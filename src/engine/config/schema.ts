import { z } from 'zod'
import { TOTALS } from '../core/dice.ts'
import { ROUNDING_MODES } from '../core/money.ts'
import { citationIssues, isJsonPointer } from './provenance.ts'
import { parseRatio } from './ratio.ts'
import {
  DONT_BARS,
  HARD_KEYS,
  HARD_NUMBERS,
  POINT_KEYS,
  POINT_NUMBERS,
  VARIANTS,
} from './rulesets.ts'

/**
 * The machine-config format (plan §4.4 plus every knob in rules spec §5.1). A config is
 * plain JSON: presets are written in it, the machine editor edits it, and sessions store it. Every
 * object is strict, so a misspelt key is an error rather than a silently ignored setting.
 *
 * This schema checks each value on its own. Rules that relate values to each other (the come-out
 * partition, pay tables covering the offered numbers, type references) are in `compile.ts`.
 *
 * Money is whole cents. Pay ratios and rates are strings in the machine's own wording ("7:6",
 * "9 to 5", "31 for 1"), parsed by `parseRatio`, which keeps the wording as the label.
 */

/** Bet-type, composite and side-bet ids: camelCase, used as keys and in JSON pointers. */
export const TypeIdSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/, 'must be camelCase letters and digits, such as "passOdds"')

const Label = z.string().min(1)

/** Whole cents: an amount of money, possibly zero. */
const CentsSchema = z.int().min(0)
/** Whole cents greater than zero: a bet size, limit or increment. */
const PositiveCentsSchema = z.int().min(1)

