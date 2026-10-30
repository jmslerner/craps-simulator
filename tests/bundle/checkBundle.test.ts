import { describe, expect, it } from 'vitest'
import {
  BUDGETS,
  bundleReport,
  initialScripts,
  testHookOffences,
  type BundleFile,
  type Budgets,
} from '../../scripts/check-bundle.ts'

/**
 * The check-bundle assertion logic, unit-tested against tiny fixture strings: the test-hook
 * absence (plan §10 M8) and the §10 M10a chunk budgets — initial JS with no three or Rapier, the
 * lazy dome chunks, the physics worker. The integrator runs `node scripts/check-bundle.ts` itself
 * against the real `vite build` output in `npm run verify`; these tests pin what that run asserts.
 */

describe('testHookOffences', () => {
  it('flags the window hook property name, which minifiers keep', () => {
    const found = testHookOffences('assets/index-Ab12Cd.js', 'target.__CRAPS_TEST__=api;')
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('__CRAPS_TEST__')
    expect(found[0]).toContain('assets/index-Ab12Cd.js')
  })

  it('flags the e2e preset note even when the hook name was tree-shaken away', () => {
    const minified = 'note:"e2e test preset: a winning pass returns, so the §10 run banks $631."'
    const found = testHookOffences('assets/index-Ab12Cd.js', minified)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('testHooks marker')
  })

  it('flags the 3D readout hook, which only the e2e test hooks carry', () => {
    const found = testHookOffences('assets/index-Ab12Cd.js', 'api={domeReadout:()=>r(d)};')
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('domeReadout')
  })

  it('does not flag the engine dice-key regex that every build carries legitimately', () => {
    const compileTs = 'const DICE_KEY=/^([1-6])-([1-6])$/;'
    expect(testHookOffences('assets/index-Ab12Cd.js', compileTs)).toHaveLength(0)
  })

  it('flags a testHooks chunk by file name alone, case-insensitively', () => {
    expect(testHookOffences('assets/testHooks-D4f2Gh.js', 'whatever')).toHaveLength(1)
    expect(testHookOffences('assets/TestHooks-D4f2Gh.js', 'whatever')).toHaveLength(1)
  })

  it('does not read the directory part as a chunk name', () => {
    expect(testHookOffences('testHooks/vendor-Ab12Cd.js', 'clean')).toHaveLength(0)
  })

  it('searches bytes, so binary assets are covered too', () => {
    const blob = Buffer.from('\u0000\u0001__CRAPS_TEST__\u0002', 'utf8')
    expect(testHookOffences('assets/font-Ab12Cd.woff2', blob)).toHaveLength(1)
  })

  it('reports each marker it finds', () => {
    const both = 'w.__CRAPS_TEST__=x;note:"e2e test preset: pinned"'
    expect(testHookOffences('assets/testHooks-D4f2Gh.js', both)).toHaveLength(3)
  })

  it('passes a clean production file', () => {
    const clean = 'const dice=`${d1}-${d2}`;export{dice};'
    expect(testHookOffences('assets/index-Ab12Cd.js', clean)).toHaveLength(0)
    expect(testHookOffences('index.html', Buffer.from('<!doctype html>'))).toHaveLength(0)
  })
})

// --- §10 M10a budgets -------------------------------------------------------------------------

const HTML =
  '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-Css.css">' +
  '<link rel="modulepreload" crossorigin href="/assets/engine-Pre.js"></head>' +
  '<body><script type="module" crossorigin src="/assets/index-Ab12Cd.js"></script></body></html>'

/** What three leaves in a minified chunk: its own error prefixes. */
const THREE_CODE = 'console.error("THREE.WebGLRenderer: Error creating WebGL context.");'
/** What Rapier's compat build leaves: wasm-bindgen glue and the base64 WebAssembly header. */
const RAPIER_CODE = 'const wasm="AGFzbQEAAAABpQ";function __wbindgen_throw(){}'

function build(overrides: Partial<Record<string, string | null>> = {}): BundleFile[] {
  const files: Record<string, string | null> = {
    'index.html': HTML,
    'assets/index-Css.css': '.dome{position:relative}',
    'assets/index-Ab12Cd.js': 'const app=1;export{app};',
    'assets/engine-Pre.js': 'export const engine=2;',
    'assets/DomeView-D0m3.js': `${THREE_CODE}export default function Dome(){}`,
    'assets/physics.worker-Ph1s.js': `${RAPIER_CODE}self.onmessage=()=>{};`,
    'assets/analysis.worker-An4l.js': 'self.onmessage=()=>{solve()};',
    'fonts/barlow-400.woff2': 'wOF2',
    ...overrides,
  }
  return Object.entries(files)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([path, content]) => ({ path, content }))
}

/** Budgets the fixtures fit in comfortably. */
const ROOMY: Budgets = { initialJs: 10_000, domeChunks: 10_000, physicsWorker: 10_000 }

describe('initialScripts', () => {
  it('reads module scripts and modulepreload links, not stylesheets or external URLs', () => {
    const html = HTML + '<script type="module" src="https://cdn.example/x.js"></script>'
    expect(initialScripts(html)).toStrictEqual(['assets/engine-Pre.js', 'assets/index-Ab12Cd.js'])
  })
})

