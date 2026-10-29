import { describe, expect, it } from 'vitest'
import { rollDice, totalOf, type Total } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { seedRng } from '../../src/engine/core/rng.ts'
import {
  NATURALS,
  POINT_NUMBERS,
  analyze,
  byDice,
  byTotal,
  chanceBeforeSeven,
  collectSet,
  collectSetChance,
  collectSetRolls,
  comeOutChances,
  composite,
  expectedRollsPerLineDecision,
  expectedRollsPerShooter,
  expectedRollsToResolve,
  fireBet,
  handConstants,
  handLengthAtLeast,
  hardway,
  lineBet,
  lineEquityOnPoint,
  lineWithOdds,
  maxOdds,
  numberBet,
  oddsBet,
  oneRoll,
  passLineWinChance,
  putBet,
  sevenOutChancePerDecision,
  trueOdds,
  type CfCommission,
  type CfRounding,
  type NetOn,
  type Variant,
} from './closedForm.ts'

const f = (num: number | bigint, den: number | bigint = 1) => Fraction.of(num, den)
/** Exact equality, shown as text on failure. */
const same = (actual: Fraction, expected: Fraction | string) =>
  expect(actual.toString()).toBe(typeof expected === 'string' ? expected : expected.toString())

const edge = (win: Fraction) => Fraction.ONE.sub(win).sub(win)
/** Come-out rolls as a share of all rolls: one per decision, by the renewal theorem. */
const comeOutShare = (variant: Variant) => Fraction.ONE.div(expectedRollsPerLineDecision(variant))
/** The pass line's edge per roll: its edge per decision spread over the rolls a decision takes. */
const edgePerRoll = (variant: Variant) =>
  edge(passLineWinChance(variant)).div(expectedRollsPerLineDecision(variant))

const PENNY: CfRounding = { mode: 'floor', increment: 1 }
const FIVE_PERCENT = f(1, 20)
const BOX = [4, 5, 6, 8, 9, 10] as const
const CRAPLESS_EXTRA = [2, 3, 11, 12] as const

/** A commission rule: 5% of the stake taken from the win, exact, unless overridden. */
function vig(over: Partial<CfCommission> = {}): CfCommission {
  return {
    rate: FIVE_PERCENT,
    basis: 'stake',
    timing: 'onWin',
    rounding: null,
    minimum: 0,
    refundOnTakeDown: false,
    rearm: 'none',
    ...over,
  }
}
const ON_WIN_STAKE = vig()
const ON_WIN_WIN = vig({ basis: 'win' })
const UPFRONT = vig({ timing: 'upfront', rearm: 'recollectFromWin' })
const UPFRONT_ONCE = vig({ timing: 'upfront', rearm: 'none' })

/** A number bet left up until it loses, exact unless a rounding is given. */
function placeBet(number: number, pays: Fraction, stake = 600, rounding: CfRounding = null) {
  return analyze(numberBet({ number, winsOn: 'number', pays, stake, rounding, afterWin: 'stay' }))
}
function buyBet(number: number, commission: CfCommission, stake = 2_000) {
  const pays = trueOdds(number, 'take')
  return analyze(
    numberBet({
      number,
      winsOn: 'number',
      pays,
      stake,
      rounding: null,
      commission,
      afterWin: 'stay',
    }),
  )
}
function layBet(number: number, commission: CfCommission | null, stake = 2_400) {
  const pays = trueOdds(number, 'lay')
  return analyze(
    numberBet({
      number,
      winsOn: 'seven',
      pays,
      stake,
      rounding: null,
      commission,
      afterWin: 'stay',
    }),
  )
}
const oneRollEdge = (net: NetOn) =>
  analyze(oneRoll({ net, stake: 100, rounding: null, afterWin: 'return' })).edge

describe('point probabilities (rules spec §1.2)', () => {
  it('matches ways / (ways + 6)', () => {
    expect(chanceBeforeSeven(4).equals(Fraction.of(1, 3))).toBe(true)
    expect(chanceBeforeSeven(5).equals(Fraction.of(2, 5))).toBe(true)
    expect(chanceBeforeSeven(6).equals(Fraction.of(5, 11))).toBe(true)
    expect(chanceBeforeSeven(2).equals(Fraction.of(1, 7))).toBe(true)
    expect(chanceBeforeSeven(11).equals(Fraction.of(1, 4))).toBe(true)
    expect(expectedRollsToResolve(6).equals(Fraction.of(36, 11))).toBe(true)
    expect(() => chanceBeforeSeven(7)).toThrow(RangeError)
  })

  it('gives each number its rolls to a decision and its chance of a decision per roll', () => {
    const rows: [Total, string, string, string][] = [
      [4, '1/3', '4', '1/4'],
      [10, '1/3', '4', '1/4'],
      [5, '2/5', '18/5', '5/18'],
      [6, '5/11', '36/11', '11/36'],
      [2, '1/7', '36/7', '7/36'],
      [3, '1/4', '9/2', '2/9'],
    ]
    for (const [n, before, rolls, perRoll] of rows) {
      same(chanceBeforeSeven(n), before)
      same(expectedRollsToResolve(n), rolls)
      same(Fraction.ONE.div(expectedRollsToResolve(n)), perRoll)
    }
  })
})

