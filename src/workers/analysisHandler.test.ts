import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import { catalogTable, fromWire } from '../exact/index.ts'
import type { InspectorMath } from '../coach/inspector.ts'
import type { ZoneBadge } from '../coach/types.ts'
import { handleAnalysisRequest } from './analysisHandler.ts'

/**
 * The worker handler over a fake IndexedDB: the first catalog request computes and fills the
 * cache, the second is served from it (`fromCache: true`, plan §10 M9a "the second load hits the
 * IndexedDB analysis cache") — byte-identical badges either way.
 */

const crapless = compileConfig(PRESETS.craplessBubble)

describe('handleAnalysisRequest: catalog', () => {
  it('computes the catalog once, then serves the IndexedDB cache with equal badges', async () => {
    const first = await handleAnalysisRequest({
      id: 1,
      kind: 'catalog',
      configHash: crapless.configHash,
      input: crapless.input,
    })
    if (!first.ok || first.kind !== 'catalog') throw new Error('first catalog request failed')
    expect(first.fromCache).toBe(false)
    expect(first.badges.length).toBe(catalogTable(crapless).length)
    expect(first.badges.length).toBeGreaterThan(10)

    const second = await handleAnalysisRequest({
      id: 2,
      kind: 'catalog',
      configHash: crapless.configHash,
      input: crapless.input,
    })
    if (!second.ok || second.kind !== 'catalog') throw new Error('second catalog request failed')
    expect(second.fromCache).toBe(true)
    expect(second.badges).toEqual(first.badges)

    const place6 = second.badges
      .map((wired) => fromWire<ZoneBadge>(wired))
      .find((badge) => badge.typeId === 'place' && badge.number === 6)
    expect(place6).toBeDefined()
    expect(place6 !== undefined && (place6.edge.exact as Fraction).equals(Fraction.of(1, 66))).toBe(
      true,
    )
  })

  it('keeps configs apart: another machine computes its own badges', async () => {
    const strict = compileConfig(PRESETS.strictBubble)
    const response = await handleAnalysisRequest({
      id: 3,
      kind: 'catalog',
      configHash: strict.configHash,
      input: strict.input,
    })
    if (!response.ok || response.kind !== 'catalog') throw new Error('catalog request failed')
    expect(response.fromCache).toBe(false)
    expect(response.configHash).toBe(strict.configHash)
  })

  it('refuses a config hash that does not match what the input compiles to', async () => {
    const response = await handleAnalysisRequest({
      id: 4,
      kind: 'catalog',
      configHash: 'not-the-hash',
      input: crapless.input,
    })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toContain('mismatch')
  })
})

describe('handleAnalysisRequest: inspect', () => {
  it('prices place 6 at $5 over the wire: edge 17/1100, paid win $5.83', async () => {
    const response = await handleAnalysisRequest({
      id: 5,
      kind: 'inspect',
      configHash: crapless.configHash,
      input: crapless.input,
      spec: { typeId: 'place', number: 6 },
      amount: cents(500),
      state: null,
      betId: null,
    })
    if (!response.ok || response.kind !== 'inspect') throw new Error('inspect request failed')
    const math = fromWire<InspectorMath>(response.math)
    expect(math.edge !== null && (math.edge.exact as Fraction).equals(Fraction.of(17, 1100))).toBe(
      true,
    )
    expect(math.winPaid?.exact).toBe(583)
    expect(math.steps.length).toBeGreaterThan(3)
  })

  it('answers an impossible spec with a failure response, never a throw', async () => {
    const response = await handleAnalysisRequest({
      id: 6,
      kind: 'inspect',
      configHash: crapless.configHash,
      input: crapless.input,
      spec: { typeId: 'no-such-bet', number: null },
      amount: cents(500),
      state: null,
      betId: null,
    })
    expect(response.ok).toBe(false)
  })
})
