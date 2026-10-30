import { describe, expect, it } from 'vitest'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import type { Total } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import {
  advanceRef,
  ALL_SMALL,
  ALL_TALL,
  countedRolls,
  MAKE_EM_ALL,
  placeSideBet,
  removable,
  sideBetMachineFrom,
  START_ROUND,
  stepSideBet,
  walkSideBet,
  windowOpen,
  type RefRound,
  type RefWindow,
  type SideBetMachine,
  type SideBetRule,
} from './sideBets.ts'

// The side-bet reference walker against the rules spec's own examples (§2.1, §2.6, §6.2–§6.4,
// §6.6; research sidebets.md §2 for the PA Lucky Shooter examples). Every rule constant here is
// written from the spec, so a walker that drifts from it fails here before the engine is compared.

const penny = { variant: 'traditional', rounding: { mode: 'floor', increment: 1 } } as const
const crapless = { ...penny, variant: 'crapless' } as const
const totals = (...list: number[]): Total[] => list as Total[]
const net = (n: number) => Fraction.of(n)

const small: SideBetRule = {
  family: 'collectSet',
  id: 'luckyRollerLow',
  targets: ALL_SMALL,
  pays: net(30),
  endsOn: 'anySeven',
  placement: 'afterSevenOrStart',
}
const tall: SideBetRule = { ...small, id: 'luckyRollerHigh', targets: ALL_TALL }
const all: SideBetRule = { ...small, id: 'luckyRollerAll', targets: MAKE_EM_ALL, pays: net(155) }

const fire: SideBetRule = {
  family: 'uniquePointsMade',
  id: 'fire',
  countedPoints: totals(4, 5, 6, 8, 9, 10),
  payTable: new Map([
    [4, net(24)],
    [5, net(249)],
    [6, net(999)],
  ]),
  payImmediatelyAt: null,
  placement: 'newHand',
}

/** Rules spec §6.2: 1/3/5/7/12/30/100 "for 1" at 8/16/24/32/40/45/50 rolls. */
const hotShooter: SideBetRule = {
  family: 'handLength',
  id: 'hotShooter',
  countDefinition: 'allRolls',
  tiers: [
    { minRolls: 8, net: 'push' },
    { minRolls: 16, net: net(2) },
    { minRolls: 24, net: net(4) },
    { minRolls: 32, net: net(6) },
    { minRolls: 40, net: net(11) },
    { minRolls: 45, net: net(29) },
    { minRolls: 50, net: net(99) },
  ],
  placement: 'comeOutAfterSevenOut',
  qualifyingBet: 300,
}

/** Rules spec §6.3 paytable D ("for 1"): 500 / 100 / 10 / 5 / 2 for 5+P / 5 / 4 / 3 / 2 hits. */
const luckyShooter: SideBetRule = {
  family: 'pointRun',
  id: 'luckyShooter',
  points: totals(4, 5, 6, 8, 9, 10),
  payTable: new Map([
    [2, net(1)],
    [3, net(4)],
    [4, net(9)],
    [5, net(99)],
  ]),
  topAward: net(499),
  repeatEndsBet: true,
  placement: 'beforePoint',
  removableBeforePoint: true,
}

/** The last step of a walk: its settlement, which must exist. */
function last(
  rule: SideBetRule,
  stake: number,
  rolls: number[],
  machine: Pick<SideBetMachine, 'variant' | 'rounding'> = penny,
) {
  const { steps, bet } = walkSideBet(rule, stake, totals(...rolls), machine)
  const final = steps.at(-1)
  if (final === undefined) throw new Error('no rolls')
  return { settlement: final.settlement, steps, bet }
}

/** A traditional hand of exactly `rolls` rolls: a point of 4, fillers of 5, then the seven-out. */
function handOf(rolls: number): number[] {
  if (rolls < 2) throw new RangeError('a hand has at least two rolls')
  return [4, ...Array.from({ length: rolls - 2 }, () => 5), 7]
}

