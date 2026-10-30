import {
  Fraction,
  cents,
  validateAction,
  type Action,
  type BetInstance,
  type Cents,
  type MachineConfig,
  type TableState,
} from '../engine/index.ts'
import { legalAmounts, smallestAmount } from './amounts.ts'
import { analyzeBet, combinedEdge, efficientAmounts } from './analyze.ts'
import { ExactError, type BetSpec } from './chain.ts'
import { sameEvents } from './events.ts'

/**
 * Cheaper ways to make a bet (plan §5.2 `suggestAlternatives`, §5.4). Each alternative is priced at
 * the stake by the same analysis as the bet itself, and comes with the actions that make the
 * switch on the player's table, accepted by the engine as one batch (a dry run of
 * `validateAction`). The coach applies its own thresholds (plan §5.6); this lists every candidate
 * that is strictly cheaper.
 *
 * - **sameEvent**: another bet on the same number (or none) that wins, loses and pushes on exactly
 *   the same rolls (`sameEvents`), at the same stake: buy 4 for place 4.
 * - **restructure**: a cheaper bet that is not the same exposure, information only: place 6 for
 *   big 6 or hard 6; for a line bet with odds, the smallest flat bet with the most odds.
 * - **sizing**: the same bet at a nearby stake the machine pays more exactly ($6 rather than $5 on
 *   a penny-floored place 6).
 */

export type Comparability = 'sameEvent' | 'restructure' | 'sizing'

export interface Alternative {
  readonly comparability: Comparability
  readonly spec: BetSpec
  /** The alternative's stake; for a flat-plus-odds line bet, the flat. */
  readonly amount: Cents
  /** Its edge (lifecycle, as paid); for a line bet with odds, the combined edge. */
  readonly edge: Fraction
  /** The bet's edge less this one's: what switching saves per unit risked. */
  readonly saving: Fraction
  /** The alternative's expected loss per decision at its stake, in cents; null for odds advice. */
  readonly lossPerDecision: Fraction | null
  /**
   * The money switching saves, in cents per decision: the bet's loss per decision less this one's.
   * Only for a same-stake switch (sameEvent, and restructures on the same number); null where the
   * stakes differ (sizing, odds), where per-decision dollars are not comparable.
   */
  readonly savingPerDecision: Fraction | null
  /** What switching does on the table, accepted as one batch; empty for information only. */
  readonly actions: readonly Action[]
}

/** How far from the stake a sizing alternative may go, in increments. */
const SIZING_REACH = 3

/** The cheaper alternatives to `spec` at `amount` on table `state`, best saving first. */
export function suggestAlternatives(
  state: TableState,
  spec: BetSpec,
  amount: Cents,
  cfg: MachineConfig,
): Alternative[] {
  const own = analyzeBet(spec, amount, 'typical', cfg)
  const existing = state.bets.find(
    (bet) => bet.typeId === spec.typeId && bet.number === spec.number,
  )
  const found: Alternative[] = []
  for (const other of neighbours(spec, cfg)) {
    if (!legalAmounts(other, cfg, { from: amount, to: amount }).includes(amount)) continue
    let theirs: ReturnType<typeof analyzeBet>
    try {
      theirs = analyzeBet(other, amount, 'typical', cfg)
    } catch (error) {
      if (error instanceof ExactError) continue
      throw error
    }
    const { edge } = theirs
    if (edge.compare(own.edge) >= 0) continue
    // A lower edge whose dollar loss per decision is no lower saves nothing: an up-front vig
    // inflates the divisor, so a $15 buy 4 shows 6.250% against place 4's 6.667% while both lose
    // $1.00 a decision (rules spec §4.3, "tie at $15"). A same-stake switch must save money.
    const savingPerDecision = own.lossPerDecision.sub(theirs.lossPerDecision)
    if (savingPerDecision.isZero() || savingPerDecision.isNegative()) continue
    const same = sameEvents(spec, other, 'typical', cfg)
    found.push({
      comparability: same ? 'sameEvent' : 'restructure',
      spec: other,
      amount,
      edge,
      saving: own.edge.sub(edge),
      lossPerDecision: theirs.lossPerDecision,
      savingPerDecision,
      actions: same ? switchTo(existing, other, amount) : [],
    })
  }
  found.push(...withOdds(spec, own.edge, cfg))
  found.push(...sizing(spec, amount, own.edge, existing, cfg))
  return found
    .filter(({ actions }) => actions.length === 0 || accepted(state, actions, cfg))
    .sort((x, y) => y.saving.compare(x.saving))
}

