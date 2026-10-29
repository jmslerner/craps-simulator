/**
 * Closed-form craps math (plan §9 item 3): exact results per bet, used as an oracle for the
 * engine (through the dispatch chain) and for the exact solver in `src/exact`.
 *
 * It is written from the rules spec with its own rule constants, and imports only primitives
 * (Fraction, dice counts) from `src/engine/core` plus the reference oracle's BigInt rounding. Like
 * every oracle module, it must never import the engine's rule code
 * (`src/engine/{bets,round,settle,table,session}`, the engine barrel or
 * `src/engine/config/rulesets.ts`) or the solver in `src/exact`: shared rule code cannot catch its
 * own bugs. tests/architecture.test.ts enforces this. Inputs are plain parameters (pays,
 * commission, rounding, stake), never a machine config.
 *
 * Conventions (rules spec §0.1, plan §5.1 and §0 amendments 22 and 24):
 * - Money is in cents. Exact amounts are Fractions of a cent. A rounding of `null` pays exactly,
 *   which gives the nominal edge; breakage is the edge minus the nominal edge.
 * - A decision is one win, loss or push. The lifecycle follows the policy "leave it up until it
 *   loses or resolves": a winner the machine keeps up (`afterWin: stay`) starts a new decision, and
 *   so does a push that leaves the bet up (the don't bar).
 * - Amount risked = the stake of every decision + commission paid up front (at placement, and
 *   again when a winner stays up under `recollectFromWin` or `recollectFromCredit`). Commission
 *   taken from a win is not added (plan §0 amendment 22: an on-win buy 4 is 1/60, not 1/61).
 * - `edge` = E[loss] ÷ E[amount risked] over the lifecycle, pushes counted as decisions ("ties
 *   counted"); `edgeExcludingTies` leaves pushes out of the divisor. With i.i.d. decisions this is
 *   the per-decision house edge (HE_res).
 * - `edgePerWorkingRoll` = E[loss] ÷ (E[working rolls] × stake) (plan §5.1: place 6 is 1/216);
 *   `heRoll` = edge × P(decided on a working roll) (rules spec §0.1 HE_roll, whose divisor for
 *   upfront vig is stake + vig: a re-collected buy 4 is 1/84). They agree when nothing is paid up
 *   front.
 * - Enough credit is assumed (plan §0 amendment 24): a re-collection is always paid, so
 *   `recollectFromWin` and `recollectFromCredit` price the same, and `refundOnTakeDown` never
 *   applies, because the policy never takes a bet down.
 */
import { probabilityOf, waysToRoll, type Total } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import type { RefRounding } from './machineFacts.ts'
import { roundRef } from './referenceRules.ts'

/**
 * Crapless ("never ever craps"): only 7 wins on the come-out and every other
 * total becomes the point. Traditional: 7/11 win, 2/3/12 lose, points 4-10.
 */
export type Variant = 'crapless' | 'traditional'

export const POINT_NUMBERS: Record<Variant, readonly Total[]> = {
  traditional: [4, 5, 6, 8, 9, 10],
  crapless: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
}

/** Come-out totals that win a pass/come bet immediately. */
export const NATURALS: Record<Variant, readonly Total[]> = {
  traditional: [7, 11],
  crapless: [7],
}

/** Come-out totals that lose a pass/come bet immediately. */
export const CRAPS: Record<Variant, readonly Total[]> = {
  traditional: [2, 3, 12],
  crapless: [],
}

