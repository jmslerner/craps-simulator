import { hashJson } from '../../engine/index.ts'
import type { BetId, Cents, MachineConfig, TableState } from '../../engine/index.ts'
import { fromWire } from '../../exact/wire.ts'
import type { BetSpec } from '../../exact/chain.ts'
import { badgeKey } from '../../coach/types.ts'
import type { ZoneBadge } from '../../coach/types.ts'
import type { InspectorMath } from '../../coach/inspector.ts'
import type { AnalysisRequest, AnalysisResponse } from '../../workers/analysisProtocol.ts'

/**
 * The main-thread side of the analysis worker (plan §5.5, §13 M8 → M9 hand-off): a small
 * subscribable store the UI reads through `useSyncExternalStore`. It spawns the worker lazily on
 * the first request, sends `cfg.input` (JSON-safe) with the expected `configHash`, decodes results
 * with `fromWire`, and keeps snapshots referentially stable so zone badges and the inspector never
 * re-render on unrelated state. It deliberately imports no part of the solver: the exact module
 * runs only inside the worker chunk, keeping the initial bundle within its budget.
 *
 * Without `Worker` (jsdom unit tests, ancient browsers) the client stays inert and every snapshot
 * is null; tests install a transport with `setAnalysisTransportForTests`, usually the real
 * `handleAnalysisRequest`.
 */

export interface BadgeSet {
  readonly byKey: ReadonlyMap<string, ZoneBadge>
  /** True when the worker served every badge from the IndexedDB analysis cache. */
  readonly fromCache: boolean
}

export type AnalysisTransport = (
  request: AnalysisRequest,
) => Promise<AnalysisResponse> | AnalysisResponse

const MAX_INSPECTIONS = 64

const listeners = new Set<() => void>()
const badgeSets = new Map<string, BadgeSet>()
const catalogPending = new Set<string>()
const catalogFailed = new Set<string>()
const inspections = new Map<string, InspectorMath>()
const inspectPending = new Set<string>()
const inspectFailed = new Set<string>()
const inflight = new Map<
  number,
  | { readonly kind: 'catalog'; readonly configHash: string }
  | { readonly kind: 'inspect'; readonly key: string }
>()

let nextId = 1
let worker: Worker | null = null
let workerBroken = false
let testTransport: AnalysisTransport | null = null

