import { Fraction } from '../../src/engine/core/rational.ts'
import { cents, type Cents } from '../../src/engine/core/money.ts'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import { legalBets } from '../../src/engine/bets/legal.ts'
import { effectiveWorking } from '../../src/engine/bets/working.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import { applyAction, validateAction } from '../../src/engine/table/reducer.ts'
import { heldOffOf, newTable, type TableState } from '../../src/engine/table/state.ts'
import {
  ExactError,
  analyzeBet,
  analyzeExisting,
  analyzeLayout,
  attainableOdds,
  catalogRow,
  catalogSpecs,
  catalogTable,
  combinedEdge,
  efficientAmounts,
  minimumFreeFrom,
  perHourAt,
  sameEvents,
  smallestAmount,
  type BetSpec,
  type CatalogRow,
} from '../../src/exact/index.ts'
import { adviseSpot, type Advice, type CoachInput } from '../../src/coach/advisors/index.ts'
import { paysExactlyAt } from '../../src/coach/advisors/exactness.ts'
import { adviceLine } from '../../src/coach/advisors/render.ts'
import { zoneBadges } from '../../src/coach/badges.ts'
import { sheetFromRows } from '../../src/coach/cheatsheet.ts'
import { returnsUnplayed } from '../../src/coach/decisions.ts'
import { nextStep, SEVEN_DICE, type NextStep } from '../../src/coach/nextStep.ts'
import { badgeKey, type CoachNumber } from '../../src/coach/types.ts'
import {
  EMPTY_COACH_MEMORY,
  SAME_EVENT_MIN_SAVING,
  dismissAdvice,
  gate,
  gradeOf,
  markForFun,
  noteToast,
  type CoachMemory,
  type CoachModeName,
} from '../../src/coach/policy.ts'
import { factsFrom, type MachineFacts } from '../oracle/machineFacts.ts'
import { closedFormOf, machineBets } from '../oracle/closedFormOf.ts'
import {
  analyze as cfAnalyze,
  expectedRollsPerLineDecision,
  putBet,
  type CfBet,
} from '../oracle/closedForm.ts'

/**
 * The coach audit harness (plan §5.8, §10 M9c): random sessions, replayed through the coach in
 * all three modes. At every betting state it
 *
 * 1. runs the next-step provider and **recomputes every emitted `CoachNumber` from its `source`**
 *    (the named exact/engine call with the recorded arguments), demanding exact equality;
 * 2. re-derives the whole 7-preview independently from the engine's own settlement of a scripted
 *    7, and checks the OFF honesty rule (a bet named `off` is never effectively working);
 * 3. runs every advisor on sampled spots and re-verifies every claim: a sameEvent switch is
 *    **strictly cheaper** by at least the policy threshold when re-priced from scratch,
 *    **sameEvents** holds, the stake is unchanged, and every `fix` batch is **legal by dry-run**;
 * 4. cross-checks every plain `analyzeBet` edge against the independent closed-form oracle where
 *    it models the bet;
 * 5. routes the advice through the gate in `off`, `quiet` and `coach` modes under rotating memory
 *    fixtures and checks the §5.6 rules: nothing in off, at most one toast, cooldown and
 *    once-per-lifecycle respected, two dismissals demote to badge, "for fun" silences the type,
 *    nothing lost or duplicated, and the gate stays pure;
 * 6. (M9 audit hardening) prices surfaces the `source` replay cannot see independently against
 *    the closed-form oracle: one catalog row per session — its edges and chances, the zone badge
 *    and the cheat-sheet row the UI renders for it — and the layout meter's per-roll figure where
 *    the oracle's per-working-roll edges and the round's phase shares price every standing bet;
 *    and pins `analyzeExisting`'s equity of every do-side line bet on a number against the rules
 *    spec's §3.1 table (flat × 2w/(w+6)).
 *
 * Every failure lands in `discrepancies` as one line; the suites assert the list is empty.
 */

export interface AuditOptions {
  readonly presets: readonly PresetId[]
  /** Random sessions per preset. */
  readonly sessions: number
  /** Actions per session. */
  readonly actions: number
  /** Advise on the newest bet plus this many catalog spots per audited state. */
  readonly extraSpecs: number
  /** Audit advice on every nth betting state (the provider is audited on every state). */
  readonly adviceEvery: number
  readonly seed: number
}

export interface AuditReport {
  states: number
  steps: number
  numbers: number
  advice: number
  sameEventChecks: number
  fixChecks: number
  oracleChecks: number
  gateChecks: number
  /** Catalog rows (with their badge and sheet row) priced against the closed form. */
  rowOracleChecks: number
  /** Layouts whose per-roll meter figure was rebuilt from the closed form. */
  layoutOracleChecks: number
  /** Do-side line bets on a number whose equity was pinned to the §3.1 table. */
  equityChecks: number
  readonly discrepancies: string[]
}

/** A tiny deterministic LCG; `Math.random` is banned in tests and the dice come from the table. */
function lcg(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}

