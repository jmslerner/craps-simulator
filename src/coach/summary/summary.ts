import {
  Fraction,
  cents,
  type FamilyKey,
  type MachineConfig,
  type PointNumber,
} from '../../engine/index.ts'
import { assumedPaths, perHourAt, type BetSpec } from '../../exact/index.ts'
import type { SessionAccount } from '../../exact/summary.ts'
import { coachCount, coachMoney, coachNumber, sourceOf } from '../numbers.ts'
import type { CoachLine, CoachNumber, CoachSource } from '../types.ts'
import {
  cashNote,
  depositsNote,
  equityNote,
  expectedNote,
  familyLine,
  focusLine,
  leakLine,
  luckNote,
  noBets,
  noFocus,
  noLeaks,
  sessionFacts,
} from './content.ts'
import { sameEventSwitch, type SameEventSwitch } from './leaks.ts'

/**
 * The session summary (plan §5.7, §10 M13), built from the session account (`src/exact/summary.ts`)
 * as `CoachNumber`s, every one traced to the exact call that produced it:
 *
 * - the actual result, on the cash basis (credit and the bets still up at face value, less every
 *   deposit) and the equity basis (the bets still up at what they are worth); deposits are never a
 *   win (plan §0 #19);
 * - expected = −Σ decision cost, and luck = Σ luck, which add up exactly to the equity result;
 * - the expected loss by bet family, with each family's decisions;
 * - leaks from same-event choices only (`leaks.ts`), e.g. "Place 4/10 instead of Buy: −$3.20 over
 *   16 decisions": each decision of a bet with a cheaper twin costs the twin's saving per decision;
 * - the two largest savings an hour, as the next session's focus: a leak's cost spread over the
 *   session's rolls and priced at the machine's pace (and the pace range, plan §5.1).
 *
 * Not in v1 (plan §5.7): z-scores, σ bands, calibration.
 */

/** The display groups of the bet families. */
export type FamilyGroup = 'line' | 'odds' | 'number' | 'hardway' | 'oneRoll' | 'side'

const GROUP_LABEL: Readonly<Record<FamilyGroup, string>> = {
  line: 'Line bets',
  odds: 'Odds',
  number: 'Place, buy & lay',
  hardway: 'Hardways',
  oneRoll: 'One-roll bets',
  side: 'Side bets',
}

export function groupOf(family: FamilyKey): FamilyGroup {
  switch (family) {
    case 'line':
      return 'line'
    case 'odds':
      return 'odds'
    case 'numberVsSeven':
      return 'number'
    case 'hardway':
      return 'hardway'
    case 'oneRoll':
    case 'composite':
      return 'oneRoll'
    case 'collectSet':
    case 'uniquePointsMade':
    case 'handLength':
    case 'pointRun':
      return 'side'
  }
}

export interface SummaryFamily {
  readonly group: FamilyGroup
  readonly label: string
  /** Σ decision cost of the group's bets (cents; what they cost on average). */
  readonly cost: CoachNumber
  /** Decisions of the group's bets that the dice settled (pushes counted, unplayed odds not). */
  readonly decisions: CoachNumber
  readonly line: CoachLine
}

/** One kind of leak: every decision of `from` bets that had `to` as a cheaper same-event twin. */
export interface SummaryLeak {
  readonly from: { readonly typeId: string; readonly label: string }
  readonly to: { readonly typeId: string; readonly label: string }
  /** The numbers the leaking bets were on, ascending; empty for one-roll bets and composites. */
  readonly numbers: readonly PointNumber[]
  /** −Σ saving per decision: what the choice cost (cents, negative). */
  readonly cost: CoachNumber
  readonly decisions: CoachNumber
  /** The leak spread over the session's rolls, an hour at 60, the machine's pace and 150. */
  readonly perHour: readonly {
    readonly at: number
    readonly machine: boolean
    readonly value: CoachNumber
  }[]
  readonly line: CoachLine
}

export interface SummaryFocus {
  readonly leak: SummaryLeak
  /** What the switch saves an hour at the machine's pace. */
  readonly perHour: CoachNumber
  readonly line: CoachLine
}

