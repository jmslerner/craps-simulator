import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  checkSource,
  findImports,
  findMethodUses,
  findUsages,
  formatViolation,
  lex,
  scanTree,
} from './architecture/scanner.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** `rule@line` for each violation, which keeps the fixture expectations readable. */
const check = (file: string, source: string) =>
  checkSource(file, source).map((violation) => `${violation.rule}@${violation.line}`)
const specifiers = (source: string) => findImports(lex(source)).map((ref) => ref.specifier)
const imp = (path: string) => `import { x } from '${path}'\n`

describe('architecture scanner flags planted violations', () => {
  it('a core file importing react', () => {
    expect(check('src/engine/core/clock.ts', "import { useState } from 'react'\n")).toEqual([
      'layering@1',
    ])
    expect(check('src/exact/view.ts', "import type { Canvas } from '@react-three/fiber'")).toEqual([
      'layering@1',
    ])
  })

  it('Math.random in engine', () => {
    const source = "export const roll = () => Math.random()\nexport const r = Math['random']\n"
    expect(check('src/engine/round/round.ts', source)).toEqual([
      'seeded-random@1',
      'seeded-random@2',
    ])
  })

  it('Date in engine', () => {
    const source = 'export const stamp = () => Date.now()\nexport const today = new Date()\n'
    expect(check('src/engine/table/ledger.ts', source)).toEqual(['purity@1', 'purity@2'])
  })

  it('a core file importing ../ui/...', () => {
    const source = "import { App } from '../ui/App.tsx'\nexport { App }\n"
    expect(check('src/exact/solve.ts', source)).toEqual(['layering@1'])
    expect(check('src/engine/core/x.ts', "export * from '../../workers/rpc.ts'")).toEqual([
      'layering@1',
    ])
  })

  it('a tests/oracle file importing src/engine/bets/...', () => {
    const source = "import { decide } from '../../src/engine/bets/families/line.ts'\n"
    expect(check('tests/oracle/referenceRules.ts', source)).toEqual(['oracle-independence@1'])
    expect(check('tests/oracle/x.ts', "import '../../src/engine/settle/settle.ts'")).toEqual([
      'oracle-independence@1',
    ])
    expect(check('tests/oracle/x.ts', "import { e } from '../../src/engine/index.ts'")).toEqual([
      'oracle-independence@1',
    ])
  })

  it('other purity bans in core: DOM, timers, crypto, host globals, references', () => {
    const source = [
      'export const w = window.innerWidth',
      'setTimeout(() => undefined, 1)',
      'export const t = performance.now()',
      'export const c = globalThis.crypto',
      '/// <reference lib="dom" />',
    ].join('\n')
    expect(check('src/coach/gate.ts', source)).toEqual([
      'purity@1',
      'purity@2',
      'purity@3',
      'purity@4',
      'purity@5',
    ])
  })
})