const TOTALS: readonly Total[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const ZERO = Fraction.ZERO
const ONE = Fraction.ONE
const frac = (num: number | bigint, den: number | bigint = 1) => Fraction.of(num, den)

export function isPointNumber(variant: Variant, total: Total): boolean {
  return POINT_NUMBERS[variant].includes(total)
}

/** Chance that `total` is rolled before a 7 — what every point, place, buy and odds bet hinges on. */
export function chanceBeforeSeven(total: Total): Fraction {
  if (total === 7) throw new RangeError('7 cannot be rolled before itself')
  const ways = waysToRoll(total)
  return Fraction.of(ways, ways + 6)
}

/** Expected rolls until either `total` or 7 appears. */
export function expectedRollsToResolve(total: Total): Fraction {
  if (total === 7) throw new RangeError('7 resolves immediately')
  return Fraction.of(36, waysToRoll(total) + 6)
}

/** Probability that a pass (or come) bet wins. It never pushes. */
export function passLineWinChance(variant: Variant): Fraction {
  const naturals = Fraction.sum(NATURALS[variant].map(probabilityOf))
  const points = POINT_NUMBERS[variant].map((p) => probabilityOf(p).mul(chanceBeforeSeven(p)))
  return naturals.add(Fraction.sum(points))
}

/** Expected rolls from a come-out until the pass line is decided. */
export function expectedRollsPerLineDecision(variant: Variant): Fraction {
  const pointPhase = POINT_NUMBERS[variant].map((p) =>
    probabilityOf(p).mul(expectedRollsToResolve(p)),
  )
  return Fraction.ONE.add(Fraction.sum(pointPhase))
}

/** Probability that a pass-line decision ends in a seven-out, handing the dice to a new shooter. */
export function sevenOutChancePerDecision(variant: Variant): Fraction {
  return Fraction.sum(
    POINT_NUMBERS[variant].map((p) => probabilityOf(p).mul(Fraction.ONE.sub(chanceBeforeSeven(p)))),
  )
}

/**
 * Expected rolls per shooter (from first come-out to seven-out). By Wald's
 * identity this is rolls-per-decision divided by the per-decision seven-out chance.
 */
export function expectedRollsPerShooter(variant: Variant): Fraction {
  return expectedRollsPerLineDecision(variant).div(sevenOutChancePerDecision(variant))
}

// ---------------------------------------------------------------------------------------------
// Hand constants (rules spec §1.3)
// ---------------------------------------------------------------------------------------------

/** P(natural), P(craps) and P(point) on a come-out roll. */
export function comeOutChances(variant: Variant): {
  readonly natural: Fraction
  readonly craps: Fraction
  readonly point: Fraction
} {
  const chance = (totals: readonly Total[]) => Fraction.sum(totals.map(probabilityOf))
  return {
    natural: chance(NATURALS[variant]),
    craps: chance(CRAPS[variant]),
    point: chance(POINT_NUMBERS[variant]),
  }
}

/** P(a pass-line decision makes its point), summed over the points. */
function pointMadeChancePerDecision(variant: Variant): Fraction {
  return Fraction.sum(POINT_NUMBERS[variant].map((n) => probabilityOf(n).mul(chanceBeforeSeven(n))))
}

/**
 * Per-hand counts (rules spec §1.3). A hand is every roll from a come-out after a seven-out
 * through the next seven-out (§0.1). Its pass decisions are geometric: each ends the hand with
 * P(seven-out per decision), so a hand holds 1 ÷ that many decisions, and each kind of decision
 * occurs (its chance per decision) ÷ P(seven-out) times.
 */
export function handConstants(variant: Variant) {
  const sevenOut = sevenOutChancePerDecision(variant)
  const made = pointMadeChancePerDecision(variant)
  const { natural, craps } = comeOutChances(variant)
  const rollsPerDecision = expectedRollsPerLineDecision(variant)
  const rollsPerHand = rollsPerDecision.div(sevenOut)
  const decisionsPerHand = ONE.div(sevenOut)
  const comeOutShare = ONE.div(rollsPerDecision)
  return {
    rollsPerDecision,
    rollsPerHand,
    /** Come-out rolls per hand: one per pass decision. */
    comeOutRollsPerHand: decisionsPerHand,
    decisionsPerHand,
    pointPhaseRollsPerHand: rollsPerHand.sub(decisionsPerHand),
    comeOutShare,
    pointShare: ONE.sub(comeOutShare),
    pointsMadePerHand: made.div(sevenOut),
    /** P(the hand makes at least one point): a point made comes before the first seven-out. */
    makesAPoint: made.div(made.add(sevenOut)),
    naturalsPerHand: natural.div(sevenOut),
    crapsPerHand: craps.div(sevenOut),
    sevenOutPerDecision: sevenOut,
    /** Expected pass-line result per hand per unit flat: −edge × decisions per hand. */
    passEvPerHand: lineBet({
      variant,
      side: 'do',
      stake: 1,
      rounding: null,
      afterWin: 'stay',
    })
      .perDecision.loss.neg()
      .mul(decisionsPerHand),
    sevenOutsPerRoll: ONE.div(rollsPerHand),
  }
}

/**
 * P(a hand lasts at least `k` rolls), counting every roll including the seven-out (rules spec
 * §1.3): the chance that no seven-out happens in the first k − 1 rolls, stepped exactly roll by
 * roll from the come-out.
 */
export function handLengthAtLeast(variant: Variant, k: number): Fraction {
  if (!Number.isSafeInteger(k) || k < 1) throw new RangeError('k counts rolls from 1')
  const points = POINT_NUMBERS[variant]
  let comeOut = ONE
  let onPoint = new Map<number, Fraction>(points.map((n) => [n, ZERO]))
  for (let roll = 1; roll < k; roll++) {
    let nextComeOut = comeOut.mul(Fraction.sum([...NATURALS[variant], ...CRAPS[variant]].map(p36)))
    const next = new Map<number, Fraction>()
    for (const n of points) {
      const w = frac(waysOf(n), 36)
      const stays = ONE.sub(w).sub(frac(6, 36))
      next.set(n, comeOut.mul(w).add((onPoint.get(n) ?? ZERO).mul(stays)))
      nextComeOut = nextComeOut.add((onPoint.get(n) ?? ZERO).mul(w))
    }
    comeOut = nextComeOut
    onPoint = next
  }
  return comeOut.add(Fraction.sum(onPoint.values()))
}

// ---------------------------------------------------------------------------------------------
// The lifecycle of one bet
// ---------------------------------------------------------------------------------------------

/** A payout or commission rounding (rules spec §4.2); `null` settles exactly. */
export type CfRounding = RefRounding | null

/** A commission rule (rules spec §4.3; plan §4.4 `CommissionInput`, the rate parsed). */
export interface CfCommission {
  /** Of the base: 1/20 is 5%. */
  readonly rate: Fraction
  readonly basis: 'stake' | 'win'
  readonly timing: 'upfront' | 'onWin'
  readonly rounding: CfRounding
  /** The smallest charge, in cents. */
  readonly minimum: number
  /** No effect on the lifecycle: the policy never takes a bet down. */
  readonly refundOnTakeDown: boolean
  readonly rearm: 'recollectFromWin' | 'recollectFromCredit' | 'none'
}

/** One way a decision ends. */
export interface CfOutcome {
  readonly kind: 'win' | 'lose' | 'push'
  readonly p: Fraction
  /**
   * Cash back to the player, in cents: the win as paid less commission taken from it, plus the
   * stake when it comes back. A stake that stays up is not cash back.
   */
  readonly credited: Fraction
  /** Whether the bet stays up for another decision. */
  readonly stays: boolean
  /** Upfront commission charged again because the bet stays up (`rearm`), in cents. */
  readonly recharge: Fraction
}

/** A bet as the lifecycle sees it: the cash of one decision and how long it works. */
export interface CfBet {
  /** The stake, in cents. */
  readonly stake: Fraction
  /** Commission paid with the stake when the bet is placed, in cents. */
  readonly upfront: Fraction
  /** Every way a decision ends; the chances add up to 1. */
  readonly outcomes: readonly CfOutcome[]
  /** Expected working rolls per decision: rolls on which the bet is ON and can be decided. */
  readonly workingRolls: Fraction
}

/** A decision's expected loss and amount risked, counting only its own cash. */
export interface CfDecisionView {
  /** E[loss] per decision, in cents: stake + upfront commission − cash back. */
  readonly loss: Fraction
  /** Stake + commission paid up front for the decision, in cents. */
  readonly risked: Fraction
  /** loss ÷ risked: HE_res with this decision's divisor (§0.1). */
  readonly edge: Fraction
}

export interface CfAnalysis {
  readonly pWin: Fraction
  readonly pLose: Fraction
  readonly pPush: Fraction
  /** Expected working rolls per decision. */
  readonly workingRollsPerDecision: Fraction
  /** Expected decisions in the lifecycle. */
  readonly decisions: Fraction
  /** Expected working rolls in the lifecycle. */
  readonly workingRolls: Fraction
  /** E[loss] over the lifecycle, in cents. */
  readonly loss: Fraction
  /** E[amount risked] over the lifecycle, in cents. */
  readonly risked: Fraction
  readonly edge: Fraction
  readonly edgeExcludingTies: Fraction
  readonly edgePerWorkingRoll: Fraction
  readonly heRoll: Fraction
  /** The first decision on its own (the bet as placed, its upfront vig included). */
  readonly perDecision: CfDecisionView
}

/**
 * The lifecycle of a bet under "leave it up until it loses or resolves". Decisions repeat while
 * the bet stays up, each one i.i.d., so the number of decisions D is geometric:
 * E[D] = 1 ÷ P(the bet comes down in a decision).
 * - E[loss] = stake + upfront + E[D] × Σ P(o) × (recharge(o) − credited(o)).
 * - E[risked] = E[D] × stake + upfront + E[D] × Σ P(o) × recharge(o).
 */
export function analyze(bet: CfBet): CfAnalysis {
  const total = Fraction.sum(bet.outcomes.map((o) => o.p))
  if (!total.equals(ONE)) throw new RangeError(`Outcome chances add up to ${total}, not 1`)
  const chance = (kind: CfOutcome['kind']) =>
    Fraction.sum(bet.outcomes.filter((o) => o.kind === kind).map((o) => o.p))
  const comesDown = Fraction.sum(bet.outcomes.filter((o) => !o.stays).map((o) => o.p))
  if (comesDown.isZero()) throw new RangeError('The bet never comes down')
  const decisions = ONE.div(comesDown)
  const recharge = Fraction.sum(bet.outcomes.map((o) => o.p.mul(o.recharge)))
  const credited = Fraction.sum(bet.outcomes.map((o) => o.p.mul(o.credited)))
  const loss = bet.stake.add(bet.upfront).add(decisions.mul(recharge.sub(credited)))
  const risked = decisions.mul(bet.stake).add(bet.upfront).add(decisions.mul(recharge))
  const pPush = chance('push')
  const workingRolls = decisions.mul(bet.workingRolls)
  const edge = loss.div(risked)
  // One decision as placed: the stake and upfront vig in, the cash back out, and a stake that
  // stays up counted as back (it is the next decision's stake; a re-collection is the next
  // decision's vig).
  const staysUp = Fraction.sum(bet.outcomes.filter((o) => o.stays).map((o) => o.p))
  const decisionLoss = bet.stake.add(bet.upfront).sub(credited).sub(staysUp.mul(bet.stake))
  const decisionRisked = bet.stake.add(bet.upfront)
  return {
    pWin: chance('win'),
    pLose: chance('lose'),
    pPush,
    workingRollsPerDecision: bet.workingRolls,
    decisions,
    workingRolls,
    loss,
    risked,
    edge,
    edgeExcludingTies: loss.div(risked.sub(decisions.mul(pPush).mul(bet.stake))),
    edgePerWorkingRoll: loss.div(workingRolls.mul(bet.stake)),
    heRoll: edge.div(bet.workingRolls),
    perDecision: {
      loss: decisionLoss,
      risked: decisionRisked,
      edge: decisionLoss.div(decisionRisked),
    },
  }
}

/** A win as paid: stake × pay, rounded once (rules spec §4.1). */
export function winPaid(stake: number | Fraction, pays: Fraction, rounding: CfRounding): Fraction {
  return paid(toCents(stake).mul(pays), rounding)
}

/** Commission on a base: max(minimum, round(rate × base)) (rules spec §4.3). */
export function vigOf(commission: CfCommission, base: Fraction): Fraction {
  return paid(base.mul(commission.rate), commission.rounding).max(frac(commission.minimum))
}

// ---------------------------------------------------------------------------------------------
// Number bets, odds and hardways (rules spec §1.2, §3.1-§3.3, §4.3)
// ---------------------------------------------------------------------------------------------

export interface NumberBetParams {
  /** 2-6 or 8-12. */
  readonly number: number
  /** Place, buy, big and take odds win on the number; lay, place to lose and lay odds on 7. */
  readonly winsOn: 'number' | 'seven'
  /** Net pay per unit staked ("to 1"). */
  readonly pays: Fraction
  /** In cents. */
  readonly stake: number | Fraction
  readonly rounding: CfRounding
  readonly commission?: CfCommission | null
  readonly afterWin: 'stay' | 'return'
}

/**
 * A bet on a number against 7, decided only on rolls it works (rules spec §1.2): w/(w + 6) for
 * the number, 6/(w + 6) for the 7, in 36/(w + 6) working rolls per decision.
 * Commission (§4.3):
 * - `upfront`: vig on the stake, or on the win as it would be paid (a lay), paid with the stake;
 *   charged again on every win that stays up unless `rearm` is `none`.
 * - `onWin`: vig on the stake or on the win as paid, taken from the win, never more than the win.
 */
export function numberBet(params: NumberBetParams): CfBet {
  const w = waysOf(params.number)
  const stake = toCents(params.stake)
  const numberFirst = frac(w, w + 6)
  const pWin = params.winsOn === 'number' ? numberFirst : ONE.sub(numberFirst)
  const win = winPaid(stake, params.pays, params.rounding)
  const commission = params.commission ?? null
  const base = commission?.basis === 'win' ? win : stake
  const upfront = commission?.timing === 'upfront' ? vigOf(commission, base) : ZERO
  const onWin = commission?.timing === 'onWin' ? vigOf(commission, base).min(win) : ZERO
  const stays = params.afterWin === 'stay'
  const recharge = stays && commission?.timing === 'upfront' && commission.rearm !== 'none'
  return {
    stake,
    upfront,
    outcomes: [
      {
        kind: 'win',
        p: pWin,
        credited: win.sub(onWin).add(stays ? ZERO : stake),
        stays,
        recharge: recharge ? upfront : ZERO,
      },
      { kind: 'lose', p: ONE.sub(pWin), credited: ZERO, stays: false, recharge: ZERO },
    ],
    workingRolls: frac(36, w + 6),
  }
}

/**
 * Odds behind a line bet on `number` (rules spec §3.1): taken odds win with the number, laid odds
 * with the 7, and come down with the decision. True odds pay 6/w (take) or w/6 (lay). Odds that
 * are OFF and returned when their come bet is decided on a come-out are not modelled here (the
 * dispatch chain covers them).
 */
export function oddsBet(params: {
  readonly number: number
  readonly side: 'take' | 'lay'
  readonly pays?: Fraction
  readonly stake: number | Fraction
  readonly rounding: CfRounding
}): CfBet {
  return numberBet({
    number: params.number,
    winsOn: params.side === 'take' ? 'number' : 'seven',
    pays: params.pays ?? trueOdds(params.number, params.side),
    stake: params.stake,
    rounding: params.rounding,
    afterWin: 'return',
  })
}

/** True odds on a number: 6/w to take it, w/6 to lay it (rules spec §3.1). */
export function trueOdds(number: number, side: 'take' | 'lay'): Fraction {
  const w = waysOf(number)
  return side === 'take' ? frac(6, w) : frac(w, 6)
}

/**
 * Hard 4, 6, 8 or 10 (rules spec §3.3): wins on its pair (1 way), loses on the easy way (w − 1
 * ways) or any 7, in 36/(w + 6) working rolls per decision.
 */
export function hardway(params: {
  readonly number: 4 | 6 | 8 | 10
  readonly pays: Fraction
  readonly stake: number | Fraction
  readonly rounding: CfRounding
  readonly afterWin: 'stay' | 'return'
}): CfBet {
  const w = waysOf(params.number)
  const stake = toCents(params.stake)
  const stays = params.afterWin === 'stay'
  const win = winPaid(stake, params.pays, params.rounding)
  return {
    stake,
    upfront: ZERO,
    outcomes: [
      {
        kind: 'win',
        p: frac(1, w + 6),
        credited: win.add(stays ? ZERO : stake),
        stays,
        recharge: ZERO,
      },
      { kind: 'lose', p: frac(w + 5, w + 6), credited: ZERO, stays: false, recharge: ZERO },
    ],
    workingRolls: frac(36, w + 6),
  }
}

// ---------------------------------------------------------------------------------------------
// One-roll bets and composites (rules spec §3.4; plan §0 amendment 15)
// ---------------------------------------------------------------------------------------------

/** The net per unit on a roll: a pay ("to 1") when it wins, 0 for a push, −1 when it loses. */
export type NetOn = (d1: number, d2: number) => Fraction

/** A one-roll bet keyed by total: `pays` lists the winning totals; any other total loses. */
export function byTotal(pays: Readonly<Record<number, Fraction>>): NetOn {
  return (d1, d2) => pays[d1 + d2] ?? ONE.neg()
}

/** A one-roll bet keyed by dice, low face first ("1-2", "3-3"): a hop or a horn single. */
export function byDice(pays: Readonly<Record<string, Fraction>>): NetOn {
  return (d1, d2) => pays[d1 <= d2 ? `${d1}-${d2}` : `${d2}-${d1}`] ?? ONE.neg()
}

/**
 * A composite's net per unit (plan §0 amendment 15): Σ(units of the winning parts × (pay + 1)) ÷
 * total units − 1. A part's net above −1 is a win for it.
 */
export function composite(
  parts: readonly { readonly net: NetOn; readonly units: number }[],
): NetOn {
  const units = parts.reduce((sum, part) => sum + part.units, 0)
  return (d1, d2) => {
    let returned = ZERO
    for (const part of parts) {
      const net = part.net(d1, d2)
      if (net.compare(ONE.neg()) > 0) returned = returned.add(net.add(ONE).mul(frac(part.units)))
    }
    return returned.div(frac(units)).sub(ONE)
  }
}

/**
 * A bet decided by the next roll (rules spec §3.4): over the 36 rolls, each distinct net is one
 * outcome. A positive net wins (paid with one rounding on the whole stake), 0 pushes (the world
 * bet on 7), −1 loses; a net strictly between −1 and 0 is a partial loss, which no bet has.
 */
export function oneRoll(params: {
  readonly net: NetOn
  readonly stake: number | Fraction
  readonly rounding: CfRounding
  readonly afterWin: 'stay' | 'return'
}): CfBet {
  const stake = toCents(params.stake)
  const stays = params.afterWin === 'stay'
  const ways = new Map<string, { net: Fraction; count: number }>()
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = 1; d2 <= 6; d2++) {
      const net = params.net(d1, d2)
      const entry = ways.get(net.toString()) ?? { net, count: 0 }
      ways.set(net.toString(), { net, count: entry.count + 1 })
    }
  }
  const outcomes = [...ways.values()].map(({ net, count }): CfOutcome => {
    const p = frac(count, 36)
    if (net.equals(ONE.neg()))
      return { kind: 'lose', p, credited: ZERO, stays: false, recharge: ZERO }
    if (net.isNegative()) throw new RangeError(`A net of ${net} would lose part of the stake`)
    const back = stays ? ZERO : stake
    if (net.isZero()) return { kind: 'push', p, credited: back, stays, recharge: ZERO }
    const win = winPaid(stake, net, params.rounding)
    return { kind: 'win', p, credited: win.add(back), stays, recharge: ZERO }
  })
  return { stake, upfront: ZERO, outcomes, workingRolls: ONE }
}