export interface SessionSummary {
  readonly configHash: string
  readonly machineName: string
  /** Committed windows (rolls) and open-window actions summarised. */
  readonly windows: number
  readonly pending: number
  readonly facts: CoachLine
  readonly rolls: CoachNumber
  readonly sevenOuts: CoachNumber
  /** Everything put in, the starting bankroll included. */
  readonly deposits: CoachNumber
  readonly depositsNote: CoachLine
  /** Credit + bets still up at face value − deposits (cents). */
  readonly resultCash: CoachNumber
  readonly cashNote: CoachLine
  /** W_end − deposits: the bets still up at their equity. */
  readonly resultEquity: CoachNumber
  readonly equityNote: CoachLine
  /** −Σ decision cost. */
  readonly expected: CoachNumber
  readonly expectedNote: CoachLine
  /** Σ luck; `resultEquity = expected + luck` exactly. */
  readonly luck: CoachNumber
  readonly luckNote: CoachLine
  /** Biggest cost first; empty before any bet. */
  readonly byFamily: readonly SummaryFamily[]
  /** Shown instead of the families when no bet was made. */
  readonly noBets: CoachLine | null
  /** Costliest first. */
  readonly leaks: readonly SummaryLeak[]
  readonly noLeaks: CoachLine | null
  /** The two largest savings an hour (fewer when there are fewer leaks). */
  readonly focus: readonly SummaryFocus[]
  readonly noFocus: CoachLine | null
  /** Config pointers with `assumed` provenance under any number shown. */
  readonly assumedPaths: readonly string[]
}

/** The summary of `account` on machine `cfg`. */
export function summarizeSession(account: SessionAccount, cfg: MachineConfig): SessionSummary {
  if (account.configHash !== cfg.configHash) {
    throw new RangeError(`This account is of config ${account.configHash}, not ${cfg.configHash}`)
  }
  const at = { windows: account.windows, pending: account.pending }
  const source = (field: string): CoachSource => sourceOf('accountSession', { ...at, field }, cfg)
  const assumedOf = assumedLookup(cfg)

  const specs: BetSpec[] = [
    ...account.costs.map((entry) => entry.spec),
    ...account.rolls.flatMap((roll) => roll.bets.map((entry) => entry.spec)),
  ]
  const allAssumed = union(specs.map((spec) => assumedOf(spec)))

  const { start, end } = account
  const rolls = coachCount(Fraction.of(account.windows), source('rolls'))
  const sevenOuts = coachCount(Fraction.of(account.state.round.hand.index), source('sevenOuts'))
  const deposits = coachMoney(end.deposits, source('deposits'))
  const added = account.topUps > 0 ? coachMoney(account.topUps, source('topUps')) : null
  const resultCash = coachMoney(
    cents(end.bankroll + end.onTable - end.deposits),
    source('resultCash'),
  )
  const resultEquity = coachMoney(
    end.wealth.sub(Fraction.of(end.deposits)),
    source('resultEquity'),
    allAssumed,
  )
  const expected = coachMoney(account.cost.neg(), source('expected'), allAssumed)
  const luck = coachMoney(account.luck, source('luck'), allAssumed)
  const openBets = end.onTable > 0 ? coachMoney(end.onTable, source('onTable')) : null

  const byFamily = families(account, source, assumedOf)
  const leaks = leaksOf(account, cfg, assumedOf)
  const focus = focusOf(leaks, cfg)

  return {
    configHash: cfg.configHash,
    machineName: cfg.name,
    windows: account.windows,
    pending: account.pending,
    facts: { id: 'facts', parts: sessionFacts(cfg.name, { rolls, sevenOuts }) },
    rolls,
    sevenOuts,
    deposits,
    depositsNote: {
      id: 'deposits',
      parts: depositsNote({ start: coachMoney(start.deposits, source('buyIn')), added }),
    },
    resultCash,
    cashNote: { id: 'cash', parts: cashNote() },
    resultEquity,
    equityNote: { id: 'equity', parts: equityNote({ openBets }) },
    expected,
    expectedNote: { id: 'expected', parts: expectedNote() },
    luck,
    luckNote: { id: 'luck', parts: luckNote() },
    byFamily,
    noBets: byFamily.length === 0 ? { id: 'no-bets', parts: noBets() } : null,
    leaks,
    noLeaks: leaks.length === 0 ? { id: 'no-leaks', parts: noLeaks() } : null,
    focus,
    noFocus: focus.length === 0 ? { id: 'no-focus', parts: noFocus() } : null,
    assumedPaths: union([
      allAssumed,
      ...leaks.map((leak) => leak.cost.assumedPaths),
      ...focus.map((item) => item.perHour.assumedPaths),
    ]),
  }
}

