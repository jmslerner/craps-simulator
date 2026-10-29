import {
  ENGINE_VERSION,
  Fraction,
  betId,
  cents,
  commissionRule,
  settle,
  upfrontVig,
  vigBase,
  vigOf,
  type BetInstance,
  type Cents,
  type MachineConfig,
} from '../engine/index.ts'
import {
  ExactError,
  ROLLS_COLUMN,
  WORKING_COLUMN,
  buildChain,
  solveBetChain,
  type BetChain,
  type BetSpec,
  type ChainLabel,
  type Horizon,
  type SettledDecision,
  type SolvedChain,
  type StartContext,
} from './chain.ts'
import { analysisCache, remember } from './cache.ts'
import { at } from './solve.ts'
import { startKey } from './start.ts'

/**
 * Pricing (plan §5.2): a solved chain gives the expected count of every amount-independent label,
 * and pricing a stake is the dot product Σ count(label) × cash(label, stake). The cash comes from
 * the engine: `settle` (rounded as the machine pays, or `exact`) for settlements, and the
 * engine's up-front commission (`upfrontVig`, or `vigOf`/`vigBase` unrounded) for placement and
 * re-collection. So pricing any stake costs microseconds, which makes chip previews, rounding scans
 * and minimum-vig scans cheap.
 *
 * Distributions are cached by (configHash, ENGINE_VERSION, EXACT_VERSION, typeId, number, start,
 * horizon): everything they depend on.
 *
 * **Cash of a label** (amounts in cents):
 * - a settlement credits `trace.credited + trace.vigRearm`: the stake if it comes back, plus the
 *   win as paid, less commission taken on the win. The part of a re-collection a win covered
 *   (`vigRearm`) is added back because `vig:rearm` charges the whole of it;
 * - `vig:rearm` costs the full up-front vig again: with enough credit (plan §0 #24) the machine
 *   collects all of it, from the win and from credit;
 * - `travel:<n>` moves no money.
 *
 * At a `decision` horizon a stake left up by its settlement counts as returned (glossary: "a stake
 * that stays on the table after a win counts as returned and wagered again").
 */

/** The analysis code's own version: part of every cache key, for caches that outlive a session. */
export const EXACT_VERSION = 1

/** `rounded`: as the machine pays. `exact`: no rounding anywhere, commission minimums kept. */
export type PriceMode = 'rounded' | 'exact'

/** Expected label counts, rolls and working rolls from a start, for one bet and horizon. */
export interface Distribution {
  readonly key: string
  readonly spec: BetSpec
  readonly horizon: Horizon
  readonly labels: readonly ChainLabel[]
  readonly counts: readonly Fraction[]
  readonly rolls: Fraction
  readonly workingRolls: Fraction
}

/** A distribution priced at one stake. Money is in cents. */
export interface Priced {
  readonly amount: Cents
  readonly mode: PriceMode
  /**
   * E[cash credited back]: each settlement's credit before any re-collection, plus, at a decision
   * horizon, the stake a settlement leaves up.
   */
  readonly credited: Fraction
  /** E[up-front vig collected again from winners that stay up]. */
  readonly rearmed: Fraction
  /** E[decisions]: wins, losses and pushes. */
  readonly decisions: Fraction
}

const MAX_CACHED = 4_000
const solvedCache = analysisCache<string, SolvedChain>()
const distributionCache = analysisCache<string, Distribution>()

/** The cache key of an analysis: everything a distribution depends on. */
export function analysisKey(
  spec: BetSpec,
  start: StartContext,
  horizon: Horizon,
  cfg: MachineConfig,
): string {
  const number = spec.number === null ? '-' : String(spec.number)
  return [
    cfg.configHash,
    `e${ENGINE_VERSION}`,
    `x${EXACT_VERSION}`,
    spec.typeId,
    number,
    startKey(start),
    horizon,
  ].join('|')
}

/** The solved chain of `spec` from `start`, cached. */
export function solvedChain(
  spec: BetSpec,
  start: StartContext,
  horizon: Horizon,
  cfg: MachineConfig,
): SolvedChain {
  const key = analysisKey(spec, start, horizon, cfg)
  const cached = solvedCache.get(key)
  if (cached !== undefined) return cached
  const solved = solveBetChain(buildChain(spec, start, horizon, cfg))
  remember(solvedCache, key, solved, MAX_CACHED)
  return solved
}

/**
 * The expected label counts of `spec` from `start` (each start phase weighted), cached. Throws
 * `NEVER_RESOLVES` when the bet may never be decided from there (it is OFF for good, say).
 */
export function distribution(
  spec: BetSpec,
  start: StartContext,
  horizon: Horizon,
  cfg: MachineConfig,
): Distribution {
  const key = analysisKey(spec, start, horizon, cfg)
  const cached = distributionCache.get(key)
  if (cached !== undefined) return cached
  const made = startDistribution(key, solvedChain(spec, start, horizon, cfg))
  remember(distributionCache, key, made, MAX_CACHED)
  return made
}

/** The start-weighted distribution of a solved chain. */
export function startDistribution(key: string, { chain, solution }: SolvedChain): Distribution {
  return weighted(key, chain, solution.values, chain.starts)
}

/** The distribution of a solved chain from one of its states. */
export function nodeDistribution(solved: SolvedChain, node: number): Distribution {
  const { chain, solution } = solved
  return weighted(`${chain.spec.typeId}#${node}`, chain, solution.values, [
    { node, weight: Fraction.ONE },
  ])
}

