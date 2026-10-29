/**
 * Machine facts for the reference oracle: what the oracle needs to know about a machine, read
 * straight from the plain `MachineConfigInput` JSON (rules spec §5.1) with this file's own ratio
 * parser and defaults.
 *
 * Independence (plan §0 amendment 17): this file, `referenceRules.ts` and `referenceTable.ts` are
 * written from docs/rules/rules-spec.md alone, with their own rule constants, ratio parsing and
 * BigInt rounding. They never use the compiled config (`compileConfig` carries the engine's
 * rulesets) or any engine rule code. Their only runtime imports from `src/` are `Fraction` and the
 * dice primitives in `src/engine/core`; the config schema is imported for its types only, because
 * schema.ts loads the engine's rulesets at runtime. Shared rule code cannot catch its own bugs.
 */
import type {
  CommissionInput,
  MachineConfigInput,
  RoundingRule,
} from '../../src/engine/config/schema.ts'
import { Fraction } from '../../src/engine/core/rational.ts'

export type Variant = 'crapless' | 'traditional'
export type OnOff = 'on' | 'off'

/** How an exact amount in cents becomes payable money (rules spec §4.2). */
export interface RefRounding {
  readonly mode: 'floor' | 'ceil' | 'halfUp' | 'halfEven'
  /** The step in cents: 1 is to the penny, 100 to the dollar. */
  readonly increment: number
}

/**
 * The come-out partition of each variant (rules spec §2.1), written out here rather than read
 * from the config, so a config that disagrees with the spec is caught instead of trusted.
 */
export const COME_OUT_RULES: Readonly<
  Record<
    Variant,
    {
      readonly naturals: readonly number[]
      readonly craps: readonly number[]
      readonly points: readonly number[]
    }
  >
> = {
  traditional: { naturals: [7, 11], craps: [2, 3, 12], points: [4, 5, 6, 8, 9, 10] },
  crapless: { naturals: [7], craps: [], points: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] },
}

/** Hardway numbers (rules spec §3.3). */
const HARD_NUMBERS: readonly number[] = [4, 6, 8, 10]

const RATIO_TEXT = /^\s*(\d+)\s*(:|to|for)\s*(\d+)\s*$/

/**
 * A pay ratio or a rate as an exact net amount per unit staked (rules spec §0.1, §5.3).
 * - "a:b" and "a to b" win a per b staked: 7:6 and "7 to 6" are 7/6, and a rate "1:20" is 1/20.
 * - "a for b" returns a in total per b staked, the stake included, so it nets (a − b)/b:
 *   "31 for 1" is 30, "5 for 1" is 4.
 * A net of zero or less is not a ratio ("0:1", "1 for 1").
 */
export function parseNet(text: string): Fraction {
  const match = RATIO_TEXT.exec(text)
  if (match === null) throw new RangeError(`Not a ratio: "${text}"`)
  const a = BigInt(match[1] ?? '')
  const b = BigInt(match[3] ?? '')
  if (b === 0n) throw new RangeError(`A ratio cannot stake 0: "${text}"`)
  const net = match[2] === 'for' ? Fraction.of(a - b, b) : Fraction.of(a, b)
  if (net.num <= 0n) throw new RangeError(`A ratio must pay more than nothing: "${text}"`)
  return net
}

/** A commission rule with its rate parsed (rules spec §4.3; schema `CommissionInput`). */
export interface CommissionFacts {
  readonly rate: Fraction
  readonly basis: 'stake' | 'win'
  readonly timing: 'upfront' | 'onWin'
  readonly rounding: RefRounding
  /** The smallest charge, in cents (live: 100). */
  readonly minimum: number
  readonly refundOnTakeDown: boolean
  readonly rearm: 'recollectFromWin' | 'recollectFromCredit' | 'none'
}

/** Per-type stake limits in cents, with the machine defaults applied (rules spec §4.5, §5.1). */
export interface LimitFacts {
  readonly min: number
  readonly max: number
  readonly increment: number
  /**
   * `/limits/perType/<t>/incrementByNumber`: a stake increment for some numbers, replacing
   * `increment` there. The number is the bet's own (place 6, hard 8, a put on 9); for odds it is
   * the parent's point.
   */
  readonly incrementByNumber: ReadonlyMap<number, number>
}

interface TypeFactsBase {
  readonly id: string
  /** The type's own payout rounding, or the machine's `/money/payoutRounding` (rules spec §4.1). */
  readonly payoutRounding: RefRounding
  readonly limits: LimitFacts
}

