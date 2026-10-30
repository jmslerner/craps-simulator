import type { Fraction } from '../../engine/index.ts'
import type {
  Action,
  BetId,
  Cents,
  MachineConfig,
  PointNumber,
  TableState,
} from '../../engine/index.ts'
import type { BetSpec } from '../../exact/index.ts'
import type { CoachNumber } from '../types.ts'

/**
 * Advice (plan §5.3, §5.4): what one advisor says about one subject. Every advisor is a pure
 * `(CoachInput) => Advice[]`; the anti-nag gate (`coach/policy.ts`) decides which advice reaches
 * which surface per mode, and the audit harness recomputes every number from its source and
 * re-verifies every claim (strictly cheaper, same events, legal by dry-run).
 */

export type AdviceSeverity = 'info' | 'tip' | 'warn' | 'critical'

export type AdviceRuleId =
  | 'edge-warning'
  | 'same-event'
  | 'restructure'
  | 'sizing'
  | 'odds'
  | 'odds-not-free'
  | 'rounding'
  | 'min-vig'
  | 'variant-context'
  | 'working-off'
  | 'working-held'
  | 'working-cost'
  | 'layout-cost'
  | 'layout-swaps'

export interface AdviceFix {
  /** The one-tap button's text; amounts in it are formatted from computed cents. */
  readonly label: string
  /** What the tap does, dispatched as one `batch` — pre-validated by a dry run on the table. */
  readonly actions: readonly Action[]
}

export interface AdviceSubject {
  readonly typeId: string
  readonly number: PointNumber | null
  readonly betId?: BetId
}

export interface Advice {
  /** Stable identity for the gate's memory: `ruleId|typeId|number|betId`. */
  readonly id: string
  readonly ruleId: AdviceRuleId
  readonly severity: AdviceSeverity
  readonly subject: AdviceSubject
  /** Which template in `content/advisors.ts` renders it (`advisors/render.ts` maps ids). */
  readonly templateId: string
  /** Every number the wording shows, each traced to the exact/engine call that computed it. */
  readonly numbers: Readonly<Record<string, CoachNumber>>
  /** Machine words the template needs verbatim: bet labels, pay labels, point numbers. */
  readonly words: Readonly<Record<string, string>>
  /** Expected cents the advice is worth per decision (gate ranking: severity × $ impact). */
  readonly impact: Fraction
  /** The bet's own edge, where the rule grades one (the gate's high-edge thresholds). */
  readonly edge?: Fraction
  /** What switching saves per unit risked, for the gate's sameEvent thresholds. */
  readonly saving?: Fraction
  /** Shown once per subject (edgeWarning fires once per bet lifecycle, plan §5.4). */
  readonly once?: boolean
  readonly fix?: AdviceFix
  /**
   * Coach-level assumptions with no config pointer, named so the UI can chip them — the Set bets
   * On reading is `rules-spec §9 #28` (§13 M5/M6 → M9 hand-off).
   */
  readonly assumed?: readonly string[]
}

/** What an advisor sees: the machine, the spot under discussion, and the table when there is one. */
export interface CoachInput {
  readonly cfg: MachineConfig
  readonly spec: BetSpec
  readonly amount: Cents
  /** The table the advice is for; null for a hypothetical bet on an empty spot. */
  readonly state: TableState | null
  /** The bet on the table the spot holds, when it holds one. */
  readonly betId: BetId | null
}

export type Advisor = (input: CoachInput) => Advice[]

/** The gate's memory key half: which spot an advice is about. */
export function betKeyOf(spec: BetSpec): string {
  return `${spec.typeId}|${spec.number ?? ''}`
}

export function adviceId(ruleId: AdviceRuleId, subject: AdviceSubject): string {
  return `${ruleId}|${subject.typeId}|${subject.number ?? ''}|${subject.betId ?? ''}`
}

/** The machine's name for a spot: "Place 6". */
export function spotLabel(cfg: MachineConfig, spec: BetSpec): string {
  const label = cfg.catalog.get(spec.typeId)?.label ?? cfg.composites.get(spec.typeId)?.label
  const name = label ?? spec.typeId
  return spec.number === null ? name : `${name} ${spec.number}`
}
