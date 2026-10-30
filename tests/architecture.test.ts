import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import {
  checkFiles,
  checkSource,
  findImports,
  findMethodUses,
  findUsages,
  formatViolation,
  lex,
  readSources,
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

  it('lets oracle modules use rational.ts, dice.ts, config types and each other', () => {
    for (const path of [
      '../../src/engine/core/rational.ts',
      '../../src/engine/core/dice.ts',
      './referenceRules.ts',
    ]) {
      expect(check('tests/oracle/closedForm.ts', imp(path)), path).toEqual([])
    }
    for (const source of [
      "import type { MachineConfigInput } from '../../src/engine/config/schema.ts'",
      "import type { Ratio } from '../../src/engine/config/ratio.ts'",
      "export type { PresetId } from '../../src/engine/config/presets/index.ts'",
      "import type { Cents } from '../../src/engine/core/money.ts'",
      "type Rng = typeof import('../../src/engine/core/rng.ts')",
    ]) {
      expect(check('tests/oracle/machineFacts.ts', source), source).toEqual([])
    }
  })

  it('keeps oracle modules off config code, money.ts and the rest of engine/core', () => {
    const messages = (source: string) =>
      checkSource('tests/oracle/machineFacts.ts', source).map((violation) => violation.message)
    const CONFIG = 'oracles may take only types from src/engine/config, with import type'
    for (const path of [
      'ratio.ts',
      'schema.ts',
      'compile.ts',
      'provenance.ts',
      'presets/index.ts',
    ]) {
      expect(messages(imp(`../../src/engine/config/${path}`))).toEqual([
        `${CONFIG}: src/engine/config/${path}`,
      ])
    }
    // `import { type A }` still loads the module, and the rulesets are rule code: types and all.
    expect(messages("import { type Ratio } from '../../src/engine/config/ratio.ts'")).toEqual([
      `${CONFIG}: src/engine/config/ratio.ts`,
    ])
    expect(messages("import type { Ruleset } from '../../src/engine/config/rulesets.ts'")).toEqual([
      'oracles must not import shared rule code: src/engine/config/rulesets.ts',
    ])
    expect(messages(imp('../../src/engine/core/money.ts'))).toEqual([
      'oracles round money themselves: they must not import src/engine/core/money.ts: ' +
        'src/engine/core/money.ts',
    ])
    const CORE = 'oracles may import from src/engine/core only rational.ts and dice.ts'
    for (const path of ['rng.ts', 'hash.ts', 'rational.test.ts']) {
      expect(messages(imp(`../../src/engine/core/${path}`))).toEqual([
        `${CORE}: src/engine/core/${path}`,
      ])
    }
  })

  it('compares paths whatever their case, as macOS loads the files', () => {
    for (const path of [
      '../../src/Engine/round/round.ts',
      '../../src/exact/Solve.ts',
      '../../SRC/engine/config/rulesets.ts',
      '../../src/engine/Config/ratio.ts',
      '../../src/engine/core/Money.ts',
      '../../src/engine/Core/rng.ts',
    ]) {
      expect(check('tests/oracle/referenceRules.ts', imp(path)), path).toEqual([
        'oracle-independence@1',
      ])
    }
    expect(check('tests/Oracle/x.ts', imp('../../src/exact/solve.ts'))).toEqual([
      'oracle-independence@1',
    ])
    // The same file as rational.ts, which an oracle may import.
    expect(check('tests/oracle/x.ts', imp('../../src/engine/core/Rational.ts'))).toEqual([])
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

describe('architecture scanner oracle reach', () => {
  /** Violations of a set of in-memory files checked together. */
  const checkTree = (files: Record<string, string>) =>
    checkFiles(new Map(Object.entries(files))).map(formatViolation)
  const ROUND = 'src/engine/round/round.ts'
  const reach = (file: string, ...chain: string[]) =>
    `${file} [oracle-independence] oracles must not reach shared rule code: ${chain.join(' → ')}`

  it('follows runtime imports through other modules and shows the chain', () => {
    const files = {
      'tests/oracle/referenceTable.ts': imp('./machineFacts.ts') + imp('../support/helper.ts'),
      'tests/oracle/machineFacts.ts': 'export const a = 1\n',
      'tests/support/helper.ts': imp('../../src/engine/round/round.ts'),
      [ROUND]: 'export const x = 1\n',
    }
    expect(checkTree(files)).toEqual([
      reach(
        'tests/oracle/referenceTable.ts:2',
        'tests/oracle/referenceTable.ts',
        'tests/support/helper.ts',
        ROUND,
      ),
    ])
  })

  it('ignores import type and export type, which are erased, but not import { type }', () => {
    const tree = (oracle: string, helper: string) =>
      checkTree({ 'tests/oracle/x.ts': oracle, 'tests/support/helper.ts': helper, [ROUND]: '' })
    const helperTs = imp('../support/helper.ts')
    expect(
      tree("import type { A } from '../support/helper.ts'", imp('../../src/engine/round/round.ts')),
    ).toEqual([])
    expect(tree(helperTs, "import type { R } from '../../src/engine/round/round.ts'")).toEqual([])
    expect(tree(helperTs, "export type * from '../../src/engine/round/round.ts'")).toEqual([])
    expect(tree(helperTs, "type R = typeof import('../../src/engine/round/round.ts')")).toEqual([])
    expect(tree(helperTs, "import { type R } from '../../src/engine/round/round.ts'")).toEqual([
      reach('tests/oracle/x.ts:1', 'tests/oracle/x.ts', 'tests/support/helper.ts', ROUND),
    ])
  })

  it('ends on a cycle and reports each forbidden area once, by its shortest chain', () => {
    const files = {
      'tests/oracle/x.ts': imp('../support/a.ts'),
      'tests/support/a.ts': imp('./b.ts'),
      'tests/support/b.ts': [
        imp('./a.ts'),
        imp('../../src/engine/round/other.ts'),
        imp('./c.ts'),
      ].join(''),
      'tests/support/c.ts': imp('../../src/engine/round/round.ts'),
      'src/engine/round/other.ts': imp('./round.ts'),
    }
    expect(checkTree(files)).toEqual([
      reach(
        'tests/oracle/x.ts:1',
        'tests/oracle/x.ts',
        'tests/support/a.ts',
        'tests/support/b.ts',
        'src/engine/round/other.ts',
      ),
    ])
  })

  it('reports every forbidden area reached, beyond forbidden modules too', () => {
    const files = {
      'tests/oracle/x.ts': imp('../support/helper.ts'),
      'tests/support/helper.ts': [
        imp('../../src/engine/table/reducer.ts'),
        imp('../../src/exact/solve.ts'),
      ].join(''),
      'src/engine/table/reducer.ts': imp('../bets/registry.ts'),
      'src/engine/bets/registry.ts': imp('../config/rulesets.ts'),
    }
    const via = ['tests/oracle/x.ts', 'tests/support/helper.ts']
    expect(checkTree(files)).toEqual([
      reach('tests/oracle/x.ts:1', ...via, 'src/engine/table/reducer.ts'),
      reach('tests/oracle/x.ts:1', ...via, 'src/exact/solve.ts'),
      reach(
        'tests/oracle/x.ts:1',
        ...via,
        'src/engine/table/reducer.ts',
        'src/engine/bets/registry.ts',
      ),
      reach(
        'tests/oracle/x.ts:1',
        ...via,
        'src/engine/table/reducer.ts',
        'src/engine/bets/registry.ts',
        'src/engine/config/rulesets.ts',
      ),
    ])
  })

  it('leaves a direct import to the per-file rule, which reports it once', () => {
    const files = {
      'tests/oracle/x.ts': [
        imp('../../src/engine/round/round.ts'),
        imp('../support/helper.ts'),
      ].join(''),
      'tests/support/helper.ts': imp('../../src/engine/round/round.ts'),
    }
    expect(checkTree(files)).toEqual([
      'tests/oracle/x.ts:1 [oracle-independence] oracles must not import shared rule code: ' +
        'src/engine/round/round.ts',
    ])
  })

  it('lets the dispatch chain reach the engine, but not the solver', () => {
    const files = {
      'tests/oracle/dispatchChain.ts': imp('../support/drive.ts'),
      'tests/support/drive.ts': imp('../../src/engine/table/reducer.ts') + imp('./stats.ts'),
      'tests/support/stats.ts': imp('../../src/exact/chain.ts'),
    }
    expect(checkTree(files)).toEqual([
      'tests/oracle/dispatchChain.ts:1 [oracle-independence] ' +
        'the dispatch chain must not reach the solver it checks: tests/oracle/dispatchChain.ts → ' +
        'tests/support/drive.ts → tests/support/stats.ts → src/exact/chain.ts',
    ])
  })

  it('follows chains into config code, money.ts and the rest of engine/core', () => {
    const files = {
      'tests/oracle/x.ts': imp('../support/helper.ts') + imp('../../src/engine/core/dice.ts'),
      'tests/support/helper.ts': [
        imp('../../src/engine/config/ratio.ts'),
        imp('../../src/engine/core/hash.ts'),
        imp('../../src/engine/core/rng.ts'),
      ].join(''),
      'src/engine/config/ratio.ts': imp('../core/rational.ts'),
      'src/engine/core/dice.ts': imp('./rational.ts') + imp('./rng.ts'),
      'src/engine/core/hash.ts': imp('./money.ts'),
      'src/engine/core/money.ts': imp('./rational.ts'),
    }
    const via = ['tests/oracle/x.ts', 'tests/support/helper.ts']
    const at = 'tests/oracle/x.ts:1 [oracle-independence] '
    // dice.ts may load rng.ts; the helper may not, nor hash.ts, which loads money.ts.
    expect(checkTree(files)).toEqual([
      `${at}oracles must not reach src/engine/config at run time: ` +
        [...via, 'src/engine/config/ratio.ts'].join(' → '),
      `${at}oracles may reach src/engine/core only through rational.ts and dice.ts: ` +
        [...via, 'src/engine/core/hash.ts'].join(' → '),
      `${at}oracles may reach src/engine/core only through rational.ts and dice.ts: ` +
        [...via, 'src/engine/core/rng.ts'].join(' → '),
      `${at}oracles round money themselves: they must not reach src/engine/core/money.ts: ` +
        [...via, 'src/engine/core/hash.ts', 'src/engine/core/money.ts'].join(' → '),
    ])
  })

  it('reports money.ts even through rational.ts or dice.ts', () => {
    const files = {
      'tests/oracle/x.ts': imp('../../src/engine/core/dice.ts'),
      'src/engine/core/dice.ts': imp('./money.ts'),
    }
    expect(checkTree(files)).toEqual([
      'tests/oracle/x.ts:1 [oracle-independence] oracles round money themselves: they must not ' +
        'reach src/engine/core/money.ts: tests/oracle/x.ts → src/engine/core/dice.ts → ' +
        'src/engine/core/money.ts',
    ])
  })

  it('follows imports written in another case to the files they load', () => {
    const files = {
      'tests/oracle/x.ts': imp('../Support/Helper.ts'),
      'tests/support/helper.ts': imp('../../src/Engine/Round/round.ts'),
      [ROUND]: '',
    }
    expect(checkTree(files)).toEqual([
      reach('tests/oracle/x.ts:1', 'tests/oracle/x.ts', 'tests/support/helper.ts', ROUND),
    ])
  })

  it('keeps config modules and the scenario DSL out of reach, whatever they import', () => {
    // On the real tree, so these hold as the tree changes. A config module is out of reach as
    // config, so nothing here depends on what the presets themselves import.
    const tree = readSources(ROOT, ['src', 'tests'])
    const PROBE = 'tests/oracle/__probe__.ts'
    const HELPER = 'tests/support/__probe__.ts'
    const probe = (source: string, helper = '') =>
      checkFiles(new Map([...tree, [PROBE, source], [HELPER, helper]]))
        .filter((violation) => violation.file === PROBE)
        .map((violation) => violation.message)
    const CONFIG = 'oracles may take only types from src/engine/config, with import type'
    for (const path of [
      'schema.ts',
      'compile.ts',
      'ratio.ts',
      'presets/index.ts',
      'presets/craplessBubble.ts',
    ]) {
      const target = `src/engine/config/${path}`
      expect(probe(imp(`../../${target}`)), path).toContain(`${CONFIG}: ${target}`)
      expect(probe(imp('../support/__probe__.ts'), imp(`../../${target}`)), path).toContain(
        `oracles must not reach src/engine/config at run time: ${PROBE} → ${HELPER} → ${target}`,
      )
    }
    // The scenario DSL compiles presets and drives the reducer.
    const dsl = probe(imp('../scenarios/dsl.ts'))
    expect(dsl).toContain(
      'oracles must not reach src/engine/config at run time: ' +
        `${PROBE} → tests/scenarios/dsl.ts → src/engine/config/compile.ts`,
    )
    expect(dsl.some((message) => message.includes('→ src/engine/table/'))).toBe(true)
    expect(
      probe("import type { MachineConfigInput } from '../../src/engine/config/schema.ts'"),
    ).toEqual([])
    // A real-tree scan like the lint sweeps below: the same 30 s allowance, because this 8 GB
    // machine has stalled it past the 5 s default under a coverage run (it takes ~1 s quiet).
  }, 30_000)
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

  it('ignores allowed members, other objects and typeof Math', () => {
    const source = [
      'const r = Math.sqrt(2) + Math?.max(1, 2) + Math["PI"] + Math?.["abs"](-1)',
      'const { random } = rng',
      'const pick = flag ? { random } : other',
      'const keyed = { Math: 1, nested: state.Math }',
      'type M = typeof Math',
      "const kind = typeof Math === 'object'",
    ].join('\n')
    expect(check('src/engine/settle/settle.ts', source)).toEqual([])
    expect(check('src/physics/core/hop.ts', 'const r = Math.floor(Math.round(2.5))')).toEqual([])
    expect(check('src/physics/core/hop.ts', 'const { random } = Math')).toEqual(['seeded-random@1'])
  })

  it('sees Math reached through globalThis, window or self', () => {
    const source = [
      'const r = globalThis.Math.random()',
      'const { random } = self.Math',
      "const f = window.Math['floor'](1)",
    ].join('\n')
    // An allowed member read through a host is still Math out of sight: read it directly.
    expect(check('src/engine/core/rng.test.ts', source)).toEqual([
      'seeded-random@1',
      'seeded-random@2',
      'math-value@3',
    ])
    expect(check('src/engine/settle/settle.ts', source)).toEqual([
      'purity@1',
      'seeded-random@1',
      'purity@2',
      'seeded-random@2',
      'purity@3',
      'rounding@3',
    ])
    expect(check('src/engine/settle/settle.ts', 'const m = state.global.Math.random()')).toEqual([])
    expect(check('tests/oracle/x.test.ts', 'const r = globalThis?.Math.random()')).toEqual([
      'seeded-random@1',
    ])
    expect(check('tests/oracle/x.test.ts', 'const { random } = self?.Math')).toEqual([
      'seeded-random@1',
    ])
  })
})

describe('architecture scanner Math as a value', () => {
  it('reports each evasion the audit found: casts, wrappers, Reflect, aliases, parentheses', () => {
    const source = [
      'const { floor } = <any>Math',
      'const [{ random }] = [Math]',
      'Reflect.get(Math, "random")()',
      'const M = Math',
      'const N = (Math)',
      'const r = Math?.["random"]()',
      'const T = Math as unknown as { random(): number }',
    ].join('\n')
    expect(check('src/engine/settle/settle.ts', source)).toEqual([
      'math-value@1',
      'math-value@2',
      'math-value@3',
      'math-value@4',
      'math-value@5',
      'seeded-random@6',
      'math-value@7',
    ])
  })

  it('reports any other use that is not a member read, harmless or not', () => {
    const source = [
      'const { sqrt, PI } = Math',
      'const { sqrt: s, ...rest } = Math',
      'const { scale = Math } = options',
      'const same = a === Math',
      'total = Math',
      'const wrapped = { Math }',
      "const viaHost = globalThis.Math ?? globalThis['Math'] ?? self?.['Math'] ?? self?.Math",
      'const indexed = Math[name]',
      'const wrappedAgain = (Math).random()',
    ].join('\n')
    expect(check('src/engine/core/x.test.ts', source)).toEqual([
      'math-value@1',
      'math-value@2',
      'math-value@3',
      'math-value@4',
      'math-value@5',
      'math-value@6',
      'math-value@7',
      'math-value@7',
      'math-value@7',
      'math-value@7',
      'math-value@8',
      'math-value@9',
    ])
  })

  it('applies wherever a Math member is banned: core layers, their tests and tests/', () => {
    const alias = 'const M = Math\n'
    for (const file of [
      'src/engine/core/rational.ts',
      'src/engine/round/round.ts',
      'src/exact/solve.ts',
      'src/coach/gate.ts',
      'src/sim/runner.ts',
      'src/physics/core/hop.ts',
      'src/physics/core/hop.test.ts',
      'tests/oracle/closedForm.ts',
      'tests/scenarios/dsl.test.ts',
    ]) {
      expect(check(file, alias), file).toEqual(['math-value@1'])
    }
    for (const file of ['src/ui/App.tsx', 'src/main.tsx', 'scripts/edges.ts', 'e2e/a.spec.ts']) {
      expect(check(file, alias), file).toEqual([])
    }
  })

  it('reports a destructuring as the banned members it takes, or else as a value', () => {
    expect(check('src/physics/core/hop.ts', 'const { floor, round } = Math')).toEqual([
      'math-value@1',
    ])
    expect(check('src/engine/settle/settle.ts', 'const { floor, round } = Math')).toEqual([
      'rounding@1',
      'rounding@1',
    ])
  })
})

/** The five ways the M4 audit carried Math out of a host, unseen by the scanner and by lint. */
const carriedFrom = (host: string) =>
  [
    `const { Math: M } = ${host}; M.random()`,
    `const { Math: { random } } = ${host}`,
    `const g = ${host}; g.Math.random()`,
    `Reflect.get(${host}, 'Math').random()`,
    `Object.getOwnPropertyDescriptor(${host}, 'Math')?.value.random()`,
  ].join('\n')
const HOST_NAMES = ['globalThis', 'self', 'window', 'global']

/** Other ways a host can carry Math, one per line: the scanner and lint both report each. */
const HOST_EVASIONS = [
  'const a = globalThis.globalThis.Math.random()',
  "const b = self['window'].Math",
  'const c = (globalThis).Math.random()',
  'const d = [window][0].Math',
  'const e = { global }.global.Math',
  'const f = (globalThis as typeof globalThis).Math',
  "const { ['Math']: g } = self",
  "const { 'Math': h } = window",
  'function i({ Math: j } = global) { return j }',
  ';({ Math: k } = globalThis)',
  'const { Math: { floor } } = globalThis',
  'const { structuredClone } = globalThis',
  'const l = globalThis[name]',
  'const m = typeof globalThis.Math',
  'const n = globalThis.Math.sqrt(2)',
  'run(window)',
  'const o = globalThis.Math.random()',
  'const p = globalThis.Math[name]()',
  'const q = window?.Math?.random',
  'type R = typeof globalThis.self',
  'const s = globalThis[`Math`].random()',
  'const t = globalThis!.Math',
  "const u = 'Math' in globalThis",
]
/** Uses of hosts that carry nothing out of sight: neither tool reports them. */
const HOST_USES = [
  'globalThis.structuredClone(x)',
  "const r = globalThis['fetch'] ?? self?.postMessage ?? window?.['name']",
  "if (typeof window === 'undefined') skip()",
  'type G = typeof globalThis',
  'const window = state.round.phase.kind',
  'const same = type.window === window || window !== other',
  'const s = { window: 1, global: true, self: state.self }',
  'interface Toggle { global: boolean }',
  "vi.stubGlobal('crypto', fake)",
  'const v = globalThis[`fetch`]',
  'export {}',
  'declare global { interface W { hook: 1 } }',
]
/** `Math` as a type, one per line: reported by both tools unless it is `typeof Math` itself. */
const MATH_TYPES = [
  'export function t1(m: Math) { return m.max(1, 2) }',
  "export type T2 = Pick<Math, 'max'>",
  'export const t3 = <Math>other',
  'export type T4 = typeof Math.random',
  'export type T5 = typeof globalThis.Math',
]
/** Math in a type that names no banned member and no host: neither tool reports these. */
const MATH_TYPE_NAMES = [
  'export type T6 = typeof Math',
  'export type T7 = typeof Math.sqrt',
  'export type T8 = NS.Math',
]

describe('architecture scanner hosts', () => {
  it('sees Math destructured, aliased or passed on out of any host, in all tests', () => {
    for (const host of HOST_NAMES) {
      for (const file of ['tests/scenarios/dsl.test.ts', 'src/engine/core/rng.test.ts']) {
        expect(check(file, carriedFrom(host)), `${host} in ${file}`).toEqual([
          'math-value@1',
          'seeded-random@2',
          'host-value@3',
          'host-value@4',
          'host-value@5',
        ])
      }
    }
  })

  it('bans the hosts outright in shipped core code', () => {
    for (const host of HOST_NAMES) {
      for (const file of ['src/engine/settle/settle.ts', 'src/physics/core/hop.ts']) {
        expect(check(file, carriedFrom(host)), `${host} in ${file}`).toEqual([
          'purity@1',
          'purity@2',
          'purity@3',
          'purity@4',
          'purity@5',
        ])
      }
    }
  })

  it('sees every other way a host carries Math', () => {
    expect(check('tests/oracle/x.test.ts', HOST_EVASIONS.join('\n'))).toEqual([
      'host-value@1',
      'host-value@2',
      'host-value@3',
      'host-value@4',
      'host-value@5',
      'host-value@6',
      'math-value@7',
      'math-value@8',
      'math-value@9',
      'math-value@10',
      'math-value@11',
      'host-value@12',
      'host-value@13',
      'math-value@14',
      'math-value@15',
      'host-value@16',
      'seeded-random@17',
      'math-value@18',
      'seeded-random@19',
      'host-value@20',
      'math-value@21',
      'host-value@22',
      'host-value@23',
    ])
  })

  it('leaves member reads, typeof, equality tests and locals named like a host alone', () => {
    expect(check('tests/scenarios/x.test.ts', HOST_USES.join('\n'))).toEqual([])
    // Where Math is not guarded, neither are the hosts.
    expect(check('src/ui/App.tsx', carriedFrom('window'))).toEqual([])
  })

  it('reports Math as a type, as lint does; its type is typeof Math', () => {
    expect(check('tests/golden/types.test.ts', MATH_TYPES.join('\n'))).toEqual([
      'math-value@1',
      'math-value@2',
      'math-value@3',
      'seeded-random@4',
      'math-value@5',
    ])
    expect(check('tests/golden/types.test.ts', MATH_TYPE_NAMES.join('\n'))).toEqual([])
    expect(check('src/exact/price.ts', MATH_TYPE_NAMES.join('\n'))).toEqual([])
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

  it('marks the imports that are erased with the types, and only those', () => {
    const source = [
      "import type { A } from './erased-a.ts'",
      "import type B from './erased-b.ts'",
      "import type * as C from './erased-c.ts'",
      "export type { D } from './erased-d.ts'",
      "export type * from './erased-e.ts'",
      "type F = typeof import('./erased-f.ts')",
      // verbatimModuleSyntax keeps this as `import {} from`, which still loads the module.
      "import { type G } from './kept-g.ts'",
      "import h, { type H } from './kept-h.ts'",
      "import type from './kept-binding-named-type.ts'",
      "import type, { i } from './kept-i.ts'",
      "export { type J } from './kept-j.ts'",
      "const k = await import('./kept-k.ts')",
    ].join('\n')
    const erased = findImports(lex(source)).map(
      (ref) => `${ref.typeOnly}`.padEnd(6) + ref.specifier,
    )
    expect(erased).toEqual([
      'true  ./erased-a.ts',
      'true  ./erased-b.ts',
      'true  ./erased-c.ts',
      'true  ./erased-d.ts',
      'true  ./erased-e.ts',
      'true  ./erased-f.ts',
      'false ./kept-g.ts',
      'false ./kept-h.ts',
      'false ./kept-binding-named-type.ts',
      'false ./kept-i.ts',
      'false ./kept-j.ts',
      'false ./kept-k.ts',
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

describe('the lint mirror in eslint.config.js', () => {
  const eslint = new ESLint({ cwd: ROOT })
  const MIRRORED = new Set([
    'no-restricted-syntax',
    'no-restricted-properties',
    'no-restricted-imports',
    '@typescript-eslint/no-import-type-side-effects',
  ])
  /** `rule@line` for each mirrored rule ESLint reports on `code`, linted as if it were `file`. */
  const lint = async (file: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath: file })
    const messages = result?.messages ?? []
    // A fixture that does not parse would otherwise pass with no reports at all.
    const fatal = messages.find((message) => message.fatal === true)
    if (fatal !== undefined) throw new Error(`${file} does not parse: ${fatal.message}`)
    return messages
      .filter((message) => MIRRORED.has(message.ruleId ?? ''))
      .map((message) => `${message.ruleId}@${message.line}`)
  }
  /** The lines the scanner and lint (its mirrored rules) report in `code`, linted as `file`. */
  const reportedLines = async (file: string, code: string) => ({
    scanner: [...new Set(checkSource(file, code).map((violation) => violation.line))],
    lint: [...new Set((await lint(file, code)).map((report) => Number(report.split('@')[1])))],
  })

  it('reports each audited Math evasion, as the scanner does', async () => {
    const source = [
      'export const { floor } = <any>Math',
      'export const [{ random }] = [Math]',
      'export const r = Reflect.get(Math, "random")()',
      'export const M = Math',
      'export const N = (Math)',
      'export const r2 = Math?.["random"]()',
      'export const T = Math as unknown as { random(): number }',
      'export const fine = Math.sqrt(2) + Math["PI"] + Math?.max(1, 2) + (typeof Math).length',
    ].join('\n')
    expect(await lint('tests/scenarios/evasions.test.ts', source)).toEqual([
      'no-restricted-syntax@1',
      'no-restricted-syntax@2',
      'no-restricted-syntax@3',
      'no-restricted-syntax@4',
      'no-restricted-syntax@5',
      'no-restricted-properties@6',
      'no-restricted-syntax@7',
    ])
  }, 30_000)

  it('scopes the Math rule like the Math.random ban: core, core tests and tests/', async () => {
    const selectors = async (file: string) => {
      const config = (await eslint.calculateConfigForFile(file)) as {
        rules: Record<string, unknown[] | undefined>
      }
      const options = (config.rules['no-restricted-syntax'] ?? []).slice(1) as {
        selector: string
      }[]
      return options.some((option) => option.selector.startsWith("Identifier[name='Math']"))
    }
    for (const file of [
      'src/engine/round/round.ts',
      'src/physics/core/hop.test.ts',
      'src/sim/a.ts',
    ]) {
      expect(await selectors(file), file).toBe(true)
    }
    expect(await selectors('tests/oracle/closedForm.ts')).toBe(true)
    expect(await selectors('src/ui/App.tsx')).toBe(false)
  }, 30_000)

  it('bans oracle imports of rule code, config code and money.ts, like the scanner', async () => {
    const banned = [
      '../../src/engine/round/round.ts',
      '../../src/exact/solve.ts',
      '../../src/engine/index.ts',
      '../../src/engine/config/rulesets.ts',
      '../../src/engine/config/compile.ts',
      '../../src/engine/config/presets/index.ts',
      '../../src/engine/config/presets/craplessBubble.ts',
      '../scenarios/dsl.ts',
      '../properties/session.ts',
      '../../src/engine/config/schema.ts',
      '../../src/engine/config/ratio.ts',
      '../../src/engine/config/provenance.ts',
      '../../src/engine/core/money.ts',
      '../../src/engine/core/rng.ts',
      '../../src/engine/core/hash.ts',
      // Whatever the case, as tsc and macOS load them.
      '../../src/Engine/round/round.ts',
      '../../src/engine/Config/ratio.ts',
      '../../src/engine/core/Money.ts',
    ]
    for (const path of banned) {
      expect(await lint('tests/oracle/referenceRules.ts', imp(path)), path).toEqual([
        'no-restricted-imports@1',
      ])
    }
    const allowed = [
      "import type { MachineConfigInput } from '../../src/engine/config/schema.ts'",
      "import type { Ratio } from '../../src/engine/config/ratio.ts'",
      "import type { Cents } from '../../src/engine/core/money.ts'",
      imp('../../src/engine/core/rational.ts'),
      imp('../../src/engine/core/dice.ts'),
      imp('../../src/engine/core/Rational.ts'),
      imp('./machineFacts.ts'),
    ]
    for (const source of allowed) {
      expect(await lint('tests/oracle/referenceRules.ts', source), source).toEqual([])
    }
    // The rulesets are rule code: their types too, as the scanner says.
    expect(
      await lint(
        'tests/oracle/referenceRules.ts',
        "import type { Ruleset } from '../../src/engine/config/rulesets.ts'",
      ),
    ).toEqual(['no-restricted-imports@1'])
    // `import { type A }` still loads schema.ts, which loads rulesets.ts.
    const inline = "import { type MachineConfigInput } from '../../src/engine/config/schema.ts'"
    expect(await lint('tests/oracle/referenceRules.ts', inline)).toEqual([
      '@typescript-eslint/no-import-type-side-effects@1',
    ])
    expect(await lint('tests/oracle/referenceRules.test.ts', imp(banned[0] ?? ''))).toEqual([])
    expect(
      await lint('tests/oracle/dispatchChain.ts', imp('../../src/engine/table/reducer.ts')),
    ).toEqual([])
    expect(await lint('tests/oracle/dispatchChain.ts', imp('../../src/exact/chain.ts'))).toEqual([
      'no-restricted-imports@1',
    ])
  }, 30_000)

  it('reports Math carried out of any host, as the scanner does', async () => {
    const file = 'tests/scenarios/hosts.test.ts'
    for (const host of HOST_NAMES) {
      expect(await lint(file, carriedFrom(host)), host).toEqual([
        'no-restricted-syntax@1',
        'no-restricted-syntax@2',
        'no-restricted-syntax@3',
        'no-restricted-syntax@4',
        'no-restricted-syntax@5',
      ])
    }
    // Shipped core code bans every host outright.
    const [result] = await eslint.lintText('export const g = self\nexport const h = global', {
      filePath: 'src/physics/core/hop.ts',
    })
    expect(result?.messages.map((message) => `${message.ruleId}@${message.line}`)).toEqual([
      'no-restricted-globals@1',
      'no-restricted-globals@2',
    ])
  }, 30_000)

  it('flags the lines the scanner flags: hosts, Math through hosts, Math as a type', async () => {
    const file = 'tests/scenarios/hosts.test.ts'
    for (const fixture of [HOST_EVASIONS, MATH_TYPES]) {
      const { scanner, lint: linted } = await reportedLines(file, fixture.join('\n'))
      expect(scanner).toEqual(fixture.map((_, k) => k + 1))
      expect(linted).toEqual(scanner)
    }
    for (const fixture of [HOST_USES, MATH_TYPE_NAMES]) {
      expect(await reportedLines(file, fixture.join('\n'))).toEqual({ scanner: [], lint: [] })
    }
  }, 30_000)

  it('scopes the host rule to tests: shipped core bans the hosts as globals', async () => {
    const config = async (file: string) =>
      (await eslint.calculateConfigForFile(file)) as {
        rules: Record<string, unknown[] | undefined>
      }
    const hostRule = async (file: string) =>
      ((await config(file)).rules['no-restricted-syntax'] ?? [])
        .slice(1)
        .some((option) => (option as { selector: string }).selector.startsWith('Identifier[name=/'))
    for (const file of ['tests/oracle/closedForm.ts', 'src/physics/core/hop.test.ts']) {
      expect(await hostRule(file), file).toBe(true)
    }
    for (const file of ['src/engine/round/round.ts', 'src/ui/App.tsx']) {
      expect(await hostRule(file), file).toBe(false)
    }
    const globals = ((await config('src/engine/round/round.ts')).rules['no-restricted-globals'] ??
      []) as (string | { name: string })[]
    const names = globals.slice(1).map((entry) => (typeof entry === 'string' ? entry : entry.name))
    expect(names).toEqual(expect.arrayContaining(HOST_NAMES))
  }, 30_000)
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
