/**
 * Exact side-bet edges (M11; plan §9 item 3 for the side bets), written from rules spec §1.3,
 * §6.2–§6.4 and §6.6 with their own derivations:
 * - All Small / All Tall / Make 'Em All: a Markov chain over the subsets of the targets hit
 *   (closedForm.ts uses inclusion–exclusion; the two must agree).
 * - Hot Shooter Jackpot: the hand-length distribution P(L = k) from a roll-indexed walk over the
 *   round's phases, then the tiers of each roll-count definition.
 * - Fire Bet: P(the set of counted points made is exactly S) by Möbius inversion of
 *   P(set ⊆ S) = s ÷ (s + Σ_{n ∉ S} q_n) (closedForm.ts walks the masks; the two must agree).
 * - Lucky Shooter: a chain over the hits after each point, with the come-out rule of §6.3.
 *
 * Each bet is also given as a `CfBet` for `analyze()` (closedForm.ts), whose conventions apply:
 * `edge` counts pushes as decisions (the Lucky Shooter's edge per come-out roll, the Hot Shooter's
 * edge with the push at 0), `edgeExcludingTies` leaves them out (the Lucky Shooter's edge per
 * resolved wager, the Hot Shooter's per non-push decision). Money is in cents; a win is rounded once
 * with the machine's payout rounding (§4.1), or exactly when the rounding is null.
 *
 * Like every oracle module this file never imports the engine's rule code or `src/exact`
 * (tests/architecture.test.ts enforces this).
 */
import { probabilityOf, waysToRoll, type Total } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import {
  analyze,
  chanceBeforeSeven,
  CRAPS,
  expectedRollsPerLineDecision,
  handConstants,
  NATURALS,
  POINT_NUMBERS,
  sevenOutChancePerDecision,
  winPaid,
  type CfAnalysis,
  type CfBet,
  type CfOutcome,
  type CfRounding,
  type Variant,
} from './closedForm.ts'
import {
  countedRolls,
  LUCKY_SHOOTER_COME_OUT_LOSES,
  LUCKY_SHOOTER_COME_OUT_PUSHES,
  type HandCount,
  type SideBetMachine,
  type SideBetRule,
} from './sideBets.ts'

const ZERO = Fraction.ZERO
const ONE = Fraction.ONE
const frac = (num: number | bigint, den: number | bigint = 1) => Fraction.of(num, den)

/** The pay "to 1" at which a bet with win chance `p` (no pushes) has no edge: (1 − p) ÷ p. */
export function breakEvenPay(p: Fraction): Fraction {
  return ONE.sub(p).div(p)
}

// ---------------------------------------------------------------------------------------------
// All Small / All Tall / Make 'Em All (rules spec §6.4)
// ---------------------------------------------------------------------------------------------

/**
 * The set bet as a chain over the subsets of `targets` already rolled: from a subset with the
 * totals U still missing, a roll is a 7 (6 ways, the bet loses), a missing total t (w_t ways, the
 * subset grows) or anything else (the chain stays), so the subset is left with chance
 * (6 + ways(U)) ÷ 36 a roll. Repeats and order do not matter; any 7 loses (§6.4).
 */
export function collectSetByChain(targets: readonly Total[]): {
  readonly pWin: Fraction
  readonly expectedRolls: Fraction
} {
  const distinct = [...new Set(targets)]
  if (distinct.includes(7)) throw new RangeError('7 ends the bet; it cannot be a target')
  const size = 1 << distinct.length
  const reach: Fraction[] = Array.from({ length: size }, () => ZERO)
  reach[0] = ONE
  let expectedRolls = ZERO
  for (let mask = 0; mask < size - 1; mask++) {
    const here = reach[mask] ?? ZERO
    if (here.isZero()) continue
    let missingWays = 0
    distinct.forEach((t, i) => {
      if ((mask & (1 << i)) === 0) missingWays += waysToRoll(t)
    })
    const leave = 6 + missingWays
    expectedRolls = expectedRolls.add(here.mul(frac(36, leave)))
    distinct.forEach((t, i) => {
      const bit = 1 << i
      if ((mask & bit) !== 0) return
      reach[mask | bit] = (reach[mask | bit] ?? ZERO).add(here.mul(frac(waysToRoll(t), leave)))
    })
  }
  return { pWin: reach[size - 1] ?? ZERO, expectedRolls }
}

