import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { deepFreeze } from '../config/compile.ts'
import {
  POINT_NUMBERS,
  isPointNumber,
  makeRuleset,
  type PointNumber,
  type Ruleset,
  type Variant,
} from '../config/rulesets.ts'
import type { Dice, DieFace, Total } from '../core/dice.ts'
import { Fraction } from '../core/rational.ts'
import {
  advanceRound,
  initialRound,
  totalBit,
  totalsInMask,
  type Phase,
  type RoundState,
  type RoundStep,
  type RoundTransition,
} from './round.ts'

// These tests are written from docs/rules/rules-spec.md (§0.1 hand, §1.3 constants, §2.1 round
// transitions and counters), with their own dice and mask helpers.

const FACES: readonly DieFace[] = [1, 2, 3, 4, 5, 6]
const TOTALS: readonly Total[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
/** All 36 ways two dice can land. */
const ALL_DICE: readonly Dice[] = FACES.flatMap((d1) => FACES.map((d2) => ({ d1, d2 })))
const sum = ({ d1, d2 }: Dice) => (d1 + d2) as Total
const pairs = (...faces: (readonly [DieFace, DieFace])[]): Dice[] =>
  faces.map(([d1, d2]) => ({ d1, d2 }))
/** Mask bit `n` stands for total (or point) n. */
const bit = (n: number) => 1 << n
const inMask = (mask: number) => TOTALS.filter((total) => (mask & bit(total)) !== 0)

const CRAPLESS = makeRuleset('crapless', null)
const TRADITIONAL = makeRuleset('traditional', 12)
const RENO = makeRuleset('traditional', 2)
const COME_OUT: Phase = { kind: 'comeOut' }

/** A round partway into a session: the third hand, five rolls in, its 4 already made. */
const MIDWAY: RoundState = {
  phase: COME_OUT,
  rollIndex: 23,
  hand: { index: 2, rolls: 5, pointsMadeMask: bit(4) },
  sinceSeven: { rolls: 3, totalsMask: bit(4) | bit(9) },
}

interface Step extends RoundStep {
  readonly before: RoundState
  readonly dice: Dice
}

/** Rolls `dice` in order from the session start; returns every step. */
function play(rules: Ruleset, dice: readonly Dice[]): Step[] {
  let round = initialRound()
  return dice.map((roll) => {
    const before = round
    const step = advanceRound(before, roll, rules)
    round = step.next
    return { before, dice: roll, ...step }
  })
}

// ---------------------------------------------------------------------------------------------
// The round table
// ---------------------------------------------------------------------------------------------

/**
 * Rules spec §2.1, written out by hand: one row per phase before the roll (CO is the come-out,
 * otherwise the point) and one column per total. Both games list all eleven phase states, and the
 * test expands each cell to every roll of the dice that shows its total.
 *
 * N natural · C craps · P the total becomes the point · M point made · S seven-out ·
 * - nothing happens · ! the game has no such point, so the round is rejected
 */
const ROUND_TABLE: Readonly<Record<Variant, readonly string[]>> = {
  crapless: [
    //     2  3  4  5  6  7  8  9 10 11 12
    'CO    P  P  P  P  P  N  P  P  P  P  P',
    '2     M  -  -  -  -  S  -  -  -  -  -',
    '3     -  M  -  -  -  S  -  -  -  -  -',
    '4     -  -  M  -  -  S  -  -  -  -  -',
    '5     -  -  -  M  -  S  -  -  -  -  -',
    '6     -  -  -  -  M  S  -  -  -  -  -',
    '8     -  -  -  -  -  S  M  -  -  -  -',
    '9     -  -  -  -  -  S  -  M  -  -  -',
    '10    -  -  -  -  -  S  -  -  M  -  -',
    '11    -  -  -  -  -  S  -  -  -  M  -',
    '12    -  -  -  -  -  S  -  -  -  -  M',
  ],
  traditional: [
    //     2  3  4  5  6  7  8  9 10 11 12
    'CO    C  C  P  P  P  N  P  P  P  N  C',
    '2     !  !  !  !  !  !  !  !  !  !  !',
    '3     !  !  !  !  !  !  !  !  !  !  !',
    '4     -  -  M  -  -  S  -  -  -  -  -',
    '5     -  -  -  M  -  S  -  -  -  -  -',
    '6     -  -  -  -  M  S  -  -  -  -  -',
    '8     -  -  -  -  -  S  M  -  -  -  -',
    '9     -  -  -  -  -  S  -  M  -  -  -',
    '10    -  -  -  -  -  S  -  -  M  -  -',
    '11    !  !  !  !  !  !  !  !  !  !  !',
    '12    !  !  !  !  !  !  !  !  !  !  !',
  ],
}

type Cell = 'N' | 'C' | 'P' | 'M' | 'S' | '-' | '!'
const CELLS: readonly string[] = ['N', 'C', 'P', 'M', 'S', '-', '!']
const isCell = (text: string): text is Cell => CELLS.includes(text)

interface TableRow {
  readonly label: string
  readonly phase: Phase
  /** The cell for each total from 2 to 12. */
  readonly cells: readonly Cell[]
}

function parseTable(rows: readonly string[]): TableRow[] {
  return rows.map((row) => {
    const [label = '', ...cells] = row.trim().split(/\s+/)
    const point = Number(label)
    const phase: Phase | null =
      label === 'CO' ? COME_OUT : isPointNumber(point) ? { kind: 'point', point } : null
    if (phase === null || cells.length !== TOTALS.length || !cells.every(isCell)) {
      throw new Error(`Malformed round-table row: '${row}'`)
    }
    return { label, phase, cells }
  })
}

interface Expected {
  readonly transition: {
    readonly kind: RoundTransition['kind']
    readonly total?: Total
    readonly point?: PointNumber
  }
  readonly phase: Phase
}

/** What a cell says a roll of `total` does from `phase`; null when the round is rejected. */
function expected(cell: Cell, phase: Phase, total: Total): Expected | null {
  const point = (): PointNumber => {
    if (phase.kind !== 'point') throw new Error(`'${cell}' needs a point phase`)
    return phase.point
  }
  switch (cell) {
    case 'N':
      return { transition: { kind: 'natural', total }, phase: COME_OUT }
    case 'C':
      return { transition: { kind: 'craps', total }, phase: COME_OUT }
    case 'P':
      if (!isPointNumber(total)) throw new Error(`${total} cannot be a point`)
      return {
        transition: { kind: 'pointEstablished', point: total },
        phase: { kind: 'point', point: total },
      }
    case 'M':
      return { transition: { kind: 'pointMade', point: point() }, phase: COME_OUT }
    case 'S':
      return { transition: { kind: 'sevenOut', point: point() }, phase: COME_OUT }
    case '-':
      return { transition: { kind: 'none' }, phase }
    case '!':
      return null
  }
}

describe('the round table (rules spec §2.1)', () => {
  it('lists the come-out and all ten points for both games', () => {
    for (const variant of ['crapless', 'traditional'] as const) {
      const labels = parseTable(ROUND_TABLE[variant]).map((row) => row.label)
      expect(labels).toEqual(['CO', ...POINT_NUMBERS.map(String)])
    }
  })

  describe.each([
    ['crapless', CRAPLESS],
    ['traditional, bar 12', TRADITIONAL],
    ['traditional, bar 2 (Reno)', RENO],
  ] as const)('%s: every phase × all 36 rolls', (_, rules) => {
    it.each(parseTable(ROUND_TABLE[rules.variant]))('from $label', ({ phase, cells }) => {
      const before: RoundState = { ...MIDWAY, phase }
      for (const dice of ALL_DICE) {
        const total = sum(dice)
        const want = expected(cells[total - 2]!, phase, total)
        const roll = `${dice.d1}-${dice.d2}`
        if (want === null) {
          expect(() => advanceRound(before, dice, rules), roll).toThrow(RangeError)
          continue
        }
        const { next, transition } = advanceRound(before, dice, rules)
        expect(transition, roll).toMatchObject(want.transition)
        expect(next.phase, roll).toEqual(want.phase)
      }
    })
  })
})

// ---------------------------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------------------------

describe('counters (rules spec §0.1 hand, §2.1 counters)', () => {
  /** The round after a step, field by field. */
  const summary = ({ next: r, transition }: RoundStep) =>
    `${transition.kind}; rollIndex ${r.rollIndex}; ` +
    `hand ${r.hand.index} rolls ${r.hand.rolls} made [${inMask(r.hand.pointsMadeMask)}]; ` +
    `sinceSeven rolls ${r.sinceSeven.rolls} totals [${inMask(r.sinceSeven.totalsMask)}]`

  it('start the session on the first hand’s come-out with nothing counted', () => {
    expect(initialRound()).toEqual({
      phase: { kind: 'comeOut' },
      rollIndex: 0,
      hand: { index: 0, rolls: 0, pointsMadeMask: 0 },
      sinceSeven: { rolls: 0, totalsMask: 0 },
    })
    expect(initialRound()).not.toBe(initialRound())
  })

  it('crapless: every roll counts, the hand keeps its points made, any 7 resets sinceSeven', () => {
    const steps = play(CRAPLESS, pairs([2, 2], [3, 3], [1, 3], [3, 4], [5, 6], [2, 5], [1, 1]))
    expect(steps.map(summary)).toEqual([
      'pointEstablished; rollIndex 1; hand 0 rolls 1 made []; sinceSeven rolls 1 totals [4]',
      'none; rollIndex 2; hand 0 rolls 2 made []; sinceSeven rolls 2 totals [4,6]',
      'pointMade; rollIndex 3; hand 0 rolls 3 made [4]; sinceSeven rolls 3 totals [4,6]',
      'natural; rollIndex 4; hand 0 rolls 4 made [4]; sinceSeven rolls 0 totals []',
      'pointEstablished; rollIndex 5; hand 0 rolls 5 made [4]; sinceSeven rolls 1 totals [11]',
      'sevenOut; rollIndex 6; hand 1 rolls 0 made []; sinceSeven rolls 0 totals []',
      'pointEstablished; rollIndex 7; hand 1 rolls 1 made []; sinceSeven rolls 1 totals [2]',
    ])
    // The hand that ended ran six rolls, the seven-out included, and made its 4.
    expect(steps[5]?.transition).toEqual({
      kind: 'sevenOut',
      point: 11,
      endedHand: { index: 0, rolls: 6, pointsMadeMask: bit(4) },
    })
  })

  it('traditional: craps and naturals keep the hand; only the seven-out ends it', () => {
    const steps = play(
      TRADITIONAL,
      pairs([1, 1], [1, 2], [6, 6], [5, 6], [3, 4], [4, 4], [5, 6], [4, 4], [2, 2], [1, 6]),
    )
    expect(steps.map(summary)).toEqual([
      'craps; rollIndex 1; hand 0 rolls 1 made []; sinceSeven rolls 1 totals [2]',
      'craps; rollIndex 2; hand 0 rolls 2 made []; sinceSeven rolls 2 totals [2,3]',
      'craps; rollIndex 3; hand 0 rolls 3 made []; sinceSeven rolls 3 totals [2,3,12]',
      'natural; rollIndex 4; hand 0 rolls 4 made []; sinceSeven rolls 4 totals [2,3,11,12]',
      'natural; rollIndex 5; hand 0 rolls 5 made []; sinceSeven rolls 0 totals []',
      'pointEstablished; rollIndex 6; hand 0 rolls 6 made []; sinceSeven rolls 1 totals [8]',
      'none; rollIndex 7; hand 0 rolls 7 made []; sinceSeven rolls 2 totals [8,11]',
      'pointMade; rollIndex 8; hand 0 rolls 8 made [8]; sinceSeven rolls 3 totals [8,11]',
      'pointEstablished; rollIndex 9; hand 0 rolls 9 made [8]; sinceSeven rolls 4 totals [4,8,11]',
      'sevenOut; rollIndex 10; hand 1 rolls 0 made []; sinceSeven rolls 0 totals []',
    ])
    expect(steps.map((step) => step.transition).slice(0, 5)).toEqual([
      { kind: 'craps', total: 2 },
      { kind: 'craps', total: 3 },
      { kind: 'craps', total: 12 },
      { kind: 'natural', total: 11 },
      { kind: 'natural', total: 7 },
    ])
    expect(steps[9]?.transition).toEqual({
      kind: 'sevenOut',
      point: 4,
      endedHand: { index: 0, rolls: 10, pointsMadeMask: bit(8) },
    })
  })

  it('keep one bit for a point made twice in a hand', () => {
    const steps = play(CRAPLESS, pairs([3, 3], [5, 1], [4, 2], [2, 4]))
    expect(steps.map((step) => step.transition.kind)).toEqual([
      'pointEstablished',
      'pointMade',
      'pointEstablished',
      'pointMade',
    ])
    expect(steps[3]?.next.hand.pointsMadeMask).toBe(bit(6))
  })
})

describe('masks', () => {
  it('use bit n for total n', () => {
    for (const total of TOTALS) expect(totalBit(total)).toBe(bit(total))
    expect(totalsInMask(0)).toEqual([])
    expect(totalsInMask(bit(12) | bit(2) | bit(7))).toEqual([2, 7, 12])
    expect(totalsInMask(TOTALS.reduce((mask, total) => mask | bit(total), 0))).toEqual(TOTALS)
  })
})

// ---------------------------------------------------------------------------------------------
// Rejected input
// ---------------------------------------------------------------------------------------------

describe('rejected input', () => {
  it('rejects dice that are not two faces from 1 to 6', () => {
    for (const [d1, d2] of [
      [0, 3],
      [3, 7],
      [2.5, 3],
    ]) {
      const dice = { d1, d2 } as unknown as Dice
      expect(() => advanceRound(initialRound(), dice, CRAPLESS)).toThrow(RangeError)
    }
  })

  it('rejects a point the game does not have, naming it', () => {
    const round: RoundState = { ...initialRound(), phase: { kind: 'point', point: 11 } }
    expect(() => advanceRound(round, { d1: 3, d2: 4 }, TRADITIONAL)).toThrow(
      /11 is not a point in traditional craps/,
    )
  })

  it('rejects a come-out total that the ruleset puts in no list', () => {
    const broken: Ruleset = { ...CRAPLESS, points: CRAPLESS.points.filter((p) => p !== 5) }
    expect(() => advanceRound(initialRound(), { d1: 1, d2: 4 }, broken)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

const face = fc.constantFrom(...FACES)
const diceArb = fc.record({ d1: face, d2: face })
/** A session: a game and up to 200 rolls from its start. */
const session = fc.tuple(
  fc.constantFrom(CRAPLESS, TRADITIONAL, RENO),
  fc.array(diceArb, { maxLength: 200 }),
)

/** Checks `property` on every roll of random sessions. */
function everyRoll(property: (step: Step, rules: Ruleset) => void, numRuns = 300) {
  fc.assert(
    fc.property(session, ([rules, rolls]) => {
      for (const step of play(rules, rolls)) property(step, rules)
    }),
    { seed: 20261028, numRuns },
  )
}

/** A come-out partition: 7 a natural, every other total in one list (variant is a label only). */
const partition = fc
  .tuple(...POINT_NUMBERS.map(() => fc.constantFrom('naturals', 'craps', 'points')))
  .map((lists): Ruleset => {
    const naturals: Total[] = [7]
    const craps: Total[] = []
    const points: PointNumber[] = []
    POINT_NUMBERS.forEach((total, i) => {
      if (lists[i] === 'naturals') naturals.push(total)
      else if (lists[i] === 'craps') craps.push(total)
      else points.push(total)
    })
    return { variant: 'crapless', dontBar: null, naturals, craps, points }
  })

describe('round properties (fast-check, random sessions of up to 200 rolls)', () => {
  it('swapping the dice changes nothing, which justifies the 21 dice classes (property)', () => {
    everyRoll(({ before, dice, next, transition }, rules) => {
      expect(advanceRound(before, { d1: dice.d2, d2: dice.d1 }, rules)).toEqual({
        next,
        transition,
      })
    })
  })

  it('decides each come-out roll by the list its total is in, for any partition (property)', () => {
    fc.assert(
      fc.property(partition, (rules) => {
        for (const dice of ALL_DICE) {
          const total = sum(dice)
          const { next, transition } = advanceRound(MIDWAY, dice, rules)
          const listed = [
            rules.naturals.includes(total) && 'natural',
            rules.craps.includes(total) && 'craps',
            rules.points.some((p) => p === total) && 'pointEstablished',
          ].filter((kind) => kind !== false)
          expect(listed).toEqual([transition.kind])
          expect(next.phase).toEqual(
            transition.kind === 'pointEstablished' ? { kind: 'point', point: total } : COME_OUT,
          )
        }
        // From each of its points the point phase is the same in every game: p, 7, or nothing.
        for (const point of rules.points) {
          for (const dice of ALL_DICE) {
            const total = sum(dice)
            const { transition } = advanceRound(
              { ...MIDWAY, phase: { kind: 'point', point } },
              dice,
              rules,
            )
            const kind = total === point ? 'pointMade' : total === 7 ? 'sevenOut' : 'none'
            expect(transition.kind).toBe(kind)
          }
        }
      }),
      { seed: 20261028, numRuns: 300 },
    )
  })

  it('any 7 resets sinceSeven; any other total adds a roll and its bit (property)', () => {
    everyRoll(({ before, dice, next }) => {
      const total = sum(dice)
      expect(next.sinceSeven).toEqual(
        total === 7
          ? { rolls: 0, totalsMask: 0 }
          : {
              rolls: before.sinceSeven.rolls + 1,
              totalsMask: before.sinceSeven.totalsMask | bit(total),
            },
      )
    })
  })

  it('hand.index moves on at a seven-out and nowhere else (property)', () => {
    everyRoll(({ before, next, transition }) => {
      const sevenOut = transition.kind === 'sevenOut'
      expect(next.hand.index).toBe(before.hand.index + (sevenOut ? 1 : 0))
    })
  })

  it('pointsMadeMask gains a bit only on pointMade, the point made, and clears at a seven-out (property)', () => {
    everyRoll(({ before, next, transition }) => {
      const mask = before.hand.pointsMadeMask
      if (transition.kind === 'pointMade') {
        expect(before.phase).toEqual({ kind: 'point', point: transition.point })
        expect(next.hand.pointsMadeMask).toBe(mask | bit(transition.point))
      } else if (transition.kind === 'sevenOut') {
        expect(transition.endedHand.pointsMadeMask).toBe(mask)
        expect(next.hand.pointsMadeMask).toBe(0)
      } else {
        expect(next.hand.pointsMadeMask).toBe(mask)
      }
    })
  })

  it('counts every roll in the session and in its hand, the seven-out included (property)', () => {
    everyRoll(({ before, next, transition }) => {
      expect(next.rollIndex).toBe(before.rollIndex + 1)
      if (transition.kind === 'sevenOut') {
        expect(transition.endedHand).toEqual({ ...before.hand, rolls: before.hand.rolls + 1 })
        expect(next.hand.rolls).toBe(0)
      } else {
        expect(next.hand.rolls).toBe(before.hand.rolls + 1)
      }
    })
  })

  it('keeps every reachable round consistent with its game (property)', () => {
    everyRoll(({ next }, rules) => {
      const pointBits = rules.points.reduce((mask, point) => mask | bit(point), 0)
      if (next.phase.kind === 'point') {
        expect(rules.points).toContain(next.phase.point)
        expect(next.hand.rolls).toBeGreaterThan(0)
      }
      expect(next.hand.pointsMadeMask & ~pointBits).toBe(0)
      expect(next.sinceSeven.totalsMask & bit(7)).toBe(0)
      expect(inMask(next.sinceSeven.totalsMask).length).toBeLessThanOrEqual(next.sinceSeven.rolls)
      expect(next.sinceSeven.rolls).toBeLessThanOrEqual(next.hand.rolls)
    })
  })

  it('is pure and JSON-safe: it never changes its input, and its output survives JSON (property)', () => {
    everyRoll(({ before, dice, next, transition }, rules) => {
      const frozen = deepFreeze(structuredClone(before))
      const again = advanceRound(frozen, dice, rules)
      expect(again).toEqual({ next, transition })
      expect(frozen).toEqual(before)
      expect(JSON.parse(JSON.stringify(again))).toStrictEqual(again)
    }, 100)
  })
})

// ---------------------------------------------------------------------------------------------
// Hand constants
// ---------------------------------------------------------------------------------------------

type Reward = (phase: Phase, transition: RoundTransition) => 0 | 1

/**
 * The expected sum of `reward` over one hand from its first come-out, solved exactly over
 * `advanceRound`'s own transitions: from each phase all 36 rolls are equally likely, and the hand
 * ends at the seven-out, which still counts.
 */
function perHand(rules: Ruleset, reward: Reward): Fraction {
  const phases: Phase[] = [
    COME_OUT,
    ...rules.points.map((point): Phase => ({ kind: 'point', point })),
  ]
  const indexOf = (phase: Phase) =>
    phase.kind === 'comeOut' ? 0 : 1 + rules.points.indexOf(phase.point)
  const n = phases.length
  // Row i of [I − Q | r]: Q holds the chance of each next phase within the same hand.
  const rows = phases.map((phase, i) => {
    const row = phases.map((_, j) => (i === j ? Fraction.ONE : Fraction.ZERO))
    let expectedReward = Fraction.ZERO
    for (const dice of ALL_DICE) {
      const { next, transition } = advanceRound({ ...initialRound(), phase }, dice, rules)
      expectedReward = expectedReward.add(Fraction.of(reward(phase, transition), 36))
      if (transition.kind !== 'sevenOut') {
        const j = indexOf(next.phase)
        row[j] = row[j]!.sub(Fraction.of(1, 36))
      }
    }
    return [...row, expectedReward]
  })
  // Gauss–Jordan elimination, exact.
  for (let col = 0; col < n; col++) {
    const pivot = rows.findIndex((row, i) => i >= col && !row[col]!.isZero())
    const swap = rows[pivot]!
    rows[pivot] = rows[col]!
    rows[col] = swap.map((value) => value.div(swap[col]!))
    for (let i = 0; i < n; i++) {
      const factor = rows[i]![col]!
      if (i === col || factor.isZero()) continue
      rows[i] = rows[i]!.map((value, j) => value.sub(factor.mul(rows[col]![j]!)))
    }
  }
  return rows[0]![n]!
}

describe('hand constants (rules spec §1.3), solved exactly over advanceRound', () => {
  const rewards: readonly [string, Reward, string, string][] = [
    ['rolls (seven-out included)', () => 1, '1671/196', '57678/7303'],
    [
      'come-out rolls (= pass decisions)',
      (phase) => (phase.kind === 'comeOut' ? 1 : 0),
      '495/196',
      '13860/7303',
    ],
    ['point-phase rolls', (phase) => (phase.kind === 'point' ? 1 : 0), '6', '6'],
    ['points made', (_, t) => (t.kind === 'pointMade' ? 1 : 0), '67/98', '4247/7303'],
    ['naturals', (_, t) => (t.kind === 'natural' ? 1 : 0), '55/98', '2310/7303'],
    ['craps', (_, t) => (t.kind === 'craps' ? 1 : 0), '55/196', '0'],
  ]

  it.each(rewards)('E[%s per hand]', (_, reward, traditional, crapless) => {
    expect(perHand(TRADITIONAL, reward).toString()).toBe(traditional)
    expect(perHand(RENO, reward).toString()).toBe(traditional)
    expect(perHand(CRAPLESS, reward).toString()).toBe(crapless)
  })
})
