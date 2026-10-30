import { describe, expect, it } from 'vitest'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import type { Total } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import {
  analyze,
  collectSet,
  collectSetChance,
  collectSetRolls,
  fireBet,
  handLengthAtLeast,
  POINT_NUMBERS,
  type Variant,
} from './closedForm.ts'
import {
  breakEvenPay,
  collectSetBet,
  collectSetByChain,
  fireBetByCounts,
  fireChances,
  handAtLeast,
  handLengthDistribution,
  hotShooterBet,
  luckyShooterBet,
  luckyShooterChances,
  sideBetAnalysis,
  sideBetClosedForm,
  tiersPay,
  type PayByCount,
} from './sideBetEdges.ts'
import { ALL_SMALL, ALL_TALL, MAKE_EM_ALL, sideBetMachineFrom } from './sideBets.ts'

// Every published side-bet value of rules spec §1.3, §6.2–§6.4 and §6.6 (and research
// sidebets.md §2–§5), by exact rational equality where the spec gives a fraction and through
// `formatPercent` where it gives a percentage, plus the cross-checks between this file's methods
// and closedForm.ts's (inclusion–exclusion, the mask DP, the roll-by-roll hand length).

const exact = (num: number | bigint, den: number | bigint = 1) => Fraction.of(num, den).toString()
const net = (n: number) => Fraction.of(n)
const totals = (...list: number[]): Total[] => list as Total[]
const pct = (f: Fraction, digits = 4) => f.formatPercent(digits)
const table = (entries: Record<number, number>) =>
  new Map(Object.entries(entries).map(([k, v]) => [Number(k), net(v)]))

describe('All Small / All Tall / Make ʼEm All (rules spec §6.4)', () => {
  it('P(Small) = P(Tall) = 20049/760760 and P(All) = 126538525259/24067258815600, by the chain', () => {
    expect(collectSetByChain(ALL_SMALL).pWin.toString()).toBe(exact(20049, 760760))
    expect(collectSetByChain(ALL_TALL).pWin.toString()).toBe(exact(20049, 760760))
    expect(collectSetByChain(MAKE_EM_ALL).pWin.toString()).toBe(
      exact(126538525259n, 24067258815600n),
    )
  })

  it('agrees with the inclusion–exclusion of closedForm.ts on the chance and the rolls', () => {
    for (const targets of [ALL_SMALL, ALL_TALL, MAKE_EM_ALL, totals(4, 10), totals(6)]) {
      const chain = collectSetByChain(targets)
      expect(chain.pWin.equals(collectSetChance(targets))).toBe(true)
      expect(chain.expectedRolls.equals(collectSetRolls(targets))).toBe(true)
    }
    const mine = analyze(
      collectSetBet({ targets: ALL_SMALL, pays: net(30), stake: 500, rounding: null }),
    )
    const theirs = analyze(
      collectSet({ targets: ALL_SMALL, pays: net(30), stake: 500, rounding: null }),
    )
    expect(mine.edge.equals(theirs.edge)).toBe(true)
    expect(mine.workingRolls.equals(theirs.workingRolls)).toBe(true)
  })

  it.each([
    [30, '18.3029'],
    [31, '15.6675'],
    [33, '10.3967'],
    [34, '7.7613'],
    [35, '5.1259'],
  ])('Small/Tall at %i to 1: %s%%', (pays, he) => {
    for (const targets of [ALL_SMALL, ALL_TALL]) {
      const bet = collectSetBet({ targets, pays: net(pays), stake: 100, rounding: null })
      expect(pct(analyze(bet).edge)).toBe(he)
    }
  })

  it('Small/Tall at 30 is 139241/760760 and at 34 is 59045/760760 exactly', () => {
    const at = (pays: number) =>
      analyze(collectSetBet({ targets: ALL_SMALL, pays: net(pays), stake: 100, rounding: null }))
        .edge
    expect(at(30).toString()).toBe(exact(139241, 760760))
    expect(at(34).toString()).toBe(exact(59045, 760760))
  })

  it.each([
    [150, '20.6087'],
    [155, '17.9798'],
    [160, '15.3510'],
    [170, '10.0933'],
    [174, '7.9902'],
    [175, '7.4644'],
  ])('All at %i to 1: %s%%', (pays, he) => {
    const bet = collectSetBet({ targets: MAKE_EM_ALL, pays: net(pays), stake: 100, rounding: null })
    expect(pct(analyze(bet).edge)).toBe(he)
  })

  it('break-even pays: 36.945 to 1 for Small/Tall, 189.197 to 1 for All', () => {
    const hundredth = Fraction.of(1, 100)
    expect(breakEvenPay(collectSetByChain(ALL_SMALL).pWin).mul(hundredth).formatPercent(3)).toBe(
      '36.945',
    )
    expect(breakEvenPay(collectSetByChain(MAKE_EM_ALL).pWin).mul(hundredth).formatPercent(3)).toBe(
      '189.197',
    )
  })
})