/** Each family group's cost and settled decisions, biggest cost first. */
function families(
  account: SessionAccount,
  source: (field: string) => CoachSource,
  assumedOf: (spec: BetSpec) => readonly string[],
): SummaryFamily[] {
  const groups = new Map<
    FamilyGroup,
    { cost: Fraction; decisions: number; assumed: (readonly string[])[] }
  >()
  const entry = (family: FamilyKey) => {
    const group = groupOf(family)
    let known = groups.get(group)
    if (known === undefined) {
      known = { cost: Fraction.ZERO, decisions: 0, assumed: [] }
      groups.set(group, known)
    }
    return known
  }
  for (const cost of account.costs) {
    const group = entry(cost.family)
    group.cost = group.cost.add(cost.cost)
    group.assumed.push(assumedOf(cost.spec))
  }
  for (const roll of account.rolls) {
    for (const bet of roll.bets) {
      if (bet.playedDecision) entry(bet.family).decisions += 1
    }
  }
  return [...groups.entries()]
    .map(([group, totals]): SummaryFamily => {
      const label = GROUP_LABEL[group]
      const assumed = union(totals.assumed)
      const cost = coachMoney(totals.cost, source(`cost:${group}`), assumed)
      const decisions = coachCount(Fraction.of(totals.decisions), source(`decisions:${group}`))
      return {
        group,
        label,
        cost,
        decisions,
        line: { id: `family:${group}`, parts: familyLine(label, { cost, decisions }) },
      }
    })
    .sort((a, b) => costOf(b).compare(costOf(a)) || order(a.group) - order(b.group))
}

const GROUP_ORDER: readonly FamilyGroup[] = ['line', 'odds', 'number', 'hardway', 'oneRoll', 'side']

function order(group: FamilyGroup): number {
  return GROUP_ORDER.indexOf(group)
}

function costOf(family: SummaryFamily): Fraction {
  const { exact } = family.cost
  return typeof exact === 'number' ? Fraction.of(exact) : exact
}

/**
 * The leaks: every settled decision of a bet with a cheaper same-event twin, grouped by the pair of
 * types, costliest first.
 */