describe('pass line', () => {
  it('has the published traditional numbers', () => {
    expect(passLineWinChance('traditional').equals(Fraction.of(244, 495))).toBe(true)
    expect(edge(passLineWinChance('traditional')).equals(Fraction.of(7, 495))).toBe(true) // 1.414%
    expect(expectedRollsPerLineDecision('traditional').equals(Fraction.of(557, 165))).toBe(true)
    expect(comeOutShare('traditional').equals(Fraction.of(165, 557))).toBe(true)
    expect(edgePerRoll('traditional').equals(Fraction.of(7, 1671))).toBe(true)
    expect(sevenOutChancePerDecision('traditional').equals(Fraction.of(196, 495))).toBe(true)
    expect(expectedRollsPerShooter('traditional').equals(Fraction.of(1671, 196))).toBe(true) // 8.53
  })

  it('has the published crapless numbers', () => {
    expect(passLineWinChance('crapless').equals(Fraction.of(6557, 13860))).toBe(true)
    expect(edge(passLineWinChance('crapless')).equals(Fraction.of(373, 6930))).toBe(true) // 5.38%
    expect(expectedRollsPerLineDecision('crapless').equals(Fraction.of(9613, 2310))).toBe(true)
    expect(comeOutShare('crapless').equals(Fraction.of(2310, 9613))).toBe(true)
    expect(edgePerRoll('crapless').equals(Fraction.of(373, 28839))).toBe(true)
    // 2·(1/7 + 1/4 + 1/3 + 2/5 + 5/11)/6: the points' seven-before-point odds, weighted by ways.
    expect(sevenOutChancePerDecision('crapless').equals(Fraction.of(7303, 13860))).toBe(true)
    expect(expectedRollsPerShooter('crapless').equals(Fraction.of(57678, 7303))).toBe(true) // 7.90
  })

  it.each<Variant>(['traditional', 'crapless'])(
    'agrees with a seeded simulation (%s)',
    (variant) => {
      let state = seedRng(`pass-${variant}`)
      const roll = (): Total => {
        const [dice, next] = rollDice(state)
        state = next
        return totalOf(dice)
      }
      const decisions = 200_000
      let wins = 0
      for (let i = 0; i < decisions; i++) {
        const comeOut = roll()
        if (NATURALS[variant].includes(comeOut)) wins++
        else if (POINT_NUMBERS[variant].includes(comeOut)) {
          for (;;) {
            const next = roll()
            if (next === comeOut) {
              wins++
              break
            }
            if (next === 7) break
          }
        }
      }
      // 200k decisions: standard error ~0.0011, so 0.005 is a > 4-sigma band.
      expect(Math.abs(wins / decisions - passLineWinChance(variant).toNumber())).toBeLessThan(0.005)
    },
  )
})

describe('line and hand constants (rules spec §1.3)', () => {
  it('traditional and crapless, row by row', () => {
    const rows = {
      traditional: {
        natural: '2/9',
        craps: '1/9',
        point: '2/3',
        rollsPerDecision: '557/165',
        rollsPerHand: '1671/196',
        comeOutRollsPerHand: '495/196',
        pointPhaseRollsPerHand: '6',
        comeOutShare: '165/557',
        pointShare: '392/557',
        pointsMadePerHand: '67/98',
        makesAPoint: '67/165',
        naturalsPerHand: '55/98',
        crapsPerHand: '55/196',
        sevenOutPerDecision: '196/495',
        passEvPerHand: '-1/28',
        sevenOutsPer100: '11.73',
      },
      crapless: {
        natural: '1/6',
        craps: '0',
        point: '5/6',
        rollsPerDecision: '9613/2310',
        rollsPerHand: '57678/7303',
        comeOutRollsPerHand: '13860/7303',
        pointPhaseRollsPerHand: '6',
        comeOutShare: '2310/9613',
        pointShare: '7303/9613',
        pointsMadePerHand: '4247/7303',
        makesAPoint: '4247/11550',
        naturalsPerHand: '2310/7303',
        crapsPerHand: '0',
        sevenOutPerDecision: '7303/13860',
        passEvPerHand: '-746/7303',
        sevenOutsPer100: '12.66',
      },
    }
    for (const variant of ['traditional', 'crapless'] as const) {
      const hand = handConstants(variant)
      const chances = comeOutChances(variant)
      const actual = {
        natural: chances.natural.toString(),
        craps: chances.craps.toString(),
        point: chances.point.toString(),
        rollsPerDecision: hand.rollsPerDecision.toString(),
        rollsPerHand: hand.rollsPerHand.toString(),
        comeOutRollsPerHand: hand.comeOutRollsPerHand.toString(),
        pointPhaseRollsPerHand: hand.pointPhaseRollsPerHand.toString(),
        comeOutShare: hand.comeOutShare.toString(),
        pointShare: hand.pointShare.toString(),
        pointsMadePerHand: hand.pointsMadePerHand.toString(),
        makesAPoint: hand.makesAPoint.toString(),
        naturalsPerHand: hand.naturalsPerHand.toString(),
        crapsPerHand: hand.crapsPerHand.toString(),
        sevenOutPerDecision: hand.sevenOutPerDecision.toString(),
        passEvPerHand: hand.passEvPerHand.toString(),
        // A percentage is a count per 100: seven-outs per 100 rolls.
        sevenOutsPer100: hand.sevenOutsPerRoll.formatPercent(2),
      }
      expect(actual, variant).toEqual(rows[variant])
      // Identities: rolls = decisions + 6; decisions = naturals + craps + points made + 1;
      // π(comeOut) = 1 / E[rolls per decision].
      same(hand.rollsPerHand, hand.decisionsPerHand.add(f(6)))
      same(
        hand.decisionsPerHand,
        hand.naturalsPerHand.add(hand.crapsPerHand).add(hand.pointsMadePerHand).add(f(1)),
      )
      same(hand.comeOutShare, Fraction.ONE.div(hand.rollsPerDecision))
    }
  })

  it('the traditional hand-length tail, and 154 rolls at about 1 in 5.59 billion', () => {
    const tail = [8, 16, 24, 32, 40, 45, 50, 51].map((k) =>
      // P with 6 decimals is a percentage with 4.
      handLengthAtLeast('traditional', k).formatPercent(4),
    )
    expect(tail).toEqual([
      '42.9044',
      '13.1620',
      '4.0320',
      '1.2347',
      '0.3780',
      '0.1804',
      '0.0861',
      '0.0743',
    ])
    same(handLengthAtLeast('traditional', 1), '1')
    same(handLengthAtLeast('traditional', 2), '1') // the first roll never ends a hand
    same(handLengthAtLeast('traditional', 3), f(1).sub(f(2, 3).mul(f(6, 36)))) // a point, then 7
    const oneIn = Fraction.ONE.div(handLengthAtLeast('traditional', 154))
    expect(oneIn.div(f(10n ** 9n)).formatPercent(0)).toBe('559') // 5.59 billion
  })
})