export function runCoachAudit(options: AuditOptions): AuditReport {
  const report: AuditReport = {
    states: 0,
    steps: 0,
    numbers: 0,
    advice: 0,
    sameEventChecks: 0,
    fixChecks: 0,
    oracleChecks: 0,
    gateChecks: 0,
    rowOracleChecks: 0,
    layoutOracleChecks: 0,
    equityChecks: 0,
    discrepancies: [],
  }
  const configs = new Map<string, MachineConfig>()
  for (const id of Object.keys(PRESETS)) {
    const cfg = compileConfig(PRESETS[id as PresetId])
    configs.set(cfg.configHash, cfg)
  }
  for (const preset of options.presets) {
    const cfg = compileConfig(PRESETS[preset])
    const facts = factsFrom(cfg.input)
    const oracle = oracleEdges(facts)
    for (let session = 0; session < options.sessions; session += 1) {
      const next = lcg(options.seed + session * 7919 + preset.length * 104729)
      const seed = `${preset}-${options.seed}-${session}`
      auditCatalogRow(cfg, facts, next, report, (message) =>
        report.discrepancies.push(`${cfg.id} session ${seed}: ${message}`),
      )
      auditSession(cfg, facts, configs, oracle, seed, next, options, report)
    }
  }
  return report
}

/** The closed form's as-paid lifecycle edge per (typeId, number, amount), where it models one. */
type OracleEdges = (spec: BetSpec, amount: Cents) => Fraction | null