export function collectSetBet(params: {
  readonly targets: readonly Total[]
  readonly pays: Fraction
  readonly stake: number
  readonly rounding: CfRounding
}): CfBet {
  const { pWin, expectedRolls } = collectSetByChain(params.targets)
  const stake = frac(params.stake)
  return {
    stake,
    upfront: ZERO,
    outcomes: [
      {
        kind: 'win',
        p: pWin,
        credited: winPaid(stake, params.pays, params.rounding).add(stake),
        stays: false,
        recharge: ZERO,
      },
      { kind: 'lose', p: ONE.sub(pWin), credited: ZERO, stays: false, recharge: ZERO },
    ],
    workingRolls: expectedRolls,
  }
}

// ---------------------------------------------------------------------------------------------
// Hand length and the Hot Shooter Jackpot (rules spec §1.3, §6.2)
// ---------------------------------------------------------------------------------------------

/**
 * The distribution of the hand length L, every roll counted including the seven-out (§1.3):
 * `exactly[k]` = P(L = k) for k < `cap`, and `atLeastCap` = P(L ≥ cap). Walked roll by roll: the
 * mass on the come-out stays there on a natural or craps and moves to point n with P(n); the mass
 * on point n returns to the come-out with P(n), stays with 1 − P(n) − 1/6, and sevens out with 1/6,
 * which ends the hand on that roll.
 */
export function handLengthDistribution(
  variant: Variant,
  cap: number,
): { readonly exactly: readonly Fraction[]; readonly atLeastCap: Fraction } {
  if (!Number.isSafeInteger(cap) || cap < 1) throw new RangeError('cap counts rolls from 1')
  const points = POINT_NUMBERS[variant]
  const stayComeOut = Fraction.sum([...NATURALS[variant], ...CRAPS[variant]].map(probabilityOf))
  const seven = frac(6, 36)
  let comeOut = ONE
  let onPoint = new Map<Total, Fraction>(points.map((n) => [n, ZERO]))
  const exactly: Fraction[] = [ZERO]
  for (let roll = 1; roll < cap; roll++) {
    let ended = ZERO
    let nextComeOut = comeOut.mul(stayComeOut)
    const next = new Map<Total, Fraction>()
    for (const n of points) {
      const p = probabilityOf(n)
      const here = onPoint.get(n) ?? ZERO
      ended = ended.add(here.mul(seven))
      nextComeOut = nextComeOut.add(here.mul(p))
      next.set(n, comeOut.mul(p).add(here.mul(ONE.sub(p).sub(seven))))
    }
    exactly.push(ended)
    comeOut = nextComeOut
    onPoint = next
  }
  return { exactly, atLeastCap: comeOut.add(Fraction.sum(onPoint.values())) }
}

/** P(L ≥ k) from the distribution, for the §1.3 table and as a cross-check of closedForm.ts. */
export function handAtLeast(variant: Variant, k: number): Fraction {
  return handLengthDistribution(variant, k).atLeastCap
}

/** What a roll count pays: nothing (the bet loses), the stake back, or a net "to 1". */
export type PayByCount = (count: number) => 'lose' | 'push' | Fraction

/** The Hot Shooter tiers as a pay function: the highest tier reached pays (§6.2). */
export function tiersPay(
  tiers: readonly { readonly minRolls: number; readonly net: Fraction | 'push' }[],
): PayByCount {
  return (count) => {
    let reached: Fraction | 'push' | 'lose' = 'lose'
    for (const tier of tiers) if (tier.minRolls <= count) reached = tier.net
    return reached
  }
}