describe('line bets and odds (rules spec §3.1, §3.5, §4.4)', () => {
  const line = (variant: Variant, side: 'do' | 'dont', afterWin: 'stay' | 'stayIfFirstRoll') =>
    analyze(lineBet({ variant, side, dontBar: 12, stake: 1_000, rounding: null, afterWin }))

  it('pass and come: HE_res and HE_roll in both variants', () => {
    const pass = line('traditional', 'do', 'stay')
    same(pass.edge, '7/495')
    same(pass.heRoll, '7/1671')
    same(pass.edgePerWorkingRoll, '7/1671')
    same(pass.pWin, '244/495')
    same(pass.pPush, '0')
    same(pass.workingRollsPerDecision, '557/165')
    const crapless = line('crapless', 'do', 'stay')
    same(crapless.edge, '373/6930')
    same(crapless.heRoll, '373/28839')
    same(crapless.pWin, '6557/13860')
    same(crapless.workingRollsPerDecision, '9613/2310')
    // Come returned after a win, or on 11 kept in the box (STW): the same i.i.d. decisions.
    const come = analyze(
      lineBet({
        variant: 'traditional',
        side: 'do',
        stake: 500,
        rounding: null,
        afterWin: 'stayIf11',
      }),
    )
    same(come.edge, '7/495')
  })

  it("don't pass bar 12: 3/220 ties counted, 27/1925 without, 9/2228 per roll", () => {
    for (const afterWin of ['stay', 'stayIfFirstRoll'] as const) {
      const dont = line('traditional', 'dont', afterWin)
      same(dont.edge, '3/220')
      same(dont.edgeExcludingTies, '27/1925')
      same(dont.heRoll, '9/2228')
      same(dont.pPush, '1/36')
      same(dont.perDecision.edge, '3/220')
    }
    // Reno bar 2: 2 pushes and 3 and 12 win; the same edge by symmetry.
    const reno = analyze(
      lineBet({
        variant: 'traditional',
        side: 'dont',
        dontBar: 2,
        stake: 1,
        rounding: null,
        afterWin: 'return',
      }),
    )
    same(reno.edge, '3/220')
  })

  it("a crapless don't pass with no bar would give the player 373/6930 (§3.5)", () => {
    const dont = analyze(
      lineBet({ variant: 'crapless', side: 'dont', stake: 1, rounding: null, afterWin: 'return' }),
    )
    same(dont.edge, '-373/6930')
  })

  it('put bets: (6 − w)/(6 + w), ÷ (1 + m) with odds; per roll (6 − w)/36', () => {
    const rows: [number, string, string][] = [
      [4, '1/3', '1/12'],
      [5, '1/5', '1/18'],
      [6, '1/11', '1/36'],
    ]
    for (const [n, he, perRoll] of rows) {
      const put = analyze(putBet({ number: n, stake: 1_000 }))
      same(put.edge, he)
      same(put.heRoll, perRoll)
      expect(put.edge.formatPercent(2)).toBe({ 4: '33.33', 5: '20.00', 6: '9.09' }[n])
      // With m× odds at true odds behind it, the odds lose nothing and the edge is ÷ (1 + m).
      for (const m of [1, 2, 5]) {
        const odds = analyze(oddsBet({ number: n, side: 'take', stake: 1_000 * m, rounding: null }))
        same(put.loss.add(odds.loss).div(put.risked.add(odds.risked)), put.edge.div(f(1 + m)))
      }
    }
  })

  it('equity of a line bet on its point; what removing a don’t bet forfeits', () => {
    const equity = [4, 5, 6, 2, 3].map((n) => lineEquityOnPoint(n, 'do'))
    expect(equity.map(String)).toEqual(['2/3', '4/5', '10/11', '2/7', '1/2'])
    // As published, per unit flat: 0.667, 0.8, 0.909, 0.286, 0.5.
    expect(equity.map((x) => x.formatPercent(1))).toEqual(['66.7', '80.0', '90.9', '28.6', '50.0'])
    const forfeit = [4, 5, 6].map((n) => lineEquityOnPoint(n, 'dont').sub(f(1)).toString())
    expect(forfeit).toEqual(['1/3', '1/5', '1/11'])
    // A $10 crapless pass on point 2 is worth $20/7 (glossary: equity).
    same(lineEquityOnPoint(2, 'do').mul(f(1_000)), '2000/7')
  })

  it('odds at true odds cost nothing; crapless odds pay 6:1 and 3:1 on 2/12 and 3/11', () => {
    same(trueOdds(2, 'take'), '6')
    same(trueOdds(12, 'take'), '6')
    same(trueOdds(3, 'take'), '3')
    same(trueOdds(11, 'take'), '3')
    expect(BOX.map((n) => trueOdds(n, 'take').toString())).toEqual([
      '2',
      '3/2',
      '6/5',
      '6/5',
      '3/2',
      '2',
    ])
    expect(BOX.map((n) => trueOdds(n, 'lay').toString())).toEqual([
      '1/2',
      '2/3',
      '5/6',
      '5/6',
      '2/3',
      '1/2',
    ])
    for (const n of [...BOX, ...CRAPLESS_EXTRA]) {
      for (const side of ['take', 'lay'] as const) {
        same(analyze(oddsBet({ number: n, side, stake: 600, rounding: null })).edge, '0')
      }
    }
    // Odds on 2/12 short-paid at 11:2: 1/14 (plan §9 item 5).
    same(
      analyze(oddsBet({ number: 2, side: 'take', pays: f(11, 2), stake: 200, rounding: null }))
        .edge,
      '1/14',
    )
  })

  it('true odds stay free at every whole-cent stake that pays exactly; floor breakage costs', () => {
    // The odd-cent sweep (plan §9 item 5): floored to the cent, true odds cost nothing exactly
    // when stake × pay is whole cents, and cost something otherwise; never a player edge.
    for (const n of [...BOX, ...CRAPLESS_EXTRA]) {
      for (const side of ['take', 'lay'] as const) {
        const pays = trueOdds(n, side)
        for (let stake = 1; stake <= 300; stake++) {
          const odds = analyze(oddsBet({ number: n, side, stake, rounding: PENNY }))
          const exact = f(stake).mul(pays).den === 1n
          expect(odds.edge.isZero(), `${side} ${n} at ${stake}¢`).toBe(exact)
          expect(odds.edge.isNegative()).toBe(false)
        }
      }
    }
  })

  it('combined edges with odds (rules spec §4.4), by formula and by table', () => {
    const k = [1, 2, 3, 5, 10, 100]
    const combined = (
      variant: Variant,
      side: 'do' | 'dont',
      basis: 'stake' | 'win',
      multiple: (point: number) => number,
    ) =>
      lineWithOdds({
        variant,
        side,
        dontBar: 12,
        stake: 1,
        rounding: null,
        afterWin: 'stay',
        odds: { multiple, basis, rounding: null },
      }).edge
    for (const m of k) {
      same(
        combined('traditional', 'do', 'stake', () => m),
        f(7, 495).div(f(1).add(f(2 * m, 3))),
      )
      same(
        combined('traditional', 'dont', 'win', () => m),
        f(3, 220).div(f(1 + m)),
      )
      same(
        combined('traditional', 'dont', 'stake', () => m),
        f(3, 220).div(f(1).add(f(2 * m, 3))),
      )
      same(
        combined('crapless', 'do', 'stake', () => m),
        f(373, 6930).div(f(1).add(f(5 * m, 6))),
      )
    }
    const table = (variant: Variant, side: 'do' | 'dont', basis: 'stake' | 'win') =>
      [0, 1, 2, 3, 5, 10, 100].map((m) => combined(variant, side, basis, () => m).formatPercent(4))
    expect(table('traditional', 'do', 'stake')).toEqual([
      '1.4141',
      '0.8485',
      '0.6061',
      '0.4714',
      '0.3263',
      '0.1845',
      '0.0209',
    ])
    expect(table('traditional', 'dont', 'win')).toEqual([
      '1.3636',
      '0.6818',
      '0.4545',
      '0.3409',
      '0.2273',
      '0.1240',
      '0.0135',
    ])
    expect(table('traditional', 'dont', 'stake')).toEqual([
      '1.3636',
      '0.8182',
      '0.5844',
      '0.4545',
      '0.3147',
      '0.1779',
      '0.0202',
    ])
    expect(table('crapless', 'do', 'stake')).toEqual([
      '5.3824',
      '2.9359',
      '2.0184',
      '1.5378',
      '1.0418',
      '0.5767',
      '0.0638',
    ])
    same(
      combined('crapless', 'do', 'stake', () => 2),
      '373/18480',
    )
    // 3-4-5x: pass 7/1870 (plan §9 item 5); don't pass lays 6x the flat (win basis 3/4/5), or
    // 3/4/5x the flat on the stake basis.
    const threeFourFive = (point: number) => ({ 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 })[point] ?? 0
    same(combined('traditional', 'do', 'stake', threeFourFive), '7/1870')
    expect(combined('traditional', 'do', 'stake', threeFourFive).formatPercent(4)).toBe('0.3743')
    same(combined('traditional', 'dont', 'win', threeFourFive), '3/1100')
    expect(combined('traditional', 'dont', 'win', threeFourFive).formatPercent(4)).toBe('0.2727')
    expect(combined('traditional', 'dont', 'stake', threeFourFive).formatPercent(4)).toBe('0.3610')
    expect(combined('traditional', 'dont', 'stake', () => 6).formatPercent(4)).toBe('0.2727')
  })

  it('odds never change the flat bet loss; capped odds floor to the increment', () => {
    const run = (multiple: number) =>
      lineWithOdds({
        variant: 'crapless',
        side: 'do',
        stake: 1_000,
        rounding: null,
        afterWin: 'stay',
        odds: { multiple: () => multiple, basis: 'stake', rounding: null },
      })
    same(run(0).loss, run(2).loss)
    same(run(2).loss, f(373, 6930).mul(f(1_000)))
    // A $7 flat with lays capped at 2x the win on 6 (5:6): $16.80 floored to $1 steps is $16.
    const capped = maxOdds(700, 6, 'dont', {
      multiple: () => 2,
      basis: 'win',
      rounding: null,
      increment: () => 100,
    })
    same(capped, '1600')
    same(maxOdds(700, 6, 'dont', { multiple: () => 2, basis: 'win', rounding: null }), '1680')
    same(maxOdds(700, 6, 'do', { multiple: () => 2, basis: 'stake', rounding: null }), '1400')
  })
})

