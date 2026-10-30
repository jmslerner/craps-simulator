import { describe, expect, it } from 'vitest'
import {
  Fraction,
  PRESETS,
  applyAction,
  cents,
  compileConfig,
  newTable,
  validateAction,
} from '../../engine/index.ts'
import { pruneProvenance } from '../../engine/config/provenance.ts'
import type { Action, MachineConfig, TableState } from '../../engine/index.ts'
import type { MachineConfigInput } from '../../engine/index.ts'
import { analyzeBet, catalogSpecs, sameEvents, smallestAmount } from '../../exact/index.ts'
import { SAME_EVENT_MIN_SAVING } from '../policy.ts'
import { adviseSpot } from './index.ts'
import { alternatives } from './alternatives.ts'

/**
 * The alternatives advisor (plan §5.4, §10 M9c acceptance): the 5/9 advice flips across the three
 * commission settings, and the alternatives property — every sameEvent advice is offered on a real
 * table, legal by dry-run, strictly cheaper by at least the 0.25 pp threshold, and re-verified
 * with `sameEvents`.
 */

const CRAPLESS = compileConfig(PRESETS.craplessBubble)

function variant(edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(PRESETS.craplessBubble) as MachineConfigInput
  edit(input)
  return compileConfig(input)
}

function apply(state: TableState, action: Action, cfg: MachineConfig): TableState {
  const result = applyAction(state, action, cfg)
  if (!result.ok) throw new Error(`refused: ${result.rejection.code}`)
  return result.state
}

/** A table with the pass line met and one bet of `typeId` on 5 at $20. */
function tableWith(cfg: MachineConfig, typeId: string, amount = 2000): TableState {
  let state = newTable(cfg, 'alt-flip')
  state = apply(state, { type: 'place', typeId: 'pass', amount: cents(500) }, cfg)
  return apply(state, { type: 'place', typeId, number: 5, amount: cents(amount) }, cfg)
}

function sameEventFor(cfg: MachineConfig, typeId: string) {
  const state = tableWith(cfg, typeId)
  const betId = state.bets.find((bet) => bet.typeId === typeId)?.id ?? null
  const advice = adviseSpot({ cfg, spec: { typeId, number: 5 }, amount: cents(2000), state, betId })
  return { state, advice: advice.find((item) => item.ruleId === 'same-event') }
}

describe('the 5/9 advice flips across the three commission settings (plan §5.4, §10 M9c)', () => {
  it('on-win vig: buy 5 at 2.00% beats place 5 at 4.00% — advise the switch to buy', () => {
    const cfg = variant((input) => {
      const buy = input.catalog['buy']
      if (buy?.family !== 'numberVsSeven') throw new Error('no buy')
      buy.commission = { ...buy.commission, timing: 'onWin', rearm: 'none' } as never
    })
    const { state, advice } = sameEventFor(cfg, 'place')
    expect(advice?.fix?.label).toBe('Switch to Buy 5')
    expect((advice?.numbers['altEdge']?.exact as Fraction).equals(Fraction.of(1, 50))).toBe(true)
    expect((advice?.numbers['ownEdge']?.exact as Fraction).equals(Fraction.of(1, 25))).toBe(true)
    expect(
      validateAction(state, { type: 'batch', actions: [...(advice?.fix?.actions ?? [])] }, cfg),
    ).toBeNull()
  })

  it('upfront + recollect (the preset): place 5 at 4.00% beats buy 5 at 4.76% — advise place', () => {
    const { advice } = sameEventFor(CRAPLESS, 'buy')
    expect(advice?.fix?.label).toBe('Switch to Place 5')
    expect((advice?.numbers['ownEdge']?.exact as Fraction).equals(Fraction.of(1, 21))).toBe(true) // 4.76%
    expect((advice?.numbers['altEdge']?.exact as Fraction).equals(Fraction.of(1, 25))).toBe(true)
  })

  it('upfront + none: the vig amortizes over the lifecycle, so buy 5 at 2.91% wins again', () => {
    const cfg = variant((input) => {
      const buy = input.catalog['buy']
      if (buy?.family !== 'numberVsSeven') throw new Error('no buy')
      buy.commission = { ...buy.commission, rearm: 'none' } as never
    })
    const { state, advice } = sameEventFor(cfg, 'place')
    expect(advice?.fix?.label).toBe('Switch to Buy 5')
    const altEdge = advice?.numbers['altEdge']?.exact as Fraction
    expect(
      altEdge.equals(analyzeBet({ typeId: 'buy', number: 5 }, cents(2000), 'typical', cfg).edge),
    ).toBe(true)
    expect(altEdge.formatPercent(2)).toBe('2.91')
    // The lifetime-dollars fallback still dry-runs its own batch.
    expect(
      validateAction(state, { type: 'batch', actions: [...(advice?.fix?.actions ?? [])] }, cfg),
    ).toBeNull()
  })

  it('the tie stays silent: a $15 buy 4 with a $1 upfront minimum saves no money over place 4', () => {
    // The exact module's own §4.3 fixture: the live table with the 4/10 on-win override removed,
    // so the buy vig is charged up front on every number. At $15 the buy's edge is lower only
    // because the vig inflates the divisor — both lose exactly $1.00 a decision, and the lifetime
    // dollars tie too, so neither the first-decision path nor the lifecycle fallback offers it.
    const input = structuredClone(PRESETS.traditionalLive345) as MachineConfigInput
    const buy = input.catalog['buy']
    if (buy?.family !== 'numberVsSeven') throw new Error('no buy on the live preset')
    delete buy.commissionByNumber
    input.provenance = pruneProvenance(input)
    const cfg = compileConfig(input)
    let state = newTable(cfg, 'alt-tie')
    state = apply(state, { type: 'place', typeId: 'pass', amount: cents(1000) }, cfg)
    state = apply(state, { type: 'place', typeId: 'place', number: 4, amount: cents(1500) }, cfg)
    const betId = state.bets.find((bet) => bet.typeId === 'place')?.id ?? null
    const advice = alternatives({
      cfg,
      spec: { typeId: 'place', number: 4 },
      amount: cents(1500),
      state,
      betId,
    })
    expect(advice.find((item) => item.ruleId === 'same-event')).toBeUndefined()
  })
})