describe('architecture scanner layering', () => {
  it('follows engine -> exact -> coach, with sim on engine and exact', () => {
    expect(check('src/exact/solve.ts', imp('../engine/core/rational.ts'))).toEqual([])
    expect(check('src/coach/run.ts', imp('../exact/price.ts'))).toEqual([])
    expect(check('src/sim/runner.ts', imp('../exact/analyze.ts'))).toEqual([])
    expect(check('src/engine/table/roll.ts', imp('../../exact/chain.ts'))).toEqual(['layering@1'])
    expect(check('src/exact/chain.ts', imp('../coach/policy.ts'))).toEqual(['layering@1'])
    expect(check('src/sim/runner.ts', imp('../coach/run.ts'))).toEqual(['layering@1'])
    expect(check('src/engine/core/x.ts', imp('../../main.tsx'))).toEqual(['layering@1'])
  })

  it('keeps engine/core to itself, in its tests too', () => {
    expect(check('src/engine/core/money.ts', imp('./rational.ts'))).toEqual([])
    expect(check('src/engine/config/ratio.ts', imp('../core/rational.ts'))).toEqual([])
    expect(check('src/engine/round/round.ts', imp('../config/rulesets.ts'))).toEqual([])
    expect(check('src/engine/core/money.ts', imp('../config/ratio.ts'))).toEqual(['layering@1'])
    expect(check('src/engine/core/money.test.ts', imp('../config/ratio.ts'))).toEqual([
      'layering@1',
    ])
    expect(check('src/engine/core/x.ts', imp('../bets/registry.ts'))).toEqual(['layering@1'])
    expect(check('src/engine/core/x.ts', "import { z } from 'zod'")).toEqual(['layering@1'])
    expect(checkSource('src/engine/core/x.ts', imp('../config/ratio.ts'))[0]?.message).toBe(
      'src/engine/core may import only src/engine/core, not src/engine/config/ratio.ts',
    )
  })

  it('allows only zod in engine and only Rapier in physics/core', () => {
    const rapier = "import RAPIER from '@dimforge/rapier3d-deterministic-compat'"
    expect(check('src/engine/config/schema.ts', "import { z } from 'zod/v4'")).toEqual([])
    expect(check('src/physics/core/world.ts', rapier)).toEqual([])
    expect(check('src/engine/core/x.ts', rapier)).toEqual(['layering@1'])
    expect(check('src/physics/core/x.ts', "import { z } from 'zod'")).toEqual(['layering@1'])
    expect(check('src/physics/core/x.ts', "import '../../engine/core/dice.ts'")).toEqual([
      'layering@1',
    ])
    expect(check('src/engine/core/x.ts', "import { readFileSync } from 'node:fs'")).toEqual([
      'layering@1',
    ])
  })

  it('keeps the rest of src inside src', () => {
    expect(
      check('src/ui/App.tsx', "import { scenario } from '../../tests/scenarios/dsl.ts'"),
    ).toEqual(['src-boundary@1'])
    expect(check('src/ui/App.tsx', "import { create } from 'zustand'\nimport './a.css'")).toEqual(
      [],
    )
  })

  it('lets core tests use test tools and Node, but not Math.random', () => {
    const source = [
      "import { describe } from 'vitest'",
      "import fc from 'fast-check'",
      "import { readFileSync } from 'node:fs'",
      'const started = performance.now()',
      'const n = Math.floor(Math.random() * 6)',
    ].join('\n')
    expect(check('src/engine/core/dice.test.ts', source)).toEqual(['seeded-random@5'])
    expect(check('src/engine/core/dice.test.ts', "import { App } from '../../ui/App.tsx'")).toEqual(
      ['layering@1'],
    )
  })
})

describe('architecture scanner oracle independence', () => {
  it('keeps oracle modules off the engine rules, reducer, rulesets, barrel and solver', () => {
    const forbidden = [
      '../../src/engine/bets/families/line.ts',
      '../../src/engine/round/round.ts',
      '../../src/engine/settle/settle.ts',
      '../../src/engine/table/reducer.ts',
      '../../src/engine/session/replay.ts',
      '../../src/engine/config/rulesets.ts',
      '../../src/engine/index.ts',
      '../../src/exact/chain.ts',
      '../../src/exact/solve.ts?raw',
    ]
    for (const path of forbidden) {
      expect(check('tests/oracle/referenceRules.ts', imp(path)), path).toEqual([
        'oracle-independence@1',
      ])
    }
    expect(check('tests/oracle/denseSolve.ts', "export * from '../../src/exact/chain.ts'")).toEqual(
      ['oracle-independence@1'],
    )
    expect(check('tests/oracle/fire/dp.ts', imp('../../../src/engine/round/round.ts'))).toEqual([
      'oracle-independence@1',
    ])
    expect(check('tests/oracle/legacy.js', imp('../../src/exact/solve.ts'))).toEqual([
      'oracle-independence@1',
    ])
  })

  it('lets oracle modules use primitives, config and each other', () => {
    expect(check('tests/oracle/closedForm.ts', imp('../../src/engine/core/dice.ts'))).toEqual([])
    expect(check('tests/oracle/closedForm.ts', imp('../../src/engine/config/schema.ts'))).toEqual(
      [],
    )
    expect(check('tests/oracle/closedForm.ts', imp('./referenceRules.ts'))).toEqual([])
  })

  it('lets oracle tests import the engine and solver they compare against', () => {
    const source = [
      imp('../../src/engine/bets/families/line.ts'),
      imp('../../src/engine/index.ts'),
      imp('../../src/exact/analyze.ts'),
    ].join('')
    expect(check('tests/oracle/referenceRules.test.ts', source)).toEqual([])
  })

  it('lets the dispatch chain drive the reducer, but not import the solver', () => {
    const source = [
      imp('../../src/engine/index.ts'),
      imp('../../src/engine/round/round.ts'),
      imp('../../src/engine/table/reducer.ts'),
      imp('../../src/engine/session/replay.ts'),
      imp('../../src/engine/config/rulesets.ts'),
      imp('../../src/exact/chain.ts'),
    ].join('')
    expect(check('tests/oracle/dispatchChain.ts', source)).toEqual(['oracle-independence@6'])
  })

  it('bans Math.random in oracle modules and oracle tests alike', () => {
    expect(check('tests/oracle/closedForm.ts', 'export const r = Math.random()')).toEqual([
      'seeded-random@1',
    ])
    expect(check('tests/oracle/closedForm.test.ts', 'const { random } = Math')).toEqual([
      'seeded-random@1',
    ])
  })
})