describe('number bets (rules spec §3.2)', () => {
  it('place: HE_res and HE_roll on every number, with the crapless alternatives', () => {
    const rows: [number, Fraction, string, string][] = [
      [4, f(9, 5), '1/15', '1/60'],
      [10, f(9, 5), '1/15', '1/60'],
      [5, f(7, 5), '1/25', '1/90'],
      [9, f(7, 5), '1/25', '1/90'],
      [6, f(7, 6), '1/66', '1/216'],
      [8, f(7, 6), '1/66', '1/216'],
      [2, f(11, 2), '1/14', '1/72'],
      [12, f(11, 2), '1/14', '1/72'],
      [3, f(11, 4), '1/16', '1/72'],
      [11, f(11, 4), '1/16', '1/72'],
      [2, f(5), '1/7', '1/36'], // "25 to 5"
      [3, f(13, 5), '1/10', '1/45'],
    ]
    for (const [n, pays, he, perRoll] of rows) {
      const place = placeBet(n, pays, 3_000)
      same(place.edge, he)
      same(place.heRoll, perRoll)
      same(place.edgePerWorkingRoll, perRoll)
    }
  })

  it('place to lose and big 6/8', () => {
    const ptl = (n: number, pays: Fraction) =>
      analyze(
        numberBet({
          number: n,
          winsOn: 'seven',
          pays,
          stake: 4_400,
          rounding: null,
          afterWin: 'stay',
        }),
      )
    const rows: [number, Fraction, string, string][] = [
      [4, f(5, 11), '1/33', '1/132'],
      [5, f(5, 8), '1/40', '1/144'],
      [6, f(4, 5), '1/55', '1/180'],
    ]
    for (const [n, pays, he, perRoll] of rows) {
      same(ptl(n, pays).edge, he)
      same(ptl(n, pays).heRoll, perRoll)
    }
    same(placeBet(6, f(1), 500).edge, '1/11')
    same(placeBet(8, f(1), 500).heRoll, '1/36')
  })
})

