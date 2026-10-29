import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { makeRoll } from '../engine/core/dice.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import type { Action } from '../engine/table/actions.ts'
import { applyAction } from '../engine/table/reducer.ts'
import { newTable, type TableState } from '../engine/table/state.ts'
import { analyzeLayout } from './layout.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  let state = newTable(cfg, 'layout')
  for (const action of actions) {
    const result = applyAction(state, action, cfg)
    if (!result.ok) throw new Error(`${action.type}: ${result.rejection.code}`)
    state = result.state
  }
  return state
}

describe('analyzeLayout', () => {
  it('adds up the standing costs and shows them per hour at 60, the machine pace and 150', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(1_000) },
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
      { type: 'place', typeId: 'place', number: 8, amount: cents(600) },
    ])
    const layout = analyzeLayout(state, crapless)
    const expected = Fraction.of(373_000, 28839).add(Fraction.of(1_200, 216))
    expect(layout.perRoll.toString()).toBe(expected.toString())
    expect(layout.perHour.map(({ at }) => at)).toEqual([60, 120, 150])
    expect(layout.perHour[1]?.value.toString()).toBe(expected.mul(Fraction.of(120)).toString())
    expect(layout.alternativeLayout).toBeNull()
  })

  it('counts a come stream once, at the stake in the box, and prices a pass on its point per come-out', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'roll', dice: makeRoll(2, 2) },
      { type: 'place', typeId: 'come', amount: cents(500) },
      { type: 'roll', dice: makeRoll(3, 3) },
      { type: 'place', typeId: 'come', amount: cents(700) },
    ])
    const layout = analyzeLayout(state, crapless)
    const come = layout.byBet.filter(({ spec }) => spec.typeId === 'come')
    expect(come.map(({ cost }) => cost === null)).toEqual([true, false])
    expect(come[0]?.countedIn).toBe(come[1]?.betId)
    expect(come[1]?.amount).toBe(700)
    const pass = layout.byBet.find(({ spec }) => spec.typeId === 'pass')
    expect(pass?.spec.number).toBeNull()
    expect(pass?.cost?.perRoll.toString()).toBe(Fraction.of(373 * 500, 28839).toString())
  })

  it('builds the same exposure from same-event swaps: buy 4 for place 4', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'place', number: 4, amount: cents(500) },
    ])
    const layout = analyzeLayout(state, crapless)
    expect(layout.alternativeLayout?.swaps).toEqual([
      { betId: state.bets[0]?.id, to: { typeId: 'buy', number: 4 }, amount: 500 },
    ])
    // Place 4: 1/60 of $5 a roll; buy 4 with 25¢ up front and again: 25¢ ÷ 4 rolls a decision.
    expect(layout.perRoll.toString()).toBe(Fraction.of(500, 60).toString())
    expect(layout.alternativeLayout?.perRoll.toString()).toBe(Fraction.of(25, 4).toString())
  })
})
