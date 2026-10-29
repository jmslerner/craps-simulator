import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { craplessBubble } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { cents } from '../../../src/engine/core/money.ts'
import { requireType, resolveType } from '../../../src/engine/bets/registry.ts'
import type { Decision } from '../../../src/engine/bets/types.ts'
import type { Action } from '../../../src/engine/table/actions.ts'
import { applyAction, validateAction } from '../../../src/engine/table/reducer.ts'
import { newTable, type TableState } from '../../../src/engine/table/state.ts'
import { ALL_DICE, bet, decide, machine, outcome, rollContext, roundAt, sumOf } from './support.ts'

// The number-bet rule table, written from docs/rules/rules-spec.md §2.2 (the Place/Buy/Big on N and
// Lay/PTL on N columns), §2.4 (come-out defaults by machine), §3.2 (resolution and pays: place 9:5,
// 7:5, 7:6 and crapless 11:2, 11:4; buy at true odds; lay and place-to-lose the reverse; big 1:1;
// "can be placed on any roll") and §3.5 (crapless offers no lay, place-to-lose or big 6/8), with
// the bets each preset offers from §5.2. Its constants are its own.

type Kind = 'place' | 'buy' | 'big' | 'lay' | 'placeToLose'

const CRAPLESS_POINTS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const
const BOX_NUMBERS = [4, 5, 6, 8, 9, 10] as const
const BIG_NUMBERS = [6, 8] as const

/** §3.2, net to 1 by number. */
const PAYS: Readonly<Record<Kind, Partial<Record<PointNumber, readonly [bigint, bigint]>>>> = {
  place: {
    2: [11n, 2n],
    3: [11n, 4n],
    4: [9n, 5n],
    5: [7n, 5n],
    6: [7n, 6n],
    8: [7n, 6n],
    9: [7n, 5n],
    10: [9n, 5n],
    11: [11n, 4n],
    12: [11n, 2n],
  },
  buy: {
    2: [6n, 1n],
    3: [3n, 1n],
    4: [2n, 1n],
    5: [3n, 2n],
    6: [6n, 5n],
    8: [6n, 5n],
    9: [3n, 2n],
    10: [2n, 1n],
    11: [3n, 1n],
    12: [6n, 1n],
  },
  lay: { 4: [1n, 2n], 5: [2n, 3n], 6: [5n, 6n], 8: [5n, 6n], 9: [2n, 3n], 10: [1n, 2n] },
  placeToLose: { 4: [5n, 11n], 5: [5n, 8n], 6: [4n, 5n], 8: [4n, 5n], 9: [5n, 8n], 10: [5n, 11n] },
  big: { 6: [1n, 1n], 8: [1n, 1n] },
}

interface Offered {
  readonly kind: Kind
  readonly numbers: readonly PointNumber[]
  /** Whether it works on the come-out by default (§2.4, §5.2). */
  readonly comeOut: boolean
}

/**
 * The number bets each machine offers (§5.2) and its come-out defaults (§2.4): Interblock place
 * and buy work on the come-out [V] and lay, big 6/8 too [A]; Shoot To Win's place, buy and big are
 * OFF for the come-out [V] while lay and place-to-lose work [A]; a live table has place and buy
 * OFF, lay, place-to-lose and big ON [V/R]. Every number bet that wins stays up (§5.2).
 */
const MACHINES = [
  {
    name: 'craplessBubble',
    points: CRAPLESS_POINTS,
    offered: [
      { kind: 'place', numbers: CRAPLESS_POINTS, comeOut: true },
      { kind: 'buy', numbers: CRAPLESS_POINTS, comeOut: true },
    ],
    absent: ['lay', 'placeToLose', 'big'],
  },
  {
    name: 'traditionalBubble',
    points: BOX_NUMBERS,
    offered: [
      { kind: 'place', numbers: BOX_NUMBERS, comeOut: false },
      { kind: 'buy', numbers: BOX_NUMBERS, comeOut: false },
      { kind: 'placeToLose', numbers: BOX_NUMBERS, comeOut: true },
      { kind: 'lay', numbers: BOX_NUMBERS, comeOut: true },
      { kind: 'big', numbers: BIG_NUMBERS, comeOut: false },
    ],
    absent: [],
  },
  {
    name: 'strictBubble',
    points: BOX_NUMBERS,
    offered: [
      { kind: 'place', numbers: BOX_NUMBERS, comeOut: true },
      { kind: 'buy', numbers: BOX_NUMBERS, comeOut: true },
      { kind: 'lay', numbers: BOX_NUMBERS, comeOut: true },
      { kind: 'big', numbers: BIG_NUMBERS, comeOut: true },
    ],
    absent: ['placeToLose'],
  },
  {
    name: 'traditionalLive345',
    points: BOX_NUMBERS,
    offered: [
      { kind: 'place', numbers: BOX_NUMBERS, comeOut: false },
      { kind: 'buy', numbers: BOX_NUMBERS, comeOut: false },
      { kind: 'lay', numbers: BOX_NUMBERS, comeOut: true },
      { kind: 'placeToLose', numbers: BOX_NUMBERS, comeOut: true },
      { kind: 'big', numbers: BIG_NUMBERS, comeOut: true },
    ],
    absent: [],
  },
] as const satisfies readonly {
  name: string
  points: readonly PointNumber[]
  offered: readonly Offered[]
  absent: readonly Kind[]
}[]

