import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../config/compile.ts'
import { PRESETS } from '../config/presets/index.ts'
import type { PointNumber } from '../config/rulesets.ts'
import type { Total } from '../core/dice.ts'
import { cents } from '../core/money.ts'
import { betId, type BetInstance } from '../bets/types.ts'
import type { Action } from './actions.ts'
import { InvariantError, assertInvariants, invariantViolations } from './invariants.ts'
import { applyAction } from './reducer.ts'
import { newTable, type TableState } from './state.ts'

// Each invariant is checked on a sound table with one problem planted in it: the checker must find
// that problem, in words that name it.

const crapless = compileConfig(PRESETS.craplessBubble)
const traditional = compileConfig(PRESETS.strictBubble)

function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  return actions.reduce(
    (state, action) => {
      const result = applyAction(state, action, cfg)
      if (!result.ok) throw new Error(`${JSON.stringify(action)}: ${result.rejection.code}`)
      return result.state
    },
    newTable(cfg, 'invariants'),
  )
}

/** $10 pass on 6 with $20 of odds, and a $5 come bet in the box. */
const sound = play(crapless, [
  { type: 'place', typeId: 'pass', amount: cents(1_000) },
  { type: 'roll', dice: { d1: 3, d2: 3 } },
  { type: 'place', typeId: 'passOdds', amount: cents(2_000), parentId: betId(1) },
  { type: 'place', typeId: 'come', amount: cents(500) },
])

/** `sound` with its bets replaced by `change` of them. */
function withBets(change: (bets: BetInstance[]) => BetInstance[]): TableState {
  return { ...sound, bets: change(sound.bets.map((bet) => ({ ...bet }))) }
}

function bet(index: number, more: Partial<BetInstance>): (bets: BetInstance[]) => BetInstance[] {
  return (bets) => bets.map((b, i) => (i === index ? { ...b, ...more } : b))
}

const found = (state: TableState, cfg: MachineConfig = crapless) => invariantViolations(state, cfg)