describe('architecture scanner seeded tests', () => {
  it('bans Math.random everywhere under tests/, so randomized tests reproduce', () => {
    const source = 'const r = Math.random()\nconst { random } = Math\n'
    for (const file of [
      'tests/scenarios/dsl.ts',
      'tests/golden/published.test.ts',
      'tests/properties/money.prop.test.ts',
      'tests/slow/mc.slow.test.ts',
      'tests/architecture/scanner.ts',
    ]) {
      expect(check(file, source), file).toEqual(['seeded-random@1', 'seeded-random@2'])
    }
  })

  it('leaves e2e specs and scripts to their own rules', () => {
    const source = 'const r = Math.random()\n'
    expect(check('e2e/smoke.spec.ts', source)).toEqual([])
    expect(check('scripts/physics-stats.ts', source)).toEqual([])
  })
})

describe('architecture scanner import extensions', () => {
  it('requires relative and root imports to name their file', () => {
    const source = [
      "import { a } from './store'",
      "import type { B } from '../../src/engine/core/dice'",
      "export * from './barrel/'",
      "import c from '.'",
      "import d from '..'",
      "import e from '/src/main'",
      "const f = await import('./lazy.js')",
      "const g = require('./legacy.cjs')",
      "import PhysicsWorker from '../workers/physics.worker?worker'",
    ].join('\n')
    expect(check('tests/golden/published.test.ts', source)).toEqual([
      'import-extension@1',
      'import-extension@2',
      'import-extension@3',
      'import-extension@4',
      'import-extension@5',
      'import-extension@6',
      'import-extension@7',
      'import-extension@8',
      'import-extension@9',
    ])
  })

  it('accepts .ts, .tsx, assets and Vite queries, and leaves packages alone', () => {
    const source = [
      "import a from './a.ts'",
      "import B from '../ui/B.tsx'",
      "import './index.css'",
      "import styles from './x.module.css'",
      "import data from './fixtures/crapless-200.json' with { type: 'json' }",
      "import logo from './logo.svg?url'",
      "import glow from '../dome/glow.frag?raw'",
      "import PhysicsWorker from '../workers/physics.worker.ts?worker'",
      "import main from '/src/main.tsx'",
      "import { z } from 'zod'",
      "import { readFileSync } from 'node:fs'",
    ].join('\n')
    expect(check('src/ui/App.tsx', source)).toEqual([])
  })

  it('applies in core too, and only under src/ and tests/', () => {
    expect(check('src/engine/core/x.ts', "import { Fraction } from './rational'")).toEqual([
      'import-extension@1',
    ])
    expect(check('src/engine/core/x.ts', "import { Fraction } from './rational.js'")).toEqual([
      'import-extension@1',
    ])
    expect(check('scripts/edges.ts', "import { x } from './lib'")).toEqual([])
    expect(check('e2e/smoke.spec.ts', "import { x } from './support/hooks'")).toEqual([])
  })
})