/** Place, buy and big win on their number; lay and place-to-lose win on 7 (§3.2). */
function winsOnNumber(kind: Kind): boolean {
  return kind === 'place' || kind === 'buy' || kind === 'big'
}

/** A working bet of `kind` on n, on one roll (§2.2): the winning total wins, the other loses. */
function expected(kind: Kind, n: PointNumber, dice: Dice, stake: 'stay' | 'return'): string {
  const total = sumOf(dice)
  const wins = winsOnNumber(kind) ? n : 7
  const loses = winsOnNumber(kind) ? 7 : n
  if (total === wins) return `win:${stake}`
  if (total === loses) return 'lose'
  return 'none'
}

/** Every one of the 36 rolls on which `actual` departs from `want`, as readable lines. */
function departures(want: (dice: Dice) => string, actual: (dice: Dice) => string): string[] {
  return ALL_DICE.flatMap((dice) => {
    const [w, a] = [want(dice), actual(dice)]
    return w === a ? [] : [`${dice.d1}-${dice.d2}: expected ${w}, got ${a}`]
  })
}

/** Two dice that make `total`, the first die no higher than the second. */
function rollOf(total: number): Dice {
  return (total <= 7 ? { d1: 1, d2: total - 1 } : { d1: total - 6, d2: 6 }) as Dice
}

/** 'accepted' if the table would take `action`, else the rejection code. */
function verdict(state: TableState, action: Action, cfg: MachineConfig): string {
  return validateAction(state, action, cfg)?.code ?? 'accepted'
}

function placeOn(typeId: string, number: PointNumber | undefined, amount = 600): Action {
  return number === undefined
    ? { type: 'place', typeId, amount: cents(amount) }
    : { type: 'place', typeId, number, amount: cents(amount) }
}

describe.each(MACHINES)('number bets on $name', ({ name, points, offered: rows, absent }) => {
  const cfg = machine(name)
  const offered: readonly Offered[] = rows
  const phases: readonly (PointNumber | null)[] = [null, ...points]

  it.each(offered)(
    '$kind: wins and loses on its number and 7 in every phase, and stays up after a win',
    ({ kind, numbers }) => {
      for (const n of numbers) {
        for (const point of phases) {
          const subject = bet(kind, n)
          const got = departures(
            (dice) => expected(kind, n, dice, 'stay'),
            (dice) => outcome(decide(cfg, subject, rollContext(cfg, roundAt(point), dice))),
          )
          expect(got, `${kind} ${n}, point ${String(point)}`).toEqual([])
        }
      }
    },
  )

  it.each(offered)('$kind: switched OFF, no roll decides it', ({ kind, numbers }) => {
    for (const n of numbers) {
      for (const point of phases) {
        const subject = bet(kind, n, { working: false })
        const got = departures(
          () => 'none',
          (dice) =>
            outcome(
              decide(cfg, subject, rollContext(cfg, roundAt(point), dice, { working: false })),
            ),
        )
        expect(got, `${kind} ${n}, point ${String(point)}`).toEqual([])
      }
    }
  })

  it.each(offered)('$kind: pays its §3.2 ratio on every number', ({ kind, numbers }) => {
    const { family, type } = requireType(cfg, kind)
    for (const n of numbers) {
      const roll = rollOf(winsOnNumber(kind) ? n : 7)
      const decision = decide(cfg, bet(kind, n), rollContext(cfg, roundAt(null), roll))
      expect(decision.kind, `${kind} ${n}`).toBe('win')
      if (decision.kind !== 'win') continue
      const ratio = family.payout(type, decision.payKey)
      expect([ratio.num, ratio.den], `${kind} ${n}`).toEqual([...PAYS[kind][n]!])
    }
  })

  it.each(offered)(
    '$kind: placed on any roll, on its own numbers only (§3.2)',
    ({ kind, numbers }) => {
      // The come-out, then point 4. Only a field bet is up for the roll, which the machine's
      // minimum total needs (§2.3 step 9), and no exclusion involves it.
      const comeOut = newTable(cfg, 'rules')
      const field = applyAction(
        comeOut,
        { type: 'place', typeId: 'field', amount: cents(500) },
        cfg,
      )
      if (!field.ok) throw new Error('the field bet was refused')
      const rolled = applyAction(field.state, { type: 'roll', dice: { d1: 2, d2: 2 } }, cfg)
      if (!rolled.ok) throw new Error('the roll was refused')
      for (const state of [comeOut, rolled.state]) {
        for (const n of CRAPLESS_POINTS) {
          const want = (numbers as readonly number[]).includes(n) ? 'accepted' : 'BAD_PARAMS'
          const phase = state.round.phase.kind
          expect(verdict(state, placeOn(kind, n), cfg), `${kind} ${n}, ${phase}`).toBe(want)
        }
      }
    },
  )

  it(`works on the come-out per §2.4 and always with a point on`, () => {
    for (const { kind, comeOut } of offered) {
      const { family, type } = requireType(cfg, kind)
      expect(family.toggleable, kind).toBe(true)
      expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg), `${kind} on the come-out`).toBe(
        comeOut,
      )
      for (const point of points) {
        expect(
          family.defaultWorking({ kind: 'point', point }, type, cfg),
          `${kind}, ${point}`,
        ).toBe(true)
      }
    }
  })

  it('does not offer what the machine lacks (§3.5, §5.2)', () => {
    const table = newTable(cfg, 'rules')
    for (const kind of absent) {
      expect(resolveType(cfg, kind), kind).toBeNull()
      expect(verdict(table, placeOn(kind, 6), cfg), kind).toBe('NOT_OFFERED')
    }
  })
})