export interface LineFacts extends TypeFactsBase {
  readonly family: 'line'
  readonly side: 'do' | 'dont'
  /** The phase a new bet is placed in: pass and don't pass on the come-out, come in the point. */
  readonly window: 'comeOut' | 'point'
  readonly pays: Fraction
  readonly afterWin: 'stay' | 'return' | 'stayIfFirstRoll' | 'stayIf11'
  /** Don't bets only: whether a bet on a number can be reduced or removed. */
  readonly onNumber: 'locked' | 'reduceRemove' | null
  /** Don't bets only: whether a bet removed from a number can be replaced before the next cycle. */
  readonly rebetAfterRemove: 'allowed' | 'nextCycle' | null
  /** The odds type behind this line type, if the machine offers one. */
  readonly oddsType: string | null
}

export interface OddsFacts extends TypeFactsBase {
  readonly family: 'odds'
  readonly parent: string
  readonly parentSide: 'do' | 'dont'
  readonly pays: ReadonlyMap<number, Fraction>
  readonly limitBasis: 'stake' | 'win'
  readonly limitMultiple: ReadonlyMap<number, number>
  /** Only odds on come and don't come bets face a come-out roll (rules spec §2.4). */
  readonly comeOutDefault: OnOff | null
}

export interface NumberFacts extends TypeFactsBase {
  readonly family: 'numberVsSeven'
  readonly kind: 'place' | 'buy' | 'big' | 'lay' | 'placeToLose'
  /** Place, buy and big win on the number; lay and place to lose win on 7 (rules spec §3.2). */
  readonly winsOn: 'number' | 'seven'
  readonly numbers: readonly number[]
  readonly pays: ReadonlyMap<number, Fraction>
  /**
   * The payout rounding on each offered number: `/catalog/<t>/payoutRoundingByNumber/<n>` where
   * given (Shoot To Win place: 6 and 8 up to the cent, the rest down), else `payoutRounding`.
   */
  readonly roundingByNumber: ReadonlyMap<number, RefRounding>
  /** The commission on each number, per-number overrides applied; absent when there is none. */
  readonly commission: ReadonlyMap<number, CommissionFacts>
  readonly afterWin: 'stay' | 'return'
  readonly comeOutDefault: OnOff
}

export interface HardwayFacts extends TypeFactsBase {
  readonly family: 'hardway'
  readonly numbers: readonly number[]
  readonly pays: ReadonlyMap<number, Fraction>
  readonly afterWin: 'stay' | 'return'
  readonly comeOutDefault: OnOff
}

export interface OneRollFacts extends TypeFactsBase {
  readonly family: 'oneRoll'
  /** Winning outcomes keyed by total ("7") or by dice, low face first ("2-5"). */
  readonly match: 'total' | 'dice'
  readonly pays: ReadonlyMap<string, Fraction>
  readonly afterWin: 'stay' | 'return'
}

/**
 * A composite (C&E, horn, horn high, world) settled as one bet (plan §0 amendment 15). Its net per
 * unit staked on each of the 21 unordered rolls is derived from its parts' pays:
 * Σ(units of the winning parts × (pay + 1)) ÷ total units − 1. Zero is a push, −1 a loss. Its
 * payout rounding and `afterWin` are its parts', which must agree (rules spec §5.3 #8).
 */
export interface CompositeFacts extends TypeFactsBase {
  readonly family: 'composite'
  readonly parts: readonly { readonly typeId: string; readonly units: number }[]
  readonly totalUnits: number
  /** Net per unit, keyed by dice low face first ("1-1" … "6-6"). */
  readonly netByDice: ReadonlyMap<string, Fraction>
  readonly afterWin: 'stay' | 'return'
}

export type TypeFacts =
  LineFacts | OddsFacts | NumberFacts | HardwayFacts | OneRollFacts | CompositeFacts