describe('the round and the hand (rules spec §2.1)', () => {
  it('counts every roll of the hand, the seven-out included, then starts the next hand at 0', () => {
    let round: RefRound = START_ROUND
    const events: string[] = []
    for (const total of totals(7, 11, 6, 8, 6, 4, 7, 5)) {
      const next = advanceRef(round, total, 'traditional')
      events.push(`${next.event}@${next.round.handRolls}`)
      round = next.round
    }
    expect(events).toEqual([
      'natural@1',
      'natural@2',
      'pointEstablished@3',
      'none@4',
      'pointMade@5',
      'pointEstablished@6',
      'sevenOut@0',
      'pointEstablished@1',
    ])
    expect(round).toMatchObject({ phase: 'point', point: 5, lastWasSeven: false, rolled: true })
  })

  it('crapless: only 7 is a natural and 2, 3, 11 and 12 are points', () => {
    expect(advanceRef(START_ROUND, 11, 'crapless').event).toBe('pointEstablished')
    expect(advanceRef(START_ROUND, 2, 'crapless').event).toBe('pointEstablished')
    expect(advanceRef(START_ROUND, 7, 'crapless').event).toBe('natural')
    expect(advanceRef(START_ROUND, 12, 'traditional').event).toBe('craps')
  })

  it('Hot Shooter definitions: A counts all rolls, B drops the seven-out, C the first come-out too', () => {
    expect(countedRolls('allRolls', 10)).toBe(10)
    expect(countedRolls('exceptSevenOut', 10)).toBe(9)
    expect(countedRolls('exceptComeOutAndSevenOut', 10)).toBe(8)
  })
})

describe('All Small / All Tall / Make ʼEm All (rules spec §6.4)', () => {
  it('a come-out 7 loses All Small', () => {
    const { settlement } = last(small, 500, [7])
    expect(settlement).toMatchObject({ outcome: 'lose', credited: 0, ends: true })
  })

  it('completing the set pays at once, 30 to 1 on $5, repeats and order ignored', () => {
    const { settlement, steps } = last(small, 500, [6, 6, 2, 5, 3, 3, 4, 9])
    expect(steps).toHaveLength(7)
    expect(settlement).toMatchObject({ outcome: 'win', winPaid: 15_000, credited: 15_500 })
    expect(steps[5]?.progress).toEqual({ family: 'collectSet', hit: [6, 2, 5, 3] })
  })

  it('a 7 after four of five loses; All Tall ignores the small numbers', () => {
    expect(last(small, 100, [2, 3, 4, 5, 7]).settlement?.outcome).toBe('lose')
    const { settlement, steps } = last(tall, 100, [2, 8, 9, 3, 10, 11, 4, 12])
    expect(settlement).toMatchObject({ outcome: 'win', winPaid: 3_000 })
    expect(steps[6]?.progress).toEqual({ family: 'collectSet', hit: [8, 9, 10, 11] })
  })

  it('Make ʼEm All needs all ten numbers, and pays 155 to 1', () => {
    const { settlement } = last(all, 100, [2, 3, 4, 5, 6, 8, 9, 10, 11, 12])
    expect(settlement).toMatchObject({ outcome: 'win', winPaid: 15_500, credited: 15_600 })
    expect(last(all, 100, [2, 3, 4, 5, 6, 8, 9, 10, 11, 7]).settlement?.outcome).toBe('lose')
  })

  it('tracking starts fresh at placement: a point phase does not matter, a crapless point 7 loses', () => {
    const start = advanceRef(START_ROUND, 9, 'traditional').round
    const { steps } = walkSideBet(small, 100, totals(2, 3, 4, 5, 6), penny, start)
    expect(steps.at(-1)?.settlement?.outcome).toBe('win')
    expect(last(small, 100, [4, 7], crapless).settlement?.outcome).toBe('lose')
  })

  it("endsOn 'sevenOut': a come-out 7 changes nothing, a 7 on the point loses", () => {
    const sevenOutOnly: SideBetRule = { ...small, endsOn: 'sevenOut' }
    const { steps, settlement } = last(sevenOutOnly, 100, [7, 2, 3, 4, 7])
    expect(steps[0]?.settlement).toBeNull()
    expect(settlement).toMatchObject({ outcome: 'lose', why: 'a 7' })
    expect(last(sevenOutOnly, 100, [7, 2, 3, 7, 4, 5, 6]).settlement?.outcome).toBe('win')
  })
})

