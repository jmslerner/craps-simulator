/**
 * Prints the exact house-edge table for a machine preset:
 * `node scripts/edges.ts --preset crapless-bubble`.
 *
 * Only --help works until the exact solver lands in M6. The table will be computed by src/exact
 * from the preset's config, never typed in.
 */
import { parseArgs } from 'node:util'

const USAGE = `Usage: node scripts/edges.ts --preset <id>

Prints the exact house edge of every offered bet on a machine preset, computed from its config.

Options:
  --preset <id>  machine preset, e.g. crapless-bubble
  -h, --help     show this help`

const OPTIONS = {
  preset: { type: 'string' },
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
  console.error('edges: the edge table arrives with the exact solver in milestone M6.')
  return 1
}

process.exitCode = main(process.argv.slice(2))
