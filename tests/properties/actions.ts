import fc from 'fast-check'
import type { LineBetType, MachineConfig } from '../../src/engine/config/compile.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import type { DieFace } from '../../src/engine/core/dice.ts'
import { cents } from '../../src/engine/core/money.ts'
import { checkMinTotal, maxOdds, smallestBet, typeLimits } from '../../src/engine/bets/limits.ts'
import { resolveType } from '../../src/engine/bets/registry.ts'
import type { BetId, BetInstance, BetType } from '../../src/engine/bets/types.ts'
import { effectiveWorking } from '../../src/engine/bets/working.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import type { GameEvent } from '../../src/engine/table/events.ts'
import { applyAction, validateAction, type ActionResult } from '../../src/engine/table/reducer.ts'
import type { TableState } from '../../src/engine/table/state.ts'

/**
 * The action generator for the M4d properties and the reference differential (plan §9 item 6,
 * §0 #17). fast-check draws abstract intents; each intent is turned into a concrete step against
 * the table as it is at that moment, so a run keeps placing bets that can be placed, odds behind
 * bets that are up, presses and cuts of bets that exist, and so on, while still sending a share of
 * actions the table must refuse (wrong numbers, off-grid or too-large amounts, odds over the cap,
 * bets that are not there).
 *
 * It reaches every bet type the machine offers and the engine implements (families are drawn by
 * weight, then a type within the family), both phases, per-bet and global ON/OFF, presses, cuts,
 * take-downs, deposits and long runs of scripted rolls. `meetMinimum` tops the table up to the
 * round's minimum with a line bet, on the don't side one time in three where the machine has one,
 * so rolls keep coming and lay odds get parents.
 *
 * Odds intents aim at the line bets on a number that take odds (M6 reconciliation: before, most of
 * them named no parent): the odds type and the parent are drawn among those, one intent in twelve
 * names no parent or a parent still in its box for the table to refuse, and with no parent up the
 * intent places a line bet that takes odds instead. Stakes follow the unit on the bet's number
 * (`/limits/perType/<t>/incrementByNumber`; for odds, the parent's point).
 *
 * A step names bets by their spot (`BetKey`: type, number and the parent's spot), which both the
 * engine and the reference table can resolve, since no two bets ever share a spot.
 */

/** A bet named by its spot: its type, its number, and for odds the spot of their parent. */
export interface BetKey {
  readonly typeId: string
  readonly number: PointNumber | null
  /** Odds: their parent as `typeId@number` (`come@6`); null for every other bet. */
  readonly parent: string | null
}

/** One concrete action, in terms both the engine and the reference table understand. */
export type Step =
  | {
      readonly kind: 'place'
      readonly typeId: string
      /** A number the action names (number bets, hardways), or null. */
      readonly number: number | null
      /** Odds: the line bet they go behind, if any. */
      readonly parent: BetKey | null
      readonly amount: number
    }
  | { readonly kind: 'setAmount'; readonly bet: BetKey; readonly amount: number }
  | { readonly kind: 'setWorking'; readonly bet: BetKey; readonly working: boolean | null }
  | { readonly kind: 'setGlobalWorking'; readonly off: boolean | null }
  | { readonly kind: 'deposit'; readonly amount: number }
  | { readonly kind: 'roll'; readonly d1: DieFace; readonly d2: DieFace }

type Size = 'min' | 'units' | 'max' | 'over' | 'odd'

/** What fast-check draws: choices that `resolveIntent` makes concrete against the table. */
export type Intent =
  | {
      readonly kind: 'place'
      readonly family: number
      readonly type: number
      readonly spot: number
      readonly size: Size
      readonly units: number
    }
  | { readonly kind: 'press'; readonly pick: number; readonly size: Size; readonly units: number }
  | { readonly kind: 'cut'; readonly pick: number; readonly units: number }
  | { readonly kind: 'takeDown'; readonly pick: number }
  | { readonly kind: 'working'; readonly pick: number; readonly value: boolean | null }
  | { readonly kind: 'global'; readonly value: boolean | null }
  | { readonly kind: 'deposit'; readonly units: number }
  | { readonly kind: 'meetMinimum'; readonly side: number }
  | { readonly kind: 'roll'; readonly d1: DieFace; readonly d2: DieFace }

/** A batch of intents, applied as one atomic `batch` action (engine properties only). */
export type BatchIntent = { readonly kind: 'batch'; readonly parts: readonly Intent[] }