describe('hardways (rules spec §3.3)', () => {
  it('hard 4/10 at 7:1 and hard 6/8 at 9:1, and the non-US pays', () => {
    const hard = (number: 4 | 6 | 8 | 10, pays: Fraction) =>
      analyze(hardway({ number, pays, stake: 100, rounding: null, afterWin: 'stay' }))
    for (const n of [4, 10] as const) {
      same(hard(n, f(7)).edge, '1/9')
      same(hard(n, f(7)).heRoll, '1/36')
      same(hard(n, f(7)).workingRollsPerDecision, '4')
      same(hard(n, f(15, 2)).edge, '1/18')
      expect(hard(n, f(15, 2)).edge.formatPercent(3)).toBe('5.556')
    }
    for (const n of [6, 8] as const) {
      same(hard(n, f(9)).edge, '1/11')
      same(hard(n, f(9)).heRoll, '1/36')
      same(hard(n, f(9)).workingRollsPerDecision, '36/11')
      expect(hard(n, f(19, 2)).edge.formatPercent(3)).toBe('4.545')
    }
  })
})

describe('one-roll bets and composites (rules spec §3.4; plan §0 amendment 15)', () => {
  const field = (two: number, twelve: number) =>
    byTotal({ 2: f(two), 3: f(1), 4: f(1), 9: f(1), 10: f(1), 11: f(1), 12: f(twelve) })
  const horn = composite([
    { net: byTotal({ 2: f(30) }), units: 1 },
    { net: byTotal({ 3: f(15) }), units: 1 },
    { net: byTotal({ 11: f(15) }), units: 1 },
    { net: byTotal({ 12: f(30) }), units: 1 },
  ])
  const ce = composite([
    { net: byTotal({ 2: f(7), 3: f(7), 12: f(7) }), units: 1 },
    { net: byTotal({ 11: f(15) }), units: 1 },
  ])
  const any7 = byTotal({ 7: f(4) })
  const world = composite([
    { net: byTotal({ 2: f(30) }), units: 1 },
    { net: byTotal({ 3: f(15) }), units: 1 },
    { net: byTotal({ 11: f(15) }), units: 1 },
    { net: byTotal({ 12: f(30) }), units: 1 },
    { net: any7, units: 1 },
  ])
  const hornHigh = (x: number) =>
    composite([
      { net: byTotal({ 2: f(30) }), units: x === 2 ? 2 : 1 },
      { net: byTotal({ 3: f(15) }), units: x === 3 ? 2 : 1 },
      { net: byTotal({ 11: f(15) }), units: x === 11 ? 2 : 1 },
      { net: byTotal({ 12: f(30) }), units: x === 12 ? 2 : 1 },
    ])

  it('edges of the field, props, hops and composites', () => {
    same(oneRollEdge(field(2, 2)), '1/18')
    same(oneRollEdge(field(2, 3)), '1/36')
    same(oneRollEdge(field(3, 3)), '0')
    same(oneRollEdge(any7), '1/6')
    same(oneRollEdge(byTotal({ 2: f(7), 3: f(7), 12: f(7) })), '1/9')
    same(oneRollEdge(byTotal({ 3: f(15) })), '1/9')
    same(oneRollEdge(byTotal({ 11: f(15) })), '1/9')
    same(oneRollEdge(byTotal({ 2: f(30) })), '5/36')
    same(oneRollEdge(byTotal({ 12: f(30) })), '5/36')
    // "For 1" props: 30 for 1 is 29:1 and 15 for 1 is 14:1, both 1/6.
    same(oneRollEdge(byTotal({ 2: f(29) })), '1/6')
    same(oneRollEdge(byTotal({ 11: f(14) })), '1/6')
    same(oneRollEdge(ce), '1/9')
    same(oneRollEdge(horn), '1/8')
    same(oneRollEdge(hornHigh(2)), '23/180')
    same(oneRollEdge(hornHigh(12)), '23/180')
    same(oneRollEdge(hornHigh(3)), '11/90')
    same(oneRollEdge(hornHigh(11)), '11/90')
    same(oneRollEdge(world), '2/15')
    expect(oneRollEdge(world).formatPercent(3)).toBe('13.333')
    // Hops: easy at 15:1 (2 ways), hard at 30:1 (1 way).
    same(oneRollEdge(byDice({ '1-3': f(15) })), '1/9')
    same(oneRollEdge(byDice({ '2-2': f(30) })), '5/36')
    // Maryland's Any 7 at "26 to 5" would give the player 1/30: never implement it (§3.4).
    same(oneRollEdge(byTotal({ 7: f(26, 5) })), '-1/30')
  })

  it('the net per unit table by total', () => {
    const totals = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const row = (net: NetOn, units = 1) =>
      totals.map((t) =>
        net(Math.max(1, t - 6), t - Math.max(1, t - 6))
          .mul(f(units))
          .toString(),
      )
    expect(row(field(2, 2))).toEqual(['2', '1', '1', '-1', '-1', '-1', '-1', '1', '1', '1', '2'])
    expect(row(field(2, 3))[10]).toBe('3')
    expect(row(any7)).toEqual(['-1', '-1', '-1', '-1', '-1', '4', '-1', '-1', '-1', '-1', '-1'])
    expect(row(byTotal({ 2: f(7), 3: f(7), 12: f(7) }))).toEqual([
      '7',
      '7',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '7',
    ])
    expect(row(ce)).toEqual(['3', '3', '-1', '-1', '-1', '-1', '-1', '-1', '-1', '7', '3'])
    expect(row(horn, 4)).toEqual(['27', '12', '-4', '-4', '-4', '-4', '-4', '-4', '-4', '12', '27'])
    expect(row(world, 5)).toEqual(['26', '11', '-5', '-5', '-5', '0', '-5', '-5', '-5', '11', '26'])
  })

  it('a composite settles once, rounded on the whole stake; a world 7 is a push', () => {
    // $100 horn on 6-6 nets +$675 (Interblock's formula); a $1 horn at the live table pays
    // $6.75 → $6 floored to the dollar on a 2 or 12.
    const hornBet = (stake: number, rounding: CfRounding) =>
      oneRoll({ net: horn, stake, rounding, afterWin: 'return' })
    const big = hornBet(10_000, PENNY).outcomes.find(
      (o) => o.kind === 'win' && o.p.equals(f(1, 18)),
    )
    same(big?.credited ?? f(0), '77500')
    const live = hornBet(100, { mode: 'floor', increment: 100 }).outcomes
    expect(live.map((o) => `${o.kind} ${o.p} ${o.credited}`).sort()).toEqual([
      'lose 5/6 0',
      'win 1/18 700',
      'win 1/9 400',
    ])
    const worldBet = analyze(
      oneRoll({ net: world, stake: 500, rounding: PENNY, afterWin: 'return' }),
    )
    same(worldBet.pPush, '1/6')
    same(worldBet.edge, '2/15')
    same(worldBet.edgeExcludingTies, f(2, 15).div(f(5, 6)))
  })
})