export interface HotShooterParams {
  readonly variant: Variant
  readonly countDefinition: HandCount
  readonly pay: PayByCount
  /** Counts at or above this all pay the same (the top tier); the distribution is cut here. */
  readonly topCount: number
  readonly stake: number
  readonly rounding: CfRounding
}

/**
 * The Hot Shooter Jackpot over one hand (§6.2): the count is the hand length under the definition
 * (A all rolls, B without the seven-out, C without the first come-out and the seven-out), and the
 * highest tier reached pays "for 1" at the seven-out; the 1× tier is a push. Working rolls are the
 * hand's (§1.3).
 */
export function hotShooterBet(params: HotShooterParams): CfBet & {
  /** P(the count is exactly c) for c < topCount, then P(count ≥ topCount) at index topCount. */
  readonly countChances: readonly Fraction[]
} {
  const shift = countedRolls(params.countDefinition, 0)
  // count = L + shift, so P(count = c) = P(L = c − shift).
  const { exactly, atLeastCap } = handLengthDistribution(params.variant, params.topCount - shift)
  const countChances: Fraction[] = []
  for (let count = 0; count < params.topCount; count++) {
    countChances.push(exactly[count - shift] ?? ZERO)
  }
  countChances.push(atLeastCap)
  const stake = frac(params.stake)
  const byNet = new Map<string, { net: Fraction; p: Fraction }>()
  let lose = ZERO
  let push = ZERO
  countChances.forEach((p, count) => {
    if (p.isZero()) return
    const pays = params.pay(count)
    if (pays === 'lose') lose = lose.add(p)
    else if (pays === 'push') push = push.add(p)
    else {
      const entry = byNet.get(pays.toString()) ?? { net: pays, p: ZERO }
      byNet.set(pays.toString(), { net: pays, p: entry.p.add(p) })
    }
  })
  const outcomes: CfOutcome[] = [...byNet.values()].map(({ net, p }) => ({
    kind: 'win',
    p,
    credited: winPaid(stake, net, params.rounding).add(stake),
    stays: false,
    recharge: ZERO,
  }))
  if (!push.isZero()) {
    outcomes.push({ kind: 'push', p: push, credited: stake, stays: false, recharge: ZERO })
  }
  outcomes.push({ kind: 'lose', p: lose, credited: ZERO, stays: false, recharge: ZERO })
  return {
    stake,
    upfront: ZERO,
    outcomes,
    workingRolls: handConstants(params.variant).rollsPerHand,
    countChances,
  }
}

// ---------------------------------------------------------------------------------------------
// The Fire Bet (rules spec §6.6)
// ---------------------------------------------------------------------------------------------

export interface FireChances {
  /** P(exactly k counted points are made before the seven-out), or at `payImmediatelyAt` P(reached). */
  readonly byCount: readonly Fraction[]
  /** Expected pass decisions while the bet is up. */
  readonly decisions: Fraction
}

/**
 * The hand as a sequence of pass decisions, each making counted point n with q_n = P(n) × w ÷
 * (w + 6), sevening out with s, or changing nothing (naturals, craps, points that do not count or
 * repeat). The set of counted points made is a subset S of the counted points; P(final set ⊆ S) is
 * the chance that the seven-out comes before any point outside S, s ÷ (s + Σ_{n ∉ S} q_n), and
 * P(final set = S) follows by Möbius inversion over the subsets. With `payImmediatelyAt` = m, the
 * bet ends when the m-th point is made, which happens exactly when the final set would have had
 * m or more points.
 */
