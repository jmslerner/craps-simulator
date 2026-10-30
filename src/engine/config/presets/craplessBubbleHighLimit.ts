import { deepFreeze } from '../compile.ts'
import type { MachineConfigInput } from '../schema.ts'
import { craplessBubble } from './craplessBubble.ts'
import { INTERBLOCK_HOPS, hopId } from './shared.ts'

/**
 * High-limit crapless bubble craps (docs/rules/research/high-limit-machines.md): the same
 * Interblock crapless machine as `craplessBubble` — every rule, pay and working behavior is the
 * identical object — at the stakes of a Las Vegas high-limit unit, anchored on the Venetian's
 * reported live-table limits and the $20,000-maximum crapless machine reported in WOV-35576.
 * No high-limit par sheet is public, so the money values carry `reported`/`assumed` provenance;
 * the rules keep the base preset's own entries.
 */

/** 16-for-1 one-roll props: $70 on the reported standard machine, × the $5,000/$195 line ratio. */
const PROP_16_MAX = 180_000
/** 31-for-1 one-roll props: $35 on the reported standard machine, scaled the same way. */
const PROP_31_MAX = 90_000

/** Easy hops pay 16 for 1 and hard hops 31 for 1 (the base preset), so their caps follow the tiers. */
const HOP_MAXES = Object.fromEntries(
  INTERBLOCK_HOPS.map((combo) => [
    hopId(combo),
    { max: combo[0] === combo[2] ? PROP_31_MAX : PROP_16_MAX },
  ]),
)

const PER_TYPE_LIMITS = {
  status: 'assumed',
  source: 'WOV-35576',
  note: 'Scaled from the per-bet maximums reported for a standard machine (pass $195, odds 2x the line, place $400, hards ~$115, $70 at 16 for 1, $35 at 31 for 1) by this machine’s $5,000 line maximum; composites at parts × the part’s tier. No high-limit par sheet is public (research high-limit-machines.md §2–§3).',
} as const

export const craplessBubbleHighLimit: MachineConfigInput = deepFreeze({
  ...craplessBubble,
  id: 'craplessBubbleHighLimit',
  name: 'Crapless bubble craps — high limit',
  money: {
    payoutRounding: craplessBubble.money.payoutRounding,
    startingBankroll: 500_000,
    betIncrement: 500,
  },
  limits: {
    min: 500,
    max: 500_000,
    tableMax: 2_000_000,
    perType: {
      passOdds: { max: 1_000_000 },
      comeOdds: { max: 1_000_000 },
      place: { max: 1_000_000 },
      buy: { max: 1_000_000 },
      hard: { max: 300_000 },
      anyCraps: { max: 380_000 },
      c: { max: 380_000 },
      e: { max: PROP_16_MAX },
      aceDeuce: { max: PROP_16_MAX },
      yo: { max: PROP_16_MAX },
      snakeEyes: { max: PROP_31_MAX },
      boxcars: { max: PROP_31_MAX },
      ...HOP_MAXES,
      ce: { max: 360_000 },
      horn: { max: 360_000 },
    },
    minTotal: { amount: 2_500, scope: 'totalRound', countOff: false, countSideBets: false },
  },
  chips: [2_500, 5_000, 10_000, 25_000, 50_000, 100_000],
  provenance: {
    ...craplessBubble.provenance,
    '/money/startingBankroll': {
      status: 'assumed',
      note: 'Trainer default sized to the stakes; not a machine value.',
    },
    '/money/betIncrement': {
      status: 'assumed',
      source: 'IB §5.1',
      note: 'A $5 denomination for a high-limit unit; Interblock chip and credit values scale with denomination.',
    },
    '/limits/min': {
      status: 'assumed',
      source: 'VA',
      note: 'One credit at the $5 denomination; machine minimums report $1 to $6 (research high-limit-machines.md §2).',
    },
    '/limits/max': {
      status: 'assumed',
      note: 'The $5,000 maximum reported for the Venetian’s live craps, mapped onto one machine wager; no machine source (research high-limit-machines.md §1).',
    },
    '/limits/tableMax': {
      status: 'reported',
      source: 'WOV-35576',
      note: 'A Las Vegas high-limit crapless machine takes a maximum bet of $20,000 (the 2025-04-16 video the thread retells), read as the most the layout holds for one roll.',
    },
    '/limits/minTotal/amount': {
      status: 'assumed',
      source: 'VA (Venetian page)',
      note: '$25 total to roll: the Venetian’s table minimums "usually start at $25", mapped onto Interblock’s minimum-total check (research high-limit-machines.md §1).',
    },
    '/limits/perType': PER_TYPE_LIMITS,
    '/chips': {
      status: 'assumed',
      source: 'IB §5.1',
      note: 'Trainer default spanning the limits; Interblock shows seven chips whose values scale with denomination.',
    },
  },
} satisfies MachineConfigInput)