const face = fc.constantFrom<DieFace>(1, 2, 3, 4, 5, 6)
const setting = fc.constantFrom(true, false, null)
const size: fc.Arbitrary<Size> = fc.oneof(
  { weight: 4, arbitrary: fc.constant('min' as const) },
  { weight: 8, arbitrary: fc.constant('units' as const) },
  { weight: 2, arbitrary: fc.constant('max' as const) },
  { weight: 1, arbitrary: fc.constant('over' as const) },
  { weight: 1, arbitrary: fc.constant('odd' as const) },
)

/** One intent. The weights keep tables busy: about a third of the actions are rolls. */
export const intent: fc.Arbitrary<Intent> = fc.oneof(
  {
    weight: 30,
    arbitrary: fc.record({
      kind: fc.constant('place' as const),
      family: fc.nat(),
      type: fc.nat(),
      spot: fc.nat(),
      size,
      units: fc.integer({ min: 1, max: 25 }),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('press' as const),
      pick: fc.nat(),
      size,
      units: fc.integer({ min: 1, max: 10 }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('cut' as const),
      pick: fc.nat(),
      units: fc.integer({ min: 1, max: 10 }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({ kind: fc.constant('takeDown' as const), pick: fc.nat() }),
  },
  {
    weight: 5,
    arbitrary: fc.record({ kind: fc.constant('working' as const), pick: fc.nat(), value: setting }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('global' as const), value: setting }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('deposit' as const),
      units: fc.integer({ min: 1, max: 100 }),
    }),
  },
  {
    weight: 8,
    arbitrary: fc.record({ kind: fc.constant('meetMinimum' as const), side: fc.nat() }),
  },
  { weight: 38, arbitrary: fc.record({ kind: fc.constant('roll' as const), d1: face, d2: face }) },
)

/** An intent or, now and then, a batch of two to four of them. */
export const intentOrBatch: fc.Arbitrary<Intent | BatchIntent> = fc.oneof(
  { weight: 19, arbitrary: intent },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('batch' as const),
      parts: fc.array(intent, { minLength: 2, maxLength: 4 }),
    }),
  },
)

/** Families by weight: each type of a family with many types (one-roll bets) is still reached. */
const FAMILY_WEIGHTS: readonly (readonly [BetType['family'], number])[] = [
  ['line', 5],
  ['odds', 5],
  ['numberVsSeven', 6],
  ['hardway', 2],
  ['oneRoll', 4],
  ['composite', 2],
]
const FAMILY_DRAW: readonly BetType['family'][] = FAMILY_WEIGHTS.flatMap(([family, weight]) =>
  Array<BetType['family']>(weight).fill(family),
)

/** A bet id no table holds, for steps that name a bet that is not there. */
const MISSING: BetId = 'b999999' as BetId
const NO_BET: BetKey = { typeId: 'none', number: null, parent: null }

/** The types of each family the machine offers and the engine implements. */
export function typesByFamily(cfg: MachineConfig): ReadonlyMap<BetType['family'], string[]> {
  const byFamily = new Map<BetType['family'], string[]>()
  for (const typeId of [...cfg.catalog.keys(), ...cfg.composites.keys()]) {
    const resolved = resolveType(cfg, typeId)
    if (resolved === null) continue
    const list = byFamily.get(resolved.type.family) ?? []
    list.push(typeId)
    byFamily.set(resolved.type.family, list)
  }
  return byFamily
}

/** Every type the machine offers and the engine implements. */
export function offeredTypes(cfg: MachineConfig): string[] {
  return [...typesByFamily(cfg).values()].flat()
}

/** The odds types the machine offers. */
export function oddsTypes(cfg: MachineConfig): string[] {
  return typesByFamily(cfg).get('odds') ?? []
}

/** The spot of a bet on the table. */
export function keyOf(bet: BetInstance, state: TableState): BetKey {
  const parent =
    bet.parentId === null ? undefined : state.bets.find((other) => other.id === bet.parentId)
  return {
    typeId: bet.typeId,
    number: bet.number,
    parent: parent === undefined ? null : `${parent.typeId}@${parent.number ?? ''}`,
  }
}

/** The bet on a spot, if there is one. */
export function findByKey(state: TableState, key: BetKey): BetInstance | undefined {
  return state.bets.find((bet) => {
    const own = keyOf(bet, state)
    return own.typeId === key.typeId && own.number === key.number && own.parent === key.parent
  })
}

