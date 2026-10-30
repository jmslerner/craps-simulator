/**
 * The side-bet reference (M11; plan §9 item 2 for the side bets): a naive walker that follows one
 * side bet roll by roll and settles it as the rules spec says, written from rules spec §2.1, §2.6,
 * §6.2–§6.4 and §6.6 with its own rule constants. The engine is compared with it over scripted and
 * random dice sequences (tests/oracle/sideBets.diff.test.ts, tests/slow/sideBets.slow.test.ts).
 *
 * Like every oracle module, it reads machine data from the plain config JSON with the oracle's own
 * ratio parser (`parseNet`), takes only types from `src/engine/config`, and never imports the
 * engine's rule code or `src/exact` (tests/architecture.test.ts enforces this).
 *
 * The hand model (§0.1, §2.1): a hand is every roll from the first come-out after a seven-out (or
 * the session start) through the next seven-out, inclusive. `hand.rolls` counts every roll of the
 * hand, the seven-out included; the side bets that read hand counters settle at SEVEN_OUT before
 * the hand resets. "Shooter" means hand everywhere (plan §0 #14).
 *
 * Money: a side bet sets no rounding of its own, so its win rounds once with the machine's
 * `/money/payoutRounding` (§4.1); "x for 1" pays (x − 1) to 1 (§0.1).
 */
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import type { Total } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { CRAPS, NATURALS, POINT_NUMBERS, type Variant } from './closedForm.ts'
import { parseNet, type RefRounding } from './machineFacts.ts'
import { roundRef } from './referenceRules.ts'

// ---------------------------------------------------------------------------------------------
// Rule constants (rules spec §6.3, §6.4)
// ---------------------------------------------------------------------------------------------

/** Lucky Shooter come-out (§6.3 step 1): 2, 3 or 12 loses; 7 or 11 pushes and the bet stays. */
export const LUCKY_SHOOTER_COME_OUT_LOSES: readonly Total[] = [2, 3, 12]
export const LUCKY_SHOOTER_COME_OUT_PUSHES: readonly Total[] = [7, 11]

/** All Small is 2–6, All Tall 8–12, Make 'Em All both (§6.4). */
export const ALL_SMALL: readonly Total[] = [2, 3, 4, 5, 6]
export const ALL_TALL: readonly Total[] = [8, 9, 10, 11, 12]
export const MAKE_EM_ALL: readonly Total[] = [...ALL_SMALL, ...ALL_TALL]

// ---------------------------------------------------------------------------------------------
// The side bets a machine offers, read from the config JSON (rules spec §5.1 `/sideBets/<t>`)
// ---------------------------------------------------------------------------------------------

export type HandCount = 'allRolls' | 'exceptSevenOut' | 'exceptComeOutAndSevenOut'

export type SideBetRule =
  | {
      readonly family: 'collectSet'
      readonly id: string
      readonly targets: readonly Total[]
      /** Net pay "to 1". */
      readonly pays: Fraction
      /** `anySeven`: a come-out 7 loses too (§6.4); `sevenOut`: only a 7 in the point phase. */
      readonly endsOn: 'anySeven' | 'sevenOut'
      readonly placement: 'afterSevenOrStart' | 'noneOfTypeActive' | 'newHand'
    }
  | {
      readonly family: 'uniquePointsMade'
      readonly id: string
      readonly countedPoints: readonly Total[]
      /** Net pay "to 1" by the count of counted points made; a count not listed loses. */
      readonly payTable: ReadonlyMap<number, Fraction>
      readonly payImmediatelyAt: number | null
      readonly placement: 'newHand'
    }
  | {
      readonly family: 'handLength'
      readonly id: string
      readonly countDefinition: HandCount
      /** Ascending in `minRolls`; `push` is "1 for 1" (the stake back). */
      readonly tiers: readonly { readonly minRolls: number; readonly net: Fraction | 'push' }[]
      readonly placement: 'comeOutAfterSevenOut' | 'anyComeOut'
      /** Main-game stake the machine wants on the table, in cents. */
      readonly qualifyingBet: number
    }
  | {
      readonly family: 'pointRun'
      readonly id: string
      /** The box numbers: the point and the hits. */
      readonly points: readonly Total[]
      /** Net pay "to 1" by hits; a count not listed loses. */
      readonly payTable: ReadonlyMap<number, Fraction>
      /** Every other box number hit, then the point. */
      readonly topAward: Fraction
      readonly repeatEndsBet: boolean
      readonly placement: 'beforePoint' | 'comeOut' | 'newHand'
      readonly removableBeforePoint: boolean
    }