describe('hand length (rules spec §1.3)', () => {
  it.each([
    [8, '42.9044'],
    [16, '13.1620'],
    [24, '4.0320'],
    [32, '1.2347'],
    [40, '0.3780'],
    [45, '0.1804'],
    [50, '0.0861'],
    [51, '0.0743'],
  ])('P(L ≥ %i) = %s%% on a traditional table', (k, p) => {
    expect(pct(handAtLeast('traditional', k))).toBe(p)
  })

  it('agrees with closedForm.ts roll by roll, on both variants, and the distribution sums to 1', () => {
    for (const variant of ['traditional', 'crapless'] as const) {
      for (let k = 1; k <= 60; k++) {
        expect(
          handAtLeast(variant, k).equals(handLengthAtLeast(variant, k)),
          `${variant} ${k}`,
        ).toBe(true)
      }
      const { exactly, atLeastCap } = handLengthDistribution(variant, 40)
      expect(Fraction.sum(exactly).add(atLeastCap).equals(Fraction.ONE)).toBe(true)
      expect(exactly[0]?.isZero() && exactly[1]?.isZero()).toBe(true)
    }
    // A traditional hand of exactly two rolls: a point, then the seven-out.
    expect(handLengthDistribution('traditional', 3).exactly[2]?.toString()).toBe(exact(1, 9))
  })
})

describe('the Hot Shooter Jackpot (rules spec §6.2)', () => {
  /** The CW tiers "for 1": 1 (push) / 3 / 5 / 7 / 12 / 30 / 100 at 8 / 16 / 24 / 32 / 40 / 45 / 50. */
  const tiers = [
    { minRolls: 8, net: 'push' as const },
    { minRolls: 16, net: net(2) },
    { minRolls: 24, net: net(4) },
    { minRolls: 32, net: net(6) },
    { minRolls: 40, net: net(11) },
    { minRolls: 45, net: net(29) },
    { minRolls: 50, net: net(99) },
  ]
  const hsj = (
    countDefinition: 'allRolls' | 'exceptSevenOut' | 'exceptComeOutAndSevenOut',
    pay: PayByCount = tiersPay(tiers),
    topCount = 50,
  ) =>
    hotShooterBet({
      variant: 'traditional',
      countDefinition,
      pay,
      topCount,
      stake: 100,
      rounding: null,
    })

  it('the roll-count bands under definition A', () => {
    const { countChances } = hsj('allRolls')
    const band = (from: number, to: number) => pct(Fraction.sum(countChances.slice(from, to + 1)))
    expect(band(0, 7)).toBe('57.0956')
    expect(band(8, 15)).toBe('29.7425')
    expect(band(16, 23)).toBe('9.1300')
    expect(band(24, 31)).toBe('2.7973')
    expect(band(32, 39)).toBe('0.8566')
    expect(band(40, 44)).toBe('0.1976')
    expect(band(45, 49)).toBe('0.0943')
    expect(pct(countChances[50] ?? Fraction.ZERO)).toBe('0.0861')
    expect(Fraction.sum(countChances).equals(Fraction.ONE)).toBe(true)
  })

  it('definition A: 9.0740% per wager, 12.915% per non-push decision, over 1671/196 rolls', () => {
    const a = analyze(hsj('allRolls'))
    expect(pct(a.edge)).toBe('9.0740')
    expect(a.edgeExcludingTies.formatPercent(3)).toBe('12.915')
    expect(a.workingRolls.toString()).toBe(exact(1671, 196))
  })

  it('Grand at 51 gives 9.9029%; the literal "OVER 50" with 50 paying nothing 10.2581%', () => {
    const at51 = tiers.map((t) => (t.minRolls === 50 ? { ...t, minRolls: 51 } : t))
    expect(pct(analyze(hsj('allRolls', tiersPay(at51), 51)).edge)).toBe('9.9029')
    const literal: PayByCount = (count) => (count === 50 ? 'lose' : tiersPay(at51)(count))
    expect(pct(analyze(hsj('allRolls', literal, 51)).edge)).toBe('10.2581')
  })

  it('definition B (no seven-out) 21.5608%; C (no first come-out, no seven-out) 32.3353%', () => {
    expect(pct(analyze(hsj('exceptSevenOut')).edge)).toBe('21.5608')
    expect(pct(analyze(hsj('exceptComeOutAndSevenOut')).edge)).toBe('32.3353')
  })

  it('read "to 1" the tiers favour the player: +34% under A, +15% under B (the spec\'s 14–34%)', () => {
    const toOne: PayByCount = (count) => {
      let pays: Fraction | 'lose' = 'lose'
      for (const [minRolls, times] of [
        [8, 1],
        [16, 3],
        [24, 5],
        [32, 7],
        [40, 12],
        [45, 30],
        [50, 100],
      ]) {
        if (count >= (minRolls ?? 0)) pays = net(times ?? 0)
      }
      return pays
    }
    expect(analyze(hsj('allRolls', toOne)).edge.formatPercent(0)).toBe('-34')
    expect(analyze(hsj('exceptSevenOut', toOne)).edge.formatPercent(0)).toBe('-15')
    // Under C the misreading is about even (0.40% to the house), so "impossible" needs A or B.
    expect(analyze(hsj('exceptComeOutAndSevenOut', toOne)).edge.formatPercent(2)).toBe('0.40')
  })
})