describe('commission (rules spec §4.3; plan §9 item 5)', () => {
  it('the edges table, every mode and number', () => {
    // [n, place pays, place, buy on win (stake), buy on win (win), buy upfront re-collected,
    //  buy upfront once (lifecycle), lay on win, lay upfront re-collected, lay upfront once]
    const rows: [number, Fraction, ...string[]][] = [
      [4, f(9, 5), '1/15', '1/60', '1/30', '1/21', '1/31', '1/60', '1/41', '1/121'],
      [5, f(7, 5), '1/25', '1/50', '3/100', '1/21', '3/103', '1/50', '1/31', '1/76'],
      [6, f(7, 6), '1/66', '1/44', '3/110', '1/21', '3/113', '1/44', '1/25', '5/269'],
      [2, f(11, 2), '1/14', '1/140', '3/70', '1/21', '3/73', '1/140', '1/121', '1/841'],
      [3, f(11, 4), '1/16', '1/80', '3/80', '1/21', '3/83', '1/80', '1/61', '1/241'],
    ]
    for (const [n, pays, ...expected] of rows) {
      const lay = (c: CfCommission) => layBet(n, vig({ ...c, basis: 'win' }))
      const actual = [
        placeBet(n, pays, 3_000).edge,
        buyBet(n, ON_WIN_STAKE).edge,
        buyBet(n, ON_WIN_WIN).edge,
        buyBet(n, UPFRONT).edge,
        buyBet(n, UPFRONT_ONCE).edge,
        lay(ON_WIN_WIN).edge,
        lay(UPFRONT).edge,
        lay(UPFRONT_ONCE).edge,
      ].map(String)
      expect(actual, `${n}`).toEqual(expected)
    }
    // The table's percentages, three decimals.
    expect(buyBet(5, UPFRONT_ONCE).edge.formatPercent(3)).toBe('2.913')
    expect(buyBet(6, UPFRONT_ONCE).edge.formatPercent(3)).toBe('2.655')
    expect(layBet(6, vig({ ...UPFRONT_ONCE, basis: 'win' })).edge.formatPercent(3)).toBe('1.859')
    expect(buyBet(2, UPFRONT_ONCE).edge.formatPercent(3)).toBe('4.110')
    expect(buyBet(3, UPFRONT_ONCE).edge.formatPercent(3)).toBe('3.614')
    expect(layBet(3, vig({ ...UPFRONT_ONCE, basis: 'win' })).edge.formatPercent(3)).toBe('0.415')
  })

  it('re-collecting from credit prices the same as from the win; the refund never applies', () => {
    for (const n of [4, 5, 6, 2, 3]) {
      same(
        buyBet(n, vig({ ...UPFRONT, rearm: 'recollectFromCredit' })).edge,
        buyBet(n, UPFRONT).edge,
      )
      same(buyBet(n, vig({ ...UPFRONT, refundOnTakeDown: true })).edge, buyBet(n, UPFRONT).edge)
      same(
        buyBet(n, vig({ ...UPFRONT_ONCE, refundOnTakeDown: true })).edge,
        buyBet(n, UPFRONT_ONCE).edge,
      )
    }
  })

  it('HE_roll: on the win per stake, upfront per stake + vig', () => {
    const onWin = [4, 5, 6, 2, 3].map((n) => buyBet(n, ON_WIN_STAKE).heRoll.toString())
    expect(onWin).toEqual(['1/240', '1/180', '1/144', '1/720', '1/360'])
    const layOnWin = [4, 5, 6].map((n) => layBet(n, ON_WIN_WIN).heRoll.toString())
    expect(layOnWin).toEqual(['1/240', '1/180', '1/144'])
    const buyUpfront = [4, 5, 6, 2, 3].map((n) => buyBet(n, UPFRONT).heRoll.toString())
    expect(buyUpfront).toEqual(['1/84', '5/378', '11/756', '1/108', '2/189'])
    const layUpfront = [4, 5, 6].map((n) => layBet(n, vig({ ...UPFRONT, basis: 'win' })).heRoll)
    expect(layUpfront.map(String)).toEqual(['1/164', '5/558', '11/900'])
    // Per stake instead (plan §5.1), a re-collected buy 4 costs 1/80 per working roll.
    same(buyBet(4, UPFRONT).edgePerWorkingRoll, '1/80')
  })

  it('the buy 4 lifecycle of the glossary: E[decisions] 3/2, E[R] = 3/2 s + s/20, 1/31', () => {
    const once = buyBet(4, UPFRONT_ONCE, 2_000)
    same(once.decisions, '3/2')
    same(once.risked, f(3_000).add(f(100)))
    same(once.loss, '100')
    same(once.edge, '1/31')
    same(once.perDecision.edge, '1/21') // the first decision alone
  })

  it('place against buy (rules spec §4.3 "Place vs buy")', () => {
    const exact = [ON_WIN_STAKE, ON_WIN_WIN, UPFRONT, UPFRONT_ONCE]
    const placePays: Record<number, Fraction> = {
      4: f(9, 5),
      5: f(7, 5),
      6: f(7, 6),
      2: f(11, 2),
      3: f(11, 4),
    }
    const cheaper = (n: number, c: CfCommission) =>
      buyBet(n, c).edge.compare(placeBet(n, placePays[n] ?? f(1), 3_000).edge) < 0
    for (const n of [4, 2, 3])
      expect(exact.map((c) => cheaper(n, c))).toEqual([true, true, true, true])
    expect(exact.map((c) => cheaper(6, c))).toEqual([false, false, false, false])
    expect(exact.map((c) => cheaper(5, c))).toEqual([true, true, false, true])
  })

  it('live flat vig on 4/10: upfront buy ties placing at B = 15C, on the win at B = 5C', () => {
    // A flat $C commission whatever the stake: rate 0 with a minimum of C.
    const flat = (cents: number, timing: 'upfront' | 'onWin') =>
      vig({
        rate: f(0),
        minimum: cents,
        timing,
        rearm: timing === 'upfront' ? 'recollectFromWin' : 'none',
      })
    const lossPerDecision = (stake: number, c: CfCommission | null) =>
      c === null
        ? placeBet(4, f(9, 5), stake).loss.div(placeBet(4, f(9, 5), stake).decisions)
        : buyBet(4, c, stake).loss.div(buyBet(4, c, stake).decisions)
    for (const c of [100, 200]) {
      same(lossPerDecision(15 * c, flat(c, 'upfront')), lossPerDecision(15 * c, null))
      same(lossPerDecision(5 * c, flat(c, 'onWin')), lossPerDecision(5 * c, null))
      const bigger = lossPerDecision(16 * c, flat(c, 'upfront')).compare(
        lossPerDecision(16 * c, null),
      )
      expect(bigger).toBe(-1)
    }
  })

  it("the live buy-the-4 examples: whole-dollar vig, $1 minimum (Harrah's PA)", () => {
    const live = (timing: 'upfront' | 'onWin') =>
      vig({
        timing,
        rounding: { mode: 'floor', increment: 100 },
        minimum: 100,
        rearm: timing === 'upfront' ? 'recollectFromWin' : 'none',
      })
    const edgeOf = (stake: number, timing: 'upfront' | 'onWin') =>
      analyze(
        numberBet({
          number: 4,
          winsOn: 'number',
          pays: f(2),
          stake,
          rounding: { mode: 'floor', increment: 100 },
          commission: live(timing),
          afterWin: 'stay',
        }),
      ).edge
    same(edgeOf(2_500, 'upfront'), '1/26')
    expect(edgeOf(2_500, 'upfront').formatPercent(3)).toBe('3.846')
    same(edgeOf(2_500, 'onWin'), '1/75')
    same(edgeOf(3_900, 'upfront'), '1/40')
    same(edgeOf(3_900, 'onWin'), '1/117')
    expect(edgeOf(3_900, 'onWin').formatPercent(3)).toBe('0.855')
    same(edgeOf(1_000, 'upfront'), '1/11')
    same(edgeOf(500, 'upfront'), '1/6')
    // A $5 buy with the $1 minimum taken from the win pays $9, the same as placing it at 9:5.
    const fiveOnWin = numberBet({
      number: 4,
      winsOn: 'number',
      pays: f(2),
      stake: 500,
      rounding: { mode: 'floor', increment: 100 },
      commission: live('onWin'),
      afterWin: 'return',
    })
    same(fiveOnWin.outcomes[0]?.credited.sub(f(500)) ?? f(0), '900')
  })
})