function oracleEdges(facts: MachineFacts): OracleEdges {
  const cache = new Map<string, Fraction | null>()
  return (spec, amount) => {
    const key = `${spec.typeId}|${spec.number ?? ''}|${amount}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    let edge: Fraction | null = null
    try {
      const known = machineBets(facts, amount).some(
        (bet) => bet.typeId === spec.typeId && bet.number === spec.number,
      )
      if (known) {
        const bet = closedFormOf(
          facts,
          { typeId: spec.typeId, number: spec.number, amount },
          'asPaid',
        )
        if (bet !== null) edge = cfAnalyze(bet).edge
      }
    } catch {
      edge = null
    }
    cache.set(key, edge)
    return edge
  }
}

function auditSession(
  cfg: MachineConfig,
  facts: MachineFacts,
  configs: ReadonlyMap<string, MachineConfig>,
  oracle: OracleEdges,
  seed: string,
  next: () => number,
  options: AuditOptions,
  report: AuditReport,
): void {
  let state = newTable(cfg, seed)
  for (let step = 0; step < options.actions; step += 1) {
    auditState(cfg, facts, configs, oracle, state, step, next, options, report)
    state = advance(cfg, state, next)
  }
}

/** One random legal move: mostly bets, sometimes a roll or a working toggle; always accepted. */
function advance(cfg: MachineConfig, state: TableState, next: () => number): TableState {
  const kind = next() % 10
  if (kind < 5) {
    const spots = legalBets(state, cfg).filter((spot) => spot.canAdd === null && spot.minAdd > 0)
    const spot = spots[next() % Math.max(1, spots.length)]
    if (spot !== undefined) {
      const action: Action = {
        type: 'place',
        typeId: spot.typeId,
        ...(spot.number === null ? {} : { number: spot.number }),
        ...(spot.parentId === null ? {} : { parentId: spot.parentId }),
        amount: spot.minAdd,
      }
      const placed = applyAction(state, action, cfg)
      if (placed.ok) return placed.state
    }
  }
  if (kind === 5 && cfg.working.toggle.global) {
    const action: Action = { type: 'setGlobalWorking', off: state.globalOff === true ? null : true }
    const toggled = applyAction(state, action, cfg)
    if (toggled.ok) return toggled.state
  }
  const rolled = applyAction(state, { type: 'roll' }, cfg)
  if (rolled.ok) return rolled.state
  // The roll was refused (minimum total): place the smallest legal add instead.
  const spots = legalBets(state, cfg).filter((spot) => spot.canAdd === null && spot.minAdd > 0)
  const spot = spots[0]
  if (spot === undefined) return state
  const fallback = applyAction(
    state,
    {
      type: 'place',
      typeId: spot.typeId,
      ...(spot.number === null ? {} : { number: spot.number }),
      ...(spot.parentId === null ? {} : { parentId: spot.parentId }),
      amount: spot.minAdd,
    },
    cfg,
  )
  return fallback.ok ? fallback.state : state
}

function auditState(
  cfg: MachineConfig,
  facts: MachineFacts,
  configs: ReadonlyMap<string, MachineConfig>,
  oracle: OracleEdges,
  state: TableState,
  stepIndex: number,
  next: () => number,
  options: AuditOptions,
  report: AuditReport,
): void {
  report.states += 1
  const where = `${cfg.id} roll ${state.round.rollIndex} step ${stepIndex}`
  const flag = (message: string) => report.discrepancies.push(`${where}: ${message}`)

  auditStep(cfg, state, next, report, flag)
  auditEquity(cfg, state, report, flag)

  if (stepIndex % options.adviceEvery !== 0) return
  auditLayout(cfg, facts, state, report, flag)
  const sampled = sampleSpecs(cfg, state, next, options.extraSpecs)
  for (const { spec, amount, betId } of sampled) {
    const input: CoachInput = { cfg, spec, amount, state, betId }
    let advice: Advice[]
    try {
      advice = adviseSpot(input)
    } catch (error) {
      flag(`adviseSpot(${spec.typeId} ${spec.number ?? ''}) threw ${String(error)}`)
      continue
    }
    report.advice += advice.length
    for (const item of advice) {
      auditAdvice(cfg, configs, oracle, input, item, report, flag)
    }
    auditGate(advice, state, next, report, flag)
  }
}

/** The provider's step: legal suggestions, recomputed numbers, an honestly re-derived 7-line. */
function auditStep(
  cfg: MachineConfig,
  state: TableState,
  next: () => number,
  report: AuditReport,
  flag: (message: string) => void,
): void {
  const settings =
    next() % 3 === 0
      ? { selectedChip: null, chips: null, dismissedIdeas: ['skip-odds', 'come-out-working'] }
      : { selectedChip: null, chips: null }
  let step: NextStep | null
  try {
    step = nextStep(state, cfg, legalBets(state, cfg), settings)
  } catch (error) {
    flag(`nextStep threw ${String(error)}`)
    return
  }
  if (step === null) return
  report.steps += 1
  for (const offered of [step.action, step.alt?.action]) {
    if (offered === undefined) continue
    if (validateAction(state, offered, cfg) !== null) {
      flag(`step ${step.stepId} suggested a refused action ${JSON.stringify(offered)}`)
    }
  }
  if (settings.dismissedIdeas !== undefined && step.alt?.ideaId !== undefined) {
    if (settings.dismissedIdeas.includes(step.alt.ideaId)) {
      flag(`dismissed idea ${step.alt.ideaId} came back`)
    }
  }
  for (const [name, number] of Object.entries(step.numbers ?? {})) {
    auditNumber(cfg, new Map([[cfg.configHash, cfg]]), null, { state }, name, number, report, flag)
  }
  if (step.seven !== undefined) auditSeven(cfg, state, step, flag)
}

/** Re-derives the 7-preview from the engine and compares every total and OFF claim. */
function auditSeven(
  cfg: MachineConfig,
  state: TableState,
  step: NextStep,
  flag: (message: string) => void,
): void {
  const seven = step.seven
  if (seven === undefined) return
  const replay = applyAction(state, { type: 'roll', dice: SEVEN_DICE }, cfg, {
    checkInvariants: false,
  })
  if (!replay.ok) {
    flag('the step carried a 7-preview but the engine refuses the roll')
    return
  }
  let wins = 0
  let takes = 0
  let returns = 0
  const touched = new Set<string>()
  for (const event of replay.events) {
    if (event.type === 'betResolved') {
      const t = event.trace
      touched.add(t.betId)
      if (t.outcome === 'win') {
        wins += t.winPaid - t.vigOnWin - t.vigRearm
        if (t.stakeDisposition === 'returned') returns += t.stake
      } else if (t.outcome === 'lose') takes += t.stake
      else if (t.stakeDisposition === 'returned') returns += t.stake
    } else if (event.type === 'betRemoved') {
      returns += event.amount
      touched.add(event.betId)
    }
  }
  const wealth = (s: TableState) => s.bets.reduce((sum, b) => sum + b.amount, 0) + s.ledger.bankroll
  const net = wealth(replay.state) - wealth(state)
  const got = {
    wins: seven.wins.exact,
    takes: seven.takes.exact,
    returns: seven.returns.exact,
    net: seven.net.exact,
  }
  if (got.wins !== wins || got.takes !== takes || got.returns !== returns || got.net !== net) {
    flag(
      `7-preview totals ${JSON.stringify(got)} differ from the engine's ` +
        `{wins ${wins}, takes ${takes}, returns ${returns}, net ${net}}`,
    )
  }
  let off = 0
  for (const effect of seven.byBet) {
    const bet = state.bets.find((b) => b.id === effect.betId)
    if (bet === undefined) {
      flag(`7-preview names a bet not on the table (${effect.betId})`)
      continue
    }
    const working = effectiveWorking(bet, state, cfg)
    if (effect.what === 'off') {
      off += 1
      if (working) flag(`7-preview says ${effect.name} is OFF but it is working`)
      if (touched.has(bet.id)) flag(`7-preview says ${effect.name} is OFF but the 7 decided it`)
    }
    if ((effect.what === 'wins' || effect.what === 'loses') && !touched.has(bet.id)) {
      flag(`7-preview says ${effect.name} ${effect.what} but the 7 left it alone`)
    }
  }
  const offCount = seven.offCount.exact
  if (!(offCount instanceof Fraction ? offCount.equals(Fraction.of(off)) : offCount === off)) {
    flag(`7-preview off count ${String(seven.offCount.exact)} differs from ${off}`)
  }
}