// ---------------------------------------------------------------------------------------------
// Line bets and odds (rules spec §1.3, §2.2, §3.1, §3.5, §4.4)
// ---------------------------------------------------------------------------------------------

export interface LineParams {
  readonly variant: Variant
  /** Pass and come (`do`), or don't pass and don't come (`dont`). */
  readonly side: 'do' | 'dont'
  /** The don't bar: 12 (or 2, Reno) pushes a don't bet on the come-out. */
  readonly dontBar?: 2 | 12 | null
  readonly pays?: Fraction
  readonly stake: number | Fraction
  readonly rounding: CfRounding
  /** `stayIfFirstRoll`: a don't winner in its box stays; `stayIf11`: a come winner on 11 stays. */
  readonly afterWin: 'stay' | 'return' | 'stayIfFirstRoll' | 'stayIf11'
}

/**
 * A line bet from its box (rules spec §2.2, §3.1): the come-out roll's naturals, craps and the
 * bar, then the point against 7. The bar push leaves the bet up, so it starts a new decision.
 * Every roll works, so working rolls per decision are the rolls per decision (§1.3).
 */
export function lineBet(params: LineParams): CfBet & {
  readonly perDecision: CfDecisionView
} {
  const { variant, side } = params
  const stake = toCents(params.stake)
  const win = winPaid(stake, params.pays ?? ONE, params.rounding)
  const stays = (firstRoll: boolean, total: number | null) =>
    params.afterWin === 'stay' ||
    (params.afterWin === 'stayIfFirstRoll' && firstRoll) ||
    (params.afterWin === 'stayIf11' && firstRoll && total === 11)
  const winning = (p: Fraction, staying: boolean): CfOutcome => ({
    kind: 'win',
    p,
    credited: win.add(staying ? ZERO : stake),
    stays: staying,
    recharge: ZERO,
  })
  const outcomes: CfOutcome[] = []
  let lose = ZERO
  for (const total of NATURALS[variant]) {
    if (side === 'do') outcomes.push(winning(probabilityOf(total), stays(true, total)))
    else lose = lose.add(probabilityOf(total))
  }
  for (const total of CRAPS[variant]) {
    if (side === 'do') lose = lose.add(probabilityOf(total))
    else if (total === params.dontBar) {
      outcomes.push({
        kind: 'push',
        p: probabilityOf(total),
        credited: ZERO,
        stays: true,
        recharge: ZERO,
      })
    } else outcomes.push(winning(probabilityOf(total), stays(true, total)))
  }
  let pointWins = ZERO
  for (const n of POINT_NUMBERS[variant]) {
    const made = probabilityOf(n).mul(chanceBeforeSeven(n))
    const sevened = probabilityOf(n).sub(made)
    pointWins = pointWins.add(side === 'do' ? made : sevened)
    lose = lose.add(side === 'do' ? sevened : made)
  }
  outcomes.push(winning(pointWins, stays(false, null)))
  outcomes.push({ kind: 'lose', p: lose, credited: ZERO, stays: false, recharge: ZERO })
  const bet: CfBet = {
    stake,
    upfront: ZERO,
    outcomes: outcomes.filter((o) => !o.p.isZero()),
    workingRolls: expectedRollsPerLineDecision(variant),
  }
  return { ...bet, perDecision: analyze(bet).perDecision }
}

