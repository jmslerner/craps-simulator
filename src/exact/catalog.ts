import { type Cents, type Fraction, type MachineConfig, type PointNumber } from '../engine/index.ts'
import { exactUnit, smallestAmount } from './amounts.ts'
import { analysisCache, remember } from './cache.ts'
import { analyzeBet, lifecycleHorizon } from './analyze.ts'
import { ExactError, type BetSpec } from './chain.ts'
import { distribution, edgeOf, measure } from './price.ts'
import { standingCost } from './standing.ts'
import { isPutStart, typicalStart } from './start.ts'

/**
 * The catalog table (plan §5.2 `catalogTable`): every non-side bet the machine offers, on every
 * number it can be on, analysed exactly. It feeds the cheat sheet (sorted by edge, with assumed
 * chips), the layout meter's per-bet figures, `scripts/edges.ts` and the preset fingerprints
 * (plan §9 item 11). Side bets join in M11.
 *
 * Each row is priced at the bet's **exact unit**: the smallest legal stake the machine pays
 * exactly, with no commission minimum above the rate (rules spec §3.2's "exact unit, live /
 * penny": a $6 place 6 live, $3 on a penny machine; a $20 live buy). The edge at the smallest legal
 * stake is given too, where rounding or a minimum can make it worse.
 */

export interface CatalogRow {
  readonly spec: BetSpec
  /** The machine's name for the spot, with its number: "Place 6". */
  readonly label: string
  readonly family: string
  /** The stake the row is priced at: the exact unit. */
  readonly amount: Cents
  readonly edge: Fraction
  readonly nominalEdge: Fraction
  readonly edgePerWorkingRoll: Fraction
  readonly pWin: Fraction
  readonly pLose: Fraction
  readonly pPush: Fraction
  /** E[rolls per decision]. */
  readonly expectedRolls: Fraction
  readonly payoutLabel: string
  /**
   * Standing cost at `amount`, in cents per roll; null for a put bet, which is one decision, not a
   * stream (rules spec §3.1).
   */
  readonly standingPerRoll: Fraction | null
  /** The edge at the smallest legal stake; null when that is `amount`. */
  readonly atMinimum: { readonly amount: Cents; readonly edge: Fraction } | null
  readonly assumedPaths: readonly string[]
}

const cache = analysisCache<string, readonly CatalogRow[]>()

/**
 * Every non-side bet `cfg` offers, on each of its numbers, in config order. Where the machine
 * allows put bets (`/rules/allowPutBets`), a do-side come-out line bet also gets one spec per
 * point: the put bet on that number (rules spec §3.1; M9 prices put advice from these).
 */
export function catalogSpecs(cfg: MachineConfig): BetSpec[] {
  const specs: BetSpec[] = []
  for (const [typeId, type] of cfg.catalog) {
    let numbers: readonly (PointNumber | null)[]
    switch (type.family) {
      case 'numberVsSeven':
      case 'hardway':
        numbers = type.numbers
        break
      case 'odds':
        numbers = cfg.ruleset.points.filter((n) => type.pays.has(n))
        break
      case 'line':
        numbers =
          type.window === 'comeOut' && type.side === 'do' && cfg.input.rules.allowPutBets
            ? [null, ...cfg.ruleset.points]
            : [null]
        break
      case 'oneRoll':
        numbers = [null]
        break
    }
    for (const number of numbers) specs.push({ typeId, number })
  }
  for (const typeId of cfg.composites.keys()) specs.push({ typeId, number: null })
  return specs
}

/**
 * The catalog of `cfg`, cached by config hash plus the provenance the rows' assumed chips rest on
 * (a provenance-only edit keeps the hash but can change `assumedPaths`; M5/M6 audit). A bet that
 * cannot be analysed (odds the cap allows none of, a bet that is never decided) is left out;
 * `sanity.ts` reports those.
 */
export function catalogTable(cfg: MachineConfig): readonly CatalogRow[] {
  const key = `${cfg.configHash}|${assumedKey(cfg)}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const rows: CatalogRow[] = []
  for (const spec of catalogSpecs(cfg)) {
    try {
      rows.push(catalogRow(spec, cfg))
    } catch (error) {
      if (!(error instanceof ExactError)) throw error
    }
  }
  remember(cache, key, rows, 32)
  return rows
}

/**
 * The provenance a row's `assumedPaths` depend on: the pointers whose entries are `assumed`
 * (`statusAt` and the below-the-path check read nothing else), sorted so the key is canonical.
 */
function assumedKey(cfg: MachineConfig): string {
  return Object.entries(cfg.provenance)
    .filter(([, entry]) => entry.status === 'assumed')
    .map(([pointer]) => pointer)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join(',')
}

/** One row of the catalog. */
export function catalogRow(spec: BetSpec, cfg: MachineConfig): CatalogRow {
  const start = typicalStart(spec, cfg)
  const first = distribution(spec, start, 'decision', cfg)
  const amount = exactUnit(spec, first.labels, cfg)
  if (amount === null) throw new ExactError('BAD_SPEC', `${spec.typeId} takes no legal stake`)
  const analysis = analyzeBet(spec, amount, start, cfg)
  const minimum = smallestAmount(spec, cfg)
  const type = cfg.catalog.get(spec.typeId) ?? cfg.composites.get(spec.typeId)
  const name = type?.label ?? spec.typeId
  const put = isPutStart(spec, start, cfg)
  return {
    spec,
    label: spec.number === null ? name : put ? `Put ${spec.number}` : `${name} ${spec.number}`,
    family: type?.family ?? 'unknown',
    amount,
    edge: analysis.edge,
    nominalEdge: analysis.nominalEdge,
    edgePerWorkingRoll: analysis.edgePerWorkingRoll,
    pWin: analysis.pWin,
    pLose: analysis.pLose,
    pPush: analysis.pPush,
    expectedRolls: analysis.expectedRolls,
    payoutLabel: analysis.payoutLabel,
    standingPerRoll: put ? null : standingCost(spec, amount, cfg).perRoll,
    atMinimum:
      minimum === null || minimum === amount
        ? null
        : {
            amount: minimum,
            edge: edgeOf(
              measure(
                distribution(spec, start, lifecycleHorizon(spec, start, cfg), cfg),
                minimum,
                cfg,
                'rounded',
              ),
            ),
          },
    assumedPaths: analysis.assumedPaths,
  }
}

/** Rows sorted by edge, lowest first (the cheat sheet's order); ties keep config order. */
export function byEdge(rows: readonly CatalogRow[]): CatalogRow[] {
  return [...rows].sort((a, b) => a.edge.compare(b.edge))
}