export function fireChances(params: {
  readonly variant: Variant
  readonly countedPoints: readonly Total[]
  readonly payImmediatelyAt: number | null
}): FireChances {
  const { variant } = params
  const counted = [...new Set(params.countedPoints)]
  for (const n of counted) {
    if (!POINT_NUMBERS[variant].includes(n)) throw new RangeError(`${n} is not a point`)
  }
  const q = counted.map((n) => probabilityOf(n).mul(chanceBeforeSeven(n)))
  const s = sevenOutChancePerDecision(variant)
  const size = 1 << counted.length
  const outside = (mask: number) => {
    let sum = ZERO
    counted.forEach((_, i) => {
      if ((mask & (1 << i)) === 0) sum = sum.add(q[i] ?? ZERO)
    })
    return sum
  }
  // f[S] = P(final set ⊆ S); then the inverse zeta transform gives g[S] = P(final set = S).
  const g: Fraction[] = Array.from({ length: size }, (_, mask) => s.div(s.add(outside(mask))))
  for (let i = 0; i < counted.length; i++) {
    const bit = 1 << i
    for (let mask = 0; mask < size; mask++) {
      if ((mask & bit) !== 0) g[mask] = (g[mask] ?? ZERO).sub(g[mask ^ bit] ?? ZERO)
    }
  }
  const byCount: Fraction[] = Array.from({ length: counted.length + 1 }, () => ZERO)
  g.forEach((p, mask) => {
    const count = bitCount(mask)
    byCount[count] = (byCount[count] ?? ZERO).add(p)
  })
  const stopAt = params.payImmediatelyAt
  if (stopAt !== null) {
    if (stopAt < 1 || stopAt > counted.length) throw new RangeError(`cannot reach ${stopAt} points`)
    const reached = Fraction.sum(byCount.slice(stopAt))
    byCount.length = stopAt + 1
    byCount[stopAt] = reached
  }
  // Expected decisions: from a set of made points with Q = Σ q over the points still missing, a
  // decision leaves the set with chance s + Q, so the set holds 1 ÷ (s + Q) decisions.
  const reach: Fraction[] = Array.from({ length: size }, () => ZERO)
  reach[0] = ONE
  let decisions = ZERO
  for (let mask = 0; mask < size; mask++) {
    const here = reach[mask] ?? ZERO
    if (here.isZero() || bitCount(mask) === stopAt) continue
    const leave = s.add(outside(mask))
    decisions = decisions.add(here.div(leave))
    counted.forEach((_, i) => {
      const bit = 1 << i
      if ((mask & bit) !== 0) return
      reach[mask | bit] = (reach[mask | bit] ?? ZERO).add(here.mul(q[i] ?? ZERO).div(leave))
    })
  }
  return { byCount, decisions }
}

export interface FireParams {
  readonly variant: Variant
  readonly countedPoints: readonly Total[]
  /** Net pay "to 1" by count; a count not listed loses. */
  readonly payTable: ReadonlyMap<number, Fraction>
  readonly payImmediatelyAt: number | null
  readonly stake: number
  readonly rounding: CfRounding
}

/** The Fire Bet over one hand (§6.6), paid once for the count reached. */
export function fireBetByCounts(
  params: FireParams,
): CfBet & { readonly countChances: readonly Fraction[] } {
  const { byCount, decisions } = fireChances(params)
  const stake = frac(params.stake)
  const outcomes: CfOutcome[] = []
  let lose = ZERO
  byCount.forEach((p, count) => {
    if (p.isZero()) return
    const pays = params.payTable.get(count)
    if (pays === undefined) lose = lose.add(p)
    else {
      outcomes.push({
        kind: 'win',
        p,
        credited: winPaid(stake, pays, params.rounding).add(stake),
        stays: false,
        recharge: ZERO,
      })
    }
  })
  outcomes.push({ kind: 'lose', p: lose, credited: ZERO, stays: false, recharge: ZERO })
  return {
    stake,
    upfront: ZERO,
    outcomes,
    workingRolls: decisions.mul(expectedRollsPerLineDecision(params.variant)),
    countChances: byCount,
  }
}