export function subscribeAnalysis(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** The badges of a config, or null until they arrive. The returned set is referentially stable. */
export function badgesFor(configHash: string): BadgeSet | null {
  return badgeSets.get(configHash) ?? null
}

/** One zone's badge, or null while unknown; stable per arrival, safe as a snapshot. */
export function badgeFor(
  configHash: string,
  typeId: string,
  number: number | null,
): ZoneBadge | null {
  return badgeSets.get(configHash)?.byKey.get(badgeKey(typeId, number)) ?? null
}

/** Asks the worker for `cfg`'s badges once; later calls for the same config are free. */
export function ensureCatalog(cfg: MachineConfig): void {
  const hash = cfg.configHash
  if (badgeSets.has(hash) || catalogPending.has(hash) || catalogFailed.has(hash)) return
  catalogPending.add(hash)
  send({ id: nextId++, kind: 'catalog', configHash: hash, input: cfg.input }, (id) =>
    inflight.set(id, { kind: 'catalog', configHash: hash }),
  )
}

/**
 * The inspector request's identity: config, spec, amount, and — when a bet on the table is being
 * valued — the exact table, by hash, because equity moves with the phase and the working toggles.
 */
export function inspectKey(
  cfg: MachineConfig,
  spec: BetSpec,
  amount: Cents,
  betId: BetId | null,
  state: TableState | null,
): string {
  const stateTag = betId === null || state === null ? '-' : hashJson(state)
  return [cfg.configHash, spec.typeId, spec.number ?? '-', amount, betId ?? '-', stateTag].join('|')
}

/** Requests the inspector math once per `inspectKey`; returns the key to read results with. */
export function requestInspect(
  cfg: MachineConfig,
  spec: BetSpec,
  amount: Cents,
  state: TableState | null,
  betId: BetId | null,
): string {
  const key = inspectKey(cfg, spec, amount, betId, state)
  if (inspections.has(key) || inspectPending.has(key) || inspectFailed.has(key)) return key
  inspectPending.add(key)
  send(
    {
      id: nextId++,
      kind: 'inspect',
      configHash: cfg.configHash,
      input: cfg.input,
      spec,
      amount,
      state: betId === null ? null : state,
      betId,
    },
    (id) => inflight.set(id, { kind: 'inspect', key }),
  )
  return key
}

/** The inspector math for a key from `requestInspect`, or null until it arrives. */
export function inspectFor(key: string): InspectorMath | null {
  return inspections.get(key) ?? null
}

// ---------------------------------------------------------------------------------------------

function send(request: AnalysisRequest, track: (id: number) => void): void {
  track(request.id)
  if (testTransport !== null) {
    const transport = testTransport
    void Promise.resolve()
      .then(() => transport(request))
      .then(deliver)
      .catch((error: unknown) => {
        deliver({ id: request.id, ok: false, error: String(error) })
      })
    return
  }
  const spawned = spawn()
  if (spawned === null) {
    deliver({ id: request.id, ok: false, error: 'analysis worker unavailable' })
    return
  }
  spawned.postMessage(request)
}

function spawn(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null
  if (worker !== null) return worker
  try {
    worker = new Worker(new URL('../../workers/analysis.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    workerBroken = true
    return null
  }
  worker.addEventListener('message', (event) => {
    deliver((event as MessageEvent<AnalysisResponse>).data)
  })
  worker.addEventListener('error', () => {
    // The worker is gone: fail everything in flight so the UI settles instead of waiting.
    workerBroken = true
    for (const [id] of inflight) deliver({ id, ok: false, error: 'analysis worker crashed' })
  })
  return worker
}

function deliver(response: AnalysisResponse): void {
  const tracked = inflight.get(response.id)
  if (tracked === undefined) return
  inflight.delete(response.id)
  try {
    if (tracked.kind === 'catalog') {
      catalogPending.delete(tracked.configHash)
      if (!response.ok || response.kind !== 'catalog') {
        catalogFailed.add(tracked.configHash)
      } else {
        const byKey = new Map<string, ZoneBadge>()
        for (const wired of response.badges) {
          const badge = fromWire<ZoneBadge>(wired)
          byKey.set(badgeKey(badge.typeId, badge.number), badge)
        }
        badgeSets.set(tracked.configHash, { byKey, fromCache: response.fromCache })
      }
    } else {
      inspectPending.delete(tracked.key)
      if (!response.ok || response.kind !== 'inspect') {
        inspectFailed.add(tracked.key)
      } else {
        if (inspections.size >= MAX_INSPECTIONS) {
          const oldest = inspections.keys().next()
          if (oldest.done !== true) inspections.delete(oldest.value)
        }
        inspections.set(tracked.key, fromWire<InspectorMath>(response.math))
      }
    }
  } catch {
    // A malformed payload: treat it as a failure for that request.
    if (tracked.kind === 'catalog') catalogFailed.add(tracked.configHash)
    else inspectFailed.add(tracked.key)
  }
  notify()
}

// --- Test plumbing (unit tests only; production never calls these) ---

/** Routes requests through `transport` instead of a real worker, and resets all state. */
export function setAnalysisTransportForTests(transport: AnalysisTransport | null): void {
  testTransport = transport
  resetAnalysisForTests()
}

/** Clears every snapshot and in-flight request (isolated unit tests). */
export function resetAnalysisForTests(): void {
  badgeSets.clear()
  catalogPending.clear()
  catalogFailed.clear()
  inspections.clear()
  inspectPending.clear()
  inspectFailed.clear()
  inflight.clear()
}
