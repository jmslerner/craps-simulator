import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, paramsFingerprint } from '../physics/core/params.ts'
import { synthesizeRest } from '../physics/core/plan.ts'
import { hashRest } from '../physics/core/restPose.ts'
import { handlePhysicsRequest } from '../workers/physicsHandler.ts'
import type { Outgoing, PhysicsRequest } from '../workers/physicsProtocol.ts'
import { createPhysicsClient, type PhysicsTransport } from './physicsClient.ts'

/**
 * The physics client over fake transports (and once over the real handler): it holds one throw at
 * a time for exactly one (seed, rest) pair, `take` hands it over or waits a bounded time for one
 * in flight, a prefetch for another throw replaces the held one, and a broken or wrong worker
 * leaves the client inert rather than hanging a roll.
 */

const REST = synthesizeRest(0x10, [1, 2])
const OTHER = synthesizeRest(0x11, [1, 2])

const READY: Outgoing = {
  response: {
    id: 0,
    ok: true,
    kind: 'ready',
    paramsFingerprint: paramsFingerprint(DEFAULT_PARAMS),
  },
  transfer: [],
}

/** A transport whose throw replies the test releases by hand; pings answer at once. */
function gatedTransport(): {
  transport: PhysicsTransport
  release(): Promise<void>
  requests: PhysicsRequest[]
} {
  const requests: PhysicsRequest[] = []
  const gates: (() => void)[] = []
  const transport: PhysicsTransport = (request) => {
    requests.push(request)
    if (request.kind === 'ping')
      return { ...READY, response: { ...READY.response, id: request.id } }
    return new Promise<Outgoing>((resolve) => {
      gates.push(() => {
        void handlePhysicsRequest(request).then(resolve)
      })
    })
  }
  return {
    transport,
    requests,
    release: async () => {
      for (const gate of gates.splice(0)) gate()
      // Let the handler's promise chain settle.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await vi.waitFor(() => undefined)
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createPhysicsClient', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is inert without a worker: broken, and take answers null at once', async () => {
    const client = createPhysicsClient({ spawn: () => null })
    client.prefetch(1, REST)
    expect(client.broken).toBe(true)
    expect(await client.take(1, REST, 1000)).toBeNull()
    expect(client.has(1, REST)).toBe(false)
  })

  it('prefetches a throw and hands it over for exactly that seed and rest', async () => {
    const client = createPhysicsClient({ transport: handlePhysicsRequest })
    client.prefetch(42, REST)
    await vi.waitFor(() => expect(client.has(42, REST)).toBe(true), { timeout: 20_000 })
    expect(client.ready).toBe(true)
    expect(client.has(43, REST)).toBe(false)
    expect(client.has(42, OTHER)).toBe(false)
    const reply = await client.take(42, REST, 10)
    expect(reply?.seed).toBe(42)
    expect(reply?.recording.restHash).toBe(hashRest(reply?.rest ?? OTHER))
    // Consumed: a second take has nothing held and must prefetch again.
    expect(client.has(42, REST)).toBe(false)
  }, 30_000)

  it('waits a bounded time for a throw in flight', async () => {
    const gate = gatedTransport()
    const client = createPhysicsClient({ transport: gate.transport })
    client.prefetch(7, REST)
    await settle()
    expect(client.has(7, REST)).toBe(false)
    const taking = client.take(7, REST, 5000)
    await gate.release()
    const reply = await taking
    expect(reply?.seed).toBe(7)
    expect(gate.requests.filter((r) => r.kind === 'throw')).toHaveLength(1)
  }, 30_000)

  it('gives up after the timeout when the worker is late, so the roll plays its fallback', async () => {
    const gate = gatedTransport()
    const client = createPhysicsClient({ transport: gate.transport })
    client.prefetch(8, REST)
    const reply = await client.take(8, REST, 20)
    expect(reply).toBeNull()
  })

  it('a take for a throw never asked for starts the request and waits for it', async () => {
    const gate = gatedTransport()
    const client = createPhysicsClient({ transport: gate.transport })
    const taking = client.take(9, REST, 5000)
    await settle()
    expect(gate.requests.filter((r) => r.kind === 'throw')).toHaveLength(1)
    await gate.release()
    expect((await taking)?.seed).toBe(9)
  }, 30_000)

  it('replaces the held throw when another seed or rest is asked for', async () => {
    const gate = gatedTransport()
    const client = createPhysicsClient({ transport: gate.transport })
    client.prefetch(1, REST)
    client.prefetch(1, REST) // the same pair: no new request
    await settle()
    expect(gate.requests.filter((r) => r.kind === 'throw')).toHaveLength(1)
    client.prefetch(1, OTHER)
    await settle()
    expect(gate.requests.filter((r) => r.kind === 'throw')).toHaveLength(2)
    await gate.release()
    expect(client.has(1, REST)).toBe(false)
    expect(client.has(1, OTHER)).toBe(true)
  }, 30_000)

  it('refuses a worker that runs other physics params', async () => {
    const listener = vi.fn()
    const transport: PhysicsTransport = (request) => ({
      response: { id: request.id, ok: true, kind: 'ready', paramsFingerprint: 'deadbeefdeadbeef' },
      transfer: [],
    })
    const client = createPhysicsClient({ transport })
    client.subscribe(listener)
    client.prefetch(3, REST)
    await settle()
    expect(client.broken).toBe(true)
    expect(client.ready).toBe(false)
    expect(await client.take(3, REST, 1000)).toBeNull()
    expect(listener).toHaveBeenCalled()
  })

  it('treats a failure response as no throw, and keeps working afterwards', async () => {
    let fail = true
    const transport: PhysicsTransport = (request) => {
      if (request.kind === 'ping')
        return { ...READY, response: { ...READY.response, id: request.id } }
      if (fail) return { response: { id: request.id, ok: false, error: 'nope' }, transfer: [] }
      return handlePhysicsRequest(request)
    }
    const client = createPhysicsClient({ transport })
    client.prefetch(5, REST)
    await settle()
    expect(client.has(5, REST)).toBe(false)
    expect(await client.take(5, REST, 50)).toBeNull()
    fail = false
    client.prefetch(6, REST)
    await vi.waitFor(() => expect(client.has(6, REST)).toBe(true), { timeout: 20_000 })
    expect(client.broken).toBe(false)
  }, 30_000)

  it('dispose settles a pending take with null', async () => {
    const gate = gatedTransport()
    const client = createPhysicsClient({ transport: gate.transport })
    const taking = client.take(2, REST, 5000)
    await settle()
    client.dispose()
    expect(await taking).toBeNull()
  })
})