/** A pay ratio or rate that `parseRatio` accepts: positive, whole numbers, "a:b" / "a to b" / "a for b". */
export const RatioSchema = z.string().superRefine((text, ctx) => {
  try {
    parseRatio(text)
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

/** How an exact amount becomes payable money: a mode and a step in cents (1 = to the penny). */
export const RoundingRuleSchema = z.strictObject({
  mode: z.enum(ROUNDING_MODES),
  increment: PositiveCentsSchema,
})

const TotalSchema = z.literal(TOTALS)
const PointNumberSchema = z.literal(POINT_NUMBERS)
const PointKeySchema = z.enum(POINT_KEYS)
const PayByPoint = z.partialRecord(PointKeySchema, RatioSchema)
const OnOff = z.enum(['on', 'off'])
const StayOrReturn = z.enum(['stay', 'return'])

/**
 * Commission (vig) on buy and lay bets (plan §4.7). `rate` is a ratio of the base: "1:20" is 5%.
 * - `basis`: the base is the stake (buy) or the win (lay).
 * - `timing`: charged when the bet is placed or increased (`upfront`) or taken from each win.
 * - `rounding`, `minimum`: how the charge is rounded, and the smallest charge (live: $1).
 * - `refundOnTakeDown`: whether upfront vig comes back when the bet is taken down.
 * - `rearm`: upfront vig when a winning bet stays up: taken again from the win, charged to
 *   credit, or not charged again. On-win commission has nothing to refund or re-collect.
 */
export const CommissionSchema = z.strictObject({
  rate: RatioSchema,
  basis: z.enum(['stake', 'win']),
  timing: z.enum(['upfront', 'onWin']),
  rounding: RoundingRuleSchema,
  minimum: CentsSchema,
  refundOnTakeDown: z.boolean(),
  rearm: z.enum(['recollectFromWin', 'recollectFromCredit', 'none']),
})

/**
 * Pass, come, don't pass and don't come. `side` is the direction and `window` the phase a new bet
 * is placed in (pass: come-out; come: point). A don't bet on a number also says whether it can be
 * reduced or removed (`onNumber`) and whether a removed bet can be replaced before the next come-out
 * (`rebetAfterRemove`); do bets are always locked once on a number.
 */
const LineTypeSchema = z.strictObject({
  family: z.literal('line'),
  label: Label,
  side: z.enum(['do', 'dont']),
  window: z.enum(['comeOut', 'point']),
  pays: RatioSchema,
  payoutRounding: RoundingRuleSchema.optional(),
  /** `stayIfFirstRoll`: a don't bet that wins on its first roll rides; `stayIf11`: a come bet that wins on 11 rides. */
  afterWin: z.enum(['stay', 'return', 'stayIfFirstRoll', 'stayIf11']),
  onNumber: z.enum(['locked', 'reduceRemove']).optional(),
  rebetAfterRemove: z.enum(['allowed', 'nextCycle']).optional(),
})

/**
 * Free odds behind the line type `parent`, with a pay ratio and a cap for every point. The cap is
 * `multiple` × the flat bet, either on the odds stake (`stake`) or on what the odds would win
 * (`win`, the standard lay rule). `comeOutDefault` is given only for odds on come and don't come
 * bets, the only odds that can face a come-out roll.
 */
const OddsTypeSchema = z.strictObject({
  family: z.literal('odds'),
  label: Label,
  parent: TypeIdSchema,
  pays: PayByPoint,
  payoutRounding: RoundingRuleSchema.optional(),
  limit: z.strictObject({
    basis: z.enum(['stake', 'win']),
    multiple: z.partialRecord(PointKeySchema, z.int().min(0)),
  }),
  comeOutDefault: OnOff.optional(),
})

/**
 * Bets that are decided by one number against 7: place, buy and big 6/8 win on the number; lay and
 * place-to-lose win on 7. Buy and lay carry a commission, optionally overridden per number.
 */
const NumberTypeSchema = z.strictObject({
  family: z.literal('numberVsSeven'),
  kind: z.enum(['place', 'buy', 'big', 'lay', 'placeToLose']),
  label: Label,
  numbers: z.array(PointNumberSchema).min(1),
  pays: PayByPoint,
  payoutRounding: RoundingRuleSchema.optional(),
  commission: CommissionSchema.optional(),
  commissionByNumber: z.partialRecord(PointKeySchema, CommissionSchema).optional(),
  afterWin: StayOrReturn,
  comeOutDefault: OnOff,
})

/** Hard 4, 6, 8 and 10: win on the pair, lose on the easy way or any 7. */
const HardwayTypeSchema = z.strictObject({
  family: z.literal('hardway'),
  label: Label,
  numbers: z.array(z.literal(HARD_NUMBERS)).min(1),
  pays: z.partialRecord(z.enum(HARD_KEYS), RatioSchema),
  payoutRounding: RoundingRuleSchema.optional(),
  afterWin: StayOrReturn,
  comeOutDefault: OnOff,
})

/**
 * A bet decided by the next roll. `pays` lists the winning outcomes; every other roll loses. Keys
 * are totals ("2" to "12") when `match` is `total`, and dice pairs, low face first ("2-5", "3-3"),
 * when it is `dice`.
 */
const OneRollTypeSchema = z.strictObject({
  family: z.literal('oneRoll'),
  label: Label,
  match: z.enum(['total', 'dice']),
  pays: z.record(z.string(), RatioSchema),
  payoutRounding: RoundingRuleSchema.optional(),
  afterWin: StayOrReturn,
})

export const BetTypeSchema = z.discriminatedUnion('family', [
  LineTypeSchema,
  OddsTypeSchema,
  NumberTypeSchema,
  HardwayTypeSchema,
  OneRollTypeSchema,
])

/**
 * All Small / All Tall / Make 'Em All (Lucky Roller): every target total before the bet's ending 7.
 * `placement`: Interblock allows it only right after a 7 or at the start of a cycle
 * (`afterSevenOrStart`); Shoot To Win whenever no bet of the same type is active.
 */
const CollectSetSchema = z.strictObject({
  family: z.literal('collectSet'),
  label: Label,
  targets: z.array(TotalSchema).min(1),
  pays: RatioSchema,
  endsOn: z.enum(['anySeven', 'sevenOut']),
  placement: z.enum(['afterSevenOrStart', 'noneOfTypeActive', 'newHand']),
})

/**
 * Fire Bet: unique points made in a hand, counting only `countedPoints`. `payTable` maps a count to
 * its pay; the bet is settled at the seven-out unless `payImmediatelyAt` is reached first.
 */
const UniquePointsSchema = z.strictObject({
  family: z.literal('uniquePointsMade'),
  label: Label,
  countedPoints: z.array(PointNumberSchema),
  payTable: z.record(z.string(), RatioSchema),
  payImmediatelyAt: z.int().min(1).nullable(),
  placement: z.literal('newHand'),
})

/**
 * Hot Shooter Jackpot: pays on the hand's roll count at the seven-out. A tier applies from
 * `minRolls` up to the next tier; fewer rolls than the first tier lose. The 1× tier returns the
 * stake, written "push" ("1 for 1" pays nothing). `countDefinition`: which rolls count (research
 * definitions A, B and C).
 */
const HandLengthSchema = z.strictObject({
  family: z.literal('handLength'),
  label: Label,
  countDefinition: z.enum(['allRolls', 'exceptSevenOut', 'exceptComeOutAndSevenOut']),
  tiers: z.array(
    z.strictObject({
      minRolls: z.int().min(1),
      pays: z.union([z.literal('push'), RatioSchema]),
    }),
  ),
  placement: z.enum(['comeOutAfterSevenOut', 'anyComeOut']),
  qualifyingBet: CentsSchema,
})

/**
 * Lucky Shooter (traditional only): after the come-out sets a point, count hits on the other box
 * numbers. `payTable` maps a number of hits to its pay; `topAward` pays all hits followed by the
 * point.
 */
const PointRunSchema = z.strictObject({
  family: z.literal('pointRun'),
  label: Label,
  points: z.array(PointNumberSchema),
  payTable: z.record(z.string(), RatioSchema),
  topAward: RatioSchema,
  repeatEndsBet: z.boolean(),
  placement: z.enum(['beforePoint', 'comeOut', 'newHand']),
  removableBeforePoint: z.boolean(),
})

export const SideBetSchema = z.discriminatedUnion('family', [
  CollectSetSchema,
  UniquePointsSchema,
  HandLengthSchema,
  PointRunSchema,
])

/** A citation such as "CW §17" or "IB §3.2; VA", each starting with a known source key. */
const SourceSchema = z
  .string()
  .min(1)
  .superRefine((source, ctx) => {
    for (const message of citationIssues(source)) ctx.addIssue({ code: 'custom', message })
  })

/** Verified and reported values need a source; assumed values need a note saying why. */
export const ProvenanceEntrySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('verified'), source: SourceSchema, note: Label.optional() }),
  z.strictObject({ status: z.literal('reported'), source: SourceSchema, note: Label.optional() }),
  z.strictObject({ status: z.literal('assumed'), source: SourceSchema.optional(), note: Label }),
])

