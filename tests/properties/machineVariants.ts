import { pruneProvenance } from '../../src/engine/config/provenance.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { CommissionInput, MachineConfigInput } from '../../src/engine/config/schema.ts'
import type { CommissionEvent } from './differential.ts'

/**
 * Machine variants for the reference differential (M6 reconciliation): each one turns on knobs of
 * rules spec §5.1 that no preset uses, so the engine and the reference table are compared on
 * those rules too. A variant is a preset with a few values changed, its provenance pruned to the
 * values left (an added value is simply assumed). The full run plays 2,000 sequences on each,
 * like a preset (tests/slow/reference.slow.test.ts); the quick subset fewer
 * (tests/oracle/reference.diff.test.ts).
 */
export interface MachineVariant {
  /** The variant's config id: what reports and mismatches name. */
  readonly id: string
  readonly from: PresetId
  /** The knobs it turns on, as rules spec §5.1 names them. */
  readonly knobs: readonly string[]
  /** The commission events a run must reach on it (`COMMISSION_EVENTS` in actions.ts). */
  readonly commission: readonly CommissionEvent[]
  /**
   * Whether it changes what a bet placed alone on a fresh table costs (commission, rounding, the
   * bar), so the exact analysis is compared on it too (tests/slow/exactOracles.slow.test.ts).
   * Working rules a lone bet never meets (toggles, the post-seven-out hold of later bets) and
   * stake units (the dispatch chain takes any stake) do not.
   */
  readonly prices: boolean
  readonly input: MachineConfigInput
}

/** `PRESETS[from]` with `edit` applied to a copy, renamed `id`, provenance pruned. */
function variantOf(
  from: PresetId,
  id: string,
  edit: (input: MachineConfigInput) => void,
): MachineConfigInput {
  const input = structuredClone(PRESETS[from]) as MachineConfigInput
  input.id = id
  input.name = `${input.name} (${id})`
  edit(input)
  return { ...input, provenance: pruneProvenance(input) }
}

/** The commission of `typeId`, changed by `change`. */
function setCommission(
  input: MachineConfigInput,
  typeId: string,
  change: (commission: CommissionInput) => CommissionInput,
): void {
  const type = input.catalog[typeId]
  if (type?.family !== 'numberVsSeven' || type.commission === undefined) {
    throw new Error(`${input.id} has no commission on ${typeId}`)
  }
  type.commission = change(type.commission)
  delete type.commissionByNumber
}

/** Sets a per-type limit field, keeping what the type already sets. */
function setPerType(
  input: MachineConfigInput,
  typeId: string,
  limits: NonNullable<MachineConfigInput['limits']['perType']>[string],
): void {
  input.limits.perType = {
    ...input.limits.perType,
    [typeId]: { ...input.limits.perType?.[typeId], ...limits },
  }
}

/**
 * Removes the posted minimums of `typeIds` (their `min` and `minByNumber`) from a config copy, so
 * those types take any stake from the machine's own minimum; a limit entry left empty goes.
 */
export function liftMinimums(input: MachineConfigInput, typeIds: readonly string[]): void {
  const perType = input.limits.perType
  if (perType === undefined) return
  for (const typeId of typeIds) {
    const own = perType[typeId]
    if (own === undefined) continue
    const { min, minByNumber, ...rest } = own
    void min
    void minByNumber
    if (Object.keys(rest).length === 0) delete perType[typeId]
    else perType[typeId] = rest
  }
}

/**
 * `PRESETS[id]` with the posted minimums of `typeIds` lifted (`liftMinimums`), its id kept and its
 * provenance pruned: for cases about commission and rounding mechanics at stakes the machine's
 * posted minimums refuse. M12 gave the live table its researched minimums — a buy from $20, a lay
 * that wins at least $20 (rules spec §4.3, LIVE minimums) — so its $1 lay and $10 buy cases, the
 * rules spec's own §4.3 and §4.5 examples, run on this copy.
 */
export function withoutPostedMinimums(
  id: PresetId,
  typeIds: readonly string[],
): MachineConfigInput {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  liftMinimums(input, typeIds)
  return { ...input, provenance: pruneProvenance(input) }
}