describe('bundleReport', () => {
  it('passes a build that honours every budget, and measures each group', () => {
    const report = bundleReport(HTML, build(), ROOMY)
    expect(report.failures).toStrictEqual([])
    expect(report.initial.files).toStrictEqual(['assets/engine-Pre.js', 'assets/index-Ab12Cd.js'])
    expect(report.initial.gzipBytes).toBeGreaterThan(0)
    expect(report.dome.files).toStrictEqual(['assets/DomeView-D0m3.js'])
    expect(report.dome.gzipBytes).toBeGreaterThan(0)
    expect(report.physicsWorker?.file).toBe('assets/physics.worker-Ph1s.js')
    expect(report.physicsWorker?.gzipBytes).toBeGreaterThan(0)
  })

  it('ships the real budgets: 250 KB initial, 350 KB dome, 900 KB physics worker', () => {
    expect(BUDGETS).toStrictEqual({
      initialJs: 250_000,
      domeChunks: 350_000,
      physicsWorker: 900_000,
    })
    expect(bundleReport(HTML, build()).failures).toStrictEqual([])
  })

  it('fails initial JS that carries three or Rapier', () => {
    const three = bundleReport(HTML, build({ 'assets/index-Ab12Cd.js': THREE_CODE }), ROOMY)
    expect(three.failures.some((f) => f.includes('initial JS') && f.includes('three'))).toBe(true)
    const rapier = bundleReport(HTML, build({ 'assets/engine-Pre.js': RAPIER_CODE }), ROOMY)
    expect(rapier.failures.some((f) => f.includes('initial JS') && f.includes('Rapier'))).toBe(true)
  })

  it('fails each group over its budget, naming the sizes', () => {
    const tight: Budgets = { initialJs: 10, domeChunks: 10, physicsWorker: 10 }
    const { failures } = bundleReport(HTML, build(), tight)
    expect(failures).toHaveLength(3)
    expect(failures.find((f) => f.startsWith('initial JS is'))).toMatch(/over the 0\.0 kB budget/)
    expect(failures.find((f) => f.includes('dome budget'))).toMatch(/the lazy chunks total/)
    expect(failures.find((f) => f.startsWith('physics worker'))).toMatch(/over the/)
  })

  it('fails a build whose dome never split off: no lazy chunk carries three', () => {
    const { failures } = bundleReport(HTML, build({ 'assets/DomeView-D0m3.js': null }), ROOMY)
    expect(failures).toStrictEqual([
      'no lazy chunk contains three: the dome is missing or was not split off',
    ])
  })

  it('requires exactly one physics worker, carrying Rapier', () => {
    const none = bundleReport(HTML, build({ 'assets/physics.worker-Ph1s.js': null }), ROOMY)
    expect(none.failures).toStrictEqual([
      'no physics worker chunk (assets/physics.worker-*.js) is in the build',
    ])
    const two = bundleReport(
      HTML,
      build({ 'assets/physics.worker-Tw0.js': `${RAPIER_CODE}export{}` }),
      ROOMY,
    )
    expect(two.failures.some((f) => f.startsWith('more than one physics worker'))).toBe(true)
    const hollow = bundleReport(
      HTML,
      build({ 'assets/physics.worker-Ph1s.js': 'self.onmessage=()=>{}' }),
      ROOMY,
    )
    expect(hollow.failures.some((f) => f.includes('does not contain Rapier'))).toBe(true)
  })

  it('keeps Rapier out of every other chunk and three out of the workers', () => {
    const inAnalysis = bundleReport(
      HTML,
      build({ 'assets/analysis.worker-An4l.js': RAPIER_CODE }),
      ROOMY,
    )
    expect(inAnalysis.failures).toStrictEqual([
      'worker assets/analysis.worker-An4l.js contains Rapier; only the physics worker may',
    ])
    const inDome = bundleReport(
      HTML,
      build({ 'assets/DomeView-D0m3.js': THREE_CODE + RAPIER_CODE }),
      ROOMY,
    )
    expect(inDome.failures).toStrictEqual([
      'lazy chunk assets/DomeView-D0m3.js contains Rapier; only the physics worker may',
    ])
    const threeInWorker = bundleReport(
      HTML,
      build({ 'assets/analysis.worker-An4l.js': THREE_CODE }),
      ROOMY,
    )
    expect(threeInWorker.failures).toStrictEqual([
      'worker assets/analysis.worker-An4l.js contains three',
    ])
  })

  it('reports an initial script that index.html loads but the build lacks', () => {
    const { failures } = bundleReport(HTML, build({ 'assets/engine-Pre.js': null }), ROOMY)
    expect(failures).toStrictEqual([
      'index.html loads assets/engine-Pre.js, which is not in the build',
    ])
  })

  it('counts only JS: stylesheets, fonts and the page are no chunks', () => {
    const report = bundleReport(HTML, build(), ROOMY)
    const counted = [...report.initial.files, ...report.dome.files, report.physicsWorker?.file]
    expect(counted.every((path) => path?.endsWith('.js'))).toBe(true)
  })
})
