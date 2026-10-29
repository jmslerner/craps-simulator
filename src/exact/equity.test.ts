import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { cents } from '../engine/core/money.ts'
import { makeRoll } from '../engine/core/dice.ts'
import { betId } from '../engine/bets/types.ts'
import type { Action } from '../engine/table/actions.ts'
import { applyAction } from '../engine/table/reducer.ts'
import { heldOffOf, newTable, type TableState } from '../engine/table/state.ts'
import { analyzeExisting, takeDownValue } from './equity.ts'

/** Plays `actions` from a new table, failing on any refusal. */
function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  let state = newTable(cfg, 'equity')
  for (const action of actions) {
    const result = applyAction(state, action, cfg)
    if (!result.ok) throw new Error(`${action.type}: ${result.rejection.code}`)
    state = result.state
  }
  return state
}

const crapless = compileConfig(PRESETS.craplessBubble)

describe('analyzeExisting', () => {
  it('values a $10 crapless pass on point 2 at $20/7, and its odds at their stake', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(1_000) },
      { type: 'roll', dice: makeRoll(1, 1) },
      { type: 'place', typeId: 'passOdds', parentId: betId(1), amount: cents(2_000) },
    ])
    const pass = analyzeExisting(betId(1), state, crapless)
    expect(pass.resolves).toBe(true)
    expect(pass.equity.toString()).toBe('2000/7')
    expect(pass.expectedLossFromNow.toString()).toBe('5000/7')
    const odds = analyzeExisting(betId(2), state, crapless)
    // True odds: 6:1 with P = 1/7 returns the stake on average.
    expect(odds.equity.toString()).toBe('2000')
    expect(odds.expectedLossFromNow.toString()).toBe('0')
    expect(odds.lifetimeLossFromNow?.toString()).toBe('0')
  })

  it('values a place bet as its decision: a $6 place 6 wins $7 with P = 5/11', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
    ])
    const place = analyzeExisting(betId(1), state, crapless)
    expect(place.equity.toString()).toBe('6500/11')
    expect(place.expectedLossFromNow.toString()).toBe('100/11')
  })

  it("is the take-down value of a bet that is never decided: Interblock's post-seven-out OFF", () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'roll', dice: makeRoll(2, 2) },
      { type: 'roll', dice: makeRoll(3, 4) },
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
    ])
    const place = state.bets.find((bet) => bet.typeId === 'place')
    expect(heldOffOf(state)).toContain(place?.id)
    const analysis = analyzeExisting(place?.id ?? betId(99), state, crapless)
    expect(analysis.resolves).toBe(false)
    expect(analysis.equity.toString()).toBe('600')
    expect(analysis.lifetimeLossFromNow).toBeNull()
  })

  it('refuses a bet that is not on the table', () => {
    expect(() => analyzeExisting(betId(7), newTable(crapless, 'x'), crapless)).toThrow(RangeError)
  })
})

describe('takeDownValue', () => {
  it('returns the stake, plus held vig where the machine refunds it', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    const state = play(live, [{ type: 'place', typeId: 'buy', number: 5, amount: cents(2_000) }])
    const buy = state.bets[0]
    if (buy === undefined) throw new Error('no buy')
    expect(buy.vigHeld).toBe(100)
    expect(takeDownValue(buy, state, live).toString()).toBe('2100')
    const ib = play(crapless, [{ type: 'place', typeId: 'buy', number: 5, amount: cents(2_000) }])
    const noRefund = ib.bets[0]
    if (noRefund === undefined) throw new Error('no buy')
    expect(takeDownValue(noRefund, ib, crapless).toString()).toBe('2000')
  })
})