describe('rounding and breakage (rules spec §4.2; plan §9 item 5)', () => {
  const place6 = (stake: number, rounding: CfRounding) => placeBet(6, f(7, 6), stake, rounding)
  const mode = (m: 'floor' | 'ceil' | 'halfUp', increment = 1): CfRounding => ({
    mode: m,
    increment,
  })

  it('place 6 at $1, $2 and $5 under each rounding, and at the live table', () => {
    same(place6(100, mode('floor')).edge, '1/55')
    same(place6(100, mode('halfUp')).edge, '3/220')
    same(place6(100, mode('ceil')).edge, '3/220')
    expect(place6(100, mode('ceil')).edge.formatPercent(3)).toBe('1.364')
    expect(place6(200, mode('floor')).edge.formatPercent(3)).toBe('1.591')
    expect(place6(200, mode('halfUp')).edge.formatPercent(3)).toBe('1.591')
    expect(place6(200, mode('ceil')).edge.formatPercent(3)).toBe('1.364')
    same(place6(500, mode('floor')).edge, '17/1100')
    expect(place6(500, mode('halfUp')).edge.formatPercent(3)).toBe('1.545')
    expect(place6(500, mode('ceil')).edge.formatPercent(3)).toBe('1.455')
    same(place6(500, mode('floor', 100)).edge, '1/11')
    same(place6(600, mode('floor')).edge, '1/66')
    same(place6(600, null).edge, '1/66')
    same(place6(600, mode('floor')).edgePerWorkingRoll, '1/216')
  })

  it('nominal edge and breakage: $5 place 6 breaks 1/3300, $6 nothing', () => {
    const breakage = (stake: number) => place6(stake, PENNY).edge.sub(place6(stake, null).edge)
    same(breakage(500), '1/3300')
    same(breakage(600), '0')
  })

  it('$1 lay odds on 6 and on 5, and a $1 lay on 4 with vig on the win', () => {
    const layOdds = (n: number, m: 'floor' | 'ceil' | 'halfUp') =>
      analyze(oddsBet({ number: n, side: 'lay', stake: 100, rounding: mode(m) })).edge
    expect(layOdds(6, 'floor').formatPercent(3)).toBe('0.182')
    expect(layOdds(6, 'halfUp').formatPercent(3)).toBe('0.182')
    expect(layOdds(6, 'ceil').formatPercent(3)).toBe('-0.364') // a player edge: reject the config
    expect(layOdds(5, 'floor').formatPercent(3)).toBe('0.400')
    expect(layOdds(5, 'halfUp').formatPercent(3)).toBe('-0.200')
    const lay4 = (vigRounding: CfRounding) =>
      layBet(4, vig({ basis: 'win', rounding: vigRounding }), 100).edge
    same(lay4(mode('ceil')), '1/50')
    expect(lay4(mode('floor')).formatPercent(3)).toBe('1.333')
    same(lay4(null), '1/60')
  })
})

