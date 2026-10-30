import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileConfig } from '../../engine/config/compile.ts'
import { PRESETS } from '../../engine/config/presets/index.ts'
import { cents } from '../../engine/core/money.ts'
import { Fraction } from '../../engine/core/rational.ts'
import { handleAnalysisRequest } from '../../workers/analysisHandler.ts'
import type { AnalysisRequest } from '../../workers/analysisProtocol.ts'
import {
  badgeFor,
  badgesFor,
  ensureCatalog,
  inspectFor,
  requestInspect,
  setAnalysisTransportForTests,
  subscribeAnalysis,
} from './analysisClient.ts'

/**
 * The client over an injected transport (the real handler): request dedupe, wire decoding back
 * into live `Fraction`s, snapshot stability for `useSyncExternalStore`, and the fail-soft path.
 * There is no IndexedDB here, so the handler computes every time — the client cannot tell and
 * does not care.
 */

const crapless = compileConfig(PRESETS.craplessBubble)
// The real handler prices the whole catalog, side bets included, in about 0.8 s on its own and
// slower under a loaded run: Vitest's 1 s default wait is too tight for it.
const WORKER_WAIT = { timeout: 4000 }

afterEach(() => {
  setAnalysisTransportForTests(null)
})

function useHandlerTransport(): AnalysisRequest[] {
  const calls: AnalysisRequest[] = []
  setAnalysisTransportForTests((request) => {
    calls.push(request)
    return handleAnalysisRequest(request)
  })
  return calls
}

describe('analysisClient: catalog', () => {
  it('requests a config once, decodes badges, and keeps snapshots stable', async () => {
    const calls = useHandlerTransport()
    let notified = 0
    const unsubscribe = subscribeAnalysis(() => {
      notified += 1
    })

    expect(badgesFor(crapless.configHash)).toBeNull()
    ensureCatalog(crapless)
    ensureCatalog(crapless) // the second call is free
    await vi.waitFor(() => {
      expect(badgesFor(crapless.configHash)).not.toBeNull()
    }, WORKER_WAIT)
    expect(calls.filter((call) => call.kind === 'catalog')).toHaveLength(1)
    expect(notified).toBeGreaterThan(0)

    const set = badgesFor(crapless.configHash)
    expect(badgesFor(crapless.configHash)).toBe(set) // referentially stable snapshot
    const badge = badgeFor(crapless.configHash, 'place', 6)
    expect(badge).not.toBeNull()
    expect(badgeFor(crapless.configHash, 'place', 6)).toBe(badge)
    expect(badge !== null && badge.edge.exact instanceof Fraction).toBe(true)
    expect(badge !== null && (badge.edge.exact as Fraction).equals(Fraction.of(1, 66))).toBe(true)
    ensureCatalog(crapless) // already answered: still no new request
    expect(calls.filter((call) => call.kind === 'catalog')).toHaveLength(1)
    unsubscribe()
  })

  it('marks a failed config and does not retry it on every render', async () => {
    const calls: AnalysisRequest[] = []
    setAnalysisTransportForTests((request) => {
      calls.push(request)
      return { id: request.id, ok: false, error: 'boom' }
    })
    ensureCatalog(crapless)
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1)
    }, WORKER_WAIT)
    ensureCatalog(crapless)
    expect(calls).toHaveLength(1)
    expect(badgesFor(crapless.configHash)).toBeNull()
  })
})

describe('analysisClient: inspect', () => {
  it('dedupes by key and hands back live fractions', async () => {
    const calls = useHandlerTransport()
    const spec = { typeId: 'place', number: 6 as const }
    const key = requestInspect(crapless, spec, cents(500), null, null)
    expect(requestInspect(crapless, spec, cents(500), null, null)).toBe(key)
    await vi.waitFor(() => {
      expect(inspectFor(key)).not.toBeNull()
    }, WORKER_WAIT)
    expect(calls.filter((call) => call.kind === 'inspect')).toHaveLength(1)
    const math = inspectFor(key)
    expect(
      math !== null &&
        math.edge !== null &&
        (math.edge.exact as Fraction).equals(Fraction.of(17, 1100)),
    ).toBe(true)
    expect(inspectFor(key)).toBe(math) // stable
    // A different amount is a different key and a new request.
    const other = requestInspect(crapless, spec, cents(600), null, null)
    expect(other).not.toBe(key)
    await vi.waitFor(() => {
      expect(inspectFor(other)).not.toBeNull()
    }, WORKER_WAIT)
    expect(calls.filter((call) => call.kind === 'inspect')).toHaveLength(2)
  })

  it('a transport that throws becomes a settled failure, not an unhandled rejection', async () => {
    let calls = 0
    setAnalysisTransportForTests(() => {
      calls += 1
      throw new Error('transport down')
    })
    const spec = { typeId: 'place', number: 6 as const }
    const key = requestInspect(crapless, spec, cents(500), null, null)
    await new Promise((resolve) => setTimeout(resolve, 0)) // let the failure settle
    // Settled as failed: the same request is not sent again and no math ever arrives.
    expect(requestInspect(crapless, spec, cents(500), null, null)).toBe(key)
    expect(calls).toBe(1)
    expect(inspectFor(key)).toBeNull()
  })
})
