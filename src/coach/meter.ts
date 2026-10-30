import { Fraction, applyAction, hashJson } from '../engine/index.ts'
import type { Action, BetId, Cents, MachineConfig, TableState } from '../engine/index.ts'
import { analyzeLayout, assumedPaths } from '../exact/index.ts'
import type { BetSpec, LayoutAnalysis } from '../exact/index.ts'
import {
  altHeadline,
  countedWith,
  hourlyAt,
  meterHeadline,
  swapLine,
  toggleEffect,
} from './content/layout.ts'
import { coachMoney, coachNumber, sourceOf } from './numbers.ts'
import type { CoachLine, CoachNumber, CoachSource } from './types.ts'

/**
 * The layout meter's coach content (plan §5.5 surface 6, §10 M9d): what keeping the table's bets
 * up costs, from `analyzeLayout` — the meter is Σ `LayoutBet.cost.perRoll` — per roll and per hour
 * at the `PACE_RANGE` ends and the machine's own pace, each bet's share, the cheapest same-event
 * relayout, and what the global working toggle would change it to, priced by `analyzeLayout` of
 * the dry-run table after the toggle. Computed in the analysis worker; the UI renders the lines
 * through `formatPart` and computes nothing.
 */

/** The working toggle to price: the action the button would dispatch, and which way it reads. */
export interface MeterToggle {
  readonly action: Action
  /** True when the button reads "Set bets On" (the dry run turns held bets back on). */
  readonly showSetOn: boolean
}

export interface MeterBet {
  readonly betId: BetId
  readonly label: string
  /** The stake on the table, machine-paid cents (player data, not a computed number). */
  readonly amount: Cents
  /** The bet's standing cost a roll; null for a bet counted in another bet's stream. */
  readonly perRoll: CoachNumber | null
  /** The stream line for a counted bet ("counted with Come"), null when it stands alone. */
  readonly counted: CoachLine | null
}

export interface MeterPace {
  /** Rolls an hour this figure is priced at (data attribute; the line carries the number). */
  readonly at: number
  /** This pace is the machine's own configured pace. */
  readonly machine: boolean
  readonly value: CoachNumber
  readonly line: CoachLine
}

export interface MeterSwap {
  readonly betId: BetId
  readonly line: CoachLine
}

export interface LayoutMeter {
  /** Σ of the standing costs, exact cents a roll (`analyzeLayout(state, cfg).perRoll`). */
  readonly perRoll: CoachNumber
  readonly headline: CoachLine
  /** The hourly line over `PACE_RANGE` with the machine's own pace, low to high. */
  readonly hourly: readonly MeterPace[]
  readonly byBet: readonly MeterBet[]
  /** The same exposure from cheapest same-event swaps; null when nothing cheaper exists. */
  readonly alternative: {
    readonly perRoll: CoachNumber
    readonly saving: CoachNumber
    readonly headline: CoachLine
    readonly swaps: readonly MeterSwap[]
  } | null
  /** What the working toggle would make the meter; null without a legal toggle to price. */
  readonly toggled: CoachLine | null
  /** Config pointers with `assumed` provenance under any shown number. */
  readonly assumedPaths: readonly string[]
}

export function layoutMeter(
  state: TableState,
  cfg: MachineConfig,
  toggle: MeterToggle | null = null,
): LayoutMeter {
  if (state.configHash !== cfg.configHash) {
    throw new RangeError(`This table runs config ${state.configHash}, not ${cfg.configHash}`)
  }
  const layout = analyzeLayout(state, cfg)
  const stateHash = hashJson(state)
  const source = sourceOf('analyzeLayout', { stateHash }, cfg)
  const assumedByBet = new Map(
    layout.byBet.map(({ betId, spec }) => [betId, assumedPaths(spec, cfg)] as const),
  )
  const allAssumed = union(assumedByBet.values())

  const perRoll = coachMoney(layout.perRoll, source, allAssumed)
  const byBet = layout.byBet.map((bet): MeterBet => {
    const assumed = assumedByBet.get(bet.betId) ?? []
    return {
      betId: bet.betId,
      label: labelOf(bet.spec, cfg),
      amount: bet.amount,
      perRoll: bet.cost === null ? null : coachMoney(bet.cost.perRoll, source, assumed),
      counted:
        bet.countedIn === null
          ? null
          : {
              id: `counted:${bet.betId}`,
              parts: countedWith(labelOfBet(bet.countedIn, layout, cfg)),
            },
    }
  })

  return {
    perRoll,
    headline: { id: 'per-roll', parts: meterHeadline({ perRoll }) },
    hourly: hourly(layout, cfg, allAssumed),
    byBet,
    alternative: alternative(layout, source, allAssumed, cfg),
    toggled: toggled(state, cfg, toggle, allAssumed),
    assumedPaths: allAssumed,
  }
}