describe('the Fire Bet (rules spec §6.6)', () => {
  it('pays 24:1 at the seven-out after 4 unique points and ignores repeated points', () => {
    // Points 4, 4 (repeat), 6, 9, 10 made; the 4 again adds nothing; then the seven-out.
    const rolls = [4, 4, 4, 4, 6, 6, 9, 9, 10, 10, 4, 4, 5, 7]
    const { settlement, steps } = last(fire, 500, rolls)
    expect(steps).toHaveLength(rolls.length)
    expect(settlement).toMatchObject({
      outcome: 'win',
      winPaid: 12_000,
      credited: 12_500,
      why: 'seven-out after 4 points',
    })
    expect(steps[11]?.progress).toEqual({ family: 'uniquePointsMade', made: [4, 6, 9, 10] })
  })

  it('three points lose at the seven-out; naturals and craps change nothing', () => {
    const { settlement } = last(fire, 500, [7, 11, 2, 4, 4, 5, 5, 6, 6, 12, 8, 7])
    expect(settlement).toMatchObject({ outcome: 'lose', credited: 0 })
  })

  it('rounds the win once with the machine rounding: $1.01 at 24:1 on a whole-dollar table', () => {
    const dollars = { ...penny, rounding: { mode: 'floor', increment: 100 } } as const
    // Four points made, a fifth set, then the seven-out: 101¢ × 24 = 2424¢, floored to $24.
    const { settlement } = last(fire, 101, [4, 4, 5, 5, 6, 6, 8, 8, 9, 7], dollars)
    expect(settlement).toMatchObject({ outcome: 'win', winPaid: 2_400, credited: 2_501 })
  })

  it('payImmediatelyAt 6 pays 999:1 as the sixth point is made, before any seven-out', () => {
    const atOnce: SideBetRule = { ...fire, payImmediatelyAt: 6 }
    const rolls = [4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10]
    const { settlement, steps } = last(atOnce, 100, rolls)
    expect(steps).toHaveLength(12)
    expect(settlement).toMatchObject({ outcome: 'win', winPaid: 99_900, ends: true })
  })

  it('counts only countedPoints: crapless 2, 3, 11 and 12 made do not count against a 4–10 list', () => {
    // 2, 3, 11 and 12 made, then 4, 5, 6 and 9: four counted points before the seven-out.
    const rolls = [2, 2, 3, 3, 11, 11, 12, 12, 4, 4, 5, 5, 6, 6, 9, 9, 8, 7]
    const { settlement } = last(fire, 100, rolls, crapless)
    expect(settlement).toMatchObject({
      outcome: 'win',
      winPaid: 2_400,
      why: 'seven-out after 4 points',
    })
    const tenPoints: SideBetRule = {
      ...fire,
      countedPoints: totals(2, 3, 4, 5, 6, 8, 9, 10, 11, 12),
    }
    const made = last(tenPoints, 100, [2, 2, 3, 3, 11, 11, 12, 12, 5, 5, 4, 7], crapless)
    expect(made.settlement).toMatchObject({
      outcome: 'win',
      winPaid: 24_900,
      why: 'seven-out after 5 points',
    })
  })
})

describe('the Hot Shooter Jackpot (rules spec §6.2)', () => {
  it.each([
    [2, 'lose', 0],
    [7, 'lose', 0],
    [8, 'push', 100],
    [15, 'push', 100],
    [16, 'win', 300],
    [23, 'win', 300],
    [24, 'win', 500],
    [32, 'win', 700],
    [40, 'win', 1_200],
    [44, 'win', 1_200],
    [45, 'win', 3_000],
    [49, 'win', 3_000],
    [50, 'win', 10_000],
    [61, 'win', 10_000],
  ])('a hand of %i rolls: %s, credited %i on $1 (definition A)', (rolls, outcome, credited) => {
    const { settlement, steps } = last(hotShooter, 100, handOf(rolls))
    expect(steps).toHaveLength(rolls)
    expect(steps.slice(0, -1).every((s) => s.settlement === null)).toBe(true)
    expect(settlement).toMatchObject({ outcome, credited, ends: true })
  })

  it('naturals on the come-out count as rolls under definition A', () => {
    const { settlement } = last(hotShooter, 100, [7, 11, 11, 7, 11, 11, 4, 7])
    expect(settlement).toMatchObject({ outcome: 'push', why: '8 rolls, 1 for 1' })
  })

  it('definition B drops the seven-out and C the first come-out as well', () => {
    const b: SideBetRule = { ...hotShooter, countDefinition: 'exceptSevenOut' }
    const c: SideBetRule = { ...hotShooter, countDefinition: 'exceptComeOutAndSevenOut' }
    expect(last(b, 100, handOf(8)).settlement?.outcome).toBe('lose')
    expect(last(b, 100, handOf(9)).settlement?.outcome).toBe('push')
    expect(last(c, 100, handOf(9)).settlement?.outcome).toBe('lose')
    expect(last(c, 100, handOf(10)).settlement?.outcome).toBe('push')
    expect(last(c, 100, handOf(52)).settlement?.credited).toBe(10_000)
  })

  it('a Hot Shooter placed on a later come-out reads the hand counter (§2.6), not its own', () => {
    const start = advanceRef(
      advanceRef(START_ROUND, 4, 'traditional').round,
      4,
      'traditional',
    ).round
    expect(start.handRolls).toBe(2)
    const { steps } = walkSideBet(hotShooter, 100, totals(...handOf(6)), penny, start)
    expect(steps.at(-1)?.settlement).toMatchObject({ outcome: 'push', why: '8 rolls, 1 for 1' })
  })
})