function weighted(
  key: string,
  chain: BetChain,
  values: readonly (readonly Fraction[] | null)[],
  starts: readonly { readonly node: number; readonly weight: Fraction }[],
): Distribution {
  const columns = chain.labels.length + 2
  const totals = new Array<Fraction>(columns).fill(Fraction.ZERO)
  for (const { node, weight } of starts) {
    const row = at(values, node)
    if (row === null) {
      throw new ExactError(
        'NEVER_RESOLVES',
        `${chain.spec.typeId} may never be decided from ${at(chain.nodes, node).key}`,
      )
    }
    for (let c = 0; c < columns; c++) totals[c] = at(totals, c).add(at(row, c).mul(weight))
  }
  return {
    key,
    spec: chain.spec,
    horizon: chain.horizon,
    labels: chain.labels,
    counts: totals.slice(0, chain.labels.length),
    rolls: at(totals, chain.labels.length + ROLLS_COLUMN),
    workingRolls: at(totals, chain.labels.length + WORKING_COLUMN),
  }
}

/** Prices a distribution at `amount`: a dot product of the label counts with each label's cash. */
export function price(
  dist: Distribution,
  amount: Cents,
  cfg: MachineConfig,
  mode: PriceMode,
): Priced {
  let credited = Fraction.ZERO
  let rearmed = Fraction.ZERO
  let decisions = Fraction.ZERO
  for (const [index, label] of dist.labels.entries()) {
    const count = at(dist.counts, index)
    if (count.isZero()) continue
    switch (label.kind) {
      case 'settle': {
        decisions = decisions.add(count)
        let cash = settlementCash(dist.spec, label.decision, amount, cfg, mode)
        if (dist.horizon === 'decision' && label.disposition === 'stays') {
          cash = cash.add(Fraction.of(amount))
        }
        credited = credited.add(count.mul(cash))
        break
      }
      case 'rearm':
        rearmed = rearmed.add(count.mul(upfrontCharge(dist.spec, amount, cfg, mode)))
        break
      case 'travel':
        break
    }
  }
  return { amount, mode, credited, rearmed, decisions }
}

/**
 * The cash a settlement credits at `amount`, before any re-collection (see the module comment):
 * `credited + vigRearm` from the engine's `settle`.
 */
export function settlementCash(
  spec: BetSpec,
  decision: SettledDecision,
  amount: Cents,
  cfg: MachineConfig,
  mode: PriceMode,
): Fraction {
  const bet = betAt(spec, amount)
  if (mode === 'exact') {
    const trace = settle(bet, decision, cfg, 'exact')
    return trace.credited.add(trace.vigRearm)
  }
  const trace = settle(bet, decision, cfg)
  return Fraction.of(trace.credited + trace.vigRearm)
}

/**
 * The up-front commission on a bet of `amount` on its number: what placing it costs on top of the
 * stake, and what a winner that stays up pays again where it is re-collected. 0 for a bet charged
 * no commission up front. Rounded as the machine charges it (`upfrontVig`), or exactly (the same
 * rule with no rounding: `vigOf(vigBase(...))`, minimum kept).
 */
export function upfrontCharge(
  spec: BetSpec,
  amount: Cents,
  cfg: MachineConfig,
  mode: PriceMode,
): Fraction {
  const type = cfg.catalog.get(spec.typeId)
  const n = spec.number
  if (type?.family !== 'numberVsSeven' || n === null || amount === 0) return Fraction.ZERO
  if (mode === 'rounded') return Fraction.of(upfrontVig(type, n, amount))
  const rule = commissionRule(type, n)
  if (rule === null || rule.timing !== 'upfront') return Fraction.ZERO
  return vigOf(vigBase(Fraction.of(amount), type, n, rule, unrounded), rule, unrounded)
}

/** Exact mode's rounding: none (a `RoundFn` that ignores its rule). */
export function unrounded(amount: Fraction): Fraction {
  return amount
}

/** A bet of `spec` at `amount`, as settlement reads it. */
export function betAt(spec: BetSpec, amount: Cents): BetInstance {
  return {
    id: betId(1),
    typeId: spec.typeId,
    number: spec.number,
    parentId: null,
    amount,
    vigHeld: cents(0),
    working: null,
    progress: 0,
    placedAtRoll: 0,
  }
}

/** A bet's expected loss and amount risked over a distribution's horizon, in cents. */
export interface Measured {
  /** E[loss]: all paid in (stake, up-front and re-collected vig) less all credited. */
  readonly loss: Fraction
  /**
   * E[amount risked] (glossary; plan §0 #22): the stake of every decision, pushes included, plus
   * commission paid up front, at placement and on re-collection. Commission taken from a win is not
   * added: it is a smaller win, not more money risked.
   */
  readonly risked: Fraction
  readonly decisions: Fraction
  readonly rolls: Fraction
  readonly workingRolls: Fraction
}

/**
 * What a bet placed at the distribution's start costs over its horizon: the stake and the up-front
 * vig at placement, then the distribution's settlements and re-collections.
 */
export function measure(
  dist: Distribution,
  amount: Cents,
  cfg: MachineConfig,
  mode: PriceMode,
): Measured {
  const priced = price(dist, amount, cfg, mode)
  const placement = upfrontCharge(dist.spec, amount, cfg, mode)
  const paidIn = Fraction.of(amount).add(placement).add(priced.rearmed)
  return {
    loss: paidIn.sub(priced.credited),
    risked: Fraction.of(amount).mul(priced.decisions).add(placement).add(priced.rearmed),
    decisions: priced.decisions,
    rolls: dist.rolls,
    workingRolls: dist.workingRolls,
  }
}

/** E[loss] ÷ E[amount risked]: the edge (glossary). */
export function edgeOf(measured: Measured): Fraction {
  if (measured.risked.isZero()) throw new ExactError('NEVER_RESOLVES', 'Nothing is ever risked')
  return measured.loss.div(measured.risked)
}