const PointerSchema = z
  .string()
  .refine(isJsonPointer, 'must be a JSON pointer such as "/catalog/place/pays/6"')

const TypeIdList = z.array(TypeIdSchema)

export const MachineConfigInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'must be letters, digits and dashes'),
  name: Label,
  variant: z.enum(VARIANTS),
  /** The come-out partition (it must match the variant), the don't bar and put bets. */
  rules: z.strictObject({
    naturals: z.array(TotalSchema),
    craps: z.array(TotalSchema),
    points: z.array(PointNumberSchema),
    dontBar: z.literal(DONT_BARS).nullable(),
    allowPutBets: z.boolean(),
  }),
  money: z.strictObject({
    /** Default rounding of winnings; a bet type can override it. */
    payoutRounding: RoundingRuleSchema,
    startingBankroll: CentsSchema,
    betIncrement: PositiveCentsSchema,
  }),
  limits: z.strictObject({
    min: PositiveCentsSchema,
    max: PositiveCentsSchema,
    tableMax: PositiveCentsSchema.optional(),
    perType: z
      .record(
        TypeIdSchema,
        z.strictObject({
          min: PositiveCentsSchema.optional(),
          max: PositiveCentsSchema.optional(),
          increment: PositiveCentsSchema.optional(),
        }),
      )
      .optional(),
    /**
     * A minimum for the whole round, checked when the dice are rolled ("BETS ARE NOT VALID YET!").
     * `totalRound`: the counted bets must add up to `amount`; `perBet`: each counted bet must be
     * at least `amount`. OFF bets and side bets count only if the machine says so.
     */
    minTotal: z
      .strictObject({
        amount: PositiveCentsSchema,
        scope: z.enum(['totalRound', 'perBet']),
        countOff: z.boolean(),
        countSideBets: z.boolean(),
      })
      .nullable(),
  }),
  chips: z.array(PositiveCentsSchema).min(1),
  /** The bets the layout offers, keyed by type id; presence means offered. */
  catalog: z.record(TypeIdSchema, BetTypeSchema),
  /** Horn, C&E, world: one-roll bets placed together, `units` of each per composite unit. */
  composites: z.record(
    TypeIdSchema,
    z.strictObject({
      label: Label,
      parts: z.array(z.strictObject({ typeId: TypeIdSchema, units: z.int().min(1) })).min(2),
    }),
  ),
  /** Side bets, keyed by type id. Validated data only until the side-bet engine lands (M11). */
  sideBets: z.record(TypeIdSchema, SideBetSchema),
  /**
   * The ON/OFF control: a global button, per-bet toggles, which types it covers, and whether OFF
   * lasts until changed or only for the next roll.
   */
  workingToggle: z.strictObject({
    global: z.boolean(),
    perBet: z.boolean(),
    scope: z.enum(['untilChanged', 'nextRollOnly']),
    types: TypeIdList,
  }),
  /**
   * Shoot To Win: at each come-out the machine switches OFF bets of the `carried` types left from
   * the previous series and the `newlyPlaced` types placed for the come-out, and switches them
   * back ON when the point is established. Null when the machine does not.
   */
  comeOut: z.strictObject({
    autoOff: z
      .strictObject({
        carried: TypeIdList,
        newlyPlaced: TypeIdList,
        reOnAt: z.literal('pointEstablished'),
      })
      .nullable(),
  }),
  /**
   * Interblock: bets of these types placed after a seven-out start OFF until the player sets bets
   * ON (or the next point is established).
   */
  afterSevenOut: z.strictObject({
    newPlacedOff: z
      .strictObject({
        types: TypeIdList,
        until: z.enum(['playerOn', 'pointEstablished']),
      })
      .nullable(),
  }),
  /** Interblock: lay bets set OFF come back ON by themselves after a point is made or any 7. */
  layAutoOn: z.strictObject({ afterPointMade: z.boolean(), afterSeven: z.boolean() }).nullable(),
  /** Interblock: when the point is made, odds bets that are OFF are taken down and returned. */
  oddsOffReturnedAtPointMade: z.boolean(),
  /** Whether bets switched OFF still use credit (Interblock) or not (Shoot To Win). */
  offBets: z.strictObject({ consumeCredit: z.boolean() }),
  /**
   * Types that cannot be up together: anywhere on the layout (`global`) or on the same number
   * (`sameNumber`).
   */
  exclusiveGroups: z.array(
    z.strictObject({ types: TypeIdList.min(2), scope: z.enum(['global', 'sameNumber']) }),
  ),
  /** Interblock setting: a pass bet blocks lay on the point; a don't pass bet blocks buy on it. */
  excludeLineVsLayBuy: z.boolean(),
  /** How pay ratios are shown: as each ratio is written, or all as "to 1" or "for 1". */
  payLabelStyle: z.enum(['asWritten', 'to', 'for']),
  /** Presentation and pacing of the machine; none of it changes an outcome or a payout. */
  flow: z.strictObject({
    shooter: z.strictObject({ mode: z.enum(['single', 'community']) }),
    invalidRoll: z.enum(['reshoot', 'reVibrate', 'void', 'attendant', 'noRoll']),
    puckReset: z.literal([0, 1, 2]),
    groupButtons: z.strictObject({
      buttons: z.array(z.enum(['press', 'across', 'inside', 'outside'])),
      condition: z.enum(['afterComeOutWithLineOrOneRoll', 'always']),
    }),
    historyLength: z.int().min(0),
    macros: z.array(z.enum(['repeatLastBet', 'double', 'keepBetsOn'])),
  }),
  pace: z.strictObject({
    rollsPerHour: z.int().min(1),
    betWindowSec: z.int().min(1).nullable(),
    shooterWindowSec: z.int().min(1).nullable(),
  }),
  /** Where each value comes from, keyed by JSON pointer (see provenance.ts). */
  provenance: z.record(PointerSchema, ProvenanceEntrySchema),
})

export type MachineConfigInput = z.infer<typeof MachineConfigInputSchema>
export type BetTypeConfig = z.infer<typeof BetTypeSchema>
export type SideBetConfig = z.infer<typeof SideBetSchema>
export type CommissionInput = z.infer<typeof CommissionSchema>
export type RoundingRule = z.infer<typeof RoundingRuleSchema>

export type LineTypeConfig = Extract<BetTypeConfig, { family: 'line' }>
export type OddsTypeConfig = Extract<BetTypeConfig, { family: 'odds' }>
export type NumberTypeConfig = Extract<BetTypeConfig, { family: 'numberVsSeven' }>
export type HardwayTypeConfig = Extract<BetTypeConfig, { family: 'hardway' }>
export type OneRollTypeConfig = Extract<BetTypeConfig, { family: 'oneRoll' }>
export type CollectSetConfig = Extract<SideBetConfig, { family: 'collectSet' }>
export type UniquePointsConfig = Extract<SideBetConfig, { family: 'uniquePointsMade' }>
export type HandLengthConfig = Extract<SideBetConfig, { family: 'handLength' }>
export type PointRunConfig = Extract<SideBetConfig, { family: 'pointRun' }>