describe('the Lucky Shooter (rules spec §6.3; PA §623c.2 examples)', () => {
  it('PA example (i): point 9, then 10, 4, 6, 10 is paid for 3 hits (5 for 1)', () => {
    const { settlement, steps } = last(luckyShooter, 100, [9, 10, 4, 6, 10])
    expect(steps[3]?.progress).toEqual({ family: 'pointRun', point: 9, hits: [10, 4, 6] })
    expect(settlement).toMatchObject({ outcome: 'win', winPaid: 400, credited: 500, why: '3 hits' })
  })

  it('PA example (iii): 6, 9, 6 loses with one hit; 0 hits lose too', () => {
    expect(last(luckyShooter, 100, [6, 9, 6]).settlement).toMatchObject({ outcome: 'lose' })
    expect(last(luckyShooter, 100, [6, 7]).settlement).toMatchObject({ outcome: 'lose' })
  })

  it('come-out 7 or 11 pushes and the bet stays; 2, 3 or 12 loses', () => {
    const { steps, bet } = walkSideBet(luckyShooter, 100, totals(7, 11), penny)
    expect(steps.map((s) => s.settlement)).toMatchObject([
      { outcome: 'push', credited: 0, ends: false },
      { outcome: 'push', credited: 0, ends: false },
    ])
    expect(bet).not.toBeNull()
    for (const craps of [2, 3, 12]) {
      expect(last(luckyShooter, 100, [11, craps]).settlement).toMatchObject({
        outcome: 'lose',
        ends: true,
      })
    }
  })

  it('every other box number and then the point pays the top award (500 for 1)', () => {
    const { settlement, steps } = last(luckyShooter, 100, [8, 4, 5, 6, 9, 10, 8])
    expect(steps[5]?.progress).toEqual({ family: 'pointRun', point: 8, hits: [4, 5, 6, 9, 10] })
    expect(settlement).toMatchObject({ outcome: 'win', winPaid: 49_900, credited: 50_000 })
  })

  it('after five hits the next roll settles: anything but the point pays the 5-hit award', () => {
    for (const other of [2, 3, 7, 11, 12, 4]) {
      const { settlement } = last(luckyShooter, 100, [8, 4, 5, 6, 9, 10, other])
      expect(settlement, `${other}`).toMatchObject({ outcome: 'win', winPaid: 9_900 })
    }
  })

  it('a repeat settles the bet by default; 2, 3, 11 and 12 settle it in the point phase too', () => {
    expect(last(luckyShooter, 100, [4, 5, 6, 5]).settlement).toMatchObject({
      outcome: 'win',
      winPaid: 100,
      why: '2 hits',
    })
    for (const ender of [2, 3, 11, 12]) {
      expect(last(luckyShooter, 100, [4, 5, 6, 8, 9, ender]).settlement).toMatchObject({
        outcome: 'win',
        winPaid: 900,
      })
    }
  })

  it('with repeatEndsBet false a repeat changes nothing, until five hits are in', () => {
    const lenient: SideBetRule = { ...luckyShooter, repeatEndsBet: false }
    const { steps, settlement } = last(lenient, 100, [4, 5, 5, 5, 6, 6, 8, 9, 10, 5])
    expect(steps[3]?.settlement).toBeNull()
    expect(steps[3]?.progress).toEqual({ family: 'pointRun', point: 4, hits: [5] })
    expect(settlement).toMatchObject({ outcome: 'win', winPaid: 9_900, why: '5 hits' })
  })

  it('refuses a come-out the spec does not define (a crapless 11 as the point)', () => {
    const bet = placeSideBet(luckyShooter, 100)
    expect(() => stepSideBet(bet, START_ROUND, 11, crapless)).not.toThrow()
    const narrow: SideBetRule = { ...luckyShooter, points: totals(4, 5, 6) }
    expect(() => stepSideBet(placeSideBet(narrow, 100), START_ROUND, 8, penny)).toThrow(
      /does not define/,
    )
  })
})

