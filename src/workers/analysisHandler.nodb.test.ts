import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { handleAnalysisRequest } from './analysisHandler.ts'

/**
 * No IndexedDB at all (plain Node, no fake): the storage wrappers fail softly, so the handler
 * recomputes every time and still answers — the cache is an optimization, never a dependency.
 */

const crapless = compileConfig(PRESETS.craplessBubble)

describe('handleAnalysisRequest without IndexedDB', () => {
  it('still answers catalog requests, computing both times', async () => {
    const request = {
      kind: 'catalog',
      configHash: crapless.configHash,
      input: crapless.input,
    } as const
    const first = await handleAnalysisRequest({ id: 1, ...request })
    const second = await handleAnalysisRequest({ id: 2, ...request })
    if (!first.ok || first.kind !== 'catalog') throw new Error('first catalog request failed')
    if (!second.ok || second.kind !== 'catalog') throw new Error('second catalog request failed')
    expect(first.fromCache).toBe(false)
    expect(second.fromCache).toBe(false)
    expect(second.badges).toEqual(first.badges)
  })
})