describe('architecture scanner Math members by other routes', () => {
  it('sees banned members destructured from Math', () => {
    const source = [
      'const { random } = Math',
      'const { floor: f, sqrt, round } = Math',
      "let { ['ceil']: c } = Math",
      ';({ trunc } = Math)',
      'export function roll({ random: r } = Math) { return r() }',
      'const {',
      '  random: draw,',
      '  floor,',
      '} = Math',
    ].join('\n')
    expect(check('src/engine/settle/settle.ts', source)).toEqual([
      'seeded-random@1',
      'rounding@2',
      'rounding@2',
      'rounding@3',
      'rounding@4',
      'seeded-random@5',
      'seeded-random@7',
      'rounding@8',
    ])
  })

  it('sees through a type annotation on the pattern', () => {
    const source = [
      'const { random }: { random: () => number } = Math',
      "const { floor }: Pick<typeof Math, 'floor' | 'ceil'> = Math",
      'let { round }: MathLike = Math',
    ].join('\n')
    expect(check('src/exact/price.ts', source)).toEqual([
      'seeded-random@1',
      'rounding@2',
      'rounding@3',
    ])
  })

  it('ignores allowed members, other objects, aliases and Math as a default value', () => {
    const source = [
      'const { sqrt, PI } = Math',
      'const { random } = rng',
      'const M = Math',
      'const { scale = Math } = options',
      'const same = a === Math',
      'const pick = flag ? { random } : other',
      'total = Math',
    ].join('\n')
    expect(check('src/engine/settle/settle.ts', source)).toEqual([])
    expect(check('src/physics/core/hop.ts', 'const { floor, round } = Math')).toEqual([])
    expect(check('src/physics/core/hop.ts', 'const { random } = Math')).toEqual(['seeded-random@1'])
  })

  it('sees Math reached through globalThis, window or self', () => {
    const source = [
      'const r = globalThis.Math.random()',
      'const { random } = self.Math',
      "const f = window.Math['floor'](1)",
    ].join('\n')
    expect(check('src/engine/core/rng.test.ts', source)).toEqual([
      'seeded-random@1',
      'seeded-random@2',
    ])
    expect(check('src/engine/settle/settle.ts', source)).toEqual([
      'purity@1',
      'seeded-random@1',
      'seeded-random@2',
      'purity@3',
      'rounding@3',
    ])
    expect(check('src/engine/settle/settle.ts', 'const m = state.global.Math.random()')).toEqual([])
  })
})