function leaksOf(
  account: SessionAccount,
  cfg: MachineConfig,
  assumedOf: (spec: BetSpec) => readonly string[],
): SummaryLeak[] {
  interface Pending {
    readonly from: string
    readonly to: string
    readonly numbers: Set<PointNumber>
    total: Fraction
    decisions: number
    readonly switches: SameEventSwitch[]
  }
  const found = new Map<string, Pending>()
  for (const roll of account.rolls) {
    for (const bet of roll.bets) {
      if (!bet.playedDecision) continue
      const twin = sameEventSwitch(bet.spec, bet.amount, bet.family, cfg)
      if (twin === null) continue
      const key = `${twin.from.typeId}>${twin.to.typeId}`
      let leak = found.get(key)
      if (leak === undefined) {
        leak = {
          from: twin.from.typeId,
          to: twin.to.typeId,
          numbers: new Set(),
          total: Fraction.ZERO,
          decisions: 0,
          switches: [],
        }
        found.set(key, leak)
      }
      if (bet.spec.number !== null) leak.numbers.add(bet.spec.number)
      leak.total = leak.total.add(twin.perDecision)
      leak.decisions += 1
      leak.switches.push(twin)
    }
  }
  const rollCount = account.windows
  return [...found.values()]
    .sort((a, b) => b.total.compare(a.total) || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .map((leak): SummaryLeak => {
      const numbers = [...leak.numbers].sort((a, b) => a - b)
      const assumed = union(
        leak.switches.flatMap((twin) => [assumedOf(twin.from), assumedOf(twin.to)]),
      )
      const args = { from: leak.from, to: leak.to, numbers, windows: rollCount }
      const source = sourceOf('sessionLeaks', args, cfg)
      const cost = coachMoney(leak.total.neg(), source, assumed)
      const decisions = coachCount(Fraction.of(leak.decisions), source)
      const fromLabel = typeLabel(cfg, leak.from)
      const toLabel = typeLabel(cfg, leak.to)
      return {
        from: { typeId: leak.from, label: fromLabel },
        to: { typeId: leak.to, label: toLabel },
        numbers,
        cost,
        decisions,
        perHour: rollCount === 0 ? [] : hourly(leak.total, rollCount, cfg, args, assumed),
        line: {
          id: `leak:${leak.from}>${leak.to}`,
          parts: leakLine(fromLabel, toLabel, numbers.join('/'), { cost, decisions }),
        },
      }
    })
}

/** A saving spread over the session's rolls, an hour at each pace `perHourAt` names. */
function hourly(
  total: Fraction,
  rolls: number,
  cfg: MachineConfig,
  args: object,
  assumed: readonly string[],
): SummaryLeak['perHour'] {
  const withPace = union([assumed, paceAssumedOf(cfg)])
  return perHourAt(total.div(Fraction.of(rolls)), cfg).map(({ at, value }) => {
    const machine = at === cfg.pace.rollsPerHour
    const source = sourceOf('perHourAt', { ...args, at }, cfg)
    return {
      at,
      machine,
      value: coachNumber('perHour', value, source, machine ? withPace : assumed),
    }
  })
}

/**
 * The two largest savings an hour at the machine's pace: the next session's focus. The pace range
 * ends (`PACE_RANGE`, plan §5.1) are shown beside the machine's own pace, which carries its
 * provenance (`/pace/rollsPerHour` is assumed on every preset).
 */
function focusOf(leaks: readonly SummaryLeak[], cfg: MachineConfig): SummaryFocus[] {
  const ranked = leaks
    .map((leak) => ({ leak, machine: leak.perHour.find((pace) => pace.machine) }))
    .filter(
      (item): item is { leak: SummaryLeak; machine: SummaryLeak['perHour'][number] } =>
        item.machine !== undefined,
    )
    .sort((a, b) => valueOf(b.machine.value).compare(valueOf(a.machine.value)))
  return ranked.slice(0, 2).map(({ leak, machine }): SummaryFocus => {
    const low = leak.perHour[0] ?? machine
    const high = leak.perHour.at(-1) ?? machine
    const paceOf = (pace: SummaryLeak['perHour'][number]): CoachNumber =>
      coachNumber(
        'count',
        Fraction.of(pace.at),
        sourceOf('perHourAt', { at: pace.at }, cfg),
        pace.machine ? paceAssumedOf(cfg) : [],
      )
    return {
      leak,
      perHour: machine.value,
      line: {
        id: `focus:${leak.from.typeId}>${leak.to.typeId}`,
        parts: focusLine(leak.from.label, leak.to.label, leak.numbers.join('/'), {
          perHour: machine.value,
          pace: paceOf(machine),
          low: { value: low.value, pace: paceOf(low) },
          high: { value: high.value, pace: paceOf(high) },
        }),
      },
    }
  })
}

/** The machine's pace pointer, when its provenance is assumed. */
function paceAssumedOf(cfg: MachineConfig): readonly string[] {
  return cfg.provenance['/pace/rollsPerHour']?.status === 'assumed' ? ['/pace/rollsPerHour'] : []
}

function valueOf(n: CoachNumber): Fraction {
  return typeof n.exact === 'number' ? Fraction.of(n.exact) : n.exact
}

/** The machine's label for a type: a catalog type, a composite or a side bet. */
export function typeLabel(cfg: MachineConfig, typeId: string): string {
  return (
    cfg.catalog.get(typeId)?.label ??
    cfg.composites.get(typeId)?.label ??
    cfg.sideBets.get(typeId)?.label ??
    typeId
  )
}

/** `assumedPaths` per (type, number), remembered for one summary. */
function assumedLookup(cfg: MachineConfig): (spec: BetSpec) => readonly string[] {
  const known = new Map<string, readonly string[]>()
  return (spec) => {
    const key = `${spec.typeId}|${spec.number ?? ''}`
    let paths = known.get(key)
    if (paths === undefined) {
      paths = assumedPaths(spec, cfg)
      known.set(key, paths)
    }
    return paths
  }
}

function union(lists: Iterable<readonly string[]>): readonly string[] {
  const all = new Set<string>()
  for (const list of lists) for (const path of list) all.add(path)
  return [...all].sort()
}