describe('the Fire Bet (rules spec §6.6; research §5)', () => {
  const traditional = { variant: 'traditional' as const, countedPoints: totals(4, 5, 6, 8, 9, 10) }
  const fireEdge = (
    payTable: ReadonlyMap<number, Fraction>,
    extra: {
      variant?: Variant
      countedPoints?: readonly Total[]
      payImmediatelyAt?: number | null
    } = {},
  ) =>
    analyze(
      fireBetByCounts({
        ...traditional,
        payImmediatelyAt: null,
        ...extra,
        payTable,
        stake: 100,
        rounding: null,
      }),
    )

  it('unique points made in a traditional hand: 98/165, 78834/302335, then to the sixth', () => {
    const { byCount } = fireChances({ ...traditional, payImmediatelyAt: null })
    expect(byCount[0]?.toString()).toBe(exact(98, 165))
    expect(byCount[1]?.toString()).toBe(exact(78834, 302335))
    expect(byCount.slice(2).map((p) => pct(p))).toEqual([
      '10.1275',
      '3.3434',
      '0.8798',
      '0.1640',
      '0.0162',
    ])
    expect(Fraction.sum(byCount.slice(4)).formatPercent(5)).toBe('1.06005')
    expect(Fraction.sum(byCount).equals(Fraction.ONE)).toBe(true)
  })

  it('paytable A 24/249/999 is 20.7628%; B 10/200/2000 24.8562%; C 6/29/149/299 20.7295%; MD B 39/199/499 23.8869%', () => {
    expect(pct(fireEdge(table({ 4: 24, 5: 249, 6: 999 })).edge)).toBe('20.7628')
    expect(pct(fireEdge(table({ 4: 10, 5: 200, 6: 2000 })).edge)).toBe('24.8562')
    expect(pct(fireEdge(table({ 3: 6, 4: 29, 5: 149, 6: 299 })).edge)).toBe('20.7295')
    expect(pct(fireEdge(table({ 4: 39, 5: 199, 6: 499 })).edge)).toBe('23.8869')
  })

  it('crapless with all ten points: 13.4152% when 6 or more pay 999, 17.1059% paying nothing above 6; 4–10 only 70.4488%', () => {
    const ten = { variant: 'crapless' as const, countedPoints: POINT_NUMBERS.crapless }
    const a = table({ 4: 24, 5: 249, 6: 999 })
    expect(pct(fireEdge(a, { ...ten, payImmediatelyAt: 6 }).edge)).toBe('13.4152')
    const tiers = table({ 4: 24, 5: 249, 6: 999, 7: 999, 8: 999, 9: 999, 10: 999 })
    expect(pct(fireEdge(tiers, ten).edge)).toBe('13.4152')
    expect(pct(fireEdge(a, ten).edge)).toBe('17.1059')
    expect(pct(fireEdge(a, { variant: 'crapless' }).edge)).toBe('70.4488')
  })

  it('agrees with the mask walk of closedForm.ts on every chance, the loss and the rolls', () => {
    const cases = [
      { ...traditional, payImmediatelyAt: null },
      { ...traditional, payImmediatelyAt: 6 },
      { ...traditional, payImmediatelyAt: 4 },
      {
        variant: 'crapless' as const,
        countedPoints: POINT_NUMBERS.crapless,
        payImmediatelyAt: null,
      },
      { variant: 'crapless' as const, countedPoints: POINT_NUMBERS.crapless, payImmediatelyAt: 6 },
      {
        variant: 'crapless' as const,
        countedPoints: totals(4, 5, 6, 8, 9, 10),
        payImmediatelyAt: null,
      },
    ]
    const payTable = table({ 4: 24, 5: 249, 6: 999 })
    for (const c of cases) {
      const mine = fireBetByCounts({
        ...c,
        payTable,
        stake: 101,
        rounding: { mode: 'floor', increment: 100 },
      })
      const theirs = fireBet({
        ...c,
        payTable,
        stake: 101,
        rounding: { mode: 'floor', increment: 100 },
      })
      const at = `${c.variant} ${c.countedPoints.length} points, pay at ${c.payImmediatelyAt}`
      expect(mine.countChances.map(String), at).toEqual(
        theirs.countChances.slice(0, mine.countChances.length).map(String),
      )
      const a = analyze(mine)
      const b = analyze(theirs)
      expect(a.edge.equals(b.edge), at).toBe(true)
      expect(a.loss.equals(b.loss), at).toBe(true)
      expect(a.pWin.equals(b.pWin), at).toBe(true)
      expect(a.workingRolls.equals(b.workingRolls), at).toBe(true)
    }
  })
})