/** The spots to advise on: the newest bet, then catalog spots in rotation. */
function sampleSpecs(
  cfg: MachineConfig,
  state: TableState,
  next: () => number,
  extra: number,
): { spec: BetSpec; amount: Cents; betId: TableState['bets'][number]['id'] | null }[] {
  const out: { spec: BetSpec; amount: Cents; betId: TableState['bets'][number]['id'] | null }[] = []
  const newest = state.bets.at(-1)
  if (newest !== undefined) {
    out.push({
      spec: { typeId: newest.typeId, number: newest.number },
      amount: newest.amount,
      betId: newest.id,
    })
  }
  const specs = catalogSpecs(cfg)
  for (let index = 0; index < extra && specs.length > 0; index += 1) {
    const spec = specs[next() % specs.length]
    if (spec === undefined) continue
    const amount = smallestAmount(spec, cfg)
    if (amount === null) continue
    const held = state.bets.find((b) => b.typeId === spec.typeId && b.number === spec.number)
    out.push({
      spec,
      amount: held?.amount ?? amount,
      betId: held?.id ?? null,
    })
  }
  return out
}

function auditAdvice(
  cfg: MachineConfig,
  configs: ReadonlyMap<string, MachineConfig>,
  oracle: OracleEdges,
  input: CoachInput,
  advice: Advice,
  report: AuditReport,
  flag: (message: string) => void,
): void {
  const tag = (message: string) => flag(`${advice.id}: ${message}`)
  try {
    adviceLine(advice)
  } catch (error) {
    tag(`does not render: ${String(error)}`)
  }
  for (const [name, number] of Object.entries(advice.numbers)) {
    auditNumber(
      cfg,
      configs,
      oracle,
      { state: input.state, input, advice },
      name,
      number,
      report,
      tag,
    )
  }
  if (advice.fix !== undefined && input.state !== null) {
    report.fixChecks += 1
    if (
      validateAction(input.state, { type: 'batch', actions: [...advice.fix.actions] }, cfg) !== null
    ) {
      tag(`fix "${advice.fix.label}" is refused by the table it was offered on`)
    }
  }
  if (advice.ruleId === 'same-event') {
    report.sameEventChecks += 1
    const last = advice.fix?.actions.at(-1)
    if (last === undefined || last.type !== 'place') {
      tag('sameEvent advice without a place action')
      return
    }
    const altSpec: BetSpec = { typeId: last.typeId, number: input.spec.number }
    if (last.amount !== input.amount) tag('sameEvent switch changes the stake')
    const own = analyzeBet(input.spec, input.amount, 'typical', cfg).edge
    const alt = analyzeBet(altSpec, input.amount, 'typical', cfg).edge
    if (own.sub(alt).compare(SAME_EVENT_MIN_SAVING) < 0) {
      tag(`sameEvent saving ${own.sub(alt).toString()} is under the 0.25 pp threshold`)
    }
    if (!sameEvents(input.spec, altSpec, 'typical', cfg)) {
      tag(`claims same events for ${altSpec.typeId}, but sameEvents says no`)
    }
  }
}

/** Recomputes one `CoachNumber` from its recorded source; exact equality or a discrepancy. */
function auditNumber(
  cfg: MachineConfig,
  configs: ReadonlyMap<string, MachineConfig>,
  oracle: OracleEdges | null,
  context: { state: TableState | null; input?: CoachInput; advice?: Advice },
  name: string,
  number: CoachNumber,
  report: AuditReport,
  flag: (message: string) => void,
): void {
  report.numbers += 1
  const expected = recompute(configs, context, name, number, flag)
  if (expected === undefined) return // the source re-verified a claim instead of a value
  if (expected === null) {
    flag(`number "${name}" has unknown source ${number.source.fn}`)
    return
  }
  const actual = number.exact
  const equal =
    actual instanceof Fraction && expected instanceof Fraction
      ? actual.equals(expected)
      : typeof actual === 'number' && expected instanceof Fraction
        ? expected.equals(Fraction.of(actual))
        : typeof actual === 'number' && typeof expected === 'number'
          ? actual === expected
          : actual instanceof Fraction && typeof expected === 'number'
            ? actual.equals(Fraction.of(expected))
            : false
  if (!equal) {
    flag(
      `number "${name}" (${number.source.fn}) shows ${String(actual)} but recomputes to ${String(expected)}`,
    )
  }
  // Where the independent closed form models the same bet, the edge must match it too.
  if (number.source.fn === 'analyzeBet' && oracle !== null) {
    const args = number.source.args as {
      spec?: BetSpec
      amount?: number
      amountOf?: string
      field?: string
    }
    if (
      args.spec !== undefined &&
      typeof args.amount === 'number' &&
      args.amountOf === undefined &&
      (args.field === undefined || args.field === 'edge') &&
      number.source.configHash === cfg.configHash &&
      number.kind === 'percent'
    ) {
      const fromOracle = oracle(args.spec, cents(args.amount))
      if (fromOracle !== null) {
        report.oracleChecks += 1
        if (actual instanceof Fraction && !actual.equals(fromOracle)) {
          flag(
            `edge of ${args.spec.typeId} ${args.spec.number ?? ''} at ${args.amount} is ` +
              `${actual.toString()} but the closed form says ${fromOracle.toString()}`,
          )
        }
      }
    }
  }
}