/**
 * A line bet on a number: a put bet (pass placed on the point, rules spec §3.1 PUT_N) or a pass
 * bet whose point is set. Even money on the number against 7.
 */
export function putBet(params: {
  readonly number: number
  readonly stake: number | Fraction
  readonly side?: 'do' | 'dont'
}): CfBet {
  return numberBet({
    number: params.number,
    winsOn: (params.side ?? 'do') === 'do' ? 'number' : 'seven',
    pays: ONE,
    stake: params.stake,
    rounding: null,
    afterWin: 'return',
  })
}

/**
 * The equity of a line bet on point n, per unit flat (rules spec §3.1): the cash it returns from
 * now, 2w/(w + 6) for pass or come, 12/(w + 6) for don't.
 */
export function lineEquityOnPoint(number: number, side: 'do' | 'dont'): Fraction {
  const w = waysOf(number)
  return side === 'do' ? frac(2 * w, w + 6) : frac(12, w + 6)
}

export interface OddsCap {
  /** The multiple of the flat bet on each point (rules spec §4.4). */
  readonly multiple: (point: number) => number
  /** `stake`: odds ≤ multiple × flat; `win`: what the odds would win ≤ multiple × flat. */
  readonly basis: 'stake' | 'win'
  /** The odds pay per point; true odds when omitted. */
  readonly pays?: (point: number) => Fraction
  /** Odds rounding; exact when null. */
  readonly rounding: CfRounding
  /** The odds increment per point, in cents: the cap is floored to it (§4.4 [A]). */
  readonly increment?: (point: number) => number
}