// ---------------------------------------------------------------------------------------------
// The Lucky Shooter (rules spec §6.3)
// ---------------------------------------------------------------------------------------------

export interface LuckyShooterChances {
  /** The come-out 7 or 11: the bet stays (§6.3 step 1). */
  readonly push: Fraction
  /** The come-out 2, 3 or 12. */
  readonly comeOutLoss: Fraction
  /** P(the point is set, then exactly k hits, settled by anything but "all hits then the point"). */
  readonly hits: readonly Fraction[]
  /** P(every other box number hit, then the point). */
  readonly top: Fraction
  /** Expected rolls per come-out decision (the come-out roll and the hits that follow). */
  readonly rollsPerDecision: Fraction
}

/**
 * Per come-out roll (§6.3): 2, 3 or 12 loses and 7 or 11 pushes; a point P sets the chain of hits
 * on the other box numbers. From a set H of hits, a roll is a new hit (its ways), a settling roll
 * (every total that is not a new hit: 2, 3, 7, 11, 12, P and, when repeats end the bet, the hits
 * already made) or, when repeats do not end it, a repeat that changes nothing. With every other box
 * number hit, the next roll settles: P pays the top award, anything else the full-hit award.
 */
export function luckyShooterChances(params: {
  readonly points: readonly Total[]
  readonly repeatEndsBet: boolean
}): LuckyShooterChances {
  const points = [...new Set(params.points)]
  const comeOutWays = (totals: readonly Total[]) => totals.reduce((n, t) => n + waysToRoll(t), 0)
  const loseWays = comeOutWays(LUCKY_SHOOTER_COME_OUT_LOSES)
  const pushWays = comeOutWays(LUCKY_SHOOTER_COME_OUT_PUSHES)
  if (loseWays + pushWays + comeOutWays(points) !== 36) {
    throw new RangeError('The come-out must lose, push or set a point on every total')
  }
  const others = points.length - 1
  const hits: Fraction[] = Array.from({ length: others + 1 }, () => ZERO)
  let top = ZERO
  let rollsPerDecision = ONE
  for (const point of points) {
    const pPoint = probabilityOf(point)
    const rest = points.filter((t) => t !== point)
    const size = 1 << others
    const reach: Fraction[] = Array.from({ length: size }, () => ZERO)
    reach[0] = ONE
    let rolls = ZERO
    for (let mask = 0; mask < size; mask++) {
      const here = reach[mask] ?? ZERO
      if (here.isZero()) continue
      const made = bitCount(mask)
      if (made === others) {
        rolls = rolls.add(here)
        top = top.add(pPoint.mul(here).mul(probabilityOf(point)))
        hits[others] = (hits[others] ?? ZERO).add(
          pPoint.mul(here).mul(ONE.sub(probabilityOf(point))),
        )
        continue
      }
      let hitWays = 0
      let repeatWays = 0
      rest.forEach((t, i) => {
        if ((mask & (1 << i)) === 0) hitWays += waysToRoll(t)
        else repeatWays += waysToRoll(t)
      })
      const loopWays = params.repeatEndsBet ? 0 : repeatWays
      const endWays = 36 - hitWays - loopWays
      const leave = hitWays + endWays
      rolls = rolls.add(here.mul(frac(36, leave)))
      hits[made] = (hits[made] ?? ZERO).add(pPoint.mul(here).mul(frac(endWays, leave)))
      rest.forEach((t, i) => {
        const bit = 1 << i
        if ((mask & bit) !== 0) return
        reach[mask | bit] = (reach[mask | bit] ?? ZERO).add(here.mul(frac(waysToRoll(t), leave)))
      })
    }
    rollsPerDecision = rollsPerDecision.add(pPoint.mul(rolls))
  }
  return {
    push: frac(pushWays, 36),
    comeOutLoss: frac(loseWays, 36),
    hits,
    top,
    rollsPerDecision,
  }
}

