import { describe, expect, it } from 'vitest'
import { compileConfig } from '../config/compile.ts'
import { PRESETS } from '../config/presets/index.ts'
import type { DieFace } from '../core/dice.ts'
import { cents } from '../core/money.ts'
import { Fraction } from '../core/rational.ts'
import { oddsFamily } from '../bets/families/odds.ts'
import { betId, type BetFamily } from '../bets/types.ts'
import { settle } from '../settle/settle.ts'
import type { Action } from './actions.ts'
import { InvariantError } from './invariants.ts'
import { applyAction, type ActionResult } from './reducer.ts'
import { newTable, type TableState } from './state.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

const place = (typeId: string, amount: number, parent?: number): Action =>
  parent === undefined
    ? { type: 'place', typeId, amount: cents(amount) }
    : { type: 'place', typeId, amount: cents(amount), parentId: betId(parent) }
const roll = (d1: DieFace, d2: DieFace): Action => ({ type: 'roll', dice: { d1, d2 } })

function ok(result: ActionResult): Extract<ActionResult, { ok: true }> {
  if (!result.ok) throw new Error(`rejected: ${JSON.stringify(result.rejection)}`)
  return result
}

function play(actions: readonly Action[], state = newTable(crapless, 'reducer')): TableState {
  return actions.reduce((s, action) => ok(applyAction(s, action, crapless)).state, state)
}

/** Runs `body` with some of the odds family's hooks replaced, then puts the family back. */
function withOddsHooks(hooks: Partial<BetFamily<never>>, body: () => void): void {
  const family = oddsFamily as unknown as Record<string, unknown>
  const saved = Object.fromEntries(Object.keys(hooks).map((key) => [key, family[key]]))
  Object.assign(family, hooks)
  try {
    body()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete family[key]
      else family[key] = value
    }
  }
}

describe('commission plumbing (what M4b fills in for buy and lay)', () => {
  const fivePercentUpFront: Partial<BetFamily<never>> = {
    vigOnChange: (bet, to) => ({
      charge: cents(to > bet.amount ? (to - bet.amount) / 20 : 0),
      refund: cents(to === 0 ? bet.vigHeld : 0),
    }),
  }

  it('charges up-front commission on placement and increases, holds it, and refunds it on take-down', () => {
    withOddsHooks(fivePercentUpFront, () => {
      const start = play([place('pass', 1_000), roll(2, 2)])
      const placed = ok(applyAction(start, place('passOdds', 1_000, 1), crapless))
      expect(placed.events.map((e) => e.type)).toEqual(['betPlaced', 'vigCharged'])
      expect(placed.events[1]).toMatchObject({ amount: 50, reason: 'placement' })
      expect(placed.state.bets[1]).toMatchObject({ amount: 1_000, vigHeld: 50 })
      expect(placed.state.ledger).toMatchObject({ bankroll: 47_950, houseNet: 50, vigPaid: 50 })

      const pressed = ok(applyAction(placed.state, place('passOdds', 1_000, 1), crapless))
      expect(pressed.events[1]).toMatchObject({
        type: 'vigCharged',
        amount: 50,
        reason: 'increase',
      })
      expect(pressed.state.bets[1]).toMatchObject({ amount: 2_000, vigHeld: 100 })

      const down = ok(
        applyAction(
          pressed.state,
          { type: 'setAmount', betId: betId(2), amount: cents(0) },
          crapless,
        ),
      )
      expect(down.events.map((e) => e.type)).toEqual(['betRemoved', 'vigRefunded'])
      expect(down.state.ledger).toMatchObject({ bankroll: 49_000, houseNet: 0, vigPaid: 0 })
    })
  })

  it('counts the commission in the credit a bet needs', () => {
    withOddsHooks(fivePercentUpFront, () => {
      const broke = play([place('pass', 49_000), roll(2, 2)])
      expect(applyAction(broke, place('passOdds', 1_000, 1), crapless)).toEqual({
        ok: false,
        rejection: { code: 'INSUFFICIENT_CREDIT', details: { needed: 1_050, available: 1_000 } },
      })
    })
  })

  it('takes commission from a win through the hook, rounded in rounded mode only', () => {
    // A thirtieth of the win, rounded up to the cent, so the rounding shows.
    const commissionOnWin: Partial<BetFamily<never>> = {
      winCommission: (_bet, _decision, win, _type, round) => ({
        onWin: round(win.mul(Fraction.of(1, 30)), { mode: 'ceil', increment: cents(1) }),
        rearm: Fraction.ZERO,
      }),
    }
    withOddsHooks(commissionOnWin, () => {
      const state = play([place('pass', 1_000), roll(2, 2), place('passOdds', 1_000, 1)])
      const made = ok(applyAction(state, roll(1, 3), crapless))
      const traces = made.events.flatMap((e) => (e.type === 'betResolved' ? [e.trace] : []))
      expect(traces[1]).toMatchObject({ winPaid: 2_000, vigOnWin: 67, credited: 2_933 })
      expect(made.state.ledger).toMatchObject({ vigPaid: 67, bankroll: 51_933 })
      const exact = settle(
        state.bets[1]!,
        { kind: 'win', payKey: '4', stake: 'return' },
        crapless,
        'exact',
      )
      expect(exact.vigOnWin.equals(Fraction.of(200, 3))).toBe(true)
    })
  })
})

