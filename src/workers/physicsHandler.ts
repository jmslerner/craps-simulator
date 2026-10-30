import { DEFAULT_PARAMS, paramsFingerprint } from '../physics/core/params.ts'
import type { RestState } from '../physics/core/restPose.ts'
import { simulateThrow } from '../physics/core/simulate.ts'
import { initPhysics } from '../physics/core/world.ts'
import type { Outgoing, PhysicsRequest, ThrowRequest } from './physicsProtocol.ts'

/**
 * The physics worker's request handler, a plain async function so the core tests drive it under
 * Node and the dome's client can use it as a fake transport. It loads Rapier on the first request
 * (`initPhysics` shares one promise), simulates each throw with `simulateThrow` — the pop, its
 * seeded retries, the drops, then the analytic hop, so a valid recording always comes back — and
 * never throws: every failure becomes an `ok: false` response. The recording's two buffers are
 * listed for transfer, so the main thread receives them without a copy.
 */

export async function handlePhysicsRequest(request: PhysicsRequest): Promise<Outgoing> {
  try {
    switch (request.kind) {
      case 'ping':
        await initPhysics()
        return {
          response: {
            id: request.id,
            ok: true,
            kind: 'ready',
            paramsFingerprint: paramsFingerprint(DEFAULT_PARAMS),
          },
          transfer: [],
        }
      case 'throw':
        return await handleThrow(request)
    }
  } catch (error) {
    return {
      response: {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      transfer: [],
    }
  }
}

async function handleThrow(request: ThrowRequest): Promise<Outgoing> {
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) {
    throw new RangeError(`physics: seed must be a uint32, got ${String(request.seed)}`)
  }
  const rest = checkRestShape(request.rest)
  await initPhysics()
  const result = simulateThrow(request.seed, rest)
  const { recording } = result
  return {
    response: {
      id: request.id,
      ok: true,
      kind: 'throw',
      seed: request.seed,
      recording,
      rest: result.rest,
      startedFromRequest: result.start.valid,
      attempts: result.attempts.length,
      source: recording.source,
    },
    transfer: [recording.frames.buffer, recording.contacts.buffer],
  }
}

/** The rest as plain numbers: a corrupt message must fail here, not inside Rapier. */
function checkRestShape(rest: unknown): RestState {
  if (!Array.isArray(rest) || rest.length !== 2) {
    throw new RangeError('physics: rest must hold two dice')
  }
  const die = (value: unknown, index: number) => {
    if (typeof value !== 'object' || value === null) {
      throw new RangeError(`physics: die ${index} of the rest is not an object`)
    }
    const { pose, offset } = value as { pose?: unknown; offset?: unknown }
    if (typeof pose !== 'object' || pose === null) {
      throw new RangeError(`physics: die ${index} has no pose`)
    }
    const { p, q } = pose as { p?: unknown; q?: unknown }
    const numbers = (list: unknown, length: number, name: string): number[] => {
      if (!Array.isArray(list) || list.length !== length) {
        throw new RangeError(`physics: die ${index} ${name} must hold ${length} numbers`)
      }
      return list.map((item) => {
        if (typeof item !== 'number' || !Number.isFinite(item)) {
          throw new RangeError(`physics: die ${index} ${name} must be finite numbers`)
        }
        return item
      })
    }
    if (!Number.isInteger(offset) || (offset as number) < 0 || (offset as number) >= 24) {
      throw new RangeError(`physics: die ${index} offset must name a cube rotation`)
    }
    const [px, py, pz] = numbers(p, 3, 'position')
    const [qx, qy, qz, qw] = numbers(q, 4, 'rotation')
    return {
      pose: {
        p: [px ?? 0, py ?? 0, pz ?? 0] as const,
        q: [qx ?? 0, qy ?? 0, qz ?? 0, qw ?? 1] as const,
      },
      offset: offset as number,
    }
  }
  return [die(rest[0], 0), die(rest[1], 1)]
}