describe('All Small / All Tall / Make Em All (rules spec §6.4; plan §9 item 5)', () => {
  const SMALL = [2, 3, 4, 5, 6]
  const TALL = [8, 9, 10, 11, 12]
  const ALL = [...SMALL, ...TALL]
  const collect = (targets: number[], pays: number) =>
    analyze(collectSet({ targets, pays: f(pays), stake: 100, rounding: null })).edge

  it('chances by inclusion-exclusion, and the published edges', () => {
    same(collectSetChance(SMALL), '20049/760760')
    same(collectSetChance(TALL), '20049/760760')
    same(collectSetChance(ALL), '126538525259/24067258815600')
    same(collect(SMALL, 34), '1687/21736')
    same(collect(TALL, 34), '1687/21736')
    same(collect(ALL, 175), '10207263466/136745788725')
    expect([30, 31, 33, 34, 35].map((pays) => collect(SMALL, pays).formatPercent(4))).toEqual([
      '18.3029',
      '15.6675',
      '10.3967',
      '7.7613',
      '5.1259',
    ])
    expect(
      [150, 155, 160, 170, 174, 175].map((pays) => collect(ALL, pays).formatPercent(4)),
    ).toEqual(['20.6087', '17.9798', '15.3510', '10.0933', '7.9902', '7.4644'])
    // Break-even pays: 1/P − 1 to 1.
    const breakEven = (targets: number[]) => Fraction.ONE.div(collectSetChance(targets)).sub(f(1))
    expect(breakEven(SMALL).div(f(100)).formatPercent(3)).toBe('36.945')
    expect(breakEven(ALL).div(f(100)).formatPercent(3)).toBe('189.197')
  })

  it('expected rolls per bet: under 6, because the bet can also end by completing the set', () => {
    const rolls = collectSetRolls(SMALL)
    expect(rolls.compare(f(6))).toBe(-1)
    same(collectSetRolls([]), '0')
    same(collectSetRolls([2]), '36/7') // 2 or 7, whichever first
    same(collectSetChance([2]), '1/7')
    // Two targets: E[min(T7, max(T2, T12))] by hand: 36/7 + 36/7 − 36/8.
    same(collectSetRolls([2, 12]), f(36, 7).add(f(36, 7)).sub(f(36, 8)))
  })
})

describe('Fire Bet (rules spec §6.6, §0.2 #13; plan §9 item 5)', () => {
  const PAYS = new Map([
    [4, f(24)],
    [5, f(249)],
    [6, f(999)],
  ])
  const fire = (
    variant: Variant,
    countedPoints: readonly number[],
    payImmediatelyAt: number | null,
    payTable = PAYS,
  ) =>
    analyze(
      fireBet({ variant, countedPoints, payTable, payImmediatelyAt, stake: 100, rounding: null }),
    )

  it('traditional 20.7628%, crapless 13.4152% with all ten counted, 70.4488% with 4-10', () => {
    const traditional = fire('traditional', BOX, null)
    expect(traditional.edge.formatPercent(4)).toBe('20.7628')
    same(
      traditional.edge,
      '3155010189076512755518373649266277142847/15195531003242259962803834074351444164892',
    )
    // Paying at once on the 6th point changes nothing in traditional craps: there are six points.
    same(fire('traditional', BOX, 6).edge, traditional.edge)
    // Crapless, all ten counted: the published figure pays the top award for 6 or more points
    // (at once on the 6th, or a 6+ tier); paying nothing above 6 at the seven-out is 17.1059%.
    const all10 = fire('crapless', [...BOX, ...CRAPLESS_EXTRA], 6)
    expect(all10.edge.formatPercent(4)).toBe('13.4152')
    same(
      all10.edge,
      '50321828082661097007132879108739539881622629562732643479311167898892810350855048011169384' +
        '22917314198543551857967148398565965220654956270135756795431100803676917851251937126278008' +
        '908371863921337976531793647/' +
        '37511014834422891225308602430019086716844803038153173621335056537544265387140732571296040' +
        '40548818237320678462897383219149507044983328403858807597436681385450491236949836535682619' +
        '2716804443025489836094313696',
    )
    const sixPlus = new Map([...PAYS, [7, f(999)], [8, f(999)], [9, f(999)], [10, f(999)]])
    same(fire('crapless', [...BOX, ...CRAPLESS_EXTRA], null, sixPlus).edge, all10.edge)
    expect(fire('crapless', [...BOX, ...CRAPLESS_EXTRA], null).edge.formatPercent(4)).toBe(
      '17.1059',
    )
    const fourToTen = fire('crapless', BOX, null)
    expect(fourToTen.edge.formatPercent(4)).toBe('70.4488')
    same(
      fourToTen.edge,
      '169886117942358132217017758814883010391035300163065619490200298/' +
        '241148365393687606776061437909091176524238352893553281873879543',
    )
    // Maryland Pay Table B, 39/199/499: 23.8869%.
    const tableB = new Map([
      [4, f(39)],
      [5, f(199)],
      [6, f(499)],
    ])
    expect(fire('traditional', BOX, null, tableB).edge.formatPercent(4)).toBe('23.8869')
  })

  it('lasts a hand: E[rolls] is the hand length; the counts add up to 1', () => {
    same(fire('traditional', BOX, null).workingRollsPerDecision, '1671/196')
    same(fire('crapless', BOX, null).workingRollsPerDecision, '57678/7303')
    const bet = fireBet({
      variant: 'traditional',
      countedPoints: BOX,
      payTable: PAYS,
      payImmediatelyAt: null,
      stake: 1,
      rounding: null,
    })
    same(Fraction.sum(bet.countChances), '1')
    // No point made before the seven-out: 1 − P(the hand makes a point).
    same(bet.countChances[0] ?? f(0), f(1).sub(f(67, 165)))
  })
})