function pick<T>(list: readonly T[], n: number): T | undefined {
  return list.length === 0 ? undefined : list[n % list.length]
}

/** The concrete step an intent stands for on this table. */
export function resolveIntent(next: Intent, state: TableState, cfg: MachineConfig): Step {
  const bets = state.bets
  switch (next.kind) {
    case 'place':
      return placeStep(next, state, cfg)
    case 'press': {
      const bet = pick(bets, next.pick)
      if (bet === undefined) return { kind: 'setAmount', bet: NO_BET, amount: 100 }
      const { increment } = typeLimits(cfg, bet.typeId, bet.number)
      const room = oddsRoom(bet, state, cfg)
      const amount =
        next.size === 'max' && room !== null
          ? bet.amount + room
          : next.size === 'odd'
            ? bet.amount + next.units * increment + 1
            : bet.amount + next.units * increment
      return { kind: 'setAmount', bet: keyOf(bet, state), amount }
    }
    case 'cut': {
      const bet = pick(bets, next.pick)
      if (bet === undefined) return { kind: 'setAmount', bet: NO_BET, amount: 0 }
      const { increment } = typeLimits(cfg, bet.typeId, bet.number)
      const amount = Math.max(0, bet.amount - next.units * increment)
      return { kind: 'setAmount', bet: keyOf(bet, state), amount }
    }
    case 'takeDown': {
      const bet = pick(bets, next.pick)
      return { kind: 'setAmount', bet: bet === undefined ? NO_BET : keyOf(bet, state), amount: 0 }
    }
    case 'working': {
      const bet = pick(bets, next.pick)
      const key = bet === undefined ? NO_BET : keyOf(bet, state)
      return { kind: 'setWorking', bet: key, working: next.value }
    }
    case 'global':
      return { kind: 'setGlobalWorking', off: next.value }
    case 'deposit':
      return { kind: 'deposit', amount: next.units * 1_000 }
    case 'meetMinimum':
      return minimumStep(next, state, cfg)
    case 'roll':
      return { kind: 'roll', d1: next.d1, d2: next.d2 }
  }
}

type PlaceIntent = Extract<Intent, { kind: 'place' }>

/** The stake an intent's size stands for, for a bet holding `held` with `room` left under a cap. */
function amountFor(
  next: Pick<PlaceIntent, 'size' | 'units'>,
  limits: ReturnType<typeof typeLimits>,
  existing: BetInstance | undefined,
  room: number | null,
): number {
  const held = existing?.amount ?? 0
  switch (next.size) {
    case 'min':
      return existing === undefined ? smallestBet(limits) : limits.increment
    case 'units':
      return next.units * limits.increment
    case 'max':
      return room ?? limits.max - held
    case 'over':
      return (room ?? limits.max - held) + limits.increment
    case 'odd':
      return next.units * limits.increment + 1
  }
}

function placeStep(next: PlaceIntent, state: TableState, cfg: MachineConfig): Step {
  const byFamily = typesByFamily(cfg)
  const families = FAMILY_DRAW.filter((family) => byFamily.has(family))
  const family = pick(families, next.family) ?? 'line'
  const candidates = byFamily.get(family) ?? []
  if (family === 'odds') return oddsStep(next, state, cfg, candidates)
  const typeId = pick(candidates, next.type) ?? 'pass'
  return betStep(next, state, cfg, typeId)
}

/** A new bet of `typeId`, or more on the one already on its spot. */
function betStep(next: PlaceIntent, state: TableState, cfg: MachineConfig, typeId: string): Step {
  const type = resolveType(cfg, typeId)?.type
  const plain = (number: number | null, existing: BetInstance | undefined): Step => {
    const on = number === null || number === 7 ? null : (number as PointNumber)
    return {
      kind: 'place',
      typeId,
      number,
      parent: null,
      amount: amountFor(next, typeLimits(cfg, typeId, on), existing, null),
    }
  }
  switch (type?.family) {
    case 'numberVsSeven':
    case 'hardway': {
      // One choice in a dozen names 7, which no number bet takes.
      const numbers: readonly number[] = type.numbers
      const n = next.spot % 12 === 11 ? 7 : (pick(numbers, next.spot) ?? 6)
      const existing = state.bets.find((bet) => bet.typeId === typeId && bet.number === n)
      return plain(n, existing)
    }
    case 'line': {
      const existing = state.bets.find(
        (bet) => bet.typeId === typeId && (type.window === 'comeOut' || bet.number === null),
      )
      return plain(null, existing)
    }
    default: {
      const existing = state.bets.find((bet) => bet.typeId === typeId)
      return plain(null, existing)
    }
  }
}