describe('the decision never depends on the amount, the parent or the round beyond the phase', () => {
  const cfg = machine('traditionalLive345')

  it('the same roll decides $1 and $500 bets alike', () => {
    for (const kind of ['place', 'buy', 'lay', 'placeToLose'] as const) {
      for (const dice of ALL_DICE) {
        const ctx = rollContext(cfg, roundAt(9), dice)
        const small = outcome(decide(cfg, bet(kind, 5, { amount: 100 }), ctx))
        const large = outcome(decide(cfg, bet(kind, 5, { amount: 50_000 }), ctx))
        expect(large, `${kind} ${dice.d1}-${dice.d2}`).toBe(small)
      }
    }
  })
})

describe('a number bet names its number', () => {
  it('a missing number or a parent is BAD_PARAMS', () => {
    const cfg = machine('craplessBubble')
    const table = newTable(cfg, 'rules')
    expect(validateAction(table, placeOn('place', undefined), cfg)).toMatchObject({
      code: 'BAD_PARAMS',
      details: { typeId: 'place', field: 'number' },
    })
    const withParent: Action = {
      type: 'place',
      typeId: 'buy',
      number: 6,
      parentId: 'b1' as never,
      amount: cents(600),
    }
    expect(validateAction(table, withParent, cfg)).toMatchObject({
      code: 'BAD_PARAMS',
      details: { typeId: 'buy', field: 'parentId' },
    })
  })

  it('a second bet of the same type on the same number adds to the first', () => {
    const cfg = machine('craplessBubble')
    let state = newTable(cfg, 'rules')
    for (const amount of [600, 1_200]) {
      const result = applyAction(state, placeOn('place', 8, amount), cfg)
      if (!result.ok) throw new Error('refused')
      state = result.state
    }
    expect(state.bets.map((b) => [b.typeId, b.number, b.amount])).toEqual([['place', 8, 1_800]])
  })
})

describe('after a win, per /catalog/<t>/afterWin', () => {
  it('a machine that returns winning place bets takes them down', () => {
    const input = structuredClone(craplessBubble)
    const place = input.catalog.place
    if (place?.family !== 'numberVsSeven') throw new Error('craplessBubble has no place bets')
    place.afterWin = 'return'
    input.id = 'craplessPlaceReturned'
    const cfg = machine(input)
    for (const n of CRAPLESS_POINTS) {
      const got = departures(
        (dice) => expected('place', n, dice, 'return'),
        (dice) => outcome(decide(cfg, bet('place', n), rollContext(cfg, roundAt(5), dice))),
      )
      expect(got, `place ${n}`).toEqual([])
    }
  })
})