/** The working policy (rules spec §2.4, §5.1). */
export interface WorkingFacts {
  readonly toggle: {
    readonly global: boolean
    readonly perBet: boolean
    readonly scope: 'untilChanged' | 'nextRollOnly'
    readonly types: readonly string[]
  }
  /** Shoot To Win: types forced OFF on the come-out, by whether the chip was carried or is new. */
  readonly autoOff: {
    readonly carried: readonly string[]
    readonly newlyPlaced: readonly string[]
  } | null
  /** Interblock: types placed after the trigger 7 start OFF until the player sets bets On. */
  readonly newPlacedOff: {
    readonly types: readonly string[]
    readonly trigger: 'sevenOut' | 'anySeven'
    readonly until: 'playerOn' | 'pointEstablished'
  } | null
  /** Interblock: lay bets set OFF come back ON by themselves. */
  readonly layAutoOn: { readonly afterPointMade: boolean; readonly afterSeven: boolean } | null
  readonly oddsOffReturnedAtPointMade: boolean
  /** Recorded only: the reference table does not model credit held outside the bankroll. */
  readonly offBetsConsumeCredit: boolean
}

export interface MachineFacts {
  readonly id: string
  readonly variant: Variant
  readonly naturals: readonly number[]
  readonly craps: readonly number[]
  readonly points: readonly number[]
  readonly dontBar: 2 | 12 | null
  readonly allowPutBets: boolean
  readonly payoutRounding: RefRounding
  readonly betIncrement: number
  readonly startingBankroll: number
  /** Every offered bet type and composite, keyed by id. */
  readonly types: ReadonlyMap<string, TypeFacts>
  readonly tableMax: number | null
  readonly minTotal: {
    readonly amount: number
    readonly scope: 'totalRound' | 'perBet'
    readonly countOff: boolean
    readonly countSideBets: boolean
  } | null
  readonly working: WorkingFacts
  readonly exclusiveGroups: readonly {
    readonly types: readonly string[]
    readonly scope: 'global' | 'sameNumber'
  }[]
  readonly excludeLineVsLayBuy: boolean
}

/** The 21 unordered rolls, low face first. */
export const DICE_PAIRS: readonly (readonly [number, number])[] = [1, 2, 3, 4, 5, 6].flatMap((lo) =>
  [1, 2, 3, 4, 5, 6].filter((hi) => hi >= lo).map((hi) => [lo, hi] as const),
)

/** "2-5" for a roll of 5 and 2: the key one-roll bets and composites use for dice. */
export function diceKey(d1: number, d2: number): string {
  return d1 <= d2 ? `${d1}-${d2}` : `${d2}-${d1}`
}

