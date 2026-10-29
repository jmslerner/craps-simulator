import {
  Fraction,
  type BetId,
  type BetInstance,
  type Cents,
  type MachineConfig,
  type TableState,
} from '../engine/index.ts'
import { suggestAlternatives } from './alternatives.ts'
import { type BetSpec } from './chain.ts'
import { standingCost, type StandingCost } from './standing.ts'

/**
 * The layout meter (plan §5.1, §5.2 `analyzeLayout`): what keeping the table's bets up costs per
 * roll and per hour, each bet's standing cost added up, and the same exposure built from cheaper
 * same-event bets.
 *
 * Streams: a pass or don't pass bet is one decision after another on the line, priced per come-out
 * decision whatever its point now. Come and don't come bets are one stream per type, a new bet in
 * the box on every point-phase roll (plan §5.1's "come" row), so the meter counts each such type
 * once, at the stake in the box, or at the latest bet's if the box is empty; the type's other bets
 * are part of that stream. Odds are priced per arrival of their parent on their number.
 */

/** The machine's pace range the meter always shows alongside the config's own pace (plan §5.1). */
export const PACE_RANGE = Object.freeze({ low: 60, high: 150 })

export interface LayoutBet {
  readonly betId: BetId
  readonly spec: BetSpec
  readonly amount: Cents
  /** The bet's standing cost; null for a bet counted in another's stream (`countedIn`). */
  readonly cost: StandingCost | null
  readonly countedIn: BetId | null
}

export interface LayoutSwap {
  readonly betId: BetId
  readonly to: BetSpec
  readonly amount: Cents
}

export interface LayoutAnalysis {
  /** Expected loss per roll, in cents. */
  readonly perRoll: Fraction
  /** Per hour at 60, at the machine's pace and at 150 rolls an hour, in cents. */
  readonly perHour: readonly { readonly at: number; readonly value: Fraction }[]
  readonly byBet: readonly LayoutBet[]
  /** The same exposure with every bet swapped for its cheapest same-event bet; null if none. */
  readonly alternativeLayout: {
    readonly perRoll: Fraction
    readonly swaps: readonly LayoutSwap[]
  } | null
}

export function analyzeLayout(state: TableState, cfg: MachineConfig): LayoutAnalysis {
  const streams = streamHeads(state, cfg)
  const byBet: LayoutBet[] = state.bets.map((bet) => {
    const spec = standingSpec(bet, cfg)
    const head = streams.get(bet.typeId)
    if (head !== undefined && head.id !== bet.id) {
      return { betId: bet.id, spec, amount: bet.amount, cost: null, countedIn: head.id }
    }
    const cost = standingCost(spec, bet.amount, cfg, {
      working: bet.working,
      globalOff: state.globalOff,
    })
    return { betId: bet.id, spec, amount: bet.amount, cost, countedIn: null }
  })
  const perRoll = Fraction.sum(byBet.map(({ cost }) => cost?.perRoll ?? Fraction.ZERO))
  return {
    perRoll,
    perHour: perHourAt(perRoll, cfg),
    byBet,
    alternativeLayout: alternativeLayout(state, byBet, perRoll, cfg),
  }
}

/** `perRoll` per hour at 60, the machine's pace and 150 rolls an hour. */
export function perHourAt(
  perRoll: Fraction,
  cfg: MachineConfig,
): { readonly at: number; readonly value: Fraction }[] {
  const paces = [...new Set([PACE_RANGE.low, cfg.pace.rollsPerHour, PACE_RANGE.high])].sort(
    (a, b) => a - b,
  )
  return paces.map((at) => ({ at, value: perRoll.mul(Fraction.of(at)) }))
}

/**
 * The bet standing for each come-type stream on the table: its bet in the box, else its latest bet
 * (bets are in placement order).
 */
function streamHeads(state: TableState, cfg: MachineConfig): Map<string, BetInstance> {
  const heads = new Map<string, BetInstance>()
  for (const bet of state.bets) {
    const type = cfg.catalog.get(bet.typeId)
    if (type?.family !== 'line' || type.window !== 'point') continue
    const head = heads.get(bet.typeId)
    if (head === undefined || head.number !== null) heads.set(bet.typeId, bet)
  }
  return heads
}

/** What a bet's standing cost is of: line bets as their stream, from the line or the box. */
function standingSpec(bet: BetInstance, cfg: MachineConfig): BetSpec {
  const type = cfg.catalog.get(bet.typeId)
  return { typeId: bet.typeId, number: type?.family === 'line' ? null : bet.number }
}

function alternativeLayout(
  state: TableState,
  byBet: readonly LayoutBet[],
  perRoll: Fraction,
  cfg: MachineConfig,
): LayoutAnalysis['alternativeLayout'] {
  const swaps: LayoutSwap[] = []
  let total = perRoll
  for (const { betId, spec, amount, cost } of byBet) {
    if (cost === null) continue
    const best = suggestAlternatives(state, spec, amount, cfg).find(
      ({ comparability }) => comparability === 'sameEvent',
    )
    if (best === undefined) continue
    const bet = state.bets.find((b) => b.id === betId)
    const swapped = standingCost(best.spec, best.amount, cfg, {
      working: bet?.working ?? null,
      globalOff: state.globalOff,
    })
    total = total.sub(cost.perRoll).add(swapped.perRoll)
    swaps.push({ betId, to: best.spec, amount: best.amount })
  }
  return swaps.length === 0 ? null : { perRoll: total, swaps }
}
