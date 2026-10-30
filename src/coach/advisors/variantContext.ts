import { Fraction, PRESETS, compileConfig } from '../../engine/index.ts'
import { byEdge, catalogRow, catalogTable } from '../../exact/index.ts'
import type { CatalogRow } from '../../exact/index.ts'
import { coachPercent, sourceOf } from '../numbers.ts'
import type { Advice, Advisor } from './advice.ts'
import { adviceId, spotLabel } from './advice.ts'

/**
 * Crapless context (plan §5.4 variantContext): on a crapless machine, the do line's protection
 * from craps is paid for — the pass edge here against the same bet on the traditional bubble
 * preset, next to the machine's own cheapest number bet. All three numbers are computed
 * (`catalogRow` on each config), none are typed in; each carries its own config hash.
 */

export const variantContext: Advisor = (input): Advice[] => {
  const { cfg, spec } = input
  if (cfg.ruleset.variant !== 'crapless' || spec.number !== null) return []
  const type = cfg.catalog.get(spec.typeId)
  if (type?.family !== 'line' || type.side !== 'do') return []

  const own = catalogRow(spec, cfg)
  const traditional = compileConfig(PRESETS.traditionalBubble)
  const tradLine = doLineSpec(traditional)
  if (tradLine === null) return []
  const tradRow = catalogRow(tradLine, traditional)
  const cheap = cheapestNumberBet(cfg)
  if (cheap === undefined) return []

  const subject = {
    typeId: spec.typeId,
    number: spec.number,
    ...(input.betId === null ? {} : { betId: input.betId }),
  }
  return [
    {
      id: adviceId('variant-context', subject),
      ruleId: 'variant-context',
      severity: 'info',
      subject,
      templateId: 'variant-context',
      numbers: {
        crapless: coachPercent(
          own.edge,
          sourceOf('catalogRow', { spec, amount: own.amount }, cfg),
          own.assumedPaths,
        ),
        traditional: coachPercent(
          tradRow.edge,
          sourceOf('catalogRow', { spec: tradLine, amount: tradRow.amount }, traditional),
          tradRow.assumedPaths,
        ),
        cheap: coachPercent(
          cheap.edge,
          sourceOf('catalogRow', { spec: cheap.spec, amount: cheap.amount }, cfg),
          cheap.assumedPaths,
        ),
      },
      words: { name: spotLabel(cfg, spec), cheap: cheap.label },
      impact: Fraction.ZERO,
      edge: own.edge,
    },
  ]
}

/** The traditional preset's come-out do line, read from its own catalog. */
function doLineSpec(cfg: ReturnType<typeof compileConfig>) {
  for (const type of cfg.catalog.values()) {
    if (type.family === 'line' && type.side === 'do' && type.window === 'comeOut') {
      return { typeId: type.typeId, number: null }
    }
  }
  return null
}

/** The machine's cheapest number-vs-seven bet at its exact unit. */
function cheapestNumberBet(cfg: ReturnType<typeof compileConfig>): CatalogRow | undefined {
  return byEdge(catalogTable(cfg)).find((row) => row.family === 'numberVsSeven')
}