describe('table invariants', () => {
  it('hold on a sound table', () => {
    expect(found(sound)).toEqual([])
    expect(() => assertInvariants(sound, crapless)).not.toThrow()
  })

  it.each([
    ['the config', { ...sound, configHash: 'other' }, /config other/],
    ['the ledger balance', { ...sound, ledger: { ...sound.ledger, deposits: cents(1) } }, /off by/],
    [
      'whole cents',
      { ...sound, ledger: { ...sound.ledger, vigPaid: 0.5 } },
      /vigPaid is not whole/,
    ],
    [
      'a negative bankroll',
      {
        ...sound,
        ledger: {
          ...sound.ledger,
          bankroll: cents(-100),
          houseNet: cents(sound.ledger.houseNet + 100),
        },
      },
      /bankroll is negative/,
    ],
    ['the last roll', { ...sound, lastRoll: null }, /does not match lastRoll/],
    [
      'the history length',
      { ...sound, recentTotals: Array<Total>(21).fill(7) },
      /history holds 21/,
    ],
    ['the history totals', { ...sound, recentTotals: [13 as Total] }, /bad total/],
    ['a blocked type', { ...sound, rebetBlocked: ['nope'] }, /rebetBlocked names "nope"/],
    ['a twice-blocked type', { ...sound, rebetBlocked: ['come', 'come'] }, /lists come twice/],
    ['the next bet id', { ...sound, nextBetSeq: 2 }, /not below nextBetSeq 2/],
  ] as const)('find a problem with %s', (_what, state, message) => {
    expect(found(state as TableState)).toEqual(
      expect.arrayContaining([expect.stringMatching(message)]),
    )
    expect(() => assertInvariants(state as TableState, crapless)).toThrow(InvariantError)
  })

  it.each([
    ['bets out of order', (bets: BetInstance[]) => [bets[1]!, bets[0]!, bets[2]!], /out of order/],
    ['a bad amount', bet(2, { amount: cents(0) }), /bad amount/],
    ['bad commission', bet(2, { vigHeld: cents(-1) }), /bad commission/],
    ['a bet placed in the future', bet(2, { placedAtRoll: 9 }), /placed at roll 9/],
    ['an unknown type', bet(2, { typeId: 'nope' }), /type "nope"/],
    ['a missing parent', bet(1, { parentId: betId(7) }), /no pass bet to back/],
    ['odds off their parent', bet(1, { number: 8 }), /b2 is on 8, its parent on 6/],
    ['odds above the cap', bet(1, { amount: cents(2_100) }), /above the 2000¢ cap/],
    ['a pass off the point', bet(0, { number: 8 }), /b1 \(pass\) is on 8 but the point is 6/],
    [
      'two come bets on one number (a merge)',
      (bets: BetInstance[]) => [
        ...bets.slice(0, 2),
        { ...bets[2]!, number: 9 as PointNumber },
        { ...bets[2]!, id: betId(4), number: 9 as PointNumber },
      ],
      /two bets share one spot \(come on 9/,
    ],
  ] as const)('find %s', (_what, change, message) => {
    const state = { ...withBets(change), nextBetSeq: 5 }
    expect(found(state)).toEqual(expect.arrayContaining([expect.stringMatching(message)]))
  })

  it('find a point or a bet number that the game does not have', () => {
    const base = play(traditional, [{ type: 'place', typeId: 'pass', amount: cents(1_000) }])
    const onTwo = {
      ...base,
      round: { ...base.round, phase: { kind: 'point' as const, point: 2 as PointNumber } },
    }
    expect(found(onTwo, traditional)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/the point 2 is not a point in traditional craps/),
        expect.stringMatching(/b1 \(pass\) is on null but the point is 2/),
      ]),
    )
    const comeOnTwo = {
      ...base,
      bets: [{ ...base.bets[0]!, typeId: 'come', number: 2 as PointNumber }],
    }
    expect(found(comeOnTwo, traditional)).toEqual(['b1 is on 2, not a point in traditional craps'])
  })

  it('list every problem in the error', () => {
    const broken = { ...sound, configHash: 'other', nextBetSeq: 2 }
    try {
      assertInvariants(broken, crapless)
      throw new Error('no error')
    } catch (error) {
      expect(error).toBeInstanceOf(InvariantError)
      expect((error as InvariantError).violations.length).toBeGreaterThan(1)
      expect((error as InvariantError).message).toMatch(/^Table invariants violated: /)
    }
  })
})