export interface LuckyShooterParams {
  readonly points: readonly Total[]
  /** Net pay "to 1" by hits; a count not listed loses. */
  readonly payTable: ReadonlyMap<number, Fraction>
  readonly topAward: Fraction
  readonly repeatEndsBet: boolean
  readonly stake: number
  readonly rounding: CfRounding
}

/**
 * The Lucky Shooter as a lifecycle bet: the 7/11 push stays up and starts a new come-out decision,
 * so `analyze(bet).edge` is the edge per come-out roll and `edgeExcludingTies` the edge per
 * resolved wager (§6.3's two columns); `workingRolls` is E[rolls per resolved wager].
 */
export function luckyShooterBet(params: LuckyShooterParams): CfBet & {
  readonly chances: LuckyShooterChances
} {
  const chances = luckyShooterChances(params)
  const stake = frac(params.stake)
  const outcomes: CfOutcome[] = [
    { kind: 'push', p: chances.push, credited: ZERO, stays: true, recharge: ZERO },
  ]
  let lose = chances.comeOutLoss
  const win = (p: Fraction, net: Fraction) => {
    if (p.isZero()) return
    outcomes.push({
      kind: 'win',
      p,
      credited: winPaid(stake, net, params.rounding).add(stake),
      stays: false,
      recharge: ZERO,
    })
  }
  chances.hits.forEach((p, k) => {
    const pays = params.payTable.get(k)
    if (pays === undefined) lose = lose.add(p)
    else win(p, pays)
  })
  win(chances.top, params.topAward)
  outcomes.push({ kind: 'lose', p: lose, credited: ZERO, stays: false, recharge: ZERO })
  return {
    stake,
    upfront: ZERO,
    outcomes,
    workingRolls: chances.rollsPerDecision,
    chances,
  }
}

// ---------------------------------------------------------------------------------------------
// Any side bet of a machine
// ---------------------------------------------------------------------------------------------

/**
 * The closed form of one side bet of `machine` at `stake` cents, as paid, or null when this file
 * does not model it (a set bet that only a seven-out ends: its chain would have to follow the
 * round's phase as well).
 */
export function sideBetClosedForm(
  rule: SideBetRule,
  machine: Pick<SideBetMachine, 'variant' | 'rounding'>,
  stake: number,
  rounding: CfRounding = machine.rounding,
): CfBet | null {
  switch (rule.family) {
    case 'collectSet':
      if (rule.endsOn !== 'anySeven') return null
      return collectSetBet({ targets: rule.targets, pays: rule.pays, stake, rounding })
    case 'uniquePointsMade':
      return fireBetByCounts({
        variant: machine.variant,
        countedPoints: rule.countedPoints,
        payTable: rule.payTable,
        payImmediatelyAt: rule.payImmediatelyAt,
        stake,
        rounding,
      })
    case 'handLength': {
      const top = rule.tiers.at(-1)
      if (top === undefined) throw new RangeError('a Hot Shooter needs tiers')
      return hotShooterBet({
        variant: machine.variant,
        countDefinition: rule.countDefinition,
        pay: tiersPay(rule.tiers),
        topCount: top.minRolls,
        stake,
        rounding,
      })
    }
    case 'pointRun':
      return luckyShooterBet({
        points: rule.points,
        payTable: rule.payTable,
        topAward: rule.topAward,
        repeatEndsBet: rule.repeatEndsBet,
        stake,
        rounding,
      })
  }
}

/** `analyze` of the closed form, or null (see `sideBetClosedForm`). */
export function sideBetAnalysis(
  rule: SideBetRule,
  machine: Pick<SideBetMachine, 'variant' | 'rounding'>,
  stake: number,
  rounding: CfRounding = machine.rounding,
): CfAnalysis | null {
  const bet = sideBetClosedForm(rule, machine, stake, rounding)
  return bet === null ? null : analyze(bet)
}

function bitCount(mask: number): number {
  let count = 0
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++
  return count
}