/** The largest odds bet behind `flat` on a point, in cents (rules spec §4.4). */
export function maxOdds(
  flat: number | Fraction,
  point: number,
  side: 'do' | 'dont',
  cap: OddsCap,
): Fraction {
  const pays = cap.pays?.(point) ?? trueOdds(point, side === 'do' ? 'take' : 'lay')
  const limit = toCents(flat).mul(frac(cap.multiple(point)))
  const onStake = cap.basis === 'stake' ? limit : limit.div(pays)
  const step = cap.increment?.(point)
  return step === undefined ? onStake : frac(roundRef(onStake, { mode: 'floor', increment: step }))
}

/**
 * A line bet with full odds behind it on every point (rules spec §4.4): the combined edge is
 * E[loss on the flat and the odds] ÷ (flat + E[odds wagered]) per pass decision, ties counted.
 * With true odds paid exactly the odds lose nothing, so it is the flat's edge ÷ (1 + E[odds per
 * flat]): (7/495)/(1 + 2k/3) on a traditional pass with k× odds.
 */
export function lineWithOdds(params: LineParams & { readonly odds: OddsCap }): {
  readonly oddsWagered: Fraction
  readonly loss: Fraction
  readonly risked: Fraction
  readonly edge: Fraction
} {
  const flat = lineBet(params)
  let oddsWagered = ZERO
  let oddsLoss = ZERO
  for (const n of POINT_NUMBERS[params.variant]) {
    const amount = maxOdds(params.stake, n, params.side, params.odds)
    if (amount.isZero()) continue
    const odds = analyze(
      oddsBet({
        number: n,
        side: params.side === 'do' ? 'take' : 'lay',
        pays: params.odds.pays?.(n),
        stake: amount,
        rounding: params.odds.rounding,
      }),
    )
    oddsWagered = oddsWagered.add(probabilityOf(n as Total).mul(amount))
    oddsLoss = oddsLoss.add(probabilityOf(n as Total).mul(odds.loss))
  }
  const loss = flat.perDecision.loss.add(oddsLoss)
  const risked = flat.perDecision.risked.add(oddsWagered)
  return { oddsWagered, loss, risked, edge: loss.div(risked) }
}

