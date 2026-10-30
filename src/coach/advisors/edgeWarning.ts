import { Fraction, cents } from '../../engine/index.ts'
import { analyzeBet } from '../../exact/index.ts'
import { coachMoney, coachPercent, sourceOf } from '../numbers.ts'
import { gradeOf } from '../policy.ts'
import type { Advice, Advisor } from './advice.ts'
import { adviceId, spotLabel } from './advice.ts'

/**
 * The edge warning (plan §5.4): the bet graded by `policy.ts` thresholds, plus what it costs of
 * every $100 put on it — both derived from the same `analyzeBet` edge, never typed in. For a bet
 * already held it fires once per bet lifecycle (`once`, enforced by the gate's memory).
 */

/** The "per $100" base, in cents; a number like any other so the template holds no literal. */
export const PER_BASE_CENTS = 10_000

export const edgeWarning: Advisor = (input): Advice[] => {
  const { cfg, spec, amount } = input
  const analysis = analyzeBet(spec, amount, 'typical', cfg)
  const grade = gradeOf(analysis.edge)
  const source = sourceOf('analyzeBet', { spec, amount, start: 'typical' }, cfg)
  const per = sourceOf('edgePer100', { spec, amount, start: 'typical' }, cfg)
  const subject = {
    typeId: spec.typeId,
    number: spec.number,
    ...(input.betId === null ? {} : { betId: input.betId }),
  }
  return [
    {
      id: adviceId('edge-warning', subject),
      ruleId: 'edge-warning',
      severity: grade === 'awful' ? 'warn' : grade === 'poor' ? 'tip' : 'info',
      subject,
      templateId: 'edge-warning',
      numbers: {
        edge: coachPercent(analysis.edge, source, analysis.assumedPaths),
        per: coachMoney(analysis.edge.mul(Fraction.of(PER_BASE_CENTS)), per, analysis.assumedPaths),
        base: coachMoney(cents(PER_BASE_CENTS), per),
      },
      words: { name: spotLabel(cfg, spec), grade },
      impact: analysis.lossPerDecision,
      edge: analysis.edge,
      ...(input.betId === null ? {} : { once: true }),
    },
  ]
}
