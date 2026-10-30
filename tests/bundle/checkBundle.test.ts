import { describe, expect, it } from 'vitest'
import { testHookOffences } from '../../scripts/check-bundle.ts'

/**
 * The check-bundle assertion logic (plan §10 M8: the production bundle contains no
 * `__CRAPS_TEST__` and no testHooks module), unit-tested against tiny fixture strings. The
 * integrator runs `node scripts/check-bundle.ts` itself against the real `vite build` output in
 * `npm run verify`; these tests pin what that run asserts.
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