/** The recomputation dispatcher: the audit's own reading of each `CoachSource`. */
function recompute(
  configs: ReadonlyMap<string, MachineConfig>,
  context: { state: TableState | null; input?: CoachInput; advice?: Advice },
  name: string,
  number: CoachNumber,
  flag: (message: string) => void,
): Fraction | number | null | undefined {
  const source = number.source
  const onCfg = configs.get(source.configHash)
  if (onCfg === undefined) return null
  const args = source.args as Record<string, unknown>
  const state = context.state
  switch (source.fn) {
    case 'analyzeBet': {
      const spec = args['spec'] as BetSpec
      let amount = args['amount'] as number | undefined
      if (args['amountOf'] === 'attainable') {
        const line = args['line'] as BetSpec
        const flat = args['flat'] as number
        amount = attainableOdds(line, cents(flat), spec.typeId, spec.number as PointNumber, onCfg)
      }
      if (amount === undefined || amount <= 0) return null
      const analysis = analyzeBet(spec, cents(amount), 'typical', onCfg)
      const field = (args['field'] as string | undefined) ?? 'edge'
      if (field === 'edge') return analysis.edge
      if (field === 'nominalEdge') return analysis.nominalEdge
      // Spec §0.1 [M]: an odds bet's unplayed returns are not decisions (coach/decisions.ts).
      if (field === 'pWinDecided') return analysis.pWin.div(analysis.pWin.add(analysis.pLose))
      return null
    }
    case 'edgePer100': {
      const spec = args['spec'] as BetSpec
      const amount = args['amount'] as number
      if (typeof number.exact === 'number') return 10_000
      return analyzeBet(spec, cents(amount), 'typical', onCfg).edge.mul(Fraction.of(10_000))
    }
    case 'catalogRow': {
      const spec = args['spec'] as BetSpec
      const row = catalogRow(spec, onCfg)
      if (args['field'] === 'pWinDecided') return row.pWin.div(row.pWin.add(row.pLose))
      return row.edge
    }
    case 'combinedEdge': {
      const line = args['line'] as BetSpec
      const flat = args['flat'] as number
      return combinedEdge(line, cents(flat), onCfg, 'max').edge
    }
    case 'suggestAlternatives':
    case 'lifetimeSameEvent': {
      const spec = args['spec'] as BetSpec
      const amount = args['amount'] as number
      const alt = args['alt'] as BetSpec | undefined
      if (name === 'stake') return amount
      if (name === 'betterAmount') {
        // A claim, not a copy: the named stake must be legal, strictly cheaper and — the template
        // says "the machine pays it exactly" — an exact stake (M9 audit).
        const better = number.exact
        if (typeof better !== 'number') return null
        const ownEdge = analyzeBet(spec, cents(amount), 'typical', onCfg).edge
        const betterEdge = analyzeBet(spec, cents(better), 'typical', onCfg).edge
        if (betterEdge.compare(ownEdge) >= 0) {
          flag(`sizing stake ${better} is not cheaper than ${amount}`)
        }
        if (!paysExactlyAt(spec, cents(better), onCfg)) {
          flag(`sizing stake ${better} is said to pay exactly but does not`)
        }
        return undefined
      }
      if (alt === undefined) return null
      const own = analyzeBet(spec, cents(amount), 'typical', onCfg)
      const theirs = analyzeBet(alt, cents(amount), 'typical', onCfg)
      if (name === 'saving') return own.edge.sub(theirs.edge)
      if (name === 'savingPerDecision') {
        if (source.fn === 'lifetimeSameEvent') {
          return own.lifecycle.loss.sub(theirs.lifecycle.loss).div(own.lifecycle.decisions)
        }
        return own.lossPerDecision.sub(theirs.lossPerDecision)
      }
      return null
    }
    case 'efficientAmounts': {
      const spec = args['spec'] as BetSpec
      const from = args['from'] as number
      const to = args['to'] as number
      if (name === 'stake') return undefined // the input stake, shown verbatim
      if (name === 'betterAmount') {
        const better = number.exact
        if (typeof better !== 'number') return null
        const scan = efficientAmounts(spec, onCfg, { from, to })
        if (!scan.some((entry) => entry.amount === better)) {
          flag(`efficient amount ${better} is not in the scan [${from}, ${to}]`)
        }
        // "At $X it pays exactly": the words are a claim the audit re-verifies (M9 audit MAJOR).
        if (!paysExactlyAt(spec, cents(better), onCfg)) {
          flag(`efficient amount ${better} is said to pay exactly but does not`)
        }
        const stakeAmount = (context.advice?.numbers['stake']?.exact ?? null) as number | null
        if (stakeAmount !== null) {
          const ownEdge = analyzeBet(spec, cents(stakeAmount), 'typical', onCfg).edge
          const betterEdge = analyzeBet(spec, cents(better), 'typical', onCfg).edge
          if (betterEdge.compare(ownEdge) >= 0) {
            flag(`efficient amount ${better} is not cheaper than the stake ${stakeAmount}`)
          }
        }
        return undefined
      }
      return null
    }
    case 'minimumFreeFrom': {
      const spec = args['spec'] as BetSpec
      return minimumFreeFrom(spec, onCfg)
    }
    case 'heldOffOf': {
      if (state === null) return null
      return Fraction.of(heldOffOf(state).length)
    }
    case 'analyzeLayout': {
      if (state === null) return null
      const toggled = args['toggled'] as boolean | undefined
      let on = state
      if (toggled === true) {
        const off = applyAction(state, { type: 'setGlobalWorking', off: true }, onCfg, {
          checkInvariants: false,
        })
        if (!off.ok) return null
        on = off.state
      }
      const layout = analyzeLayout(on, onCfg)
      const field = args['field'] as string | undefined
      if (field === 'perRoll') return layout.perRoll
      if (field === 'alternativeLayout.perRoll') return layout.alternativeLayout?.perRoll ?? null
      const at = args['at'] as number | undefined
      if (at !== undefined) {
        return perHourAt(layout.perRoll, onCfg).find((entry) => entry.at === at)?.value ?? null
      }
      return null
    }
    case 'legalBets': {
      if (state === null) return null
      const typeId = args['typeId'] as string
      const field = args['field'] as 'minAdd' | 'maxAdd'
      const number = (args['number'] as number | null | undefined) ?? null
      const parentId = (args['parentId'] as string | null | undefined) ?? null
      const spot = legalBets(state, onCfg).find(
        (candidate) =>
          candidate.typeId === typeId &&
          (number === null || candidate.number === number) &&
          (parentId === null || candidate.parentId === parentId),
      )
      return spot?.[field] ?? null
    }
    case 'chipFits': {
      if (state === null) return null
      const typeId = args['typeId'] as string
      const chip = args['chip'] as number
      if (validateAction(state, { type: 'place', typeId, amount: cents(chip) }, onCfg) !== null) {
        flag(`chip ${chip} does not fit the ${typeId} after all`)
      }
      return chip
    }
    case 'sevenPreview':
      // Audited whole by auditSeven (totals, OFF honesty); the step numbers mirror those parts.
      return undefined
    case 'takeDownValue':
    case 'analyzeExisting':
      return undefined // inspector-only sources; the e2e hook equality covers them
    default:
      return null
  }
}

