import { DEFAULT_PARAMS, paramsFingerprint } from '../physics/core/params.ts'
import { hashRest, type RestState } from '../physics/core/restPose.ts'
import type { Outgoing, PhysicsRequest, PhysicsResponse } from '../workers/physicsProtocol.ts'
import type { ThrowReply } from './throws.ts'

/**
 * The main-thread side of the physics worker (plan §7 Prefetch). While the player bets, the dome
 * asks for the next throw — the seed the roll flow will derive, from the rest the dice lie in —
 * and the worker simulates it; when the roll comes, `take` hands the recording over at once, or
 * waits at most `timeoutMs` for one still in flight, or gives up (null) so the dome plays its
 * fallback. One throw is held at a time: a prefetch for another seed or rest replaces it, which
 * is how a new session or a rest the dome had to re-synthesise discards a stale throw. The worker
 * is spawned on the first prefetch and pinged, so Rapier loads while the player is still betting.
 *
 * Without `Worker` (jsdom tests, old browsers) the client is inert — `take` answers null — unless
 * a transport is injected; the tests use `handlePhysicsRequest` itself.
 */

export type PhysicsTransport = (request: PhysicsRequest) => Promise<Outgoing> | Outgoing

export interface PhysicsClient {
  /** Simulates the throw for `seed` from `rest` ahead of time; a repeat for the same pair is free. */
  prefetch(seed: number, rest: RestState): void
  /** The held throw for exactly this seed and rest, waiting up to `timeoutMs` for one in flight. */
  take(seed: number, rest: RestState, timeoutMs: number): Promise<ThrowReply | null>
  /** True while a finished throw for exactly this seed and rest is held. */
  has(seed: number, rest: RestState): boolean
  /** True once the worker has loaded Rapier (its ping came back with matching params). */
  readonly ready: boolean
  /** True when the worker could not be spawned, crashed, or runs other physics params. */
  readonly broken: boolean
  subscribe(listener: () => void): () => void
  /** Terminates the worker; the client stays usable but inert. */
  dispose(): void
}

export interface PhysicsClientOptions {
  /** Routes requests through a function instead of a worker (tests). */
  readonly transport?: PhysicsTransport
  /** Spawns the worker; the default builds the Vite worker chunk. Null means no worker. */
  readonly spawn?: () => Worker | null
}

interface Held {
  readonly id: number
  readonly seed: number
  readonly restHash: string
  status: 'pending' | 'done' | 'failed'
  reply: ThrowReply | null
  readonly waiters: ((reply: ThrowReply | null) => void)[]
}

function spawnWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('../workers/physics.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export function createPhysicsClient(options: PhysicsClientOptions = {}): PhysicsClient {
  const listeners = new Set<() => void>()
  let worker: Worker | null = null
  let started = false
  let ready = false
  let broken = false
  let disposed = false
  let nextId = 1
  let held: Held | null = null

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const deliver = (response: PhysicsResponse): void => {
    if (response.ok && response.kind === 'ready') {
      if (response.paramsFingerprint !== paramsFingerprint(DEFAULT_PARAMS)) {
        fail('the physics worker runs other physics params')
      } else {
        ready = true
        notify()
      }
      return
    }
    if (held === null || held.id !== response.id) return
    if (response.ok && response.kind === 'throw') {
      held.status = 'done'
      held.reply = {
        seed: response.seed,
        recording: response.recording,
        rest: response.rest,
        startedFromRequest: response.startedFromRequest,
        attempts: response.attempts,
        source: response.source,
      }
    } else {
      held.status = 'failed'
    }
    settleWaiters(held)
    notify()
  }

  const settleWaiters = (entry: Held): void => {
    const reply = entry.status === 'done' ? entry.reply : null
    for (const waiter of entry.waiters.splice(0)) waiter(reply)
  }

  /** The worker is gone or wrong: nothing held can arrive, and nothing more is asked. */
  const fail = (reason: string): void => {
    void reason
    broken = true
    ready = false
    if (held !== null) {
      held.status = 'failed'
      settleWaiters(held)
    }
    worker?.terminate()
    worker = null
    notify()
  }

  const send = (request: PhysicsRequest): boolean => {
    if (broken || disposed) return false
    if (options.transport !== undefined) {
      const transport = options.transport
      void Promise.resolve()
        .then(() => transport(request))
        .then(({ response }) => deliver(response))
        .catch((error: unknown) => deliver({ id: request.id, ok: false, error: String(error) }))
      return true
    }
    if (!started) {
      started = true
      worker = (options.spawn ?? spawnWorker)()
      if (worker === null) {
        broken = true
        return false
      }
      worker.addEventListener('message', (event) => {
        deliver((event as MessageEvent<PhysicsResponse>).data)
      })
      worker.addEventListener('error', () => fail('the physics worker crashed'))
      if (request.kind !== 'ping') worker.postMessage({ id: nextId++, kind: 'ping' })
    }
    if (worker === null) return false
    worker.postMessage(request)
    return true
  }

  const prefetch = (seed: number, rest: RestState): void => {
    const restHash = hashRest(rest)
    if (
      held !== null &&
      held.seed === seed &&
      held.restHash === restHash &&
      held.status !== 'failed'
    ) {
      return
    }
    if (held !== null) settleWaiters({ ...held, status: 'failed' })
    const entry: Held = {
      id: nextId++,
      seed,
      restHash,
      status: 'pending',
      reply: null,
      waiters: [],
    }
    held = entry
    if (options.transport !== undefined && !started) {
      started = true
      send({ id: nextId++, kind: 'ping' })
    }
    if (!send({ id: entry.id, kind: 'throw', seed, rest })) {
      entry.status = 'failed'
    }
    notify()
  }

  return {
    prefetch,
    has: (seed, rest) =>
      held !== null &&
      held.status === 'done' &&
      held.seed === seed &&
      held.restHash === hashRest(rest),
    take: (seed, rest, timeoutMs) => {
      const restHash = hashRest(rest)
      if (held === null || held.seed !== seed || held.restHash !== restHash) {
        prefetch(seed, rest)
      }
      const entry = held
      if (entry === null || entry.status === 'failed') return Promise.resolve(null)
      if (entry.status === 'done') {
        held = null
        notify()
        return Promise.resolve(entry.reply)
      }
      return new Promise((resolve) => {
        let settled = false
        const finish = (reply: ThrowReply | null): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (reply !== null && held === entry) {
            held = null
            notify()
          }
          resolve(reply)
        }
        const timer = setTimeout(() => finish(null), timeoutMs)
        entry.waiters.push(finish)
      })
    },
    get ready() {
      return ready
    },
    get broken() {
      return broken
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {
      disposed = true
      worker?.terminate()
      worker = null
      if (held !== null) {
        held.status = 'failed'
        settleWaiters(held)
      }
    },
  }
}