describe('architecture scanner rounding', () => {
  const source =
    'export const f = (x: number) => Math.floor(x) + Math.round(x) + Math.ceil(x) + Math.trunc(x)\n'

  it('allows Math.floor/round/ceil/trunc only in engine/core/{money,rational}.ts', () => {
    expect(check('src/engine/core/money.ts', source)).toEqual([])
    expect(check('src/engine/core/rational.ts', source)).toEqual([])
    expect(check('src/engine/settle/settle.ts', source)).toEqual([
      'rounding@1',
      'rounding@1',
      'rounding@1',
      'rounding@1',
    ])
    expect(check('src/engine/core/dice.ts', source)).toHaveLength(4)
    expect(check('src/exact/price.ts', source)).toHaveLength(4)
    expect(check('src/coach/numbers.ts', source)).toHaveLength(4)
  })

  it('exempts sim, physics/core and tests', () => {
    expect(check('src/sim/runner.ts', source)).toEqual([])
    expect(check('src/physics/core/params.ts', source)).toEqual([])
    expect(check('src/engine/core/dice.test.ts', source)).toEqual([])
  })

  it('bans float formatting wherever Math rounding is banned', () => {
    const floats = [
      'export const a = share.toFixed(2)',
      'export const b = share.toPrecision(3)',
      'export const c = edge.toNumber()',
      "export const d = edge['toNumber']()",
      'export const e = edge?.toFixed(1)',
    ].join('\n')
    expect(check('src/exact/price.ts', floats)).toEqual([
      'rounding@1',
      'rounding@2',
      'rounding@3',
      'rounding@4',
      'rounding@5',
    ])
    expect(check('src/engine/config/compile.ts', floats)).toHaveLength(5)
    expect(check('src/coach/numbers.ts', floats)).toHaveLength(5)
    for (const allowed of [
      'src/engine/core/money.ts',
      'src/engine/core/rational.ts',
      'src/engine/core/rational.test.ts',
      'src/sim/runner.ts',
      'src/physics/core/params.ts',
      'src/ui/Meters.tsx',
      'tests/oracle/closedForm.test.ts',
    ]) {
      expect(check(allowed, floats), allowed).toEqual([])
    }
  })

  it('ignores look-alikes of the float methods', () => {
    const source = [
      "export const names = ['toFixed', 'toNumber']",
      'export const methods = { toNumber: 1, toFixed() { return 2 } }',
      'function toPrecision() { return 3 }',
      "export const note = 'call .toFixed(2) and never .toNumber()'",
      'export const spread = [...toFixed]',
    ].join('\n')
    expect(check('src/exact/price.ts', source)).toEqual([])
    const methods = new Set(['toFixed', 'toNumber'])
    expect(findMethodUses(lex('a.toFixed(1); return ["toNumber"]'), methods)).toEqual([
      { name: 'toFixed', line: 1 },
    ])
  })
})

describe('architecture scanner reads code, not prose', () => {
  it('ignores comments, strings, template text and regex literals', () => {
    const source = [
      '// Never call Math.random() or new Date() here; window is not available.',
      '/* setTimeout(() => {}, 0) and performance.now() are banned */',
      "export const note = 'Math.random() and Date.now() are banned'",
      'export const label = `window ${1 + 1} Date`',
      "export const pattern = /'Date'|window|\\/ \"/",
      "export const after = 'still code-aware'",
    ].join('\n')
    expect(check('src/engine/core/x.ts', source)).toEqual([])
  })

  it('still sees code inside template substitutions', () => {
    const source = 'export const id = `roll-${Date.now()}-${`${Math.random()}`}`\n'
    expect(check('src/engine/core/x.ts', source)).toEqual(['purity@1', 'seeded-random@1'])
  })

  it('skips property accesses, object keys and type members named like globals', () => {
    const source = [
      'export interface Session { window: number; document?: string }',
      'export const s = { window: 3, performance: 1 }',
      'export const w = state.window + state?.document',
      'export const ok = flag ? 1 : 2',
    ].join('\n')
    expect(check('src/engine/session/window.ts', source)).toEqual([])
  })

  it('still sees ternary branches, case labels, spreads and shorthand properties', () => {
    const source = [
      'export const a = flag ? window : undefined',
      'export const b = [...document.all]',
      'export const c = { navigator }',
      'switch (x) { case crypto: break }',
    ].join('\n')
    expect(check('src/engine/core/x.ts', source)).toEqual([
      'purity@1',
      'purity@2',
      'purity@3',
      'purity@4',
    ])
  })

  it('reports line numbers after multi-line comments and templates', () => {
    const source = '/*\n\n*/\nconst t = `\n\n`\nexport const n = Date.now()\n'
    expect(checkSource('src/engine/core/x.ts', source)[0]?.line).toBe(7)
  })
})