describe('placement windows and locks (rules spec §2.6)', () => {
  const ctx = (round: RefRound, extra: Partial<RefWindow> = {}): RefWindow => ({
    round,
    sameTypeActive: false,
    wonSinceSeven: false,
    mainGameStake: 0,
    ...extra,
  })
  const after = (rolls: number[], variant: 'traditional' | 'crapless' = 'traditional') =>
    totals(...rolls).reduce((round, t) => advanceRef(round, t, variant).round, START_ROUND)

  it('Interblock Lucky Roller: at the start, after any 7, never twice, and not after a win until a 7', () => {
    expect(windowOpen(small, ctx(START_ROUND)).open).toBe(true)
    expect(windowOpen(small, ctx(after([4]))).open).toBe(false)
    expect(windowOpen(small, ctx(after([7]))).open).toBe(true)
    expect(windowOpen(small, ctx(after([4, 7]))).open).toBe(true)
    expect(windowOpen(small, ctx(after([4, 7, 5]))).open).toBe(false)
    expect(windowOpen(small, ctx(after([7]), { wonSinceSeven: true })).open).toBe(false)
    expect(windowOpen(small, ctx(START_ROUND, { sameTypeActive: true })).open).toBe(false)
  })

  it('Shoot To Win Lucky Roller: whenever none of the type is active; new-hand bets only at hand.rolls 0', () => {
    const stw: SideBetRule = { ...small, placement: 'noneOfTypeActive' }
    expect(windowOpen(stw, ctx(after([4, 5, 6]))).open).toBe(true)
    expect(windowOpen(stw, ctx(after([4]), { sameTypeActive: true })).open).toBe(false)
    const nj: SideBetRule = { ...small, placement: 'newHand' }
    expect(windowOpen(nj, ctx(START_ROUND)).open).toBe(true)
    expect(windowOpen(nj, ctx(after([4, 7]))).open).toBe(true)
    expect(windowOpen(nj, ctx(after([7]))).open).toBe(false)
    expect(windowOpen(fire, ctx(after([4, 4]))).open).toBe(false)
    expect(windowOpen(fire, ctx(after([4, 7]))).open).toBe(true)
  })

  it('Hot Shooter: the come-out after a seven-out with the qualifying bet up; PA any come-out', () => {
    expect(windowOpen(hotShooter, ctx(START_ROUND, { mainGameStake: 300 })).open).toBe(true)
    expect(windowOpen(hotShooter, ctx(START_ROUND, { mainGameStake: 200 })).open).toBe(false)
    expect(windowOpen(hotShooter, ctx(after([4, 4]), { mainGameStake: 300 })).open).toBe(false)
    expect(windowOpen(hotShooter, ctx(after([4]), { mainGameStake: 300 })).open).toBe(false)
    const pa: SideBetRule = { ...hotShooter, placement: 'anyComeOut' }
    expect(windowOpen(pa, ctx(after([4, 4]), { mainGameStake: 300 })).open).toBe(true)
    expect(windowOpen(pa, ctx(after([4]), { mainGameStake: 300 })).open).toBe(false)
  })

  it('Lucky Shooter: before the point is set; MD only before a new hand', () => {
    expect(windowOpen(luckyShooter, ctx(START_ROUND)).open).toBe(true)
    expect(windowOpen(luckyShooter, ctx(after([4, 4]))).open).toBe(true)
    expect(windowOpen(luckyShooter, ctx(after([4]))).open).toBe(false)
    const md: SideBetRule = { ...luckyShooter, placement: 'newHand' }
    expect(windowOpen(md, ctx(after([4, 4]))).open).toBe(false)
    expect(windowOpen(md, ctx(after([4, 7]))).open).toBe(true)
  })

  it('a side bet is removable until the dice roll on it; a Lucky Shooter until its point is set', () => {
    expect(removable(placeSideBet(small, 100))).toBe(true)
    const rolled = stepSideBet(placeSideBet(small, 100), START_ROUND, 4, penny).bet
    expect(rolled !== null && removable(rolled)).toBe(false)
    const pushed = stepSideBet(placeSideBet(luckyShooter, 100), START_ROUND, 7, penny).bet
    expect(pushed !== null && removable(pushed)).toBe(true)
    const pointSet = stepSideBet(placeSideBet(luckyShooter, 100), START_ROUND, 6, penny).bet
    expect(pointSet !== null && removable(pointSet)).toBe(false)
    const locked: SideBetRule = { ...luckyShooter, removableBeforePoint: false }
    const lockedPush = stepSideBet(placeSideBet(locked, 100), START_ROUND, 7, penny).bet
    expect(lockedPush !== null && removable(lockedPush)).toBe(false)
  })
})