describe('the alternatives property (plan §10 M9c): offered ⇒ legal, cheaper, same events', () => {
  const presets = [CRAPLESS, compileConfig(PRESETS.traditionalBubble)]

  it('holds for every catalog spec that fits a fresh table, at its smallest stake', () => {
    let checked = 0
    let offered = 0
    for (const cfg of presets) {
      for (const spec of catalogSpecs(cfg)) {
        const amount = smallestAmount(spec, cfg)
        if (amount === null) continue
        let state = newTable(cfg, `alt-prop-${spec.typeId}-${spec.number ?? ''}`)
        const lineFirst = applyAction(
          state,
          { type: 'place', typeId: 'pass', amount: cents(500) },
          cfg,
        )
        if (lineFirst.ok) state = lineFirst.state
        const placed = applyAction(
          state,
          {
            type: 'place',
            typeId: spec.typeId,
            ...(spec.number === null ? {} : { number: spec.number }),
            amount,
          },
          cfg,
        )
        if (!placed.ok) continue
        state = placed.state
        const betId =
          state.bets.find((bet) => bet.typeId === spec.typeId && bet.number === spec.number)?.id ??
          null
        checked += 1
        const advice = alternatives({ cfg, spec, amount, state, betId })
        for (const item of advice) {
          if (item.ruleId !== 'same-event') continue
          offered += 1
          const to = advice.length > 0 ? item : item
          void to
          // 1. Legal by dry-run on the very table it was offered for.
          expect(item.fix, item.id).toBeDefined()
          expect(
            validateAction(state, { type: 'batch', actions: [...(item.fix?.actions ?? [])] }, cfg),
            item.id,
          ).toBeNull()
          // 2. Strictly cheaper by at least the threshold, re-priced from scratch.
          const ownEdge = analyzeBet(spec, amount, 'typical', cfg).edge
          const altSpec = {
            typeId: (item.fix?.actions.at(-1) as { typeId: string }).typeId,
            number: spec.number,
          }
          const altEdge = analyzeBet(altSpec, amount, 'typical', cfg).edge
          expect(ownEdge.sub(altEdge).compare(SAME_EVENT_MIN_SAVING) >= 0, item.id).toBe(true)
          // 3. Same events, re-verified.
          expect(sameEvents(spec, altSpec, 'typical', cfg), item.id).toBe(true)
        }
      }
    }
    expect(checked).toBeGreaterThan(30)
    expect(offered).toBeGreaterThan(0) // place 4/5/9/10 → buy on the crapless preset
  })
})
