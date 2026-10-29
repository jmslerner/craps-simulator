import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  checkSource,
  findImports,
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
    const imp = (path: string) => `import { x } from '${path}'\n`
    expect(check('src/exact/solve.ts', imp('../engine/core/rational.ts'))).toEqual([])
    expect(check('src/coach/run.ts', imp('../exact/price.ts'))).toEqual([])
    expect(check('src/sim/runner.ts', imp('../exact/analyze.ts'))).toEqual([])
    expect(check('src/engine/table/roll.ts', imp('../../exact/chain.ts'))).toEqual(['layering@1'])
    expect(check('src/exact/chain.ts', imp('../coach/policy.ts'))).toEqual(['layering@1'])
    expect(check('src/sim/runner.ts', imp('../coach/run.ts'))).toEqual(['layering@1'])
    expect(check('src/engine/core/x.ts', imp('../../main.tsx'))).toEqual(['layering@1'])
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

describe('architecture scanner rounding', () => {
  const source = 'export const f = (x: number) => Math.floor(x) + Math.round(x) + Math.ceil(x)\n'

  it('allows Math.floor/round/ceil only in engine/core/{money,rational}.ts', () => {
    expect(check('src/engine/core/money.ts', source)).toEqual([])
    expect(check('src/engine/core/rational.ts', source)).toEqual([])
    expect(check('src/engine/settle/settle.ts', source)).toEqual([
      'rounding@1',
      'rounding@1',
      'rounding@1',
    ])
    expect(check('src/exact/price.ts', source)).toHaveLength(3)
    expect(check('src/coach/numbers.ts', source)).toHaveLength(3)
  })

  it('exempts sim and physics/core', () => {
    expect(check('src/sim/runner.ts', source)).toEqual([])
    expect(check('src/physics/core/params.ts', source)).toEqual([])
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

describe('the real tree', () => {
  const { files, violations } = scanTree(ROOT, ['src', 'tests/oracle'])

  it('scans src/ and tests/oracle/', () => {
    expect(files).toEqual(expect.arrayContaining(['src/engine/core/rational.ts', 'src/main.tsx']))
    expect(files).toContain('tests/oracle/closedForm.ts')
  })

  it('has no architecture violations', () => {
    expect(violations.map(formatViolation)).toEqual([])
  })
})