describe('the Lucky Shooter (rules spec §6.3; research §2)', () => {
  const points = totals(4, 5, 6, 8, 9, 10)
  const forOne = (tableForOne: Record<number, number>, topForOne: number, repeatEndsBet = true) =>
    analyze(
      luckyShooterBet({
        points,
        payTable: new Map(Object.entries(tableForOne).map(([k, v]) => [Number(k), net(v - 1)])),
        topAward: net(topForOne - 1),
        repeatEndsBet,
        stake: 100,
        rounding: null,
      }),
    )

  it('per come-out roll: 7/11 push 2/9, 2/3/12 loss 1/9, the hit counts and the top award', () => {
    const c = luckyShooterChances({ points, repeatEndsBet: true })
    expect(c.push.toString()).toBe(exact(2, 9))
    expect(c.comeOutLoss.toString()).toBe(exact(1, 9))
    expect(c.hits.map(String)).toEqual([
      exact(97, 324),
      exact(67, 324),
      exact(7583, 69984),
      exact(8597, 209952),
      exact(175, 17496),
      exact(125, 118098),
    ])
    expect(c.top.toString()).toBe(exact(125, 944784))
    const all = Fraction.sum([c.push, c.comeOutLoss, ...c.hits, c.top])
    expect(all.equals(Fraction.ONE)).toBe(true)
  })

  it('per resolved wager: 1/7 lose on the come-out; 38.4921% 0 hits … 0.017011% all hits + point', () => {
    const c = luckyShooterChances({ points, repeatEndsBet: true })
    const resolved = Fraction.ONE.sub(c.push)
    expect(c.comeOutLoss.div(resolved).toString()).toBe(exact(1, 7))
    expect(c.hits.slice(0, 5).map((p) => pct(p.div(resolved)))).toEqual([
      '38.4921',
      '26.5873',
      '13.9311',
      '5.2647',
      '1.2860',
    ])
    expect((c.hits[5] ?? Fraction.ZERO).div(resolved).formatPercent(5)).toBe('0.13609')
    expect(c.top.div(resolved).formatPercent(6)).toBe('0.017011')
  })

  it('a resolved wager takes 474275/163296 rolls, 9/7 of them come-outs', () => {
    const a = forOne({ 2: 2, 3: 5, 4: 10, 5: 100 }, 500)
    expect(a.workingRolls.toString()).toBe(exact(474275, 163296))
    expect(a.decisions.toString()).toBe(exact(9, 7))
  })

  it.each([
    ['A', { 3: 5, 4: 15, 5: 150 }, 1000, exact(249299, 1469664), '13.193'],
    ['B', { 2: 2, 3: 4, 4: 10, 5: 100 }, 500, exact(118345, 734832), '12.526'],
    ['C', { 3: 5, 4: 20, 5: 150 }, 1000, exact(154799, 1469664), '8.192'],
    ['D', { 2: 2, 3: 5, 4: 10, 5: 100 }, 500, exact(159317, 1469664), '8.431'],
  ])(
    'paytable %s: %s per resolved wager, %s%% per come-out roll',
    (_, pays, top, perWager, perRoll) => {
      const a = forOne(pays, top)
      expect(a.edgeExcludingTies.toString()).toBe(perWager)
      expect(a.edge.formatPercent(3)).toBe(perRoll)
    },
  )

  it('traps: D read "to 1" is player +9.79%; the bubble-craps.com table +43.92%; D plus "1 hit 1 for 1" +15.75%', () => {
    const toOne = forOne({ 2: 3, 3: 6, 4: 11, 5: 101 }, 501) // nets 2 / 5 / 10 / 100, top 500
    expect(toOne.edgeExcludingTies.formatPercent(2)).toBe('-9.79')
    const site = forOne({ 1: 1, 2: 2, 3: 5, 4: 20, 5: 150 }, 1000)
    expect(site.edgeExcludingTies.formatPercent(2)).toBe('-43.92')
    expect(site.edge.formatPercent(2)).toBe('-34.16')
    const dPlusOne = forOne({ 1: 1, 2: 2, 3: 5, 4: 10, 5: 100 }, 500)
    expect(dPlusOne.edgeExcludingTies.formatPercent(2)).toBe('-15.75')
  })

  it('when repeats do not end the bet the player does better, and the chances still sum to 1', () => {
    const lenient = luckyShooterChances({ points, repeatEndsBet: false })
    const all = Fraction.sum([lenient.push, lenient.comeOutLoss, ...lenient.hits, lenient.top])
    expect(all.equals(Fraction.ONE)).toBe(true)
    const strict = forOne({ 2: 2, 3: 5, 4: 10, 5: 100 }, 500, true)
    const loose = forOne({ 2: 2, 3: 5, 4: 10, 5: 100 }, 500, false)
    expect(loose.edgeExcludingTies.compare(strict.edgeExcludingTies)).toBe(-1)
    expect(loose.workingRolls.compare(strict.workingRolls)).toBe(1)
  })
})