/**
 * Bets that could stand in for `spec`: the other number bets and hardways on its number, or the
 * other one-roll bets and composites when it has none.
 */
function neighbours(spec: BetSpec, cfg: MachineConfig): BetSpec[] {
  const own = cfg.catalog.get(spec.typeId) ?? cfg.composites.get(spec.typeId)
  if (own === undefined) return []
  const others: BetSpec[] = []
  for (const type of [...cfg.catalog.values(), ...cfg.composites.values()]) {
    if (type.typeId === spec.typeId) continue
    if (type.family === 'numberVsSeven' || type.family === 'hardway') {
      if (spec.number !== null && type.numbers.some((n) => n === spec.number)) {
        others.push({ typeId: type.typeId, number: spec.number })
      }
    } else if (
      (type.family === 'oneRoll' || type.family === 'composite') &&
      (own.family === 'oneRoll' || own.family === 'composite')
    ) {
      others.push({ typeId: type.typeId, number: null })
    }
  }
  return others
}

/**
 * For a line bet that takes odds: the smallest flat bet with the most odds, when its combined edge
 * beats this flat bet's edge. Information only: odds go up after the point.
 */
function withOdds(spec: BetSpec, edge: Fraction, cfg: MachineConfig): Alternative[] {
  const type = cfg.catalog.get(spec.typeId)
  if (type?.family !== 'line' || spec.number !== null || !cfg.oddsFor.has(spec.typeId)) return []
  const flat = smallestAmount(spec, cfg)
  if (flat === null) return []
  const combined = combinedEdge(spec, flat, cfg)
  if (combined.oddsWagered.isZero() || combined.edge.compare(edge) >= 0) return []
  return [
    {
      comparability: 'restructure',
      spec,
      amount: flat,
      edge: combined.edge,
      saving: edge.sub(combined.edge),
      lossPerDecision: null,
      savingPerDecision: null,
      actions: [],
    },
  ]
}

/** The nearest cheaper stakes of the same bet, below and above `amount`. */
function sizing(
  spec: BetSpec,
  amount: Cents,
  edge: Fraction,
  existing: BetInstance | undefined,
  cfg: MachineConfig,
): Alternative[] {
  const span = reach(spec, cfg)
  const scan = efficientAmounts(spec, cfg, { from: amount - span, to: amount + span })
  const cheaper = scan.filter((entry) => entry.amount !== amount && entry.edge.compare(edge) < 0)
  const below = cheaper.filter((entry) => entry.amount < amount).at(-1)
  const above = cheaper.find((entry) => entry.amount > amount)
  return [below, above].flatMap((entry) =>
    entry === undefined
      ? []
      : [
          {
            comparability: 'sizing' as const,
            spec,
            amount: entry.amount,
            edge: entry.edge,
            saving: edge.sub(entry.edge),
            lossPerDecision: analyzeBet(spec, entry.amount, 'typical', cfg).lossPerDecision,
            // The stake changes, so per-decision dollars are not comparable.
            savingPerDecision: null,
            actions: resize(existing, spec, entry.amount),
          },
        ],
  )
}

/** The span of stakes a sizing scan covers: `SIZING_REACH` of the type's increments. */
function reach(spec: BetSpec, cfg: MachineConfig): number {
  const legal = legalAmounts(spec, cfg, { from: 0, to: Number.MAX_SAFE_INTEGER }, 2)
  const [first, second] = legal
  const increment = first !== undefined && second !== undefined ? second - first : 100
  return SIZING_REACH * increment
}

/** Take `existing` down (if any) and place `other` at `amount`. */
function switchTo(existing: BetInstance | undefined, other: BetSpec, amount: Cents): Action[] {
  const place: Action =
    other.number === null
      ? { type: 'place', typeId: other.typeId, amount }
      : { type: 'place', typeId: other.typeId, number: other.number, amount }
  if (existing === undefined) return [place]
  return [{ type: 'setAmount', betId: existing.id, amount: cents(0) }, place]
}

/** Change `existing` to `amount`, or place `spec` at it. */
function resize(existing: BetInstance | undefined, spec: BetSpec, amount: Cents): Action[] {
  if (existing !== undefined) return [{ type: 'setAmount', betId: existing.id, amount }]
  return switchTo(undefined, spec, amount)
}

function accepted(state: TableState, actions: readonly Action[], cfg: MachineConfig): boolean {
  return validateAction(state, { type: 'batch', actions }, cfg) === null
}