// ---------------------------------------------------------------------------------------------
// Side bets: All Small / All Tall / Make 'Em All and the Fire Bet (rules spec §6.4, §6.6)
// ---------------------------------------------------------------------------------------------

/**
 * P(every total in `targets` is rolled before a 7), by inclusion-exclusion over the totals still
 * missing: Σ over subsets S of (−1)^|S| × P(7 before any of S) = Σ (−1)^|S| × 6/(6 + ways(S)).
 */
export function collectSetChance(targets: readonly number[]): Fraction {
  return Fraction.sum(
    subsets(targets).map(({ size, ways }) => frac(size % 2 === 0 ? 6 : -6, 6 + ways)),
  )
}

/**
 * E[rolls until the set is complete or a 7], by the same inclusion-exclusion: Σ over non-empty
 * subsets S of (−1)^(|S|+1) × 36/(6 + ways(S)).
 */
export function collectSetRolls(targets: readonly number[]): Fraction {
  return Fraction.sum(
    subsets(targets)
      .filter(({ size }) => size > 0)
      .map(({ size, ways }) => frac(size % 2 === 1 ? 36 : -36, 6 + ways)),
  )
}

/** All Small / All Tall / Make 'Em All (rules spec §6.4): the set before any 7, else it loses. */
export function collectSet(params: {
  readonly targets: readonly number[]
  readonly pays: Fraction
  readonly stake: number | Fraction
  readonly rounding: CfRounding
}): CfBet {
  if (params.targets.includes(7)) throw new RangeError('7 ends the bet; it cannot be a target')
  const stake = toCents(params.stake)
  const p = collectSetChance(params.targets)
  return {
    stake,
    upfront: ZERO,
    outcomes: [
      {
        kind: 'win',
        p,
        credited: winPaid(stake, params.pays, params.rounding).add(stake),
        stays: false,
        recharge: ZERO,
      },
      { kind: 'lose', p: ONE.sub(p), credited: ZERO, stays: false, recharge: ZERO },
    ],
    workingRolls: collectSetRolls(params.targets),
  }
}