/**
 * Odds behind a line bet on a number: the odds type and its parent are drawn among the parents
 * that are up, so every odds type is played wherever its line bet is. One intent in twelve names no
 * parent, or a parent still in its box, which the table must refuse (`NO_PARENT`,
 * `PARENT_NOT_ON_POINT`). With no parent on a number, it places a line bet that takes odds.
 */
function oddsStep(
  next: PlaceIntent,
  state: TableState,
  cfg: MachineConfig,
  candidates: readonly string[],
): Step {
  const parentOf = (typeId: string) => {
    const odds = cfg.catalog.get(typeId)
    return odds?.family === 'odds' ? odds.parent : null
  }
  if (next.spot % 12 === 11) {
    const typeId = pick(candidates, next.type) ?? 'passOdds'
    const boxed = state.bets.find((bet) => bet.typeId === parentOf(typeId) && bet.number === null)
    const amount = smallestBet(typeLimits(cfg, typeId))
    const parent = boxed === undefined || next.units % 2 === 0 ? null : keyOf(boxed, state)
    return { kind: 'place', typeId, number: null, parent, amount }
  }
  const backed = candidates.flatMap((typeId) =>
    state.bets
      .filter((bet) => bet.typeId === parentOf(typeId) && bet.number !== null)
      .map((parent) => ({ typeId, parent })),
  )
  const choice = pick(backed, next.type + next.spot)
  if (choice === undefined) return parentStep(next, state, cfg)
  const { typeId, parent } = choice
  const existing = state.bets.find((bet) => bet.typeId === typeId && bet.parentId === parent.id)
  const limits = typeLimits(cfg, typeId, parent.number)
  const room = maxOdds(parent, cfg) - (existing?.amount ?? 0)
  return {
    kind: 'place',
    typeId,
    number: null,
    parent: keyOf(parent, state),
    amount: Math.max(limits.increment, amountFor(next, limits, existing, room)),
  }
}

/**
 * A line bet that takes odds, placed in its own window, so the next odds intent finds a parent:
 * the don't side first when `units` is even and the machine takes a don't bet now.
 */
function parentStep(next: PlaceIntent, state: TableState, cfg: MachineConfig): Step {
  const lines = lineTypes(cfg, state.round.phase.kind).filter((line) =>
    cfg.oddsFor.has(line.typeId),
  )
  const side = next.units % 2 === 0 ? 'dont' : 'do'
  const step = firstAccepted(state, cfg, preferSide(lines, side), (line) =>
    betStep(next, state, cfg, line.typeId),
  )
  return step ?? betStep(next, state, cfg, pick(lines, next.type)?.typeId ?? 'pass')
}

/** What an odds bet could still grow by under its cap; null for any other bet. */
function oddsRoom(bet: BetInstance, state: TableState, cfg: MachineConfig): number | null {
  if (bet.parentId === null) return null
  const parent = state.bets.find((other) => other.id === bet.parentId)
  return parent === undefined ? null : maxOdds(parent, cfg) - bet.amount
}

/**
 * A line bet for the phase (pass or don't pass on the come-out, come or don't come with a point
 * on) worth what the round's minimum still lacks, rounded up to the increment, and at least the
 * type's minimum. The don't side goes first one time in three, where the machine takes it now.
 */
function minimumStep(
  next: Extract<Intent, { kind: 'meetMinimum' }>,
  state: TableState,
  cfg: MachineConfig,
): Step {
  const short = checkMinTotal(state, cfg, (bet) => effectiveWorking(bet, state, cfg))
  const missing = typeof short?.details.short === 'number' ? short.details.short : 0
  const lineStep = (line: LineBetType): Step => {
    const { min, increment } = typeLimits(cfg, line.typeId)
    const amount = Math.max(min, missing + ((increment - (missing % increment)) % increment))
    return { kind: 'place', typeId: line.typeId, number: null, parent: null, amount }
  }
  const lines = lineTypes(cfg, state.round.phase.kind)
  const ordered = preferSide(lines, next.side % 3 === 0 ? 'dont' : 'do')
  const step = firstAccepted(state, cfg, ordered, lineStep)
  if (step !== undefined) return step
  const first = ordered[0]
  return first === undefined
    ? { kind: 'place', typeId: 'pass', number: null, parent: null, amount: cfg.limits.min }
    : lineStep(first)
}