// --- M9 audit hardening: surfaces priced against the closed form, equity against the spec ---

/**
 * The closed form of one machine bet, or null where the oracle does not model it. A line spec on
 * a number is the catalog's put bet (rules spec §3.1 PUT_N, even money on the number against 7):
 * `closedFormOf` prices a line type from the come-out, so the oracle's own `putBet` is read here.
 */
function closedForm(
  facts: MachineFacts,
  spec: BetSpec,
  amount: Cents,
  paid: 'asPaid' | 'exact',
): CfBet | null {
  const type = facts.types.get(spec.typeId)
  if (type?.family === 'line' && spec.number !== null) {
    return putBet({ number: spec.number, stake: amount, side: type.side })
  }
  try {
    return closedFormOf(facts, { typeId: spec.typeId, number: spec.number, amount }, paid)
  } catch {
    // A bet the oracle has no closed form for (a composite with parts it does not read, say).
    return null
  }
}

/**
 * One catalog row per session against the independent closed form: the row's edges and chances,
 * then the zone badge and the cheat-sheet row the UI renders for that spot — the surfaces the
 * `source` replay could only compare with themselves (the M9 audit's mutation A2).
 */
function auditCatalogRow(
  cfg: MachineConfig,
  facts: MachineFacts,
  next: () => number,
  report: AuditReport,
  flag: (message: string) => void,
): void {
  const specs = catalogSpecs(cfg)
  const spec = specs[next() % Math.max(1, specs.length)]
  if (spec === undefined) return
  let row: CatalogRow
  try {
    row = catalogRow(spec, cfg)
  } catch (error) {
    if (error instanceof ExactError) return
    throw error
  }
  const paidForm = closedForm(facts, spec, row.amount, 'asPaid')
  const exactForm = closedForm(facts, spec, row.amount, 'exact')
  if (paidForm === null || exactForm === null) return
  const paid = cfAnalyze(paidForm)
  const nominal = cfAnalyze(exactForm)
  report.rowOracleChecks += 1
  const where = `catalog row ${spec.typeId} ${spec.number ?? ''} at ${row.amount}`
  const pairs: readonly [string, Fraction, Fraction][] = [
    ['edge', row.edge, paid.edge],
    ['nominalEdge', row.nominalEdge, nominal.edge],
    ['pWin', row.pWin, paid.pWin],
    ['pLose', row.pLose, paid.pLose],
    ['pPush', row.pPush, paid.pPush],
    ['edgePerWorkingRoll', row.edgePerWorkingRoll, paid.edgePerWorkingRoll],
  ]
  for (const [name, ours, theirs] of pairs) {
    if (!ours.equals(theirs)) {
      flag(`${where}: ${name} ${ours.toString()} but the closed form says ${theirs.toString()}`)
    }
  }

  const badge = zoneBadges(cfg).find((b) => b.typeId === spec.typeId && b.number === spec.number)
  if (badge === undefined) {
    flag(`${where}: no zone badge`)
  } else {
    const shown = badge.edge.exact
    if (!(shown instanceof Fraction) || !shown.equals(paid.edge)) {
      flag(
        `${where}: the zone badge shows ${String(shown)}, the closed form ${paid.edge.toString()}`,
      )
    }
    if (badge.grade !== gradeOf(paid.edge)) {
      flag(
        `${where}: the badge grades ${badge.grade}, the closed form's edge grades ${gradeOf(paid.edge)}`,
      )
    }
  }

  const sheetRow = sheetFromRows(catalogTable(cfg), cfg).rows.find(
    (r) => r.key === badgeKey(spec.typeId, spec.number),
  )
  if (sheetRow === undefined) {
    flag(`${where}: no cheat-sheet row`)
    return
  }
  const sheetEdge = sheetRow.edge.exact
  if (!(sheetEdge instanceof Fraction) || !sheetEdge.equals(paid.edge)) {
    flag(
      `${where}: the sheet row shows ${String(sheetEdge)}, the closed form ${paid.edge.toString()}`,
    )
  }
  if (sheetRow.grade !== gradeOf(paid.edge))
    flag(`${where}: the sheet row grades ${sheetRow.grade}`)
  // "Wins … of decisions": an odds bet's returned-unplayed mass is no decision (spec §0.1 [M]).
  const played = paid.pWin.add(paid.pLose)
  const expectedChance =
    returnsUnplayed(cfg, spec) && !played.isZero() ? paid.pWin.div(played) : paid.pWin
  const chance = sheetRow.detail.parts.find(
    (part) => typeof part !== 'string' && !('style' in part) && part.kind === 'probability',
  )
  if (chance === undefined || typeof chance === 'string' || 'style' in chance) {
    flag(`${where}: the sheet row has no chance`)
  } else if (!(chance.exact instanceof Fraction) || !chance.exact.equals(expectedChance)) {
    flag(
      `${where}: the sheet row wins ${String(chance.exact)} of decisions, ` +
        `the closed form ${expectedChance.toString()}`,
    )
  }
}

