import type { Total } from '../core/dice.ts'
import { hashJson } from '../core/hash.ts'
import { cents, formatCents, type Cents, type Rounding } from '../core/money.ts'
import { Fraction } from '../core/rational.ts'
import { issue, type ConfigIssue } from './issues.ts'
import { provenanceIssues, toPointer, type Provenance } from './provenance.ts'
import { parseRatio, type Ratio } from './ratio.ts'
import {
  COME_OUT_RULES,
  makeRuleset,
  partitionIssues,
  variantIssues,
  type HardNumber,
  type PointKey,
  type PointNumber,
  type Ruleset,
} from './rulesets.ts'
import {
  MachineConfigInputSchema,
  type BetTypeConfig,
  type CommissionInput,
  type HandLengthConfig,
  type LineTypeConfig,
  type MachineConfigInput,
  type NumberTypeConfig,
  type OddsTypeConfig,
  type OneRollTypeConfig,
  type PointRunConfig,
  type RoundingRule,
  type SideBetConfig,
  type UniquePointsConfig,
} from './schema.ts'

type Path = readonly (string | number)[]
type Add = (path: Path, message: string) => void

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/**
 * Checks that relate config values to each other, after the schema has checked each value on its
 * own (plan §4.4, rules spec §5.3). Each issue is located like a zod issue.
 */
export function semanticIssues(cfg: MachineConfigInput): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  const add: Add = (path, message) => issues.push(issue(path, message))
  checkRules(cfg, add)
  checkMoney(cfg, add)
  checkCatalog(cfg, add)
  checkComposites(cfg, add)
  checkSideBets(cfg, add)
  checkTypeReferences(cfg, add)
  issues.push(...provenanceIssues(cfg))
  return issues
}

/** The schema plus the semantic checks: what a config must pass to be compiled. */
export const MachineConfigSchema = MachineConfigInputSchema.superRefine((cfg, ctx) => {
  for (const { path, message } of semanticIssues(cfg)) {
    ctx.addIssue({ code: 'custom', path: [...path], message })
  }
})

/** Every problem with `input`, structural first; empty when it can be compiled. */
export function validateConfig(input: unknown): readonly ConfigIssue[] {
  const result = MachineConfigSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map(toConfigIssue)
}

/** Thrown by `compileConfig` for an invalid config; `issues` locates every problem. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[]

  constructor(issues: readonly ConfigIssue[]) {
    const shown = issues.slice(0, 5).map((i) => `${toPointer(i.path) || '/'}: ${i.message}`)
    const more = issues.length > shown.length ? ` (and ${issues.length - shown.length} more)` : ''
    super(`Invalid machine config: ${shown.join('; ')}${more}`)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

interface ZodIssueLike {
  readonly code?: string
  readonly path: PropertyKey[]
  readonly message: string
  /** Set on `invalid_key`: why the key itself was rejected. */
  readonly issues?: readonly { readonly message: string }[]
}

function toConfigIssue(zodIssue: ZodIssueLike): ConfigIssue {
  const path = zodIssue.path.map((key) => (typeof key === 'number' ? key : String(key)))
  const reason = zodIssue.code === 'invalid_key' ? zodIssue.issues?.[0]?.message : undefined
  return issue(path, reason === undefined ? zodIssue.message : `invalid key: ${reason}`)
}

function checkRules(cfg: MachineConfigInput, add: Add): void {
  const partition = partitionIssues(cfg.rules)
  for (const { path, message } of partition) add(['rules', ...path], message)
  if (partition.length === 0) {
    for (const { path, message } of variantIssues(cfg.variant, cfg.rules)) {
      add(['rules', ...path], message)
    }
  }
  if (cfg.variant === 'crapless' && cfg.rules.dontBar !== null) {
    add(['rules', 'dontBar'], "crapless craps offers no don't bets, so nothing is barred: use null")
  }
  if (cfg.variant === 'traditional' && cfg.rules.dontBar === null) {
    add(['rules', 'dontBar'], 'traditional craps bars 12 (or 2 under Reno rules)')
  }
}

