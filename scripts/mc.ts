/**
 * Runs the Monte Carlo decision sampler against the exact solver for one preset and prints each
 * bet's gap: `node scripts/mc.ts --preset crapless-bubble --decisions 20000`.
 *
 * For every offered bet, `--decisions` decisions are sampled through the engine's own
 * decide/settle (src/sim/decisions.ts, dice from the engine RNG under a pinned seed) and compared
 * with src/exact's decision distribution: the sample mean loss against the exact mean in units of
 * the sample mean's standard error (the exact σ/√n), largest gap first. The slow suite
 * (tests/slow/mc.decisions.slow.test.ts) holds every row under 4σ plus a χ² on the outcome
 * labels; this script is the same harness as a quick diagnostic.
 */
import { parseArgs } from 'node:util'
import {
  PRESETS,
  PRESET_IDS,
  compileConfig,
  isPresetId,
  seedRng,
  type PresetId,
} from '../src/engine/index.ts'
import { catalogTable, typicalStart } from '../src/exact/index.ts'
import { decisionExpectation, sampleDecisions } from '../src/sim/index.ts'

const USAGE = `Usage: node scripts/mc.ts --preset <id> [--decisions N] [--seed tag]

Samples every offered bet through the engine's own decide/settle and prints the gap between the
sample mean loss and the exact mean, in standard errors (σ from src/exact), largest first.

Options:
  --preset <id>     machine preset: ${PRESET_IDS.join(', ')}
                    (dashed forms such as crapless-bubble also work)
  --decisions N     decisions per bet (default 20000)
  --seed <tag>      seed namespace (default mc:v4, the slow suite's)
  -h, --help        show this help`

const OPTIONS = {
  preset: { type: 'string' },
  decisions: { type: 'string', default: '20000' },
  seed: { type: 'string', default: 'mc:v4' },
  help: { type: 'boolean', short: 'h' },
} as const

function main(args: string[]): number {
  let options
  try {
    options = parseArgs({ args, options: OPTIONS }).values
  } catch (error) {
    console.error(`mc: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const preset = options.preset === undefined ? null : presetId(options.preset)
  if (preset === null) {
    console.error(`mc: name a preset with --preset (${PRESET_IDS.join(', ')})\n\n${USAGE}`)
    return 2
  }
  const decisions = Number(options.decisions)
  if (!Number.isSafeInteger(decisions) || decisions < 100 || decisions > 10_000_000) {
    console.error('mc: --decisions must be a whole number from 100 to 10000000')
    return 2
  }
  const cfg = compileConfig(PRESETS[preset])
  const started = Date.now()
  const lines: { readonly sigmas: number; readonly text: string }[] = []
  let rolls = 0
  for (const row of catalogTable(cfg)) {
    const { spec } = row
    const amount = row.atMinimum?.amount ?? row.amount
    const start = typicalStart(spec, cfg)
    const exp = decisionExpectation(spec, start, amount, cfg)
    const sample = sampleDecisions(
      spec,
      start,
      amount,
      cfg,
      decisions,
      seedRng(`${options.seed}:${preset}:${spec.typeId}:${String(spec.number)}`),
    )
    rolls += sample.rolls
    const mean = exp.meanLoss.toNumber()
    const sampled = exp.outlay.toNumber() - sample.totalCash / decisions
    const sigmas = Math.abs(sampled - mean) / Math.sqrt(exp.variance.toNumber() / decisions)
    const name = spec.number === null ? spec.typeId : `${spec.typeId} ${spec.number}`
    lines.push({
      sigmas,
      text:
        `${name.padEnd(16)} ${String(amount).padStart(6)}¢  ` +
        `sample ${sampled.toFixed(4).padStart(10)}¢  exact ${mean.toFixed(4).padStart(10)}¢  ` +
        `${sigmas.toFixed(2)}σ  (${sample.counts.size} labels)`,
    })
  }
  lines.sort((a, b) => b.sigmas - a.sigmas)
  console.log(`${cfg.name} (${cfg.id}): ${lines.length} bets × ${decisions} decisions`)
  console.log(`bet                stake  mean loss per decision            gap\n`)
  for (const { text } of lines) console.log(text)
  console.log(`\n${rolls} rolls in ${Date.now() - started} ms; seed namespace "${options.seed}"`)
  return lines.some(({ sigmas }) => sigmas > 4) ? 1 : 0
}

/** A preset id from its own camelCase form or a dashed one ("crapless-bubble"). */
function presetId(text: string): PresetId | null {
  const camel = text.trim().replace(/[-_]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase())
  return isPresetId(camel) ? camel : null
}

process.exitCode = main(process.argv.slice(2))