describe("the family's own bookkeeping", () => {
  const cfg = machine('traditionalBubble')

  it('a winner that stays is left up; a loser, a returned winner and a push come down', () => {
    for (const kind of ['place', 'lay'] as const) {
      const { family, type } = requireType(cfg, kind)
      const subject = bet(kind, 6)
      const ctx = rollContext(cfg, roundAt(8), { d1: 3, d2: 3 })
      const after = (decision: Decision) => family.apply(subject, decision, ctx, type)
      expect(after({ kind: 'none' }), kind).toBe(subject)
      expect(after({ kind: 'win', payKey: '6', stake: 'stay' }), kind).toEqual(subject)
      expect(after({ kind: 'win', payKey: '6', stake: 'return' }), kind).toBeNull()
      expect(after({ kind: 'lose' }), kind).toBeNull()
      expect(after({ kind: 'push', reason: 'offReturned' }), kind).toBeNull()
    }
  })

  it('pays only on its numbers, and flags a bet off them or behind another bet', () => {
    const { family, type } = requireType(cfg, 'big')
    expect(() => family.payout(type, '5')).toThrow(RangeError)
    const table = newTable(cfg, 'rules')
    expect(family.invariants?.(bet('big', 6), table, type, cfg)).toEqual([])
    expect(family.invariants?.(bet('big', 5), table, type, cfg)).toEqual([
      expect.stringMatching(/on 5, not one of its numbers/),
    ])
    expect(
      family.invariants?.(bet('big', 8, { parent: bet('pass', 8) }), table, type, cfg),
    ).toEqual([expect.stringMatching(/backs b1/)])
  })

  it('flags commission held by a bet whose type takes none up front', () => {
    const held = { ...bet('buy', 4), vigHeld: cents(5) }
    const onWin = requireType(cfg, 'buy')
    expect(onWin.family.invariants?.(held, newTable(cfg, 'rules'), onWin.type, cfg)).toEqual([
      expect.stringMatching(/holds 5¢ of commission it never charges/),
    ])
    const ib = machine('craplessBubble')
    const upfront = requireType(ib, 'buy')
    expect(upfront.family.invariants?.(held, newTable(ib, 'rules'), upfront.type, ib)).toEqual([])
  })
})

describe('what a number bet reads from the config', () => {
  it('its kind, numbers, pay and commission on its number, after-win, come-out rules and rounding', () => {
    const live = machine('traditionalLive345')
    const buy = requireType(live, 'buy')
    expect(buy.family.configPaths(buy.type, 4, live)).toEqual([
      '/catalog/buy/kind',
      '/catalog/buy/numbers',
      '/catalog/buy/pays/4',
      '/catalog/buy/commissionByNumber/4',
      '/catalog/buy/afterWin',
      '/catalog/buy/comeOutDefault',
      // A live table has neither machine rule, so the paths name the null values themselves.
      '/comeOut/autoOff',
      '/afterSevenOut/newPlacedOff',
      '/money/payoutRounding',
    ])
    expect(buy.family.configPaths(buy.type, 5, live)).toContain('/catalog/buy/commission')
    expect(buy.family.configPaths(buy.type, null, live)).toEqual(
      expect.arrayContaining(['/catalog/buy/commission', '/catalog/buy/commissionByNumber']),
    )
    const stw = machine('traditionalBubble')
    const lay = requireType(stw, 'lay')
    expect(lay.family.configPaths(lay.type, 6, stw)).toEqual(
      expect.arrayContaining(['/catalog/lay/commission', '/layAutoOn']),
    )
    const place = requireType(stw, 'place')
    const paths = place.family.configPaths(place.type, 6, stw)
    // Place 6 rounds by its own per-number rule; place 5 by the type's (§4.2).
    expect(paths).toContain('/catalog/place/payoutRoundingByNumber/6')
    expect(paths).not.toContain('/catalog/place/payoutRounding')
    expect(place.family.configPaths(place.type, 5, stw)).toContain('/catalog/place/payoutRounding')
    expect(place.family.configPaths(place.type, null, stw)).toEqual(
      expect.arrayContaining([
        '/catalog/place/payoutRounding',
        '/catalog/place/payoutRoundingByNumber',
      ]),
    )
    expect(paths.some((path) => path.includes('commission') || path === '/layAutoOn')).toBe(false)
    // Shoot To Win's come-out auto-OFF is listed by part, so its assumed part shows (§9 #7).
    expect(paths).toEqual(
      expect.arrayContaining([
        '/comeOut/autoOff/carried',
        '/comeOut/autoOff/newlyPlaced',
        '/comeOut/autoOff/reOnAt',
      ]),
    )
    const ib = machine('craplessBubble')
    const ibPlace = requireType(ib, 'place')
    expect(ibPlace.family.configPaths(ibPlace.type, 6, ib)).toEqual(
      expect.arrayContaining([
        '/comeOut/autoOff',
        '/afterSevenOut/newPlacedOff/types',
        '/afterSevenOut/newPlacedOff/trigger',
        '/afterSevenOut/newPlacedOff/until',
      ]),
    )
  })
})