/** The line types placed in `phase`. */
function lineTypes(cfg: MachineConfig, phase: 'comeOut' | 'point'): LineBetType[] {
  return [...cfg.catalog.values()].filter(
    (type): type is LineBetType => type.family === 'line' && type.window === phase,
  )
}

/** `lines` with those of `side` first, keeping their order otherwise. */
function preferSide(lines: readonly LineBetType[], side: 'do' | 'dont'): LineBetType[] {
  return [...lines.filter((line) => line.side === side), ...lines.filter((l) => l.side !== side)]
}

/** The first of `options`' steps that the table accepts now, if any. */
function firstAccepted<T>(
  state: TableState,
  cfg: MachineConfig,
  options: readonly T[],
  stepOf: (option: T) => Step,
): Step | undefined {
  for (const option of options) {
    const step = stepOf(option)
    if (validateAction(state, engineAction(step, state), cfg) === null) return step
  }
  return undefined
}

/** The engine action for a step on this table. */
export function engineAction(step: Step, state: TableState): Action {
  const idOf = (key: BetKey): BetId => findByKey(state, key)?.id ?? MISSING
  switch (step.kind) {
    case 'place': {
      const base = { type: 'place' as const, typeId: step.typeId, amount: cents(step.amount) }
      if (step.parent !== null) return { ...base, parentId: idOf(step.parent) }
      return step.number === null ? base : { ...base, number: step.number as PointNumber }
    }
    case 'setAmount':
      return { type: 'setAmount', betId: idOf(step.bet), amount: cents(step.amount) }
    case 'setWorking':
      return { type: 'setWorking', betId: idOf(step.bet), working: step.working }
    case 'setGlobalWorking':
      return { type: 'setGlobalWorking', off: step.off }
    case 'deposit':
      return { type: 'deposit', amount: cents(step.amount) }
    case 'roll':
      return { type: 'roll', dice: { d1: step.d1, d2: step.d2 } }
  }
}

/**
 * The engine action for an intent or a batch: a batch resolves each part against the table the
 * parts before it leave (a part the table refuses leaves it as it was).
 */
export function engineActionFor(
  next: Intent | BatchIntent,
  state: TableState,
  cfg: MachineConfig,
): Action {
  if (next.kind !== 'batch') return engineAction(resolveIntent(next, state, cfg), state)
  const actions: Action[] = []
  let current = state
  for (const part of next.parts) {
    const action = engineAction(resolveIntent(part, current, cfg), current)
    actions.push(action)
    const result = applyAction(current, action, cfg, { checkInvariants: false })
    if (result.ok) current = result.state
  }
  return { type: 'batch', actions }
}

/** Counts of what a set of runs did, so a test can insist that they exercised the rules. */
export interface Coverage {
  /** New bets placed, by type. */
  readonly placed: Map<string, number>
  /** Settlements (wins, losses, pushes), by type. */
  readonly settled: Map<string, number>
  /**
   * Settlements of bets on a number, as `place@6:win`: payouts differ by number
   * (`payoutRoundingByNumber`, odds pays), so the per-type counts alone can miss one — the M5/M6
   * audit found no run settled a winning crapless passOdds on 2 or 12. An odds bet counts on its
   * parent's point.
   */
  readonly settledByNumber: Map<string, number>
  /** Decisions by kind: `win:stay`, `win:return`, `lose`, `push:bar`, `travel`, … */
  readonly decisions: Map<string, number>
  /** Accepted changes by kind: `add`, `press`, `cut`, `takeDown`, `roll:comeOut`, `global:true`, … */
  readonly accepted: Map<string, number>
  /** Refused actions, by rejection code. */
  readonly rejected: Map<string, number>
  /**
   * What the machine did by itself: `layAutoOn`, `afterSevenOut`, and commission events by kind
   * (`COMMISSION_EVENTS`).
   */
  readonly machine: Map<string, number>
}

/**
 * The commission events a run can reach (rules spec §4.3, §4.5), as `Coverage.machine` counts
 * them: up-front vig at placement and on an increase, re-collected from the win and from credit
 * when a winner stays up, a re-collection declined (the bet comes down), refunds on a cut or
 * take-down and of what a declined win had paid, and commission taken from the win itself
 * (`timing: onWin`), with the case where the win caps it (the M5/M6 audit found no run counted
 * either).
 */