export type SideBetFamily = SideBetRule['family']

/** The machine's variant, its payout rounding and every side bet it offers. */
export interface SideBetMachine {
  readonly id: string
  readonly variant: Variant
  readonly rounding: RefRounding
  readonly rules: ReadonlyMap<string, SideBetRule>
}

export function sideBetMachineFrom(input: MachineConfigInput): SideBetMachine {
  const rules = new Map<string, SideBetRule>()
  for (const [id, bet] of Object.entries(input.sideBets)) {
    rules.set(id, sideBetRuleFrom(id, bet))
  }
  return {
    id: input.id,
    variant: input.variant,
    rounding: {
      mode: input.money.payoutRounding.mode,
      increment: input.money.payoutRounding.increment,
    },
    rules,
  }
}

/** One side bet's rules from its config JSON, the pays parsed to exact "to 1" nets. */
export function sideBetRuleFrom(
  id: string,
  bet: MachineConfigInput['sideBets'][string],
): SideBetRule {
  switch (bet.family) {
    case 'collectSet':
      return {
        family: 'collectSet',
        id,
        targets: bet.targets,
        pays: parseNet(bet.pays),
        endsOn: bet.endsOn,
        placement: bet.placement,
      }
    case 'uniquePointsMade':
      return {
        family: 'uniquePointsMade',
        id,
        countedPoints: bet.countedPoints,
        payTable: payTableFrom(bet.payTable),
        payImmediatelyAt: bet.payImmediatelyAt,
        placement: bet.placement,
      }
    case 'handLength':
      return {
        family: 'handLength',
        id,
        countDefinition: bet.countDefinition,
        tiers: bet.tiers.map((tier) => ({
          minRolls: tier.minRolls,
          net: tier.pays === 'push' ? 'push' : parseNet(tier.pays),
        })),
        placement: bet.placement,
        qualifyingBet: bet.qualifyingBet,
      }
    case 'pointRun':
      return {
        family: 'pointRun',
        id,
        points: bet.points,
        payTable: payTableFrom(bet.payTable),
        topAward: parseNet(bet.topAward),
        repeatEndsBet: bet.repeatEndsBet,
        placement: bet.placement,
        removableBeforePoint: bet.removableBeforePoint,
      }
  }
}

