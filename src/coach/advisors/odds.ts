import { Fraction } from '../../engine/index.ts'
import { ExactError, analyzeBet, combinedEdge } from '../../exact/index.ts'
import { coachPercent, sourceOf } from '../numbers.ts'
import type { Advice, Advisor } from './advice.ts'
import { adviceId, spotLabel } from './advice.ts'

/**
 * The odds advisor (plan §5.4): for a come-out line bet, the combined edge now (the flat alone)
 * against the combined edge with full odds behind it, through the clamped `combinedEdge` — the
 * odds the machine actually accepts (rules cap, per-bet maximum, table maximum). The honest
 * wording rule rides the template: odds lower the edge per dollar wagered, never the flat bet's
 * expected loss.
 *
 * It also flags odds paid below true odds as **not free** (plan §5.4): whenever the odds type's
 * own edge on a reachable number is above zero — 2/12 at 11:2 cost 1/14 on their own — a separate
 * warning names the worst such number.
 */

export const odds: Advisor = (input): Advice[] => {
  const { cfg, spec, amount } = input
  const type = cfg.catalog.get(spec.typeId)
  if (type?.family !== 'line' || spec.number !== null) return []
  const oddsId = cfg.oddsFor.get(spec.typeId)
  if (oddsId === undefined) return []
  const flat = analyzeBet(spec, amount, 'typical', cfg)
  const max = combinedEdge(spec, amount, cfg, 'max')
  if (max.oddsWagered.isZero()) return []

  const subject = {
    typeId: spec.typeId,
    number: spec.number,
    ...(input.betId === null ? {} : { betId: input.betId }),
  }
  const combinedSource = sourceOf('combinedEdge', { line: spec, flat: amount, odds: 'max' }, cfg)
  const out: Advice[] = [
    {
      id: adviceId('odds', subject),
      ruleId: 'odds',
      severity: 'info',
      subject,
      templateId: 'odds',
      numbers: {
        flatEdge: coachPercent(
          flat.edge,
          sourceOf('analyzeBet', { spec, amount, start: 'typical' }, cfg),
          flat.assumedPaths,
        ),
        withOdds: coachPercent(max.edge, combinedSource, flat.assumedPaths),
      },
      words: {
        line: spotLabel(cfg, spec),
        odds: cfg.catalog.get(oddsId)?.label ?? 'Odds',
      },
      impact: Fraction.ZERO,
      edge: flat.edge,
    },
  ]

  // "Not free": the worst reachable odds number whose own edge is above zero.
  let worst: { number: number; edge: Fraction } | null = null
  for (const rung of max.odds) {
    if (rung.amount <= 0) continue
    let priced: Fraction
    try {
      priced = analyzeBet({ typeId: oddsId, number: rung.number }, rung.amount, 'typical', cfg).edge
    } catch (error) {
      if (error instanceof ExactError) continue
      throw error
    }
    if (priced.compare(Fraction.ZERO) <= 0) continue
    if (worst === null || priced.compare(worst.edge) > 0) {
      worst = { number: rung.number, edge: priced }
    }
  }
  if (worst !== null) {
    out.push({
      id: adviceId('odds-not-free', subject),
      ruleId: 'odds-not-free',
      severity: 'tip',
      subject,
      templateId: 'odds-not-free',
      numbers: {
        oddsEdge: coachPercent(
          worst.edge,
          sourceOf(
            'analyzeBet',
            {
              spec: { typeId: oddsId, number: worst.number },
              amountOf: 'attainable',
              line: spec,
              flat: amount,
            },
            cfg,
          ),
        ),
      },
      words: {
        odds: cfg.catalog.get(oddsId)?.label ?? 'Odds',
        number: `the ${worst.number}`,
      },
      impact: Fraction.ZERO,
      edge: worst.edge,
    })
  }
  return out
}