/** The facts for one machine. Throws when the config contradicts the rules spec. */
export function factsFrom(input: MachineConfigInput): MachineFacts {
  const variant: Variant = input.variant
  const own = COME_OUT_RULES[variant]
  assertSameSet('/rules/naturals', input.rules.naturals, own.naturals)
  assertSameSet('/rules/craps', input.rules.craps, own.craps)
  assertSameSet('/rules/points', input.rules.points, own.points)
  const dontBar = input.rules.dontBar
  if (variant === 'crapless' ? dontBar !== null : dontBar !== 2 && dontBar !== 12) {
    throw new RangeError(`/rules/dontBar ${String(dontBar)} does not fit a ${variant} game`)
  }

  const payoutRounding = rounding(input.money.payoutRounding)
  const limitsOf = (id: string): LimitFacts => {
    const perType = input.limits.perType?.[id]
    const byNumber = new Map<number, number>()
    const increments = perType === undefined ? undefined : perNumber(perType, 'incrementByNumber')
    for (const [key, value] of Object.entries(increments ?? {})) {
      const at = `/limits/perType/${id}/incrementByNumber/${key}`
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${at} must be whole cents above 0`)
      }
      byNumber.set(numberKey(at, key), value)
    }
    return {
      min: perType?.min ?? input.limits.min,
      max: perType?.max ?? input.limits.max,
      increment: perType?.increment ?? input.money.betIncrement,
      incrementByNumber: byNumber,
    }
  }

  const catalog = Object.entries(input.catalog)
  const oddsByParent = new Map<string, string>()
  for (const [id, entry] of catalog) {
    if (entry.family !== 'odds') continue
    const parent = input.catalog[entry.parent]
    if (parent?.family !== 'line') throw new RangeError(`/catalog/${id}/parent is not a line type`)
    if (oddsByParent.has(entry.parent)) {
      throw new RangeError(`/catalog/${entry.parent} has two odds types`)
    }
    oddsByParent.set(entry.parent, id)
  }

  const types = new Map<string, TypeFacts>()
  for (const [id, entry] of catalog) {
    const base = {
      id,
      payoutRounding:
        entry.payoutRounding === undefined ? payoutRounding : rounding(entry.payoutRounding),
      limits: limitsOf(id),
    }
    switch (entry.family) {
      case 'line':
        types.set(id, {
          ...base,
          family: 'line',
          side: entry.side,
          window: entry.window,
          pays: parseNet(entry.pays),
          afterWin: entry.afterWin,
          onNumber: entry.onNumber ?? null,
          rebetAfterRemove: entry.rebetAfterRemove ?? null,
          oddsType: oddsByParent.get(id) ?? null,
        })
        break
      case 'odds': {
        const parent = input.catalog[entry.parent]
        if (parent?.family !== 'line') throw new RangeError(`/catalog/${id}/parent`)
        types.set(id, {
          ...base,
          family: 'odds',
          parent: entry.parent,
          parentSide: parent.side,
          pays: paysByNumber(`/catalog/${id}/pays`, entry.pays, own.points),
          limitBasis: entry.limit.basis,
          limitMultiple: multiplesByNumber(
            `/catalog/${id}/limit`,
            entry.limit.multiple,
            own.points,
          ),
          comeOutDefault: entry.comeOutDefault ?? null,
        })
        break
      }
      case 'numberVsSeven': {
        const numbers: number[] = [...entry.numbers]
        const allowed = entry.kind === 'big' ? [6, 8] : own.points
        for (const n of numbers) {
          if (!allowed.includes(n)) throw new RangeError(`/catalog/${id}/numbers: ${n}`)
        }
        const commission = new Map<number, CommissionFacts>()
        for (const n of numbers) {
          const rule = entry.commissionByNumber?.[pointKey(n)] ?? entry.commission
          if (rule !== undefined) commission.set(n, commissionFacts(rule))
        }
        const overrides = perNumber(entry, 'payoutRoundingByNumber') ?? {}
        for (const key of Object.keys(overrides)) {
          const at = `/catalog/${id}/payoutRoundingByNumber/${key}`
          if (!numbers.includes(numberKey(at, key))) throw new RangeError(`${at} is not offered`)
        }
        const roundingByNumber = new Map<number, RefRounding>()
        for (const n of numbers) {
          const override = overrides[String(n)]
          const at = `/catalog/${id}/payoutRoundingByNumber/${n}`
          roundingByNumber.set(
            n,
            override === undefined ? base.payoutRounding : roundingAt(at, override),
          )
        }
        types.set(id, {
          ...base,
          family: 'numberVsSeven',
          kind: entry.kind,
          winsOn: entry.kind === 'lay' || entry.kind === 'placeToLose' ? 'seven' : 'number',
          numbers,
          pays: paysByNumber(`/catalog/${id}/pays`, entry.pays, numbers),
          roundingByNumber,
          commission,
          afterWin: entry.afterWin,
          comeOutDefault: entry.comeOutDefault,
        })
        break
      }
      case 'hardway': {
        const numbers = [...entry.numbers]
        for (const n of numbers) {
          if (!HARD_NUMBERS.includes(n)) throw new RangeError(`/catalog/${id}/numbers: ${n}`)
        }
        types.set(id, {
          ...base,
          family: 'hardway',
          numbers,
          pays: paysByNumber(`/catalog/${id}/pays`, entry.pays, numbers),
          afterWin: entry.afterWin,
          comeOutDefault: entry.comeOutDefault,
        })
        break
      }
      case 'oneRoll': {
        const pays = new Map<string, Fraction>()
        for (const [key, text] of Object.entries(entry.pays)) {
          if (!validOutcome(entry.match, key)) throw new RangeError(`/catalog/${id}/pays/${key}`)
          pays.set(key, parseNet(text))
        }
        types.set(id, {
          ...base,
          family: 'oneRoll',
          match: entry.match,
          pays,
          afterWin: entry.afterWin,
        })
        break
      }
    }
  }

  for (const [id, composite] of Object.entries(input.composites)) {
    if (types.has(id)) throw new RangeError(`/composites/${id} reuses a bet type id`)
    const parts = composite.parts.map((part) => {
      const type = types.get(part.typeId)
      if (type?.family !== 'oneRoll') {
        throw new RangeError(`/composites/${id}: ${part.typeId} is not a one-roll bet`)
      }
      return { type, units: part.units }
    })
    const totalUnits = parts.reduce((sum, part) => sum + part.units, 0)
    // One bet, settled once (§0 amendment 15): the parts must share the rounding and afterWin
    // that settlement applies to the whole (rules spec §5.3 #8).
    const [first] = parts
    if (first === undefined) throw new RangeError(`/composites/${id} has no parts`)
    for (const { type } of parts) {
      const rule = type.payoutRounding
      if (rule.mode !== first.type.payoutRounding.mode) {
        throw new RangeError(`/composites/${id}: the parts round their payouts differently`)
      }
      if (rule.increment !== first.type.payoutRounding.increment) {
        throw new RangeError(`/composites/${id}: the parts round their payouts differently`)
      }
      if (type.afterWin !== first.type.afterWin) {
        throw new RangeError(`/composites/${id}: the parts disagree on afterWin`)
      }
    }
    const netByDice = new Map<string, Fraction>()
    for (const [lo, hi] of DICE_PAIRS) {
      let returned = Fraction.ZERO
      for (const { type, units } of parts) {
        const pay = oneRollPay(type, lo, hi)
        if (pay !== null) returned = returned.add(pay.add(Fraction.ONE).mul(Fraction.of(units)))
      }
      const net = returned.div(Fraction.of(totalUnits)).sub(Fraction.ONE)
      // Validation rejects a partial loss: the oracle has no rule for one (§0 amendment 15).
      if (net.compare(Fraction.ONE.neg()) > 0 && net.isNegative()) {
        throw new RangeError(`/composites/${id} loses part of the bet on ${lo}-${hi}`)
      }
      netByDice.set(`${lo}-${hi}`, net)
    }
    types.set(id, {
      id,
      family: 'composite',
      payoutRounding: first.type.payoutRounding,
      limits: limitsOf(id),
      parts: parts.map(({ type, units }) => ({ typeId: type.id, units })),
      totalUnits,
      netByDice,
      afterWin: first.type.afterWin,
    })
  }

  const newPlacedOff = input.afterSevenOut.newPlacedOff
  // `trigger` is a newer knob; a config written before it has the rules spec §9 #6 default.
  const trigger =
    (newPlacedOff as { readonly trigger?: 'sevenOut' | 'anySeven' } | null)?.trigger ?? 'sevenOut'

  return {
    id: input.id,
    variant,
    naturals: own.naturals,
    craps: own.craps,
    points: own.points,
    dontBar,
    allowPutBets: input.rules.allowPutBets,
    payoutRounding,
    betIncrement: input.money.betIncrement,
    startingBankroll: input.money.startingBankroll,
    types,
    tableMax: input.limits.tableMax ?? null,
    minTotal: input.limits.minTotal,
    working: {
      toggle: {
        global: input.workingToggle.global,
        perBet: input.workingToggle.perBet,
        scope: input.workingToggle.scope,
        types: [...input.workingToggle.types],
      },
      autoOff:
        input.comeOut.autoOff === null
          ? null
          : {
              carried: [...input.comeOut.autoOff.carried],
              newlyPlaced: [...input.comeOut.autoOff.newlyPlaced],
            },
      newPlacedOff:
        newPlacedOff === null
          ? null
          : { types: [...newPlacedOff.types], trigger, until: newPlacedOff.until },
      layAutoOn: input.layAutoOn,
      oddsOffReturnedAtPointMade: input.oddsOffReturnedAtPointMade,
      offBetsConsumeCredit: input.offBets.consumeCredit,
    },
    exclusiveGroups: input.exclusiveGroups.map((group) => ({
      types: [...group.types],
      scope: group.scope,
    })),
    excludeLineVsLayBuy: input.excludeLineVsLayBuy,
  }
}

/** The facts of one offered type or composite; throws for an id the machine does not offer. */
export function typeFacts(facts: MachineFacts, id: string): TypeFacts {
  const type = facts.types.get(id)
  if (type === undefined) throw new RangeError(`${facts.id} does not offer "${id}"`)
  return type
}

/** The net pay of a one-roll bet on this roll, or null when the roll loses it (rules spec §3.4). */
export function oneRollPay(type: OneRollFacts, d1: number, d2: number): Fraction | null {
  const key = type.match === 'total' ? String(d1 + d2) : diceKey(d1, d2)
  return type.pays.get(key) ?? null
}

/**
 * How a win of this type on `number` is rounded (rules spec §4.1): a number bet's per-number rule
 * where the machine gives one, else the type's own rule, else `/money/payoutRounding`.
 */
export function payoutRoundingOf(type: TypeFacts, number: number | null): RefRounding {
  if (type.family !== 'numberVsSeven' || number === null) return type.payoutRounding
  return type.roundingByNumber.get(number) ?? type.payoutRounding
}

/**
 * The stake increment of this type on `number`, in cents: `/limits/perType/<t>/incrementByNumber`
 * where it names the number, else the type's increment. `number` is the bet's own number, or the
 * parent's point for odds; null (a bet in its box, a one-roll bet) takes the type's increment.
 */
export function incrementOf(type: TypeFacts, number: number | null): number {
  if (number === null) return type.limits.increment
  return type.limits.incrementByNumber.get(number) ?? type.limits.increment
}

function rounding(rule: RoundingRule): RefRounding {
  if (!Number.isSafeInteger(rule.increment) || rule.increment < 1) {
    throw new RangeError(`A rounding increment must be whole cents, got ${rule.increment}`)
  }
  return { mode: rule.mode, increment: rule.increment }
}

const ROUNDING_MODES: readonly RefRounding['mode'][] = ['floor', 'ceil', 'halfUp', 'halfEven']

/** A rounding rule read from a per-number map, checked like the schema checks the others. */
function roundingAt(at: string, value: unknown): RefRounding {
  const rule = (typeof value === 'object' && value !== null ? value : {}) as {
    readonly mode?: unknown
    readonly increment?: unknown
  }
  const mode = ROUNDING_MODES.find((known) => known === rule.mode)
  if (mode === undefined || typeof rule.increment !== 'number') {
    throw new RangeError(`${at} is not a rounding rule`)
  }
  return rounding({ mode, increment: rule.increment })
}

/**
 * An optional per-number map on a config object (`payoutRoundingByNumber`,
 * `incrementByNumber`), read structurally so this file works with configs written with or
 * without these newer knobs.
 */
function perNumber(entry: object, key: string): Readonly<Record<string, unknown>> | undefined {
  const value: unknown = (entry as Readonly<Record<string, unknown>>)[key]
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError(`${key} must map numbers to values`)
  }
  return value as Readonly<Record<string, unknown>>
}

/** A point number written as a key ("2" … "12", never "7"). */
function numberKey(at: string, key: string): number {
  const n = Number(key)
  if (!/^(?:[2-9]|1[0-2])$/.test(key) || n === 7) throw new RangeError(`${at} is not a number`)
  return n
}

function commissionFacts(rule: CommissionInput): CommissionFacts {
  return {
    rate: parseNet(rule.rate),
    basis: rule.basis,
    timing: rule.timing,
    rounding: rounding(rule.rounding),
    minimum: rule.minimum,
    refundOnTakeDown: rule.refundOnTakeDown,
    rearm: rule.rearm,
  }
}

type PointKey = '2' | '3' | '4' | '5' | '6' | '8' | '9' | '10' | '11' | '12'

function pointKey(n: number): PointKey {
  return String(n) as PointKey
}

/** Pays for exactly `numbers`: a missing pay is an error, and so is a pay for another number. */
function paysByNumber(
  at: string,
  pays: Readonly<Partial<Record<string, string>>>,
  numbers: readonly number[],
): Map<number, Fraction> {
  const out = new Map<number, Fraction>()
  for (const n of numbers) {
    const text = pays[String(n)]
    if (text === undefined) throw new RangeError(`${at}/${n} is missing`)
    out.set(n, parseNet(text))
  }
  for (const key of Object.keys(pays)) {
    if (!numbers.includes(Number(key))) throw new RangeError(`${at}/${key} is not offered`)
  }
  return out
}

function multiplesByNumber(
  at: string,
  multiples: Readonly<Partial<Record<string, number>>>,
  numbers: readonly number[],
): Map<number, number> {
  const out = new Map<number, number>()
  for (const n of numbers) {
    const multiple = multiples[String(n)]
    if (multiple === undefined || !Number.isSafeInteger(multiple) || multiple < 0) {
      throw new RangeError(`${at}/multiple/${n} must be a whole multiple`)
    }
    out.set(n, multiple)
  }
  return out
}

function validOutcome(match: 'total' | 'dice', key: string): boolean {
  if (match === 'total') return /^(?:[2-9]|1[0-2])$/.test(key)
  const dice = /^([1-6])-([1-6])$/.exec(key)
  return dice !== null && Number(dice[1]) <= Number(dice[2])
}

function assertSameSet(at: string, actual: readonly number[], expected: readonly number[]): void {
  const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b).join(',')
  if (sorted(actual) !== sorted(expected) || new Set(actual).size !== actual.length) {
    throw new RangeError(`${at} is [${actual.join(', ')}], but the rules spec says [${expected}]`)
  }
}