describe('the side bets of the presets, read from their config JSON (rules spec §5.2)', () => {
  it('crapless Lucky Roller "31 for 1" and "156 for 1" are 30 and 155 to 1', () => {
    const machine = sideBetMachineFrom(PRESETS.craplessBubble)
    expect(machine.variant).toBe('crapless')
    expect(machine.rounding).toEqual({ mode: 'floor', increment: 1 })
    const low = machine.rules.get('luckyRollerLow')
    const high = machine.rules.get('luckyRollerHigh')
    const both = machine.rules.get('luckyRollerAll')
    expect(low?.family === 'collectSet' && low.pays.toString()).toBe('30')
    expect(low?.family === 'collectSet' && low.targets).toEqual(ALL_SMALL)
    expect(high?.family === 'collectSet' && high.targets).toEqual(ALL_TALL)
    expect(both?.family === 'collectSet' && both.pays.toString()).toBe('155')
    expect(both?.family === 'collectSet' && both.placement).toBe('afterSevenOrStart')
  })

  it('the STW Hot Shooter tiers are 1 (push) / 3 / 5 / 7 / 12 / 30 / 100 for 1, definition A', () => {
    const rule = sideBetMachineFrom(PRESETS.traditionalBubble).rules.get('hotShooter')
    if (rule?.family !== 'handLength') throw new Error('no Hot Shooter')
    expect(rule.countDefinition).toBe('allRolls')
    expect(rule.qualifyingBet).toBe(300)
    expect(
      rule.tiers.map((t) => [t.minRolls, t.net === 'push' ? 'push' : t.net.toString()]),
    ).toEqual([
      [8, 'push'],
      [16, '2'],
      [24, '4'],
      [32, '6'],
      [40, '11'],
      [45, '29'],
      [50, '99'],
    ])
  })

  it("strictBubble's Lucky Shooter is paytable D and its Lucky Roller All 150 to 1", () => {
    const machine = sideBetMachineFrom(PRESETS.strictBubble)
    const ls = machine.rules.get('luckyShooter')
    if (ls?.family !== 'pointRun') throw new Error('no Lucky Shooter')
    expect([...ls.payTable].map(([k, v]) => [k, v.toString()])).toEqual([
      [2, '1'],
      [3, '4'],
      [4, '9'],
      [5, '99'],
    ])
    expect(ls.topAward.toString()).toBe('499')
    expect(ls.repeatEndsBet).toBe(true)
    const both = machine.rules.get('luckyRollerAll')
    expect(both?.family === 'collectSet' && both.pays.toString()).toBe('150')
  })

  it('the live table has the Fire Bet at 24 / 249 / 999 to 1 on 4–10, paid at the seven-out', () => {
    const rule = sideBetMachineFrom(PRESETS.traditionalLive345).rules.get('fire')
    if (rule?.family !== 'uniquePointsMade') throw new Error('no Fire Bet')
    expect(rule.countedPoints).toEqual([4, 5, 6, 8, 9, 10])
    expect([...rule.payTable].map(([k, v]) => [k, v.toString()])).toEqual([
      [4, '24'],
      [5, '249'],
      [6, '999'],
    ])
    expect(rule.payImmediatelyAt).toBeNull()
  })
})