describe('the side bets of the presets, as paid (rules spec §5.2)', () => {
  const edgeOf = (presetId: keyof typeof PRESETS, typeId: string, stake: number) => {
    const machine = sideBetMachineFrom(PRESETS[presetId])
    const rule = machine.rules.get(typeId)
    if (rule === undefined) throw new Error(`${presetId} has no ${typeId}`)
    const analysis = sideBetAnalysis(rule, machine, stake)
    if (analysis === null) throw new Error(`${typeId} is not modelled`)
    return analysis
  }

  it('crapless Lucky Roller: Low and High 139241/760760 (18.3029%), All at 155 17.9798%', () => {
    for (const id of ['craplessBubble', 'craplessBubbleHighLimit'] as const) {
      for (const typeId of ['luckyRollerLow', 'luckyRollerHigh']) {
        expect(edgeOf(id, typeId, 500).edge.toString(), `${id} ${typeId}`).toBe(
          exact(139241, 760760),
        )
      }
      expect(pct(edgeOf(id, 'luckyRollerAll', 500).edge), id).toBe('17.9798')
    }
  })

  it('STW: the Hot Shooter 9.0740% and the Lucky Roller at 30/30/155', () => {
    expect(pct(edgeOf('traditionalBubble', 'hotShooter', 100).edge)).toBe('9.0740')
    expect(pct(edgeOf('traditionalBubble', 'luckyRollerLow', 100).edge)).toBe('18.3029')
    expect(pct(edgeOf('traditionalBubble', 'luckyRollerAll', 100).edge)).toBe('17.9798')
  })

  it('strictBubble: Lucky Shooter D 159317/1469664 per resolved wager; Lucky Roller All at 150 20.6087%', () => {
    expect(edgeOf('strictBubble', 'luckyShooter', 100).edgeExcludingTies.toString()).toBe(
      exact(159317, 1469664),
    )
    expect(pct(edgeOf('strictBubble', 'luckyRollerAll', 100).edge)).toBe('20.6087')
  })

  it('the live table: Fire Bet 20.7628% at whole dollars', () => {
    for (const stake of [100, 500]) {
      expect(pct(edgeOf('traditionalLive345', 'fire', stake).edge), `${stake}¢`).toBe('20.7628')
    }
  })

  it('a set bet that only a seven-out ends has no closed form here (the walker covers it)', () => {
    const machine = sideBetMachineFrom(PRESETS.craplessBubble)
    const rule = machine.rules.get('luckyRollerLow')
    if (rule?.family !== 'collectSet') throw new Error('no Lucky Roller')
    expect(sideBetClosedForm({ ...rule, endsOn: 'sevenOut' }, machine, 100)).toBeNull()
  })
})