describe('the roll pipeline', () => {
  it('reports progress decisions (what side bets will use, M11)', () => {
    const progress: Partial<BetFamily<never>> = {
      decide: () => ({ kind: 'progress', progress: 3 }),
      apply: (bet, decision) =>
        decision.kind === 'progress' ? { ...bet, progress: decision.progress } : bet,
    }
    withOddsHooks(progress, () => {
      const state = play([place('pass', 1_000), roll(2, 2), place('passOdds', 1_000, 1)])
      const rolled = ok(applyAction(state, roll(5, 5), crapless))
      expect(rolled.events).toContainEqual({ type: 'betProgress', betId: 'b2', progress: 3 })
      expect(rolled.state.bets[1]?.progress).toBe(3)
    })
  })
})

describe('applyAction', () => {
  it('nests batches and names the failing action of the outer one', () => {
    const start = newTable(crapless, 'batch')
    const inner: Action = { type: 'batch', actions: [place('pass', 1_000), place('field', 100)] }
    const both = ok(
      applyAction(start, { type: 'batch', actions: [inner, place('field', 100)] }, crapless),
    )
    expect(both.state.bets.map((b) => [b.typeId, b.amount])).toEqual([
      ['pass', 1_000],
      ['field', 200],
    ])
    const bad = applyAction(
      start,
      { type: 'batch', actions: [inner, place('dontPass', 500)] },
      crapless,
    )
    expect(bad).toEqual({
      ok: false,
      rejection: { code: 'NOT_OFFERED', details: { typeId: 'dontPass', batchIndex: 1 } },
    })
    const deep: Action = { type: 'batch', actions: [place('pass', 1_000), place('come', 500)] }
    expect(
      applyAction(start, { type: 'batch', actions: [place('field', 100), deep] }, crapless),
    ).toMatchObject({ ok: false, rejection: { code: 'WRONG_PHASE', details: { batchIndex: 1 } } })
  })

  it('refuses a roll in a batch at any depth, before applying any of it (plan §4.9)', () => {
    const start = newTable(crapless, 'batch')
    const inner: Action = { type: 'batch', actions: [place('pass', 1_000), roll(3, 3)] }
    for (const actions of [
      [place('pass', 1_000), roll(3, 3)],
      [place('field', 60_000), roll(3, 3)],
      [place('field', 100), { type: 'batch', actions: [inner] } as Action],
    ]) {
      expect(applyAction(start, { type: 'batch', actions }, crapless)).toEqual({
        ok: false,
        rejection: {
          code: 'BAD_PARAMS',
          details: { field: 'actions', reason: 'roll', batchIndex: 1 },
        },
      })
    }
  })

  it('refuses a batch that contains itself, and flattens any depth of nesting without recursion', () => {
    const start = newTable(crapless, 'batch')
    const looped: { type: 'batch'; actions: Action[] } = { type: 'batch', actions: [] }
    looped.actions.push(place('field', 100), looped)
    expect(applyAction(start, looped, crapless)).toEqual({
      ok: false,
      rejection: {
        code: 'BAD_PARAMS',
        details: { field: 'actions', reason: 'cycle', batchIndex: 1 },
      },
    })
    let nested: Action = place('pass', 1_000)
    for (let depth = 0; depth < 100_000; depth++) nested = { type: 'batch', actions: [nested] }
    expect(ok(applyAction(start, nested, crapless)).state.bets).toHaveLength(1)
    const bad: Action = { type: 'batch', actions: [{ type: 'batch', actions: 'x' } as never] }
    expect(applyAction(start, bad, crapless)).toEqual({
      ok: false,
      rejection: { code: 'BAD_PARAMS', details: { field: 'actions', batchIndex: 0 } },
    })
  })

  it('checks the invariants of the state it returns, unless told not to', () => {
    const start = newTable(crapless, 'corrupt')
    const corrupt = { ...start, ledger: { ...start.ledger, deposits: cents(1) } }
    const pass = place('pass', 1_000)
    expect(() => applyAction(corrupt, pass, crapless)).toThrow(InvariantError)
    expect(applyAction(corrupt, pass, crapless, { checkInvariants: false }).ok).toBe(true)
  })
})
