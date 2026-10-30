/**
 * Post-build guard, run by `npm run verify` after `vite build`.
 *
 * Fails when the production build contains the e2e test hooks — the `__CRAPS_TEST__` window hook
 * or any trace of the testHooks module, which may exist only in `vite build --mode e2e` builds —
 * or when a chunk breaks the §10 M10a budgets:
 *   - the JavaScript loaded by index.html is at most 250 KB gzip and contains no three or Rapier
 *   - the lazy chunks (every non-initial, non-worker JS chunk: the 3D dome, and since M12/M13 the
 *     machine editor's views, the session summary and the exact-analysis code they share) total at
 *     most 350 KB gzip, and one of them carries three, so the dome really is split off
 *   - the physics worker is at most 900 KB gzip and is the only chunk carrying Rapier
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

const TEST_HOOK = '__CRAPS_TEST__'
/**
 * Strings that betray `src/ui/services/testHooks.ts` in a bundle: the window hook's property name
 * (minifiers keep property names), the e2e preset's provenance note, a string literal unique to
 * that module which survives minification even when the hook installer was tree-shaken away, and
 * the 3D readout's hook property `domeReadout` (the dome itself only offers a generic `inspect`,
 * which the App hands to the hooks behind the e2e mode check). The dice-script regex is NOT a
 * usable marker: the engine's own `compile.ts` carries the same `([1-6])-([1-6])` literal for
 * hop-bet config keys, legitimately, in every build.
 */
const TEST_HOOK_MARKERS: readonly string[] = [TEST_HOOK, 'e2e test preset:', 'domeReadout']
/** A chunk split from the testHooks module keeps its name: `assets/testHooks-<hash>.js`. */
const TEST_HOOK_FILE = /testhooks/i

/** §10 M10a budgets, gzip bytes. */
export const BUDGETS = {
  initialJs: 250_000,
  domeChunks: 350_000,
  physicsWorker: 900_000,
} as const

export type Budgets = { readonly [K in keyof typeof BUDGETS]: number }

/**
 * three's own error prefixes (`THREE.WebGLRenderer: ...`) are string literals, so they survive
 * minification; no other module writes `THREE.` followed by a capitalised name.
 */
const THREE_MARKER = /THREE\.[A-Z][A-Za-z]+/
/**
 * Rapier's compat build is wasm-bindgen glue around an inlined base64 WebAssembly module: the glue
 * exports `__wbindgen_*` names, and base64 of the `\0asm` header is `AGFzbQ`.
 */
const RAPIER_MARKERS: readonly string[] = ['__wbindgen', 'AGFzbQ']
/** Vite names a worker chunk after its source file: `assets/physics.worker-<hash>.js`. */
const PHYSICS_WORKER_FILE = /^physics\.worker[-.]/i
const WORKER_FILE = /\.worker[-.][^/]*\.js$/i
const JS_FILE = /\.m?js$/i

/**
 * The test-hook failures one bundle file contributes (plan §10 M8: the production bundle contains
 * no `__CRAPS_TEST__` and no testHooks module): the file IS the testHooks chunk by name, or its
 * content carries a marker. Pure over (name, content), so the unit test can feed it fixtures
 * (`tests/bundle/checkBundle.test.ts`).
 */
export function testHookOffences(file: string, content: string | Buffer): string[] {
  const offences: string[] = []
  if (TEST_HOOK_FILE.test(basename(file))) {
    offences.push(`${file} is a testHooks chunk; the module belongs only in --mode e2e builds`)
  }
  for (const marker of TEST_HOOK_MARKERS) {
    if (content.includes(marker)) {
      const what = marker === TEST_HOOK ? TEST_HOOK : `the testHooks marker "${marker}"`
      offences.push(`${file} contains ${what}; test hooks belong only in --mode e2e builds`)
    }
  }
  return offences
}

export interface BundleFile {
  /** Relative to the build directory, with forward slashes. */
  readonly path: string
  readonly content: string | Buffer
}

export interface ChunkGroup {
  readonly files: readonly string[]
  readonly gzipBytes: number
}

export interface BundleReport {
  readonly failures: readonly string[]
  /** The scripts index.html loads before first paint. */
  readonly initial: ChunkGroup
  /** Every other JS chunk that is not a worker: the lazy dome and whatever else splits. */
  readonly dome: ChunkGroup
  readonly physicsWorker: { readonly file: string; readonly gzipBytes: number } | null
}

const hasThree = (content: string | Buffer): boolean => THREE_MARKER.test(content.toString())
const hasRapier = (content: string | Buffer): boolean =>
  RAPIER_MARKERS.some((marker) => content.includes(marker))
const gzipBytes = (content: string | Buffer): number => gzipSync(content).length

/**
 * The §10 M10a chunk budgets over a build: pure over index.html and the files, so the unit test
 * feeds it fixtures. Workers are told by name; the physics worker must be exactly one file.
 */