function checkMoney(cfg: MachineConfigInput, add: Add): void {
  const { limits, money } = cfg
  const step = money.betIncrement
  const multiple = (path: Path, amount: number, by: number) => {
    if (amount % by !== 0) add(path, `must be a multiple of ${formatCents(cents(by))}`)
  }
  if (limits.min > limits.max) add(['limits', 'min'], 'the minimum bet is above the maximum')
  multiple(['limits', 'min'], limits.min, step)
  multiple(['limits', 'max'], limits.max, step)
  if (limits.tableMax !== undefined && limits.tableMax < limits.max) {
    add(['limits', 'tableMax'], 'the table maximum is below the maximum for one bet')
  }
  for (const [typeId, own] of Object.entries(limits.perType ?? {})) {
    const at = ['limits', 'perType', typeId]
    if (!Object.hasOwn(cfg.catalog, typeId) && !Object.hasOwn(cfg.sideBets, typeId)) {
      add(at, `"${typeId}" is not a bet type or side bet in this config`)
    }
    // Only what this type sets is checked here, and reported at the field it sets; the
    // config-wide limits were checked above.
    const min = own.min ?? limits.min
    if ((own.min !== undefined || own.max !== undefined) && min > (own.max ?? limits.max)) {
      add([...at, own.min === undefined ? 'max' : 'min'], 'the minimum is above the maximum')
    }
    if (own.min !== undefined || own.increment !== undefined) {
      multiple([...at, own.min === undefined ? 'increment' : 'min'], min, own.increment ?? step)
    }
  }
  cfg.chips.forEach((chip, index) => {
    multiple(['chips', index], chip, step)
    const previous = cfg.chips[index - 1]
    if (previous !== undefined && chip <= previous) {
      add(['chips', index], 'chips must be listed from smallest to largest, once each')
    }
  })
}

function checkCatalog(cfg: MachineConfigInput, add: Add): void {
  const lineSlots = new Map<string, string>()
  const oddsParents = new Map<string, string>()
  for (const [typeId, type] of Object.entries(cfg.catalog)) {
    const at = ['catalog', typeId]
    switch (type.family) {
      case 'line':
        checkLine(cfg, type, at, lineSlots, typeId, add)
        break
      case 'odds':
        checkOdds(cfg, type, at, oddsParents, typeId, add)
        break
      case 'numberVsSeven':
        checkNumberBet(cfg, type, at, add)
        break
      case 'hardway':
        checkNumbers(type.numbers, [4, 6, 8, 10], 'hardway', [...at, 'numbers'], add)
        checkPays(type.numbers, type.pays, type.label, [...at, 'pays'], add)
        break
      case 'oneRoll':
        checkOneRoll(type, at, add)
        break
    }
  }
}

function checkLine(
  cfg: MachineConfigInput,
  type: LineTypeConfig,
  at: Path,
  slots: Map<string, string>,
  typeId: string,
  add: Add,
): void {
  const slot = `${type.side} ${type.window}`
  const taken = slots.get(slot)
  if (taken !== undefined) {
    add(
      [...at, 'side'],
      `${taken} is already the ${type.side} bet placed in the ${type.window} phase`,
    )
  }
  slots.set(slot, typeId)
  const dont = type.side === 'dont'
  if (dont && cfg.variant === 'crapless') {
    add(at, "crapless craps has no don't bets: with nothing barred they would beat the house")
  }
  for (const key of ['onNumber', 'rebetAfterRemove'] as const) {
    if (dont && type[key] === undefined) {
      add([...at, key], "a don't bet must say how it may change once it is on a number")
    } else if (!dont && type[key] !== undefined) {
      add([...at, key], 'pass and come bets are locked once on a number; leave this out')
    }
  }
  if (type.afterWin === 'stayIfFirstRoll' && !dont) {
    add([...at, 'afterWin'], "stayIfFirstRoll applies to don't bets; use stay or return")
  }
  if (type.afterWin === 'stayIf11' && (dont || type.window !== 'point')) {
    add(
      [...at, 'afterWin'],
      'stayIf11 applies to come bets, which can win on 11 on their first roll',
    )
  }
}