function setNewPlacedOff(
  input: MachineConfigInput,
  change: Partial<NonNullable<MachineConfigInput['afterSevenOut']['newPlacedOff']>>,
): void {
  const rule = input.afterSevenOut.newPlacedOff
  if (rule === null) throw new Error(`${input.id} has no after-seven-out rule`)
  input.afterSevenOut.newPlacedOff = { ...rule, ...change }
}

const FLOOR_QUARTER = { mode: 'floor', increment: 25 } as const
const CENT_UP = { mode: 'ceil', increment: 1 } as const

export const MACHINE_VARIANTS: readonly MachineVariant[] = [
  {
    // The live table without its posted buy and lay minimums (M12): a $1 lay wins $0 and owes its
    // $1 vig again, from credit, which the posted "lay must win $20" no longer lets happen.
    id: 'live-small-stakes',
    from: 'traditionalLive345',
    knobs: ['/limits/perType/<t>/min, minByNumber: lifted'],
    commission: ['placement', 'rearmFromWin', 'rearmFromCredit', 'refund', 'onWin'],
    prices: false,
    input: variantOf('traditionalLive345', 'live-small-stakes', (input) => {
      liftMinimums(input, ['buy', 'lay'])
    }),
  },
  {
    id: 'stw-next-roll-only',
    from: 'traditionalBubble',
    knobs: ['/workingToggle/scope: nextRollOnly'],
    commission: [],
    prices: false,
    input: variantOf('traditionalBubble', 'stw-next-roll-only', (input) => {
      input.workingToggle.scope = 'nextRollOnly'
    }),
  },
  {
    id: 'crapless-any-seven',
    from: 'craplessBubble',
    knobs: ['/afterSevenOut/newPlacedOff/trigger: anySeven'],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: false,
    input: variantOf('craplessBubble', 'crapless-any-seven', (input) => {
      setNewPlacedOff(input, { trigger: 'anySeven' })
    }),
  },
  {
    id: 'strict-until-point',
    from: 'strictBubble',
    knobs: ['/afterSevenOut/newPlacedOff/until: pointEstablished'],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: false,
    input: variantOf('strictBubble', 'strict-until-point', (input) => {
      setNewPlacedOff(input, { until: 'pointEstablished' })
    }),
  },
  {
    id: 'crapless-per-bet',
    from: 'craplessBubble',
    knobs: ['/workingToggle/perBet with /afterSevenOut/newPlacedOff'],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: false,
    input: variantOf('craplessBubble', 'crapless-per-bet', (input) => {
      input.workingToggle.perBet = true
    }),
  },
  {
    id: 'strict-per-bet-next-roll',
    from: 'strictBubble',
    knobs: [
      '/workingToggle/perBet with /afterSevenOut/newPlacedOff',
      '/workingToggle/scope: nextRollOnly',
      '/afterSevenOut/newPlacedOff/trigger: anySeven',
      '/afterSevenOut/newPlacedOff/until: pointEstablished',
    ],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: false,
    input: variantOf('strictBubble', 'strict-per-bet-next-roll', (input) => {
      input.workingToggle = { ...input.workingToggle, perBet: true, scope: 'nextRollOnly' }
      setNewPlacedOff(input, { trigger: 'anySeven', until: 'pointEstablished' })
    }),
  },
  {
    // No machine holds lays after a seven-out (IB §3.2 names place and buy); with one that does,
    // the hold and Interblock's lay re-enable meet (rules spec §2.4, §9 #31).
    id: 'strict-lay-held',
    from: 'strictBubble',
    knobs: [
      '/afterSevenOut/newPlacedOff/types with lay, and /layAutoOn',
      '/workingToggle/perBet with /afterSevenOut/newPlacedOff',
    ],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: false,
    input: variantOf('strictBubble', 'strict-lay-held', (input) => {
      input.workingToggle.perBet = true
      setNewPlacedOff(input, { types: ['place', 'buy', 'lay'] })
    }),
  },
  {
    id: 'crapless-table-max',
    from: 'craplessBubble',
    knobs: ['/limits/tableMax'],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: false,
    input: variantOf('craplessBubble', 'crapless-table-max', (input) => {
      input.limits.tableMax = input.limits.max
    }),
  },
  {
    id: 'crapless-recollect-credit',
    from: 'craplessBubble',
    knobs: ['/catalog/buy/commission/rearm: recollectFromCredit', 'refundOnTakeDown'],
    commission: ['placement', 'increase', 'rearmFromCredit', 'refund'],
    prices: true,
    input: variantOf('craplessBubble', 'crapless-recollect-credit', (input) => {
      setCommission(input, 'buy', (c) => ({
        ...c,
        rearm: 'recollectFromCredit',
        refundOnTakeDown: true,
      }))
    }),
  },
  {
    id: 'crapless-rearm-none',
    from: 'craplessBubble',
    knobs: ['/catalog/buy/commission/rearm: none', 'refundOnTakeDown'],
    commission: ['placement', 'increase', 'refund'],
    prices: true,
    input: variantOf('craplessBubble', 'crapless-rearm-none', (input) => {
      setCommission(input, 'buy', (c) => ({ ...c, rearm: 'none', refundOnTakeDown: true }))
    }),
  },
  {
    // A $50 minimum vig on a $100 bankroll: the win pays part of a re-collection and credit the
    // rest, and a table short of credit declines it (rules spec §4.3, §4.5).
    id: 'crapless-big-vig',
    from: 'craplessBubble',
    knobs: ['/catalog/buy/commission/minimum', 'a declined re-collection'],
    commission: [
      'placement',
      'rearmFromWin',
      'rearmFromCredit',
      'decline',
      'declineRefund',
      'refund',
    ],
    prices: true,
    input: variantOf('craplessBubble', 'crapless-big-vig', (input) => {
      setCommission(input, 'buy', (c) => ({ ...c, minimum: 5_000, refundOnTakeDown: true }))
      input.money.startingBankroll = 10_000
    }),
  },
  {
    id: 'strict-lay-credit',
    from: 'strictBubble',
    knobs: [
      '/catalog/lay/commission/rearm: recollectFromCredit',
      '/catalog/buy/commission/rearm: none',
      'a declined re-collection',
    ],
    commission: ['placement', 'increase', 'rearmFromCredit', 'decline', 'refund'],
    prices: true,
    input: variantOf('strictBubble', 'strict-lay-credit', (input) => {
      setCommission(input, 'lay', (c) => ({
        ...c,
        minimum: 2_500,
        rearm: 'recollectFromCredit',
        refundOnTakeDown: true,
      }))
      setCommission(input, 'buy', (c) => ({ ...c, rearm: 'none' }))
      input.money.startingBankroll = 10_000
    }),
  },
  {
    // Rounding by number on place, buy and lay (a lay's vig base is its win as paid), coarse
    // enough that whole-dollar bets break.
    id: 'strict-rounding-by-number',
    from: 'strictBubble',
    knobs: ['/catalog/<t>/payoutRoundingByNumber'],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: true,
    input: variantOf('strictBubble', 'strict-rounding-by-number', (input) => {
      const { place, buy, lay } = input.catalog
      if (
        place?.family !== 'numberVsSeven' ||
        buy?.family !== 'numberVsSeven' ||
        lay?.family !== 'numberVsSeven'
      ) {
        throw new Error('strictBubble lost a number bet')
      }
      Object.assign(place, {
        payoutRoundingByNumber: {
          '4': FLOOR_QUARTER,
          '5': { mode: 'halfUp', increment: 25 },
          '6': CENT_UP,
          '8': CENT_UP,
          '9': { mode: 'halfEven', increment: 25 },
        },
      })
      Object.assign(buy, { payoutRoundingByNumber: { '5': FLOOR_QUARTER, '9': CENT_UP } })
      Object.assign(lay, {
        payoutRoundingByNumber: {
          '4': FLOOR_QUARTER,
          '5': { mode: 'halfUp', increment: 5 },
          '6': CENT_UP,
          '10': { mode: 'halfEven', increment: 10 },
        },
      })
    }),
  },
  {
    // Shoot To Win's commission is taken from the win; with a minimum, a small win cannot cover it
    // and the vig is capped at the win (rules spec §4.3; the engine's winCommission `.min(win)`).
    // The M5/M6 audit found neither event counted, and the cap never exercised by the differential.
    id: 'stw-vig-cap',
    from: 'traditionalBubble',
    knobs: ['/catalog/buy/commission/minimum with timing onWin', 'vig capped at the win'],
    commission: ['onWin', 'onWinCapped'],
    prices: true,
    input: variantOf('traditionalBubble', 'stw-vig-cap', (input) => {
      setCommission(input, 'buy', (c) => ({ ...c, minimum: 500 }))
    }),
  },
  {
    id: 'crapless-units-by-number',
    from: 'craplessBubble',
    knobs: ['/limits/perType/<t>/incrementByNumber'],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: false,
    input: variantOf('craplessBubble', 'crapless-units-by-number', (input) => {
      setPerType(input, 'place', { incrementByNumber: { '5': 500, '6': 600, '8': 600, '9': 500 } })
      setPerType(input, 'buy', { incrementByNumber: { '4': 2_000, '10': 2_000 } })
      setPerType(input, 'hard', { incrementByNumber: { '6': 200, '8': 200 } })
      const odds = { '2': 100, '4': 100, '5': 200, '6': 500, '8': 500, '9': 200, '12': 300 }
      setPerType(input, 'passOdds', { incrementByNumber: odds })
      setPerType(input, 'comeOdds', { incrementByNumber: odds })
    }),
  },
  {
    id: 'strict-lay-units',
    from: 'strictBubble',
    knobs: ['/limits/perType/<t>/incrementByNumber', '/rules/dontBar: 2', 'minTotal countOff'],
    commission: ['placement', 'increase', 'rearmFromWin'],
    prices: true,
    input: variantOf('strictBubble', 'strict-lay-units', (input) => {
      const lays = { '4': 200, '5': 300, '6': 600, '8': 600, '9': 300, '10': 200 }
      setPerType(input, 'lay', { incrementByNumber: { '4': 200, '6': 600, '9': 300 } })
      setPerType(input, 'dontPassOdds', { incrementByNumber: lays })
      setPerType(input, 'dontComeOdds', { incrementByNumber: lays })
      input.rules.dontBar = 2
      if (input.limits.minTotal === null) throw new Error('strictBubble has no minimum total')
      input.limits.minTotal = { ...input.limits.minTotal, countOff: true }
    }),
  },
]