export function bundleReport(
  html: string,
  files: readonly BundleFile[],
  budgets: Budgets = BUDGETS,
): BundleReport {
  const failures: string[] = []
  const byPath = new Map(files.map((file) => [file.path, file] as const))
  const initialPaths = initialScripts(html)
  const initialFiles: BundleFile[] = []
  for (const path of initialPaths) {
    const file = byPath.get(path)
    if (file === undefined) failures.push(`index.html loads ${path}, which is not in the build`)
    else initialFiles.push(file)
  }
  const sum = (group: readonly BundleFile[]) =>
    group.reduce((total, file) => total + gzipBytes(file.content), 0)

  const initialBytes = sum(initialFiles)
  if (initialBytes > budgets.initialJs) {
    failures.push(
      `initial JS is ${kb(initialBytes)} gzip, over the ${kb(budgets.initialJs)} budget`,
    )
  }
  for (const file of initialFiles) {
    if (hasThree(file.content)) {
      failures.push(`initial JS ${file.path} contains three; the dome must be a lazy chunk`)
    }
    if (hasRapier(file.content)) {
      failures.push(`initial JS ${file.path} contains Rapier; physics belongs in its worker`)
    }
  }

  const initialSet = new Set(initialPaths)
  const scripts = files.filter((file) => JS_FILE.test(file.path) && !initialSet.has(file.path))
  const workers = scripts.filter((file) => WORKER_FILE.test(basename(file.path)))
  const physicsWorkers = workers.filter((file) => PHYSICS_WORKER_FILE.test(basename(file.path)))
  const domeFiles = scripts.filter((file) => !WORKER_FILE.test(basename(file.path)))

  let physicsWorker: BundleReport['physicsWorker'] = null
  if (physicsWorkers.length === 0) {
    failures.push('no physics worker chunk (assets/physics.worker-*.js) is in the build')
  } else if (physicsWorkers.length > 1) {
    failures.push(
      `more than one physics worker chunk: ${physicsWorkers.map((f) => f.path).join(', ')}`,
    )
  } else {
    const [file] = physicsWorkers
    if (file !== undefined) {
      const bytes = gzipBytes(file.content)
      physicsWorker = { file: file.path, gzipBytes: bytes }
      if (bytes > budgets.physicsWorker) {
        failures.push(
          `physics worker ${file.path} is ${kb(bytes)} gzip, over the ` +
            `${kb(budgets.physicsWorker)} budget`,
        )
      }
      if (!hasRapier(file.content)) {
        failures.push(
          `physics worker ${file.path} does not contain Rapier: is it still the physics worker?`,
        )
      }
    }
  }
  for (const file of workers) {
    if (!PHYSICS_WORKER_FILE.test(basename(file.path)) && hasRapier(file.content)) {
      failures.push(`worker ${file.path} contains Rapier; only the physics worker may`)
    }
    if (hasThree(file.content)) failures.push(`worker ${file.path} contains three`)
  }

  const domeBytes = sum(domeFiles)
  if (domeBytes > budgets.domeChunks) {
    failures.push(
      `the lazy chunks total ${kb(domeBytes)} gzip, over the ${kb(budgets.domeChunks)} dome budget`,
    )
  }
  if (!domeFiles.some((file) => hasThree(file.content))) {
    failures.push('no lazy chunk contains three: the dome is missing or was not split off')
  }
  for (const file of domeFiles) {
    if (hasRapier(file.content)) {
      failures.push(`lazy chunk ${file.path} contains Rapier; only the physics worker may`)
    }
  }

  return {
    failures,
    initial: { files: initialFiles.map((file) => file.path), gzipBytes: initialBytes },
    dome: { files: domeFiles.map((file) => file.path), gzipBytes: domeBytes },
    physicsWorker,
  }
}

const USAGE = `Usage: node scripts/check-bundle.ts [--dir <build dir>]

Checks a production build (default: dist) for leaked e2e test hooks and the §10 M10a chunk
budgets: initial JS (no three, no Rapier), the lazy chunks (the dome and the views loaded on
demand) and the physics worker.`

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
  const files: BundleFile[] = listFiles(dir).map((path) => ({
    path,
    content: readFileSync(join(dir, path)),
  }))
  for (const file of files) failures.push(...testHookOffences(file.path, file.content))

  const report = bundleReport(readFileSync(join(dir, 'index.html'), 'utf8'), files)
  failures.push(...report.failures)

  if (failures.length > 0) {
    for (const failure of failures) console.error(`check-bundle: ${failure}`)
    return 1
  }
  const worker = report.physicsWorker
  console.log(
    `check-bundle: ${dir} OK. No test hooks in ${files.length} files; initial JS ` +
      `${kb(report.initial.gzipBytes)} gzip of ${kb(BUDGETS.initialJs)} (no three, no Rapier); ` +
      `lazy chunks ${kb(report.dome.gzipBytes)} of ${kb(BUDGETS.domeChunks)} ` +
      `(${report.dome.files.length} files: the dome and the views loaded on demand); ` +
      `physics worker ` +
      `${worker === null ? 'missing' : `${kb(worker.gzipBytes)} of ${kb(BUDGETS.physicsWorker)}`}.`,
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
export function initialScripts(html: string): string[] {
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

// Runnable directly (`node scripts/check-bundle.ts`) and importable by its unit test without
// running: only the entry file executes main.
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2))
}