/**
 * The layout meter's per-roll figure rebuilt from the closed form: Σ stake × edge per working roll
 * × the share of rolls the bet works (every roll, or the point rolls for a number bet the machine
 * keeps OFF on the come-out; a do-side line bet decides once per come-out or per point roll). Only
 * for tables the oracle can price without the exact re-bet cycle: machine defaults untouched (no
 * per-bet or global OFF), no odds, no don't bets, one bet per line type, no put bets, and not the
 * Shoot To Win machine whose carried chips go OFF on the come-out. π(come-out) is the oracle's own
 * 1 ÷ E[rolls per line decision].
 */
function auditLayout(
  cfg: MachineConfig,
  facts: MachineFacts,
  state: TableState,
  report: AuditReport,
  flag: (message: string) => void,
): void {
  if (state.bets.length === 0 || state.globalOff === true) return
  if (facts.working.autoOff !== null || facts.allowPutBets) return
  const comeOutShare = Fraction.ONE.div(expectedRollsPerLineDecision(facts.variant))
  const pointShare = Fraction.ONE.sub(comeOutShare)
  const lineTypesSeen = new Set<string>()
  let expected = Fraction.ZERO
  for (const bet of state.bets) {
    if (bet.working !== null || bet.parentId !== null) return
    const type = facts.types.get(bet.typeId)
    if (type === undefined) return
    let share: Fraction
    switch (type.family) {
      case 'line':
        if (type.side !== 'do' || lineTypesSeen.has(type.id)) return
        lineTypesSeen.add(type.id)
        share = type.window === 'comeOut' ? comeOutShare : pointShare
        break
      case 'numberVsSeven':
      case 'hardway':
        share = type.comeOutDefault === 'on' ? Fraction.ONE : pointShare
        break
      case 'oneRoll':
        share = Fraction.ONE
        break
      default:
        return
    }
    const spec: BetSpec = { typeId: bet.typeId, number: type.family === 'line' ? null : bet.number }
    const form = closedForm(facts, spec, bet.amount, 'asPaid')
    if (form === null) return
    const analysis = cfAnalyze(form)
    // A line bet is priced per decision (its loss as placed); a standing bet per working roll.
    const perUnit =
      type.family === 'line'
        ? analysis.perDecision.loss
        : analysis.edgePerWorkingRoll.mul(Fraction.of(bet.amount))
    expected = expected.add(perUnit.mul(share))
  }
  const perRoll = analyzeLayout(state, cfg).perRoll
  report.layoutOracleChecks += 1
  if (!perRoll.equals(expected)) {
    flag(
      `layout per roll ${perRoll.toString()} but the closed form sums to ${expected.toString()} ` +
        `over ${state.bets.map((b) => `${b.typeId} ${b.number ?? ''} ${b.amount}`).join(', ')}`,
    )
  }
}

