import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../config/compile.ts'
import { PRESETS } from '../config/presets/index.ts'
import type { Dice } from '../core/dice.ts'
import { cents } from '../core/money.ts'
import type { Action } from '../table/actions.ts'
import { applyAction } from '../table/reducer.ts'
import { newTable, type TableState } from '../table/state.ts'
import {
  AFTER_ROLL,
  DEFAULT_WORKING,
  EXCLUSIONS,
  FORCED_WORKING,
  RETURN_OFF_ODDS,
  ROLL_CHECKS,
} from './policies.ts'
import { betId, reject } from './types.ts'
import { effectiveWorking } from './working.ts'

// The machine-policy extension points are empty until M4b fills them. These tests put a rule in
// each list for the length of one test, to show the engine consults it in the right place and at
// the right precedence (rules spec §2.3, §2.4).

/** Runs `body` with `rule` added to `list`, then takes it out again. */
function withRule<T>(list: readonly T[], rule: T, body: () => void): void {
  const rules = list as T[]
  rules.push(rule)
  try {
    body()
  } finally {
    rules.splice(rules.indexOf(rule), 1)
  }
}

function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  return actions.reduce(
    (state, action) => {
      const result = applyAction(state, action, cfg)
      if (!result.ok) throw new Error(`${JSON.stringify(action)}: ${result.rejection.code}`)
      return result.state
    },
    newTable(cfg, 'policies'),
  )
}

const roll = (d1: Dice['d1'], d2: Dice['d2']): Action => ({ type: 'roll', dice: { d1, d2 } })
const place = (typeId: string, amount: number): Action => ({
  type: 'place',
  typeId,
  amount: cents(amount),
})

const live = compileConfig(PRESETS.traditionalLive345)
const crapless = compileConfig(PRESETS.craplessBubble)

/** Odds on the first bet placed, which is the pass line in these tests. */
const odds = (typeId: string, amount: number): Action => ({
  type: 'place',
  typeId,
  amount: cents(amount),
  parentId: betId(1),
})

/** A machine rule that switches every odds bet OFF. */
const offOdds = ({ type }: { readonly type: { readonly family: string } }) =>
  type.family === 'odds' ? false : null

/** A live table with a $10 pass on 6 and $30 of odds on it. */
const liveOdds = () => play(live, [place('pass', 1_000), roll(3, 3), odds('passOdds', 3_000)])

describe('FORCED_WORKING', () => {
  it("overrides even the player's own toggle, and the roll returns the forced-OFF odds", () => {
    const state = liveOdds()
    const bet = state.bets[1]!
    withRule(FORCED_WORKING, offOdds, () => {
      const toggled = applyAction(state, { type: 'setWorking', betId: bet.id, working: true }, live)
      if (!toggled.ok) throw new Error('setWorking was refused')
      expect(effectiveWorking(toggled.state.bets[1]!, toggled.state, live)).toBe(false)
      const rolled = applyAction(toggled.state, roll(1, 6), live)
      if (!rolled.ok) throw new Error('the roll was refused')
      const traces = rolled.events.flatMap((e) => (e.type === 'betResolved' ? [e.trace] : []))
      expect(traces.map((t) => [t.typeId, t.outcome, t.pushReason])).toEqual([
        ['pass', 'lose', null],
        ['passOdds', 'push', 'offReturned'],
      ])
    })
  })
})

describe('DEFAULT_WORKING', () => {
  it('sits below the toggles: the global button and a per-bet toggle both override it', () => {
    const state = liveOdds()
    const bet = state.bets[1]!
    withRule(DEFAULT_WORKING, offOdds, () => {
      expect(effectiveWorking(bet, state, live)).toBe(false)
      expect(effectiveWorking({ ...bet, working: true }, state, live)).toBe(true)
      const withOdds = play(crapless, [
        place('pass', 1_000),
        roll(2, 2),
        odds('passOdds', 1_000),
        { type: 'setGlobalWorking', off: false },
      ])
      expect(effectiveWorking(withOdds.bets[1]!, withOdds, crapless)).toBe(true)
      expect(effectiveWorking(withOdds.bets[1]!, { ...withOdds, globalOff: null }, crapless)).toBe(
        false,
      )
    })
  })
})

describe('RETURN_OFF_ODDS', () => {
  it('returns OFF odds on a roll that does not decide their parent', () => {
    const state = play(crapless, [
      place('pass', 1_000),
      roll(2, 2),
      odds('passOdds', 1_000),
      { type: 'setGlobalWorking', off: true },
    ])
    withRule(
      RETURN_OFF_ODDS,
      (_odds, ctx) => ctx.total === 10,
      () => {
        const rolled = applyAction(state, roll(5, 5), crapless)
        if (!rolled.ok) throw new Error('the roll was refused')
        expect(rolled.state.bets.map((b) => b.typeId)).toEqual(['pass'])
        expect(rolled.state.ledger.bankroll).toBe(49_000)
        const still = applyAction(state, roll(5, 4), crapless)
        expect(still.ok && still.state.bets.length).toBe(2)
      },
    )
  })
})

describe('ROLL_CHECKS and EXCLUSIONS', () => {
  it('a roll check can refuse the roll, leaving the table as it was', () => {
    // The table meets the machine's own minimum total ($5), so only the planted check refuses it.
    const passOnly = play(crapless, [place('pass', 500)])
    withRule(
      ROLL_CHECKS,
      (state) => (state.bets.length < 2 ? reject('BELOW_MIN') : null),
      () => {
        expect(applyAction(passOnly, roll(3, 4), crapless)).toEqual({
          ok: false,
          rejection: { code: 'BELOW_MIN', details: {} },
        })
        const both = play(crapless, [place('pass', 500), place('field', 100)])
        expect(applyAction(both, roll(3, 4), crapless).ok).toBe(true)
      },
    )
  })

  it('an exclusion can refuse a new bet', () => {
    const state = play(crapless, [place('pass', 1_000), roll(2, 2)])
    const noCome = (_s: TableState, typeId: string) =>
      typeId === 'come' ? reject('EXCLUSIVE_CONFLICT', { typeId }) : null
    withRule(EXCLUSIONS, noCome, () => {
      const result = applyAction(state, place('come', 500), crapless)
      expect(result.ok ? 'accepted' : result.rejection.code).toBe('EXCLUSIVE_CONFLICT')
    })
  })
})

describe('AFTER_ROLL', () => {
  it('runs after the roll is committed, and its state and events are kept', () => {
    const state = play(crapless, [place('pass', 1_000)])
    withRule(
      AFTER_ROLL,
      (after) => ({
        state: { ...after, globalOff: true },
        events: [{ type: 'workingChanged', scope: 'global', off: true }],
      }),
      () => {
        const rolled = applyAction(state, roll(2, 2), crapless)
        if (!rolled.ok) throw new Error('the roll was refused')
        expect(rolled.state.globalOff).toBe(true)
        expect(rolled.events.map((e) => e.type)).toEqual([
          'diceRolled',
          'pointEstablished',
          'betTraveled',
          'workingChanged',
        ])
      },
    )
  })
})