function payTableFrom(table: Readonly<Record<string, string>>): ReadonlyMap<number, Fraction> {
  const out = new Map<number, Fraction>()
  for (const [count, text] of Object.entries(table)) {
    const n = Number(count)
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Not a count: "${count}"`)
    out.set(n, parseNet(text))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The round and the hand (rules spec §2.1)
// ---------------------------------------------------------------------------------------------

export interface RefRound {
  readonly phase: 'comeOut' | 'point'
  /** The pass point in the point phase. */
  readonly point: Total | null
  /** `hand.rolls`: rolls of the current hand so far; 0 before a hand's first roll. */
  readonly handRolls: number
  /** The last roll was a 7 of any kind; false before the first roll. */
  readonly lastWasSeven: boolean
  /** Whether any roll has happened yet (the start of a cycle, §2.6). */
  readonly rolled: boolean
}

export const START_ROUND: RefRound = {
  phase: 'comeOut',
  point: null,
  handRolls: 0,
  lastWasSeven: false,
  rolled: false,
}

export type RoundEvent =
  'natural' | 'craps' | 'pointEstablished' | 'pointMade' | 'sevenOut' | 'none'

/**
 * The round after `total` (§2.1): on the come-out a natural or craps keeps the come-out and a point
 * number sets the point; on the point, the point is made (back to the come-out, same hand) or a 7
 * is the seven-out (the hand ends; the next roll starts a new one with `hand.rolls` at 0).
 */
export function advanceRef(
  round: RefRound,
  total: Total,
  variant: Variant,
): { readonly round: RefRound; readonly event: RoundEvent } {
  const rolls = round.handRolls + 1
  const base = { lastWasSeven: total === 7, rolled: true }
  if (round.phase === 'comeOut') {
    if (NATURALS[variant].includes(total)) {
      return {
        round: { ...base, phase: 'comeOut', point: null, handRolls: rolls },
        event: 'natural',
      }
    }
    if (CRAPS[variant].includes(total)) {
      return { round: { ...base, phase: 'comeOut', point: null, handRolls: rolls }, event: 'craps' }
    }
    if (!POINT_NUMBERS[variant].includes(total)) throw new RangeError(`${total} is no come-out`)
    return {
      round: { ...base, phase: 'point', point: total, handRolls: rolls },
      event: 'pointEstablished',
    }
  }
  if (total === round.point) {
    return {
      round: { ...base, phase: 'comeOut', point: null, handRolls: rolls },
      event: 'pointMade',
    }
  }
  if (total === 7) {
    return { round: { ...base, phase: 'comeOut', point: null, handRolls: 0 }, event: 'sevenOut' }
  }
  return { round: { ...round, ...base, handRolls: rolls }, event: 'none' }
}

/**
 * The rolls a Hot Shooter definition counts in a hand of `rolls` rolls (§6.2): A counts them all,
 * B leaves out the seven-out, C leaves out the first come-out and the seven-out.
 */
export function countedRolls(definition: HandCount, rolls: number): number {
  switch (definition) {
    case 'allRolls':
      return rolls
    case 'exceptSevenOut':
      return rolls - 1
    case 'exceptComeOutAndSevenOut':
      return rolls - 2
  }
}

// ---------------------------------------------------------------------------------------------
// One side bet on the table
// ---------------------------------------------------------------------------------------------

export type SideBetProgress =
  | { readonly family: 'collectSet'; readonly hit: readonly Total[] }
  | { readonly family: 'uniquePointsMade'; readonly made: readonly Total[] }
  /** The count is the hand's own `hand.rolls` (§2.6), read from the round. */
  | { readonly family: 'handLength' }
  | { readonly family: 'pointRun'; readonly point: Total | null; readonly hits: readonly Total[] }

export interface RefSideBet {
  readonly rule: SideBetRule
  /** In cents. */
  readonly stake: number
  readonly progress: SideBetProgress
  /** Whether the bet has seen a roll since it was placed (it is then locked, §2.6). */
  readonly rolledOn: boolean
}

export interface RefSettlement {
  readonly outcome: 'win' | 'lose' | 'push'
  /** The net pay "to 1" of a win; zero otherwise. */
  readonly net: Fraction
  /** The win as paid, rounded once with the machine's payout rounding, in cents. */
  readonly winPaid: number
  /** Cash back to the player, in cents: the stake when it comes back, plus the win. */
  readonly credited: number
  /** Whether the bet leaves the table; a Lucky Shooter 7/11 push stays (§6.3). */
  readonly ends: boolean
  readonly why: string
}

export function placeSideBet(rule: SideBetRule, stake: number): RefSideBet {
  return { rule, stake, progress: initialProgress(rule), rolledOn: false }
}

function initialProgress(rule: SideBetRule): SideBetProgress {
  switch (rule.family) {
    case 'collectSet':
      return { family: 'collectSet', hit: [] }
    case 'uniquePointsMade':
      return { family: 'uniquePointsMade', made: [] }
    case 'handLength':
      return { family: 'handLength' }
    case 'pointRun':
      return { family: 'pointRun', point: null, hits: [] }
  }
}

export interface StepResult {
  /** The bet after the roll; null when it left the table. */
  readonly bet: RefSideBet | null
  readonly settlement: RefSettlement | null
}

/**
 * One roll of `total` against `bet`, with the round as it was before the roll. The bet's own
 * counters change only here; the round advances by `advanceRef`.
 */
export function stepSideBet(
  bet: RefSideBet,
  before: RefRound,
  total: Total,
  machine: Pick<SideBetMachine, 'variant' | 'rounding'>,
): StepResult {
  const { rule, stake } = bet
  const { event } = advanceRef(before, total, machine.variant)
  const keep = (progress: SideBetProgress): StepResult => ({
    bet: { ...bet, progress, rolledOn: true },
    settlement: null,
  })
  const settle = (
    outcome: RefSettlement['outcome'],
    net: Fraction,
    ends: boolean,
    why: string,
  ): StepResult => {
    const winPaid = outcome === 'win' ? roundRef(Fraction.of(stake).mul(net), machine.rounding) : 0
    const stakeBack = outcome === 'win' || (outcome === 'push' && ends) ? stake : 0
    return {
      bet: ends ? null : { ...bet, rolledOn: true },
      settlement: { outcome, net, winPaid, credited: stakeBack + winPaid, ends, why },
    }
  }
  const lose = (why: string) => settle('lose', Fraction.ZERO, true, why)
  const win = (net: Fraction, why: string) => settle('win', net, true, why)

  switch (rule.family) {
    case 'collectSet': {
      if (bet.progress.family !== 'collectSet') throw new TypeError('progress mismatch')
      if (total === 7) {
        if (rule.endsOn === 'anySeven' || event === 'sevenOut') return lose('a 7')
        return keep(bet.progress)
      }
      if (!rule.targets.includes(total) || bet.progress.hit.includes(total)) {
        return keep(bet.progress)
      }
      const hit = [...bet.progress.hit, total]
      if (hit.length === rule.targets.length) return win(rule.pays, 'the set is complete')
      return keep({ family: 'collectSet', hit })
    }

    case 'uniquePointsMade': {
      if (bet.progress.family !== 'uniquePointsMade') throw new TypeError('progress mismatch')
      const { made } = bet.progress
      if (event === 'pointMade') {
        const p = before.point
        if (p === null || !rule.countedPoints.includes(p) || made.includes(p)) {
          return keep(bet.progress)
        }
        const now = [...made, p]
        if (now.length === rule.payImmediatelyAt) {
          const pays = rule.payTable.get(now.length)
          if (pays === undefined) throw new RangeError(`no pay for ${now.length} points`)
          return win(pays, `${now.length} points made, paid at once`)
        }
        return keep({ family: 'uniquePointsMade', made: now })
      }
      if (event === 'sevenOut') {
        const pays = rule.payTable.get(made.length)
        return pays === undefined
          ? lose(`seven-out after ${made.length} points`)
          : win(pays, `seven-out after ${made.length} points`)
      }
      return keep(bet.progress)
    }

    case 'handLength': {
      if (event !== 'sevenOut') return keep(bet.progress)
      const rolls = before.handRolls + 1
      const count = countedRolls(rule.countDefinition, rolls)
      let reached: (typeof rule.tiers)[number] | null = null
      for (const tier of rule.tiers) if (tier.minRolls <= count) reached = tier
      if (reached === null) return lose(`${count} rolls counted`)
      if (reached.net === 'push')
        return settle('push', Fraction.ZERO, true, `${count} rolls, 1 for 1`)
      return win(reached.net, `${count} rolls counted`)
    }

    case 'pointRun': {
      if (bet.progress.family !== 'pointRun') throw new TypeError('progress mismatch')
      const { point, hits } = bet.progress
      if (point === null) {
        if (LUCKY_SHOOTER_COME_OUT_LOSES.includes(total)) return lose(`${total} on the come-out`)
        if (LUCKY_SHOOTER_COME_OUT_PUSHES.includes(total)) {
          return settle('push', Fraction.ZERO, false, `${total} on the come-out, the bet stays`)
        }
        if (rule.points.includes(total)) {
          return keep({ family: 'pointRun', point: total, hits: [] })
        }
        throw new RangeError(`The spec does not define a Lucky Shooter come-out of ${total}`)
      }
      const others = rule.points.length - 1
      const newHit = rule.points.includes(total) && total !== point && !hits.includes(total)
      if (newHit) return keep({ family: 'pointRun', point, hits: [...hits, total] })
      const k = hits.length
      if (total === point && k === others) return win(rule.topAward, 'every hit, then the point')
      if (hits.includes(total) && !rule.repeatEndsBet && k < others) return keep(bet.progress)
      const pays = rule.payTable.get(k)
      return pays === undefined ? lose(`${k} hits, ended by ${total}`) : win(pays, `${k} hits`)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Placement windows (rules spec §2.6) and locks
// ---------------------------------------------------------------------------------------------

export interface RefWindow {
  readonly round: RefRound
  /** A bet of the same type is on the table. */
  readonly sameTypeActive: boolean
  /** A bet of this type won since the last 7 (Interblock: no re-bet after a win until a 7). */
  readonly wonSinceSeven: boolean
  /** Main-game stakes on the table, ON or OFF, in cents (the Hot Shooter qualifier). */
  readonly mainGameStake: number
}

/** Whether a new bet of `rule` may go on the table now, and why not. */
export function windowOpen(
  rule: SideBetRule,
  ctx: RefWindow,
): { readonly open: boolean; readonly why: string } {
  const { round } = ctx
  const newHand = round.handRolls === 0 && round.phase === 'comeOut'
  const closed = (why: string) => ({ open: false, why })
  const open = { open: true, why: 'the window is open' }
  if (ctx.sameTypeActive) return closed('a bet of this type is already up')
  switch (rule.family) {
    case 'collectSet':
      switch (rule.placement) {
        case 'afterSevenOrStart':
          if (ctx.wonSinceSeven) return closed('no re-bet after a win until a 7')
          if (!round.rolled || round.lastWasSeven) return open
          return closed('only after a 7 or at the start of a cycle')
        case 'noneOfTypeActive':
          return open
        case 'newHand':
          return newHand ? open : closed('only before a new hand')
      }
      break
    case 'uniquePointsMade':
      return newHand ? open : closed('only before a new hand')
    case 'handLength':
      if (round.phase !== 'comeOut') return closed('only on a come-out')
      if (rule.placement === 'comeOutAfterSevenOut' && !newHand) {
        return closed('only on the come-out after a seven-out')
      }
      if (ctx.mainGameStake < rule.qualifyingBet) return closed('the qualifying bet is missing')
      return open
    case 'pointRun':
      if (round.phase !== 'comeOut') return closed('only before the point is set')
      if (rule.placement === 'newHand' && !newHand) return closed('only before a new hand')
      return open
  }
  throw new RangeError('unreachable')
}

/**
 * Whether the player may take `bet` down (§2.6 "Lock"): side bets are locked once the dice have
 * rolled on them; a Lucky Shooter is removable before its point when the machine allows it.
 */
export function removable(bet: RefSideBet): boolean {
  if (!bet.rolledOn) return true
  return (
    bet.rule.family === 'pointRun' &&
    bet.progress.family === 'pointRun' &&
    bet.progress.point === null &&
    bet.rule.removableBeforePoint
  )
}

// ---------------------------------------------------------------------------------------------
// Walking a whole dice sequence
// ---------------------------------------------------------------------------------------------

export interface WalkStep {
  readonly index: number
  readonly total: Total
  readonly event: RoundEvent
  readonly settlement: RefSettlement | null
  readonly progress: SideBetProgress | null
}

/**
 * Places `rule` at `stake` with the round at `start` and rolls `totals` in order, stopping when
 * the bet leaves the table. Returns one step per roll taken and the round after the last one.
 */
export function walkSideBet(
  rule: SideBetRule,
  stake: number,
  totals: readonly Total[],
  machine: Pick<SideBetMachine, 'variant' | 'rounding'>,
  start: RefRound = START_ROUND,
): {
  readonly steps: readonly WalkStep[]
  readonly round: RefRound
  readonly bet: RefSideBet | null
} {
  let bet: RefSideBet | null = placeSideBet(rule, stake)
  let round = start
  const steps: WalkStep[] = []
  for (const [index, total] of totals.entries()) {
    if (bet === null) break
    const advanced = advanceRef(round, total, machine.variant)
    const step = stepSideBet(bet, round, total, machine)
    steps.push({
      index,
      total,
      event: advanced.event,
      settlement: step.settlement,
      progress: step.bet?.progress ?? null,
    })
    bet = step.bet
    round = advanced.round
  }
  return { steps, round, bet }
}