describe('import extraction', () => {
  it('finds every import form', () => {
    const source = [
      "import a from './a.ts'",
      "import type { B } from './b.ts'",
      "import c, { d as e, type F } from './c.ts'",
      "import * as g from './g.ts'",
      "import './side-effect.css'",
      'import {',
      '  multi,',
      '  line,',
      "} from './multi.ts'",
      "export { h } from './h.ts'",
      "export * from './star.ts'",
      "export * as ns from './ns.ts'",
      "export type { T } from './t.ts'",
      "const lazy = await import('./lazy.ts')",
      "type Lazy = typeof import('./type-import.ts')",
      "const cjs = require('./cjs.cjs')",
    ].join('\n')
    expect(specifiers(source)).toEqual([
      './a.ts',
      './b.ts',
      './c.ts',
      './g.ts',
      './side-effect.css',
      './multi.ts',
      './h.ts',
      './star.ts',
      './ns.ts',
      './t.ts',
      './lazy.ts',
      './type-import.ts',
      './cjs.cjs',
    ])
  })

  it('reads templates without substitutions as specifiers', () => {
    const source = [
      'const a = await import(`./lazy.ts`)',
      'const b = require(`./legacy.cjs`)',
      'type C = typeof import(`./types.ts`)',
      'const d = await import(`./locales/${lang}.ts`)',
    ].join('\n')
    expect(specifiers(source)).toEqual(['./lazy.ts', './legacy.cjs', './types.ts'])
    expect(check('src/exact/solve.ts', 'export const ui = () => import(`../ui/App.tsx`)')).toEqual([
      'layering@1',
    ])
    expect(
      check('tests/oracle/x.ts', 'const s = await import(`../../src/exact/solve.ts`)'),
    ).toEqual(['oracle-independence@1'])
    expect(check('src/engine/core/x.ts', 'export const r = Math[`random`]()')).toEqual([
      'seeded-random@1',
    ])
  })

  it('ignores look-alikes', () => {
    const source = [
      'export { local }',
      "export const from = 'x'",
      'const url = import.meta.url',
      "loader.import('./not-a-module.ts')",
      'const text = "import x from \'./nope.ts\'"',
    ].join('\n')
    expect(specifiers(source)).toEqual([])
  })

  it('finds globals only where the caller asks', () => {
    const tokens = lex('Math.random(); Math.floor(1); Date.now()')
    expect(findUsages(tokens, new Set(['Date']), new Set(['Math.random']))).toEqual([
      { name: 'Math.random', line: 1 },
      { name: 'Date', line: 1 },
    ])
  })
})

describe('architecture scanner file types', () => {
  it('scans JavaScript files as well as TypeScript', () => {
    const root = mkdtempSync(join(tmpdir(), 'scanner-'))
    const tree: Record<string, string> = {
      'src/engine/core/a.js': 'export const r = Math.random()\n',
      'src/exact/b.mjs': "import { advise } from '../coach/c.ts'\n",
      'src/coach/c.cjs': "const React = require('react')\n",
      'src/ui/d.jsx': "import { e } from './e'\n",
      'tests/oracle/f.js': "import { solve } from '../../src/exact/solve.ts'\n",
      'src/ui/notes.md': 'Math.random()\n',
      'src/ui/data.json': '{}\n',
    }
    try {
      for (const [path, source] of Object.entries(tree)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), source)
      }
      const { files, violations } = scanTree(root, ['src', 'tests'])
      expect(files).toEqual([
        'src/coach/c.cjs',
        'src/engine/core/a.js',
        'src/exact/b.mjs',
        'src/ui/d.jsx',
        'tests/oracle/f.js',
      ])
      expect(violations.map((v) => `${v.file} ${v.rule}@${v.line}`)).toEqual([
        'src/coach/c.cjs layering@1',
        'src/engine/core/a.js seeded-random@1',
        'src/exact/b.mjs layering@1',
        'src/ui/d.jsx import-extension@1',
        'tests/oracle/f.js oracle-independence@1',
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the real tree', () => {
  const { files, violations } = scanTree(ROOT, ['src', 'tests'])

  it('scans all of src/ and tests/', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'src/engine/core/rational.ts',
        'src/main.tsx',
        'tests/architecture/scanner.ts',
        'tests/oracle/closedForm.ts',
      ]),
    )
  })

  it('has no architecture violations', () => {
    expect(violations.map(formatViolation)).toEqual([])
  })
})
