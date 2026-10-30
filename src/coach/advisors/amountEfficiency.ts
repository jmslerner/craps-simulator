import { Fraction, cents } from '../../engine/index.ts'
import {
  analyzeBet,
  commissionMinimumBinds,
  efficientAmounts,
  legalAmounts,
  minimumFreeFrom,
} from '../../exact/index.ts'
import { coachMoney, coachPercent, sourceOf } from '../numbers.ts'
import { ROUNDING_MATERIAL_BREAKAGE } from '../policy.ts'
import type { Advice, Advisor } from './advice.ts'
import { adviceId, spotLabel } from './advice.ts'
import { paysExactlyAt } from './exactness.ts'

/**
 * Amount efficiency (plan §5.4): triggers on breakage at the user's stake, whatever the rounding
 * unit, and suggests the nearest amount the machine pays exactly ($5 place 6 pays $5.83 at
 * 17/1100 ≈ 1.55 %; $6 pays exactly at 1/66). It also catches minimum-vig traps: when the
 * commission minimum binds, the vig charged is a bigger share than the rate, and the advice names
 * the stake the minimum stops binding from (`minimumFreeFrom`).
 *
 * Two guards keep the words true (M9 audit): the breakage must be material
 * (`ROUNDING_MATERIAL_BREAKAGE`, so the two percents it quotes print differently), and the stake it
 * names must pay EXACTLY (`paysExactlyAt`), not merely cheaper than the current one.
 */

/** How many increments around the stake the efficient-amount scan looks. */
export const EFFICIENCY_REACH = 4

export const amountEfficiency: Advisor = (input): Advice[] => {
  const { cfg, spec, amount } = input
  const out: Advice[] = []
  const subject = {
    typeId: spec.typeId,
    number: spec.number,
    ...(input.betId === null ? {} : { betId: input.betId }),
  }
  const analysis = analyzeBet(spec, amount, 'typical', cfg)

  if (commissionMinimumBinds(spec, amount, cfg)) {
    const freeFrom = minimumFreeFrom(spec, cfg)
    out.push({
      id: adviceId('min-vig', subject),
      ruleId: 'min-vig',
      severity: 'warn',
      subject,
      templateId: 'min-vig',
      numbers: {
        freeFrom: coachMoney(cents(freeFrom), sourceOf('minimumFreeFrom', { spec }, cfg)),
        edge: coachPercent(
          analysis.edge,
          sourceOf('analyzeBet', { spec, amount, start: 'typical' }, cfg),
          analysis.assumedPaths,
        ),
      },
      words: { name: spotLabel(cfg, spec) },
      impact: analysis.lossPerDecision,
      edge: analysis.edge,
    })
  }

  if (analysis.breakage.compare(ROUNDING_MATERIAL_BREAKAGE) >= 0) {
    const span = reach(spec, cfg)
    const nearby = efficientAmounts(spec, cfg, {
      from: Math.max(0, amount - span),
      to: amount + span,
    })
    // The nearest stake the machine pays exactly and strictly cheaper; at equal distance the
    // higher one keeps the exposure (the plan's example sends the $5 place 6 to $6, not $3). A
    // stake that is cheaper but still inexact ($2 for the $1 place 6, $9,995 for the $10,000 one
    // on a $5 machine) is never named: the template says "pays exactly".
    const better = nearby
      .filter(
        (entry) =>
          entry.amount !== amount &&
          entry.edge.compare(analysis.edge) < 0 &&
          paysExactlyAt(spec, entry.amount, cfg),
      )
      .sort((x, y) => {
        const dx = Math.abs(x.amount - amount)
        const dy = Math.abs(y.amount - amount)
        if (dx !== dy) return dx - dy
        return y.amount - x.amount
      })[0]
    if (better !== undefined) {
      const scanSource = sourceOf(
        'efficientAmounts',
        { spec, from: Math.max(0, amount - span), to: amount + span },
        cfg,
      )
      out.push({
        id: adviceId('rounding', subject),
        ruleId: 'rounding',
        severity: 'tip',
        subject,
        templateId: 'rounding',
        numbers: {
          stake: coachMoney(amount, scanSource),
          edge: coachPercent(
            analysis.edge,
            sourceOf('analyzeBet', { spec, amount, start: 'typical' }, cfg),
            analysis.assumedPaths,
          ),
          nominalEdge: coachPercent(
            analysis.nominalEdge,
            sourceOf('analyzeBet', { spec, amount, start: 'typical', field: 'nominalEdge' }, cfg),
            analysis.assumedPaths,
          ),
          betterAmount: coachMoney(better.amount, scanSource),
          betterEdge: coachPercent(
            better.edge,
            sourceOf('analyzeBet', { spec, amount: better.amount, start: 'typical' }, cfg),
          ),
        },
        words: { name: spotLabel(cfg, spec) },
        impact: analysis.breakage.mul(Fraction.of(amount)),
        edge: analysis.edge,
        saving: analysis.edge.sub(better.edge),
      })
    }
  }
  return out
}

/** The scan span: `EFFICIENCY_REACH` of the type's own stake increments. */
function reach(
  spec: Parameters<typeof legalAmounts>[0],
  cfg: Parameters<typeof legalAmounts>[1],
): number {
  const legal = legalAmounts(spec, cfg, { from: 0, to: Number.MAX_SAFE_INTEGER }, 2)
  const [first, second] = legal
  const increment = first !== undefined && second !== undefined ? second - first : 100
  return EFFICIENCY_REACH * increment
}