/** A machine the differential plays: a preset or a variant, and the commission events it reaches. */
export interface DiffMachine {
  readonly id: string
  readonly input: MachineConfigInput
  /** For a variant, the knobs it turns on; none for a preset. */
  readonly knobs: readonly string[]
  readonly commission: readonly CommissionEvent[]
  /** Whether the exact analysis is compared on it too (every preset; see `MachineVariant`). */
  readonly prices: boolean
}

/** The commission events each preset reaches (rules spec §4.3, §5.2). */
const PRESET_COMMISSION: Readonly<Record<PresetId, readonly CommissionEvent[]>> = {
  craplessBubble: ['placement', 'increase', 'rearmFromWin'],
  // The high-limit preset shares craplessBubble's catalog, buy commission included.
  craplessBubbleHighLimit: ['placement', 'increase', 'rearmFromWin'],
  // Shoot To Win takes its commission from wins: nothing is charged up front, held or refunded.
  traditionalBubble: ['onWin'],
  strictBubble: ['placement', 'increase', 'rearmFromWin'],
  // Take-downs are refunded. The vig is $1 on every bet under $40, so an increase is rarely
  // charged. The buy vig on 4 and 10 is taken from the win (commissionByNumber). Since M12 a lay
  // must win $20, so a re-collection always fits in the win; the $1 lay that wins $0 and pays its
  // vig again from credit plays on the `live-small-stakes` variant.
  traditionalLive345: ['placement', 'rearmFromWin', 'refund', 'onWin'],
}

/** Every machine the differential plays: the four presets, then the variants. */
export const DIFF_MACHINES: readonly DiffMachine[] = [
  ...PRESET_IDS.map((id) => ({
    id,
    input: PRESETS[id],
    knobs: [],
    commission: PRESET_COMMISSION[id],
    prices: true,
  })),
  ...MACHINE_VARIANTS,
]