function checkOdds(
  cfg: MachineConfigInput,
  type: OddsTypeConfig,
  at: Path,
  parents: Map<string, string>,
  typeId: string,
  add: Add,
): void {
  const parent = Object.hasOwn(cfg.catalog, type.parent) ? cfg.catalog[type.parent] : undefined
  if (parent === undefined) {
    add([...at, 'parent'], `"${type.parent}" is not a bet type in the catalog`)
  } else if (parent.family !== 'line') {
    add([...at, 'parent'], "odds back a line bet: pass, come, don't pass or don't come")
  } else {
    const facesComeOut = parent.window === 'point'
    if (facesComeOut && type.comeOutDefault === undefined) {
      add([...at, 'comeOutDefault'], "odds on a come or don't come bet need a come-out default")
    } else if (!facesComeOut && type.comeOutDefault !== undefined) {
      add([...at, 'comeOutDefault'], 'pass-line odds never face a come-out roll; leave this out')
    }
  }
  const other = parents.get(type.parent)
  if (other !== undefined) add([...at, 'parent'], `${type.parent} already has odds: ${other}`)
  parents.set(type.parent, typeId)
  const points = COME_OUT_RULES[cfg.variant].points
  checkPays(points, type.pays, type.label, [...at, 'pays'], add)
  checkKeys(
    points,
    type.limit.multiple,
    [...at, 'limit', 'multiple'],
    add,
    (n) => `odds on ${n} need a limit`,
  )
}

function checkNumberBet(cfg: MachineConfigInput, type: NumberTypeConfig, at: Path, add: Add): void {
  const allowed = type.kind === 'big' ? [6, 8] : COME_OUT_RULES[cfg.variant].points
  const what = type.kind === 'big' ? 'big bet number (6 or 8)' : `${cfg.variant} point`
  checkNumbers(type.numbers, allowed, what, [...at, 'numbers'], add)
  checkPays(type.numbers, type.pays, type.label, [...at, 'pays'], add)
  const charged = type.kind === 'buy' || type.kind === 'lay'
  if (charged && type.commission === undefined) {
    add([...at, 'commission'], `${type.kind} bets must carry a commission`)
  }
  if (!charged) {
    for (const key of ['commission', 'commissionByNumber'] as const) {
      if (type[key] !== undefined) add([...at, key], 'only buy and lay bets carry a commission')
    }
  }
  if (type.commission !== undefined) checkCommission(type.commission, [...at, 'commission'], add)
  for (const [key, commission] of Object.entries(type.commissionByNumber ?? {})) {
    const path = [...at, 'commissionByNumber', key]
    if (!type.numbers.some((n) => String(n) === key)) {
      add(path, `${key} is not one of this bet's numbers`)
    }
    checkCommission(commission, path, add)
  }
}

function checkCommission(commission: CommissionInput, at: Path, add: Add): void {
  if (commission.timing !== 'onWin') return
  if (commission.refundOnTakeDown) {
    add(
      [...at, 'refundOnTakeDown'],
      'commission taken from a win is never paid up front, so nothing can be refunded',
    )
  }
  if (commission.rearm !== 'none') {
    add([...at, 'rearm'], 'commission taken from each win is not re-collected; use none')
  }
}

