import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { makeRoll } from '../engine/core/dice.ts'
import { hashJson } from '../engine/core/hash.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import type { Action } from '../engine/table/actions.ts'
import { applyAction } from '../engine/table/reducer.ts'
import { newTable, type TableState } from '../engine/table/state.ts'
import { analyzeLayout, standingCost } from '../exact/index.ts'
import { formatPart } from './format.ts'
import { layoutMeter, type MeterToggle } from './meter.ts'
import type { TemplateParts } from './types.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

const SET_OFF: MeterToggle = { action: { type: 'setGlobalWorking', off: true }, showSetOn: false }

function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  let state = newTable(cfg, 'meter-test')
  for (const action of actions) {
    const result = applyAction(state, action, cfg)
    if (!result.ok) throw new Error(`${action.type}: ${result.rejection.code}`)
    state = result.state
  }
  return state
}

function text(parts: TemplateParts): string {
  return parts.map((part) => formatPart(part)).join('')
}

describe('layoutMeter', () => {
  it('is Σ standingCost: the meter equals the per-bet standing costs and analyzeLayout (§10 M9d)', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(1_000) },
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
      { type: 'place', typeId: 'place', number: 8, amount: cents(600) },
    ])
    const meter = layoutMeter(state, crapless)
    const direct = Fraction.sum(
      state.bets.map(
        (bet) =>
          standingCost(
            { typeId: bet.typeId, number: bet.typeId === 'pass' ? null : bet.number },
            bet.amount,
            crapless,
            { working: bet.working, globalOff: state.globalOff },
          ).perRoll,
      ),
    )
    expect(meter.perRoll.exact instanceof Fraction && meter.perRoll.exact.equals(direct)).toBe(true)
    expect(
      meter.perRoll.exact instanceof Fraction &&
        meter.perRoll.exact.equals(analyzeLayout(state, crapless).perRoll),
    ).toBe(true)
    expect(
      meter.perRoll.exact instanceof Fraction &&
        meter.perRoll.exact.equals(
          Fraction.sum(
            meter.byBet.map((bet) =>
              bet.perRoll !== null && bet.perRoll.exact instanceof Fraction
                ? bet.perRoll.exact
                : Fraction.ZERO,
            ),
          ),
        ),
    ).toBe(true)
    expect(meter.perRoll.kind).toBe('money')
    expect(meter.perRoll.source).toEqual({
      fn: 'analyzeLayout',
      args: { stateHash: hashJson(state) },
      configHash: crapless.configHash,
    })
  })

  it('shows the hourly line over the 60–150 range with the machine pace marked and assumed', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'place', number: 4, amount: cents(500) },
    ])
    const meter = layoutMeter(state, crapless)
    expect(meter.hourly.map(({ at }) => at)).toEqual([60, 120, 150])
    expect(meter.hourly.map(({ machine }) => machine)).toEqual([false, true, false])
    const layout = analyzeLayout(state, crapless)
    meter.hourly.forEach((pace, index) => {
      const value = layout.perHour[index]?.value
      expect(
        value !== undefined &&
          pace.value.exact instanceof Fraction &&
          pace.value.exact.equals(value),
      ).toBe(true)
    })
    // Place 4 at $5 loses 1/60 of the stake a roll: 8.33… cents, $5.00 an hour at 60 rolls.
    expect(text(meter.headline.parts)).toBe('Keeping these bets up costs ≈ $0.08 a roll.')
    expect(meter.hourly.map((pace) => text(pace.line.parts))).toEqual([
      '60 rolls/hr: $5.00',
      '120 rolls/hr (this machine): $10.00',
      '150 rolls/hr: $12.50',
    ])
    // The machine's pace is an assumed value on this preset; the anchors are not.
    expect(meter.hourly[1]?.value.assumedPaths).toContain('/pace/rollsPerHour')
    expect(meter.hourly[0]?.value.assumedPaths).not.toContain('/pace/rollsPerHour')
  })

  it('offers the cheapest same-event relayout with its swap lines and exact saving', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'place', number: 4, amount: cents(500) },
    ])
    const meter = layoutMeter(state, crapless)
    expect(meter.alternative).not.toBeNull()
    const layout = analyzeLayout(state, crapless)
    expect(
      meter.alternative !== null &&
        meter.alternative.perRoll.exact instanceof Fraction &&
        layout.alternativeLayout !== null &&
        meter.alternative.perRoll.exact.equals(layout.alternativeLayout.perRoll),
    ).toBe(true)
    expect(
      meter.alternative !== null &&
        meter.alternative.saving.exact instanceof Fraction &&
        layout.alternativeLayout !== null &&
        meter.alternative.saving.exact.equals(layout.perRoll.sub(layout.alternativeLayout.perRoll)),
    ).toBe(true)
    expect(meter.alternative?.swaps.map((swap) => text(swap.line.parts))).toEqual([
      'Swap Place 4 into Buy 4 at $5.00.',
    ])
  })

  it('counts a come stream once and says which bet carries it', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'roll', dice: makeRoll(2, 2) },
      { type: 'place', typeId: 'come', amount: cents(500) },
      { type: 'roll', dice: makeRoll(3, 3) },
      { type: 'place', typeId: 'come', amount: cents(700) },
    ])
    const meter = layoutMeter(state, crapless)
    const come = meter.byBet.filter((bet) => bet.label === 'Come')
    expect(come).toHaveLength(2)
    const first = come[0]
    expect(first?.perRoll).toBeNull()
    expect(first !== undefined && first.counted !== null && text(first.counted.parts)).toBe(
      'counted with Come',
    )
    expect(come[1]?.perRoll).not.toBeNull()
  })

  it('prices the working toggle on the dry-run table: Set bets OFF zeroes a place-only layout', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'place', number: 4, amount: cents(500) },
    ])
    const meter = layoutMeter(state, crapless, SET_OFF)
    expect(meter.toggled !== null && text(meter.toggled.parts)).toBe(
      'Set bets OFF and this becomes $0.00 a roll.',
    )
    const dryRun = applyAction(state, SET_OFF.action, crapless)
    expect(dryRun.ok).toBe(true)
    if (dryRun.ok) {
      expect(analyzeLayout(dryRun.state, crapless).perRoll.isZero()).toBe(true)
    }
  })

  it('answers an empty table with a zero meter, no rows and no toggle line', () => {
    const meter = layoutMeter(newTable(crapless, 'empty'), crapless, SET_OFF)
    expect(meter.perRoll.exact instanceof Fraction && meter.perRoll.exact.isZero()).toBe(true)
    expect(meter.byBet).toEqual([])
    expect(meter.alternative).toBeNull()
    expect(meter.toggled).toBeNull()
  })

  it('refuses a table from another config, like the engine does', () => {
    const strict = compileConfig(PRESETS.strictBubble)
    expect(() => layoutMeter(newTable(strict, 'other'), crapless)).toThrow(RangeError)
  })
})
