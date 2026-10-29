/**
 * Prints the exact house-edge table for a machine preset:
 * `node scripts/edges.ts --preset crapless-bubble`.
 *
 * Every number is computed by src/exact from the preset's config with the engine's own rules (the
 * catalog table, `catalogTable`), never typed in, and printed exactly: percentages through
 * `Fraction.formatPercent`, money through `formatCents`, and each edge also as its fraction.
 */
import { parseArgs } from 'node:util'
import {
  PRESETS,
  PRESET_IDS,
  compileConfig,
  formatCents,
  isPresetId,
  type MachineConfig,
  type PresetId,
} from '../src/engine/index.ts'
import { byEdge, catalogTable, roundStats, type CatalogRow } from '../src/exact/index.ts'

const USAGE = `Usage: node scripts/edges.ts --preset <id> [--sort config|edge] [--digits N]

Prints the exact house edge of every offered bet on a machine preset, computed from its config.
Each bet is priced at its exact unit, the smallest stake the machine pays exactly; where the
smallest legal stake costs more, that edge is shown too. "A" marks a number resting on an
assumed config value.

Options:
  --preset <id>   machine preset: ${PRESET_IDS.join(', ')}
                  (dashed forms such as crapless-bubble also work)
  --sort <order>  config (default) or edge, cheapest first
  --digits N      decimals in percentages (default 4)
  -h, --help      show this help`

const OPTIONS = {
  preset: { type: 'string' },
  sort: { type: 'string', default: 'config' },
  digits: { type: 'string', default: '4' },
  help: { type: 'boolean', short: 'h' },
} as const

function main(args: string[]): number {
  let options
  try {
    options = parseArgs({ args, options: OPTIONS }).values
  } catch (error) {
    console.error(`edges: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const preset = options.preset === undefined ? null : presetId(options.preset)
  if (preset === null) {
    console.error(`edges: name a preset with --preset (${PRESET_IDS.join(', ')})\n\n${USAGE}`)
    return 2
  }
  const digits = Number(options.digits)
  if (!Number.isSafeInteger(digits) || digits < 0 || digits > 12) {
    console.error('edges: --digits must be a whole number from 0 to 12')
    return 2
  }
  if (options.sort !== 'config' && options.sort !== 'edge') {
    console.error('edges: --sort must be config or edge')
    return 2
  }
  const cfg = compileConfig(PRESETS[preset])
  const rows = catalogTable(cfg)
  console.log(report(cfg, options.sort === 'edge' ? byEdge(rows) : rows, digits))
  return 0
}

/** A preset id from its own camelCase form or a dashed one ("crapless-bubble"). */
function presetId(text: string): PresetId | null {
  const camel = text.trim().replace(/[-_]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase())
  return isPresetId(camel) ? camel : null
}

function report(cfg: MachineConfig, rows: readonly CatalogRow[], digits: number): string {
  const stats = roundStats(cfg)
  const pct = (value: { formatPercent(digits: number): string }) =>
    `${value.formatPercent(digits)}%`
  const header = [
    `${cfg.name} (${cfg.id}, config ${cfg.configHash})`,
    `Rolls per pass decision ${stats.rollsPerDecision.toString()}; ` +
      `per hand ${stats.rollsPerHand.toString()}; ` +
      `come-out share ${stats.comeOutShare.toString()} = ${pct(stats.comeOutShare)}`,
    '',
  ]
  const table = [
    [
      'Bet',
      'Stake',
      'Pays',
      'Edge',
      'Exact',
      'Nominal',
      'Per roll',
      'P(win)',
      'Rolls',
      'At minimum',
      'A',
    ],
    ...rows.map((row) => [
      row.label,
      formatCents(row.amount),
      row.payoutLabel,
      pct(row.edge),
      row.edge.toString(),
      pct(row.nominalEdge),
      pct(row.edgePerWorkingRoll),
      row.pWin.toString(),
      row.expectedRolls.toString(),
      row.atMinimum === null
        ? ''
        : `${formatCents(row.atMinimum.amount)}: ${pct(row.atMinimum.edge)}`,
      row.assumedPaths.length > 0 ? 'A' : '',
    ]),
  ]
  const widths = table[0]?.map((_, column) =>
    Math.max(...table.map((line) => (line[column] ?? '').length)),
  )
  const lines = table.map((line) =>
    line
      .map((cell, column) => {
        const width = widths?.[column] ?? cell.length
        return column === 0 || column === 2 || column === 9
          ? cell.padEnd(width)
          : cell.padStart(width)
      })
      .join('  ')
      .trimEnd(),
  )
  const note =
    "Edge: expected loss ÷ amount risked over the bet's life, left up until it loses (glossary).\n" +
    'Per roll: expected loss per working roll, per unit staked.'
  return [...header, ...lines, '', note].join('\n')
}

process.exitCode = main(process.argv.slice(2))