const TOTAL_KEYS = new Set(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
const DICE_KEY = /^([1-6])-([1-6])$/

function checkOneRoll(type: OneRollTypeConfig, at: Path, add: Add): void {
  const keys = Object.keys(type.pays)
  if (keys.length === 0) add([...at, 'pays'], 'a one-roll bet needs at least one winning outcome')
  for (const key of keys) {
    const dice = DICE_KEY.exec(key)
    if (type.match === 'total' && !TOTAL_KEYS.has(key)) {
      add([...at, 'pays', key], 'must be a total from "2" to "12"')
    } else if (type.match === 'dice' && dice === null) {
      add([...at, 'pays', key], 'must be a dice pair such as "2-5" or "3-3"')
    } else if (dice !== null && Number(dice[1]) > Number(dice[2])) {
      add([...at, 'pays', key], `write the low face first: "${dice[2]}-${dice[1]}"`)
    }
  }
}

/** Each number must be allowed and listed once. */
function checkNumbers(
  numbers: readonly number[],
  allowed: readonly number[],
  what: string,
  at: Path,
  add: Add,
): void {
  numbers.forEach((n, index) => {
    if (!allowed.includes(n)) {
      add([...at, index], `${n} is not a ${what}`)
    } else if (numbers.indexOf(n) !== index) {
      add([...at, index], `${n} is listed twice`)
    }
  })
}

/** Every offered number needs a pay ratio, and the table must not pay numbers that are not offered. */
function checkPays(
  numbers: readonly number[],
  pays: Readonly<Partial<Record<string, string>>>,
  label: string,
  at: Path,
  add: Add,
): void {
  checkKeys(numbers, pays, at, add, (n) => `${label} ${n} is offered but has no pay ratio`)
}

function checkKeys(
  numbers: readonly number[],
  record: Readonly<Partial<Record<string, unknown>>>,
  at: Path,
  add: Add,
  missing: (n: number) => string,
): void {
  for (const n of numbers) {
    if (!Object.hasOwn(record, String(n))) add([...at, String(n)], missing(n))
  }
  for (const key of Object.keys(record)) {
    if (!numbers.some((n) => String(n) === key)) add([...at, key], `${key} is not offered here`)
  }
}

function checkComposites(cfg: MachineConfigInput, add: Add): void {
  for (const [id, composite] of Object.entries(cfg.composites)) {
    if (Object.hasOwn(cfg.catalog, id) || Object.hasOwn(cfg.sideBets, id)) {
      add(['composites', id], `"${id}" is already the id of a bet type`)
    }
    composite.parts.forEach(({ typeId }, index) => {
      const at = ['composites', id, 'parts', index, 'typeId']
      const part = Object.hasOwn(cfg.catalog, typeId) ? cfg.catalog[typeId] : undefined
      if (part === undefined) {
        add(at, `"${typeId}" is not a bet type in the catalog`)
      } else if (part.family !== 'oneRoll') {
        add(at, `a composite combines one-roll bets; ${typeId} is not one`)
      } else if (composite.parts.findIndex((p) => p.typeId === typeId) !== index) {
        add(at, `${typeId} is already a part; raise its units instead`)
      }
    })
  }
}

function checkSideBets(cfg: MachineConfigInput, add: Add): void {
  const points = COME_OUT_RULES[cfg.variant].points
  for (const [id, bet] of Object.entries(cfg.sideBets)) {
    const at = ['sideBets', id]
    if (Object.hasOwn(cfg.catalog, id)) add(at, `"${id}" is already the id of a bet type`)
    switch (bet.family) {
      case 'collectSet':
        bet.targets.forEach((total, index) => {
          if (total === 7) {
            add([...at, 'targets', index], '7 ends the bet, so it cannot be a target')
          } else if (bet.targets.indexOf(total) !== index) {
            add([...at, 'targets', index], `${total} is listed twice`)
          }
        })
        break
      case 'uniquePointsMade':
        checkUniquePoints(bet, points, at, add)
        break
      case 'handLength':
        checkHandLength(bet, at, add)
        break
      case 'pointRun':
        checkPointRun(cfg, bet, at, add)
        break
    }
  }
}

function checkUniquePoints(
  bet: UniquePointsConfig,
  points: readonly number[],
  at: Path,
  add: Add,
): void {
  const counted = bet.countedPoints.length
  if (counted === 0) add([...at, 'countedPoints'], 'list the points that count')
  checkNumbers(bet.countedPoints, points, 'point in this game', [...at, 'countedPoints'], add)
  checkCountTable(bet.payTable, counted, 'unique points', [...at, 'payTable'], add)
  if (bet.payImmediatelyAt !== null) {
    if (bet.payImmediatelyAt > counted) {
      add([...at, 'payImmediatelyAt'], `only ${counted} points count`)
    } else if (!Object.hasOwn(bet.payTable, String(bet.payImmediatelyAt))) {
      add([...at, 'payImmediatelyAt'], 'the pay table has no pay for this count')
    }
  }
}

function checkHandLength(bet: HandLengthConfig, at: Path, add: Add): void {
  if (bet.tiers.length === 0) add([...at, 'tiers'], 'the pay table is empty')
  bet.tiers.forEach((tier, index) => {
    const previous = bet.tiers[index - 1]
    if (previous !== undefined && tier.minRolls <= previous.minRolls) {
      add([...at, 'tiers', index, 'minRolls'], 'tiers must go up in rolls')
    }
  })
}

function checkPointRun(cfg: MachineConfigInput, bet: PointRunConfig, at: Path, add: Add): void {
  if (cfg.variant !== 'traditional') {
    add(at, 'Lucky Shooter is defined for traditional craps only (points 4 to 10)')
    return
  }
  const others = bet.points.length - 1
  if (others < 1) add([...at, 'points'], 'list the box numbers the bet tracks')
  checkNumbers(bet.points, COME_OUT_RULES.traditional.points, 'box number', [...at, 'points'], add)
  checkCountTable(bet.payTable, others, 'hits', [...at, 'payTable'], add)
}

/** A pay table keyed by a count: non-empty, and every count must be reachable. */
function checkCountTable(
  table: Readonly<Record<string, string>>,
  most: number,
  what: string,
  at: Path,
  add: Add,
): void {
  if (Object.keys(table).length === 0) add(at, 'the pay table is empty')
  for (const key of Object.keys(table)) {
    if (!/^[1-9]\d*$/.test(key)) {
      add([...at, key], `must be a whole number of ${what}`)
    } else if (Number(key) > most) {
      add([...at, key], `${key} ${what} cannot happen; at most ${most}`)
    }
  }
}

/** Lists of type ids elsewhere in the config must name offered bets, once each. */
function checkTypeReferences(cfg: MachineConfigInput, add: Add): void {
  const check = (types: readonly string[], at: Path) => {
    types.forEach((typeId, index) => {
      if (!Object.hasOwn(cfg.catalog, typeId)) {
        add([...at, index], `"${typeId}" is not a bet type in the catalog`)
      } else if (types.indexOf(typeId) !== index) {
        add([...at, index], `${typeId} is listed twice`)
      }
    })
  }
  check(cfg.workingToggle.types, ['workingToggle', 'types'])
  const autoOff = cfg.comeOut.autoOff
  if (autoOff !== null) {
    check(autoOff.carried, ['comeOut', 'autoOff', 'carried'])
    check(autoOff.newlyPlaced, ['comeOut', 'autoOff', 'newlyPlaced'])
  }
  const newPlacedOff = cfg.afterSevenOut.newPlacedOff
  if (newPlacedOff !== null) check(newPlacedOff.types, ['afterSevenOut', 'newPlacedOff', 'types'])
  cfg.exclusiveGroups.forEach((group, index) => {
    check(group.types, ['exclusiveGroups', index, 'types'])
  })
}

// ---------------------------------------------------------------------------------------------
// Compiled config
// ---------------------------------------------------------------------------------------------

/** Commission in engine form (plan §4.7). */
export interface CommissionRule {
  readonly rate: Fraction
  readonly basis: 'stake' | 'win'
  readonly timing: 'upfront' | 'onWin'
  readonly rounding: Rounding
  readonly minimum: Cents
  readonly refundOnTakeDown: boolean
  readonly rearm: 'recollectFromWin' | 'recollectFromCredit' | 'none'
}

interface TypeBase {
  readonly typeId: string
  readonly label: string
  /** The type's own rounding, or the config's default. */
  readonly payoutRounding: Rounding
}

export interface LineBetType extends TypeBase {
  readonly family: 'line'
  readonly side: LineTypeConfig['side']
  readonly window: LineTypeConfig['window']
  readonly pays: Ratio
  readonly afterWin: LineTypeConfig['afterWin']
  /** Pass and come bets are always `locked` and `allowed`. */
  readonly onNumber: 'locked' | 'reduceRemove'
  readonly rebetAfterRemove: 'allowed' | 'nextCycle'
}

export interface OddsBetType extends TypeBase {
  readonly family: 'odds'
  readonly parent: string
  readonly pays: ReadonlyMap<PointNumber, Ratio>
  readonly limit: {
    readonly basis: 'stake' | 'win'
    readonly multiple: ReadonlyMap<PointNumber, number>
  }
  /** Null for pass-line odds, which never face a come-out roll. */
  readonly comeOutDefault: 'on' | 'off' | null
}

export interface NumberBetType extends TypeBase {
  readonly family: 'numberVsSeven'
  readonly kind: NumberTypeConfig['kind']
  readonly numbers: readonly PointNumber[]
  readonly pays: ReadonlyMap<PointNumber, Ratio>
  /** The commission on each number, overrides applied; null for place, big and place to lose. */
  readonly commission: ReadonlyMap<PointNumber, CommissionRule> | null
  readonly afterWin: 'stay' | 'return'
  readonly comeOutDefault: 'on' | 'off'
}

export interface HardwayBetType extends TypeBase {
  readonly family: 'hardway'
  readonly numbers: readonly HardNumber[]
  readonly pays: ReadonlyMap<HardNumber, Ratio>
  readonly afterWin: 'stay' | 'return'
  readonly comeOutDefault: 'on' | 'off'
}

export interface OneRollBetType extends TypeBase {
  readonly family: 'oneRoll'
  readonly match: 'total' | 'dice'
  /** Winning outcomes: totals ("2"–"12") or dice pairs, low face first ("2-5"). */
  readonly pays: ReadonlyMap<string, Ratio>
  readonly afterWin: 'stay' | 'return'
}

export type CompiledBetType =
  LineBetType | OddsBetType | NumberBetType | HardwayBetType | OneRollBetType

export interface CollectSetBetType {
  readonly family: 'collectSet'
  readonly typeId: string
  readonly label: string
  readonly targets: readonly Total[]
  readonly pays: Ratio
  readonly endsOn: 'anySeven' | 'sevenOut'
  readonly placement: 'afterSevenOrStart' | 'noneOfTypeActive' | 'newHand'
}

export interface UniquePointsBetType {
  readonly family: 'uniquePointsMade'
  readonly typeId: string
  readonly label: string
  readonly countedPoints: readonly PointNumber[]
  readonly payTable: ReadonlyMap<number, Ratio>
  readonly payImmediatelyAt: number | null
  readonly placement: 'newHand'
}

export interface HandLengthBetType {
  readonly family: 'handLength'
  readonly typeId: string
  readonly label: string
  readonly countDefinition: HandLengthConfig['countDefinition']
  readonly tiers: readonly { readonly minRolls: number; readonly pays: Ratio | 'push' }[]
  readonly placement: HandLengthConfig['placement']
  readonly qualifyingBet: Cents
}

export interface PointRunBetType {
  readonly family: 'pointRun'
  readonly typeId: string
  readonly label: string
  readonly points: readonly PointNumber[]
  readonly payTable: ReadonlyMap<number, Ratio>
  readonly topAward: Ratio
  readonly repeatEndsBet: boolean
  readonly placement: PointRunConfig['placement']
  readonly removableBeforePoint: boolean
}

export type CompiledSideBet =
  CollectSetBetType | UniquePointsBetType | HandLengthBetType | PointRunBetType

export interface CompositeBet {
  readonly id: string
  readonly label: string
  readonly parts: readonly { readonly typeId: string; readonly units: number }[]
}

/** Per-type limits with the config defaults filled in. */
export interface TypeLimits {
  readonly min: Cents
  readonly max: Cents
  readonly increment: Cents
}

/**
 * A validated machine config in engine form: ratios parsed, money branded, the ruleset built and
 * every type indexed by id. Configs are compared and cached by `configHash`.
 */
export interface MachineConfig {
  /** The validated input, frozen. */
  readonly input: MachineConfigInput
  readonly id: string
  readonly name: string
  /** Hash of the input without `name` and `provenance`, so a note edit keeps caches valid. */
  readonly configHash: string
  readonly ruleset: Ruleset
  readonly payoutRounding: Rounding
  readonly startingBankroll: Cents
  readonly betIncrement: Cents
  readonly limits: {
    readonly min: Cents
    readonly max: Cents
    readonly tableMax: Cents | null
    /** Limits for every bet type and side bet, defaults applied. */
    readonly byType: ReadonlyMap<string, TypeLimits>
    readonly minTotal: MachineConfigInput['limits']['minTotal']
  }
  readonly chips: readonly Cents[]
  readonly catalog: ReadonlyMap<string, CompiledBetType>
  /** Odds type id for each line type that has odds. */
  readonly oddsFor: ReadonlyMap<string, string>
  readonly composites: ReadonlyMap<string, CompositeBet>
  readonly sideBets: ReadonlyMap<string, CompiledSideBet>
  readonly working: {
    readonly toggle: MachineConfigInput['workingToggle']
    readonly comeOutAutoOff: MachineConfigInput['comeOut']['autoOff']
    readonly afterSevenOut: MachineConfigInput['afterSevenOut']['newPlacedOff']
    readonly layAutoOn: MachineConfigInput['layAutoOn']
    readonly oddsOffReturnedAtPointMade: boolean
    readonly offBetsConsumeCredit: boolean
  }
  readonly exclusiveGroups: MachineConfigInput['exclusiveGroups']
  readonly excludeLineVsLayBuy: boolean
  readonly payLabelStyle: MachineConfigInput['payLabelStyle']
  readonly flow: MachineConfigInput['flow']
  readonly pace: MachineConfigInput['pace']
  readonly provenance: Provenance
}

/**
 * The hash that identifies a config's rules: canonical JSON of the input without `name` and
 * `provenance`, so key order, renaming and provenance edits leave it unchanged.
 */
export function configHashOf(input: MachineConfigInput): string {
  return hashJson({ ...input, name: undefined, provenance: undefined })
}

const memo = new WeakMap<object, MachineConfig>()

/**
 * Validates `input` and builds its engine form, or throws a `ConfigError` listing every problem.
 * Results are memoized by input object, so treat inputs as immutable (presets are frozen).
 */
export function compileConfig(input: unknown): MachineConfig {
  const key = typeof input === 'object' && input !== null ? input : null
  const cached = key === null ? undefined : memo.get(key)
  if (cached !== undefined) return cached
  const result = MachineConfigSchema.safeParse(input)
  if (!result.success) throw new ConfigError(result.error.issues.map(toConfigIssue))
  const compiled = build(deepFreeze(result.data))
  if (key !== null) memo.set(key, compiled)
  return compiled
}

/** Freezes a plain JSON value and everything inside it; returns it for chaining. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

function build(input: MachineConfigInput): MachineConfig {
  const payoutRounding = rounding(input.money.payoutRounding)
  const catalog = new Map<string, CompiledBetType>()
  const oddsFor = new Map<string, string>()
  for (const [typeId, type] of Object.entries(input.catalog)) {
    catalog.set(typeId, compileBetType(typeId, type, payoutRounding))
    if (type.family === 'odds') oddsFor.set(type.parent, typeId)
  }
  const sideBets = new Map<string, CompiledSideBet>()
  for (const [typeId, bet] of Object.entries(input.sideBets)) {
    sideBets.set(typeId, compileSideBet(typeId, bet))
  }
  const composites = new Map<string, CompositeBet>()
  for (const [id, { label, parts }] of Object.entries(input.composites)) {
    composites.set(id, Object.freeze({ id, label, parts }))
  }
  const { limits, money } = input
  const byType = new Map<string, TypeLimits>()
  for (const typeId of [...catalog.keys(), ...sideBets.keys()]) {
    const own = limits.perType?.[typeId]
    byType.set(
      typeId,
      Object.freeze({
        min: cents(own?.min ?? limits.min),
        max: cents(own?.max ?? limits.max),
        increment: cents(own?.increment ?? money.betIncrement),
      }),
    )
  }
  return Object.freeze({
    input,
    id: input.id,
    name: input.name,
    configHash: configHashOf(input),
    ruleset: makeRuleset(input.variant, input.rules.dontBar),
    payoutRounding,
    startingBankroll: cents(money.startingBankroll),
    betIncrement: cents(money.betIncrement),
    limits: Object.freeze({
      min: cents(limits.min),
      max: cents(limits.max),
      tableMax: limits.tableMax === undefined ? null : cents(limits.tableMax),
      byType,
      minTotal: limits.minTotal,
    }),
    chips: Object.freeze(input.chips.map(cents)),
    catalog,
    oddsFor,
    composites,
    sideBets,
    working: Object.freeze({
      toggle: input.workingToggle,
      comeOutAutoOff: input.comeOut.autoOff,
      afterSevenOut: input.afterSevenOut.newPlacedOff,
      layAutoOn: input.layAutoOn,
      oddsOffReturnedAtPointMade: input.oddsOffReturnedAtPointMade,
      offBetsConsumeCredit: input.offBets.consumeCredit,
    }),
    exclusiveGroups: input.exclusiveGroups,
    excludeLineVsLayBuy: input.excludeLineVsLayBuy,
    payLabelStyle: input.payLabelStyle,
    flow: input.flow,
    pace: input.pace,
    provenance: input.provenance,
  })
}

function rounding(rule: RoundingRule): Rounding {
  return Object.freeze({ mode: rule.mode, increment: cents(rule.increment) })
}

function ratio(text: string): Ratio {
  return Object.freeze(parseRatio(text))
}

/** The entry for `key`, which validation guarantees is there. */
function required<T>(record: Readonly<Partial<Record<string, T>>>, key: string | number): T {
  const value = record[String(key)]
  if (value === undefined) throw new Error(`Validated config is missing ${String(key)}`)
  return value
}

function payMap<N extends number>(
  numbers: readonly N[],
  pays: Readonly<Partial<Record<string, string>>>,
): ReadonlyMap<N, Ratio> {
  return new Map(numbers.map((n) => [n, ratio(required(pays, n))]))
}

function compileCommission(input: CommissionInput): CommissionRule {
  const rate = parseRatio(input.rate)
  return Object.freeze({
    rate: Fraction.of(rate.num, rate.den),
    basis: input.basis,
    timing: input.timing,
    rounding: rounding(input.rounding),
    minimum: cents(input.minimum),
    refundOnTakeDown: input.refundOnTakeDown,
    rearm: input.rearm,
  })
}

function compileBetType(
  typeId: string,
  type: BetTypeConfig,
  defaultRounding: Rounding,
): CompiledBetType {
  const base = {
    typeId,
    label: type.label,
    payoutRounding:
      type.payoutRounding === undefined ? defaultRounding : rounding(type.payoutRounding),
  }
  switch (type.family) {
    case 'line':
      return Object.freeze({
        ...base,
        family: type.family,
        side: type.side,
        window: type.window,
        pays: ratio(type.pays),
        afterWin: type.afterWin,
        onNumber: type.onNumber ?? 'locked',
        rebetAfterRemove: type.rebetAfterRemove ?? 'allowed',
      })
    case 'odds': {
      const points = Object.keys(type.pays).map(Number) as PointNumber[]
      return Object.freeze({
        ...base,
        family: type.family,
        parent: type.parent,
        pays: payMap(points, type.pays),
        limit: Object.freeze({
          basis: type.limit.basis,
          multiple: new Map(points.map((n) => [n, required(type.limit.multiple, n)])),
        }),
        comeOutDefault: type.comeOutDefault ?? null,
      })
    }
    case 'numberVsSeven':
      return compileNumberBet(type, base)
    case 'hardway':
      return Object.freeze({
        ...base,
        family: type.family,
        numbers: Object.freeze([...type.numbers]),
        pays: payMap(type.numbers, type.pays),
        afterWin: type.afterWin,
        comeOutDefault: type.comeOutDefault,
      })
    case 'oneRoll':
      return Object.freeze({
        ...base,
        family: type.family,
        match: type.match,
        pays: new Map(Object.entries(type.pays).map(([key, pays]) => [key, ratio(pays)])),
        afterWin: type.afterWin,
      })
  }
}

function compileNumberBet(type: NumberTypeConfig, base: TypeBase): NumberBetType {
  const fallback = type.commission === undefined ? null : compileCommission(type.commission)
  let commission: Map<PointNumber, CommissionRule> | null = null
  if (fallback !== null) {
    commission = new Map()
    for (const n of type.numbers) {
      const own = type.commissionByNumber?.[String(n) as PointKey]
      commission.set(n, own === undefined ? fallback : compileCommission(own))
    }
  }
  return Object.freeze({
    ...base,
    family: type.family,
    kind: type.kind,
    numbers: Object.freeze([...type.numbers]),
    pays: payMap(type.numbers, type.pays),
    commission,
    afterWin: type.afterWin,
    comeOutDefault: type.comeOutDefault,
  })
}

function countTable(table: Readonly<Record<string, string>>): ReadonlyMap<number, Ratio> {
  return new Map(
    Object.entries(table)
      .map(([count, pays]): [number, Ratio] => [Number(count), ratio(pays)])
      .sort(([a], [b]) => a - b),
  )
}

function compileSideBet(typeId: string, bet: SideBetConfig): CompiledSideBet {
  const base = { typeId, label: bet.label }
  switch (bet.family) {
    case 'collectSet':
      return Object.freeze({
        ...base,
        family: bet.family,
        targets: Object.freeze([...bet.targets].sort((a, b) => a - b)),
        pays: ratio(bet.pays),
        endsOn: bet.endsOn,
        placement: bet.placement,
      })
    case 'uniquePointsMade':
      return Object.freeze({
        ...base,
        family: bet.family,
        countedPoints: Object.freeze([...bet.countedPoints].sort((a, b) => a - b)),
        payTable: countTable(bet.payTable),
        payImmediatelyAt: bet.payImmediatelyAt,
        placement: bet.placement,
      })
    case 'handLength':
      return Object.freeze({
        ...base,
        family: bet.family,
        countDefinition: bet.countDefinition,
        tiers: Object.freeze(
          bet.tiers.map((tier) =>
            Object.freeze({
              minRolls: tier.minRolls,
              pays: tier.pays === 'push' ? ('push' as const) : ratio(tier.pays),
            }),
          ),
        ),
        placement: bet.placement,
        qualifyingBet: cents(bet.qualifyingBet),
      })
    case 'pointRun':
      return Object.freeze({
        ...base,
        family: bet.family,
        points: Object.freeze([...bet.points].sort((a, b) => a - b)),
        payTable: countTable(bet.payTable),
        topAward: ratio(bet.topAward),
        repeatEndsBet: bet.repeatEndsBet,
        placement: bet.placement,
        removableBeforePoint: bet.removableBeforePoint,
      })
  }
}
