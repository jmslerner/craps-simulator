/**
 * Post-build guard, run by `npm run verify` after `vite build`.
 *
 * Fails when the production build contains the e2e test hooks (`__CRAPS_TEST__`, which may exist
 * only in `vite build --mode e2e` builds), or when the JavaScript loaded by index.html is over its
 * gzip budget.
 *
 * TODO(M10a): enforce the rest of the §10 M10a budgets once those chunks exist:
 *   - the initial JS contains no three or Rapier code
 *   - the lazy dome chunk is at most 350 KB gzip
 *   - the physics worker is at most 900 KB
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

const TEST_HOOK = '__CRAPS_TEST__'
/** §10 M10a: initial JS at most 250 KB gzip. Checkable from M0, so enforced from M0. */
const INITIAL_JS_BUDGET = 250_000

const USAGE = `Usage: node scripts/check-bundle.ts [--dir <build dir>]

Checks a production build (default: dist) for leaked e2e test hooks and the initial JS budget.`

const OPTIONS = {
  dir: { type: 'string', default: 'dist' },
  help: { type: 'boolean', short: 'h' },
} as const

function main(args: string[]): number {
  let options
  try {
    options = parseArgs({ args, options: OPTIONS }).values
  } catch (error) {
    console.error(`check-bundle: ${error instanceof Error ? error.message : String(error)}`)
    console.error(USAGE)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  const dir = options.dir
  if (!existsSync(join(dir, 'index.html'))) {
    console.error(`check-bundle: ${join(dir, 'index.html')} not found; run vite build first.`)
    return 1
  }

  const failures: string[] = []
  const files = listFiles(dir)
  for (const file of files) {
    if (readFileSync(join(dir, file)).includes(TEST_HOOK)) {
      failures.push(`${file} contains ${TEST_HOOK}; test hooks belong only in --mode e2e builds`)
    }
  }

  const initial = initialScripts(readFileSync(join(dir, 'index.html'), 'utf8'))
  const missing = initial.filter((file) => !existsSync(join(dir, file)))
  for (const file of missing) failures.push(`index.html loads ${file}, which is not in ${dir}`)
  const initialBytes = initial
    .filter((file) => !missing.includes(file))
    .reduce((sum, file) => sum + gzipSync(readFileSync(join(dir, file))).length, 0)
  if (initialBytes > INITIAL_JS_BUDGET) {
    failures.push(
      `initial JS is ${kb(initialBytes)} gzip, over the ${kb(INITIAL_JS_BUDGET)} budget`,
    )
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-bundle: ${failure}`)
    return 1
  }
  console.log(
    `check-bundle: ${dir} OK. No ${TEST_HOOK} in ${files.length} files; initial JS is ` +
      `${kb(initialBytes)} gzip of a ${kb(INITIAL_JS_BUDGET)} budget.`,
  )
  return 0
}

/** Every file under `dir`, relative to it, with forward slashes. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/** Module scripts and modulepreload links in index.html: the JS fetched before first paint. */
function initialScripts(html: string): string[] {
  const urls = [...html.matchAll(/<(script|link)\b[^>]*>/g)].flatMap(([tag, name]) => {
    if (name === 'link' && !/\brel="modulepreload"/.test(tag)) return []
    const url = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1]
    return url === undefined || /^[a-z]+:/i.test(url) ? [] : [url.replace(/^\.?\//, '')]
  })
  return [...new Set(urls)]
}

function kb(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`
}

process.exitCode = main(process.argv.slice(2))