/** Ways to roll each point number, for the §3.1 equity table. */
const WAYS: Readonly<Record<number, number>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
}

/**
 * Rules spec §3.1 [M]: a do-side line bet (1:1) on point N is worth flat × 2w/(w+6), w the ways to
 * roll N — 2/7 of the flat on the crapless 2 and 12, 10/11 on 6 and 8. `analyzeExisting` must
 * give exactly that for every pass or come bet on a number.
 */
function auditEquity(
  cfg: MachineConfig,
  state: TableState,
  report: AuditReport,
  flag: (message: string) => void,
): void {
  for (const bet of state.bets) {
    const type = cfg.catalog.get(bet.typeId)
    if (type?.family !== 'line' || type.side !== 'do' || bet.number === null) continue
    if (type.pays.num !== type.pays.den) continue // the table assumes even money
    const w = WAYS[bet.number]
    if (w === undefined) continue
    const expected = Fraction.of(bet.amount).mul(Fraction.of(2 * w, w + 6))
    let equity: Fraction
    try {
      equity = analyzeExisting(bet.id, state, cfg).equity
    } catch (error) {
      flag(`analyzeExisting(${bet.typeId} on ${bet.number}) threw ${String(error)}`)
      continue
    }
    report.equityChecks += 1
    if (!equity.equals(expected)) {
      flag(
        `equity of ${bet.typeId} ${bet.amount} on ${bet.number} is ${equity.toString()}, ` +
          `the §3.1 table says ${expected.toString()}`,
      )
    }
  }
}

/** The gate in all three modes under rotating memory fixtures (plan §5.6, §5.8). */
function auditGate(
  advice: readonly Advice[],
  state: TableState,
  next: () => number,
  report: AuditReport,
  flag: (message: string) => void,
): void {
  if (advice.length === 0) return
  const rollIndex = state.round.rollIndex
  const first = advice[0]
  const memories: CoachMemory[] = [EMPTY_COACH_MEMORY]
  if (first !== undefined) {
    memories.push(
      dismissAdvice(dismissAdvice(EMPTY_COACH_MEMORY, first.id), first.id),
      markForFun(EMPTY_COACH_MEMORY, first.subject.typeId),
      noteToast(EMPTY_COACH_MEMORY, first.id, rollIndex),
      noteToast(EMPTY_COACH_MEMORY, `other|${next() % 100}`, rollIndex - 1 - (next() % 30)),
    )
  }
  for (const mode of ['off', 'quiet', 'coach'] as const satisfies readonly CoachModeName[]) {
    for (const memory of memories) {
      report.gateChecks += 1
      const result = gate(advice, mode, memory, rollIndex)
      const again = gate(advice, mode, memory, rollIndex)
      if (signature(result) !== signature(again)) {
        flag(`the gate is not pure in ${mode}`)
      }
      const routed = [
        ...(result.toast === null ? [] : [result.toast]),
        ...result.feed,
        ...result.badge,
        ...result.hidden,
      ]
      if (routed.length !== advice.length) {
        flag(`the gate lost or duplicated advice in ${mode}: ${routed.length} of ${advice.length}`)
      }
      if (
        mode === 'off' &&
        (result.toast !== null || result.feed.length > 0 || result.badge.length > 0)
      ) {
        flag('off mode showed something')
      }
      if (result.toast !== null) {
        const shownAt = memory.shownAt[result.toast.id]
        if (memory.lastToastRoll === rollIndex) flag(`a second toast in one window (${mode})`)
        if (shownAt !== undefined && rollIndex - shownAt < 20) {
          flag(`toast ${result.toast.id} inside its cooldown (${mode})`)
        }
        if ((memory.dismissed[result.toast.id] ?? 0) >= 2) {
          flag(`toast ${result.toast.id} was dismissed twice (${mode})`)
        }
        if (memory.forFun.includes(result.toast.subject.typeId)) {
          flag(`toast for a for-fun type (${mode})`)
        }
      }
      for (const item of advice) {
        if (
          memory.forFun.includes(item.subject.typeId) &&
          mode !== 'off' &&
          !result.hidden.includes(item)
        ) {
          flag(`for-fun advice ${item.id} was not hidden (${mode})`)
        }
        if (
          (memory.dismissed[item.id] ?? 0) >= 2 &&
          mode !== 'off' &&
          !memory.forFun.includes(item.subject.typeId) &&
          !result.badge.includes(item)
        ) {
          flag(`twice-dismissed advice ${item.id} was not badge-only (${mode})`)
        }
      }
    }
  }
}

/** A routing signature: which advice landed on which surface (ids only; Fractions don't JSON). */
function signature(result: {
  toast: Advice | null
  feed: readonly Advice[]
  badge: readonly Advice[]
  hidden: readonly Advice[]
}): string {
  const ids = (list: readonly Advice[]) => list.map((item) => item.id).join(',')
  return [result.toast?.id ?? '', ids(result.feed), ids(result.badge), ids(result.hidden)].join(';')
}
