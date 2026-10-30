import { ExactError } from '../../exact/index.ts'
import type { Advice, Advisor, CoachInput } from './advice.ts'
import { alternatives } from './alternatives.ts'
import { amountEfficiency } from './amountEfficiency.ts'
import { edgeWarning } from './edgeWarning.ts'
import { layoutCost } from './layoutCost.ts'
import { odds } from './odds.ts'
import { variantContext } from './variantContext.ts'
import { working } from './working.ts'

/**
 * The advisors (plan §5.4, §10 M9c), each a pure `(CoachInput) => Advice[]` with its own tests.
 * `adviseSpot` runs them all for one spot; a spec the solver cannot price silences the advisor
 * that needed it (ExactError), never the rest. Teachable moments are event-driven and live with
 * the recaps (M9b), not here.
 */

export const ADVISORS: readonly { readonly name: string; readonly advise: Advisor }[] = [
  { name: 'edgeWarning', advise: edgeWarning },
  { name: 'alternatives', advise: alternatives },
  { name: 'odds', advise: odds },
  { name: 'amountEfficiency', advise: amountEfficiency },
  { name: 'variantContext', advise: variantContext },
  { name: 'working', advise: working },
  { name: 'layoutCost', advise: layoutCost },
]

/** Everything the advisors have to say about one spot, in advisor order. */
export function adviseSpot(input: CoachInput): Advice[] {
  const out: Advice[] = []
  for (const { advise } of ADVISORS) {
    try {
      out.push(...advise(input))
    } catch (error) {
      if (!(error instanceof ExactError)) throw error
    }
  }
  return out
}

export type {
  Advice,
  AdviceFix,
  AdviceRuleId,
  AdviceSeverity,
  AdviceSubject,
  Advisor,
  CoachInput,
} from './advice.ts'
export { adviceId, betKeyOf, spotLabel } from './advice.ts'
export { SET_BETS_ON_ASSUMPTION } from './working.ts'
export { PER_BASE_CENTS } from './edgeWarning.ts'
export { EFFICIENCY_REACH } from './amountEfficiency.ts'
export { adviceLine } from './render.ts'