export interface FireParams {
  readonly variant: Variant
  /** The points that count; making another point changes nothing (rules spec §6.6). */
  readonly countedPoints: readonly number[]
  /** Net pay ("to 1") by the number of counted points made; a count not listed loses. */
  readonly payTable: ReadonlyMap<number, Fraction>
  /** A count that pays at once and ends the bet; null pays at the seven-out. */
  readonly payImmediatelyAt: number | null
  readonly stake: number | Fraction
  readonly rounding: CfRounding
}

/**
 * The Fire Bet over one hand (rules spec §6.6), by a DP over the set of counted points made. Each
 * pass decision makes point n with P(n) × w/(w + 6) or sevens out; naturals, craps and points that
 * do not change the set only repeat the state. From a set M the next change is a new counted point
 * n with weight P(n made), or the seven-out with weight P(seven-out per decision). E[rolls] is
 * E[decisions] × E[rolls per decision] (Wald: whether a decision happens depends only on earlier
 * ones).
 */
export function fireBet(params: FireParams): CfBet & { readonly countChances: Fraction[] } {
  const { variant } = params
  const counted = [...new Set(params.countedPoints)]
  for (const n of counted) {
    if (!POINT_NUMBERS[variant].includes(n as Total)) throw new RangeError(`${n} is not a point`)
  }
  const made = counted.map((n) => probabilityOf(n as Total).mul(chanceBeforeSeven(n as Total)))
  const sevenOut = sevenOutChancePerDecision(variant)
  const size = 1 << counted.length
  const reach: Fraction[] = Array.from({ length: size }, () => ZERO)
  reach[0] = ONE
  const ends: Fraction[] = Array.from({ length: counted.length + 1 }, () => ZERO)
  let decisions = ZERO
  for (let mask = 0; mask < size; mask++) {
    const here = reach[mask] ?? ZERO
    if (here.isZero()) continue
    const count = bitCount(mask)
    if (count === params.payImmediatelyAt) {
      ends[count] = (ends[count] ?? ZERO).add(here)
      continue
    }
    let leave = sevenOut
    counted.forEach((_, i) => {
      if ((mask & (1 << i)) === 0) leave = leave.add(made[i] ?? ZERO)
    })
    decisions = decisions.add(here.div(leave))
    ends[count] = (ends[count] ?? ZERO).add(here.mul(sevenOut).div(leave))
    counted.forEach((_, i) => {
      const bit = 1 << i
      if ((mask & bit) !== 0) return
      reach[mask | bit] = (reach[mask | bit] ?? ZERO).add(here.mul(made[i] ?? ZERO).div(leave))
    })
  }
  const stake = toCents(params.stake)
  const outcomes: CfOutcome[] = []
  let lose = ZERO
  ends.forEach((p, count) => {
    const pays = params.payTable.get(count)
    if (pays === undefined) lose = lose.add(p)
    else if (!p.isZero()) {
      const credited = winPaid(stake, pays, params.rounding).add(stake)
      outcomes.push({ kind: 'win', p, credited, stays: false, recharge: ZERO })
    }
  })
  outcomes.push({ kind: 'lose', p: lose, credited: ZERO, stays: false, recharge: ZERO })
  return {
    stake,
    upfront: ZERO,
    outcomes,
    workingRolls: decisions.mul(expectedRollsPerLineDecision(variant)),
    countChances: ends,
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function waysOf(number: number): number {
  if (!TOTALS.includes(number as Total) || number === 7) {
    throw new RangeError(`${number} is not a number bet total`)
  }
  return waysToRoll(number as Total)
}

function p36(total: Total): Fraction {
  return probabilityOf(total)
}

function toCents(amount: number | Fraction): Fraction {
  return typeof amount === 'number' ? frac(amount) : amount
}

function paid(exact: Fraction, rounding: CfRounding): Fraction {
  return rounding === null ? exact : frac(roundRef(exact, rounding))
}

/** Every subset of `targets` as its size and its ways out of 36. */
function subsets(targets: readonly number[]): { size: number; ways: number }[] {
  const out: { size: number; ways: number }[] = []
  for (let mask = 0; mask < 1 << targets.length; mask++) {
    let ways = 0
    targets.forEach((total, i) => {
      if ((mask & (1 << i)) !== 0) ways += waysOf(total)
    })
    out.push({ size: bitCount(mask), ways })
  }
  return out
}

function bitCount(mask: number): number {
  let count = 0
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++
  return count
}