export const COMMISSION_EVENTS = {
  placement: 'vigCharged:placement:credit',
  increase: 'vigCharged:increase:credit',
  rearmFromWin: 'vigCharged:rearm:win',
  rearmFromCredit: 'vigCharged:rearm:credit',
  decline: 'vigDeclined',
  refund: 'vigRefunded:takeDown',
  declineRefund: 'vigRefunded:declined',
  onWin: 'vigOnWin',
  onWinCapped: 'vigOnWin:capped',
} as const

export function newCoverage(): Coverage {
  return {
    placed: new Map(),
    settled: new Map(),
    settledByNumber: new Map(),
    decisions: new Map(),
    accepted: new Map(),
    rejected: new Map(),
    machine: new Map(),
  }
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** Adds one action's result to `coverage`; `before` is the table it was applied to. */
export function recordResult(coverage: Coverage, before: TableState, result: ActionResult): void {
  if (!result.ok) {
    bump(coverage.rejected, result.rejection.code)
    return
  }
  const rolled = result.events.some((event) => event.type === 'diceRolled')
  for (const event of result.events) recordEvent(coverage, before, event, rolled)
}

function recordEvent(
  coverage: Coverage,
  before: TableState,
  event: GameEvent,
  rolled: boolean,
): void {
  switch (event.type) {
    case 'betPlaced':
      bump(coverage.placed, event.bet.typeId)
      bump(coverage.accepted, 'place')
      break
    case 'betAdjusted':
      bump(coverage.accepted, event.to > event.from ? 'press' : 'cut')
      break
    case 'betRemoved':
      bump(event.reason === 'vigDeclined' ? coverage.machine : coverage.accepted, event.reason)
      break
    case 'workingChanged':
      if (event.scope === 'global') bump(coverage.accepted, `global:${String(event.off)}`)
      else if (event.by !== undefined) bump(coverage.machine, event.by)
      else bump(coverage.accepted, `working:${String(event.working)}`)
      break
    case 'vigCharged':
      bump(coverage.machine, `vigCharged:${event.reason}:${event.from ?? 'credit'}`)
      break
    case 'vigRefunded':
      // A roll refunds only what a declined re-collection had taken from the win (§4.5).
      bump(coverage.machine, rolled ? 'vigRefunded:declined' : 'vigRefunded:takeDown')
      break
    case 'deposited':
      bump(coverage.accepted, 'deposit')
      break
    case 'diceRolled':
      bump(coverage.accepted, `roll:${before.round.phase.kind}`)
      break
    case 'betResolved': {
      const { trace } = event
      bump(coverage.settled, trace.typeId)
      if (trace.number !== null) {
        bump(coverage.settledByNumber, `${trace.typeId}@${trace.number}:${trace.outcome}`)
      }
      if (trace.vigOnWin > 0) {
        bump(coverage.machine, COMMISSION_EVENTS.onWin)
        if (trace.vigOnWin === trace.winPaid) bump(coverage.machine, COMMISSION_EVENTS.onWinCapped)
      }
      const kind =
        trace.outcome === 'win'
          ? `win:${trace.stakeDisposition === 'stays' ? 'stay' : 'return'}`
          : trace.outcome === 'push'
            ? `push:${String(trace.pushReason)}`
            : 'lose'
      bump(coverage.decisions, kind)
      break
    }
    case 'betTraveled':
      bump(coverage.decisions, 'travel')
      break
    case 'betProgress':
    case 'natural':
    case 'crapsOut':
    case 'pointEstablished':
    case 'pointMade':
    case 'sevenOut':
    case 'newShooter':
      break
  }
}

/** Adds `more` into `into`. */
export function mergeCoverage(into: Coverage, more: Coverage): void {
  for (const key of Object.keys(into) as (keyof Coverage)[]) {
    for (const [name, count] of more[key]) into[key].set(name, (into[key].get(name) ?? 0) + count)
  }
}

/** A compact, sorted, printable view of the counts. */
export function describeCoverage(coverage: Coverage): Record<string, Record<string, number>> {
  const sorted = (map: Map<string, number>) =>
    Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return {
    placed: sorted(coverage.placed),
    settled: sorted(coverage.settled),
    settledByNumber: sorted(coverage.settledByNumber),
    decisions: sorted(coverage.decisions),
    accepted: sorted(coverage.accepted),
    rejected: sorted(coverage.rejected),
    machine: sorted(coverage.machine),
  }
}