/** The hourly figures: `perRoll` at each `analyzeLayout` pace, the machine's own marked. */
function hourly(
  layout: LayoutAnalysis,
  cfg: MachineConfig,
  assumed: readonly string[],
): MeterPace[] {
  const paceAssumed =
    cfg.provenance['/pace/rollsPerHour']?.status === 'assumed' ? ['/pace/rollsPerHour'] : []
  return layout.perHour.map(({ at, value }) => {
    const machine = at === cfg.pace.rollsPerHour
    const source = sourceOf('perHourAt', { at }, cfg)
    const withPace = machine ? union([assumed, paceAssumed]) : assumed
    const pace = coachNumber('count', Fraction.of(at), source, machine ? paceAssumed : [])
    const hourlyValue = coachMoney(value, source, withPace)
    return {
      at,
      machine,
      value: hourlyValue,
      line: { id: `hourly:${at}`, parts: hourlyAt({ pace, value: hourlyValue }, machine) },
    }
  })
}

function alternative(
  layout: LayoutAnalysis,
  source: CoachSource,
  assumed: readonly string[],
  cfg: MachineConfig,
): LayoutMeter['alternative'] {
  const alt = layout.alternativeLayout
  if (alt === null) return null
  const altPerRoll = coachMoney(alt.perRoll, source, assumed)
  const saving = coachMoney(layout.perRoll.sub(alt.perRoll), source, assumed)
  return {
    perRoll: altPerRoll,
    saving,
    headline: { id: 'alt', parts: altHeadline({ perRoll: altPerRoll, saving }) },
    swaps: alt.swaps.map((swap): MeterSwap => {
      const toAssumed = union([assumed, assumedPaths(swap.to, cfg)])
      return {
        betId: swap.betId,
        line: {
          id: `swap:${swap.betId}`,
          parts: swapLine(labelOfBet(swap.betId, layout, cfg), labelOf(swap.to, cfg), {
            amount: coachMoney(swap.amount, source, toAssumed),
          }),
        },
      }
    }),
  }
}

/** The toggle priced on the dry-run table after it; null when the machine refuses the action. */
function toggled(
  state: TableState,
  cfg: MachineConfig,
  toggle: MeterToggle | null,
  assumed: readonly string[],
): CoachLine | null {
  if (toggle === null || state.bets.length === 0) return null
  const dryRun = applyAction(state, toggle.action, cfg)
  if (!dryRun.ok) return null
  const after = analyzeLayout(dryRun.state, cfg)
  const source = sourceOf(
    'analyzeLayout',
    { stateHash: hashJson(dryRun.state), after: toggle.action },
    cfg,
  )
  const perRoll = coachMoney(after.perRoll, source, assumed)
  return { id: 'toggle', parts: toggleEffect({ perRoll }, toggle.showSetOn) }
}

/** The machine's name for a spec: its type label, with the number where the label lacks it. */
export function labelOf(spec: BetSpec, cfg: MachineConfig): string {
  const type = cfg.catalog.get(spec.typeId) ?? cfg.composites.get(spec.typeId)
  const name = type?.label ?? spec.typeId
  if (spec.number === null || name.includes(String(spec.number))) return name
  return `${name} ${spec.number}`
}

/** The label of a bet on the analysed table, by id (stream heads, swap sources). */
function labelOfBet(betId: BetId, layout: LayoutAnalysis, cfg: MachineConfig): string {
  const bet = layout.byBet.find((b) => b.betId === betId)
  return bet === undefined ? betId : labelOf(bet.spec, cfg)
}

function union(lists: Iterable<readonly string[]>): readonly string[] {
  const all = new Set<string>()
  for (const list of lists) for (const path of list) all.add(path)
  return [...all].sort()
}