// M4d: JSON-safety, the generic bet checks, and what one action may not change.
describe('more table invariants (M4d)', () => {
  it.each([
    [
      'a bigint',
      { ...sound, ledger: { ...sound.ledger, wagered: 5n } },
      /ledger\.wagered is a bigint/,
    ],
    ['undefined', { ...sound, lastRoll: undefined }, /state\.lastRoll is a undefined/],
    ['NaN', { ...sound, recentTotals: [Number.NaN] }, /recentTotals\[0\] is NaN/],
    ['a Map', { ...sound, rebetBlocked: new Map() }, /state\.rebetBlocked is not a plain object/],
    ['a class instance', { ...sound, lastRoll: new Date(0) }, /state\.lastRoll is not a plain/],
  ] as const)('find state that JSON cannot carry: %s', (_what, state, message) => {
    expect(found(state as unknown as TableState)).toEqual(
      expect.arrayContaining([expect.stringMatching(message)]),
    )
  })

  it('find a table that contains itself', () => {
    const looped: Record<string, unknown> = { ...sound }
    looped.self = looped
    expect(found(looped as unknown as TableState)).toEqual(
      expect.arrayContaining([expect.stringMatching(/state\.self contains itself/)]),
    )
  })

  it.each([
    [
      'a duplicate id',
      (bets: BetInstance[]) => [...bets, { ...bets[2]!, typeId: 'field' }],
      /two bets have the id b3/,
    ],
    [
      'a bet above its maximum',
      bet(0, { amount: cents(50_100) }),
      /b1 \(pass\) breaks its limits: ABOVE_MAX/,
    ],
    [
      'a bet off its increment',
      bet(2, { amount: cents(550) }),
      /b3 \(come\) breaks its limits: BAD_INCREMENT/,
    ],
    [
      'commission on a line bet',
      bet(2, { vigHeld: cents(5) }),
      /b3 \(come\) holds 5¢ of commission its family never charges/,
    ],
    [
      'a parent behind a line bet',
      bet(2, { parentId: betId(1) }),
      /b3 \(come\) backs b1, but only odds back a bet/,
    ],
  ] as const)('find %s', (_what, change, message) => {
    expect(found({ ...withBets(change), nextBetSeq: 5 })).toEqual(
      expect.arrayContaining([expect.stringMatching(message)]),
    )
  })

  it('find a layout above /limits/tableMax', () => {
    const input = structuredClone(PRESETS.craplessBubble)
    input.id = 'craplessTableMax'
    input.limits.tableMax = 50_000
    const capped = compileConfig(input)
    const table = { ...sound, configHash: capped.configHash }
    expect(found(table, capped)).toEqual([])
    const over = {
      ...table,
      bets: table.bets.map((b) => (b.typeId === 'come' ? { ...b, amount: cents(47_500) } : b)),
    }
    const ledger = { ...over.ledger, deposits: cents(over.ledger.deposits + 47_000) }
    expect(found({ ...over, ledger }, capped)).toEqual([
      'the table holds 50500¢, above the 50000¢ table maximum',
    ])
  })

  describe('what one action may not change', () => {
    const change = (after: TableState) => invariantViolations(after, crapless, sound)

    it('nothing, when the action is sound', () => {
      const next = applyAction(sound, { type: 'roll', dice: { d1: 3, d2: 3 } }, crapless)
      if (!next.ok) throw new Error('refused')
      expect(change(next.state)).toEqual([])
    })

    it.each([
      ['the config', { ...sound, configHash: 'other' }, /changed the table's config/],
      ['nextBetSeq going back', { ...sound, nextBetSeq: 3 }, /nextBetSeq went back from 4 to 3/],
      [
        'the round going back',
        { ...sound, round: { ...sound.round, rollIndex: 0 } },
        /round went back/,
      ],
      [
        'deposits falling',
        { ...sound, ledger: { ...sound.ledger, deposits: cents(1) } },
        /deposits went down/,
      ],
      [
        'the wagered amount falling',
        { ...sound, ledger: { ...sound.ledger, wagered: cents(-1) } },
        /wagered went down/,
      ],
      [
        'a bet changing type',
        { ...sound, bets: sound.bets.map((b) => (b.id === 'b3' ? { ...b, typeId: 'field' } : b)) },
        /b3 changed from come behind null to field/,
      ],
      [
        'a bet changing its placement roll',
        { ...sound, bets: sound.bets.map((b) => (b.id === 'b3' ? { ...b, placedAtRoll: 0 } : b)) },
        /b3 changed its placement roll/,
      ],
    ] as const)('find %s', (_what, after, message) => {
      expect(change(after as TableState)).toEqual(
        expect.arrayContaining([expect.stringMatching(message)]),
      )
    })

    it('find an id given out before and taken down coming back', () => {
      const taken = applyAction(
        sound,
        { type: 'setAmount', betId: betId(3), amount: cents(0) },
        crapless,
      )
      if (!taken.ok) throw new Error('refused')
      const reused = { ...taken.state, bets: [...taken.state.bets, sound.bets[2]!] }
      expect(invariantViolations(reused, crapless, taken.state)).toEqual(
        expect.arrayContaining([expect.stringMatching(/b3 reuses an id given out before/)]),
      )
    })

    it('are checked by applyAction against the table it was given', () => {
      expect(() => assertInvariants({ ...sound, nextBetSeq: 3 }, crapless, sound)).toThrow(
        /nextBetSeq went back/,
      )
    })
  })
})
