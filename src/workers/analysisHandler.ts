import { ENGINE_VERSION, compileConfig, hashJson } from '../engine/index.ts'
import type { MachineConfig, MachineConfigInput } from '../engine/index.ts'
import { EXACT_VERSION, byEdge, catalogTable, fromWire, toWire } from '../exact/index.ts'
import type { BetSpec, CatalogRow, Wire } from '../exact/index.ts'
import { catalogSpecs } from '../exact/index.ts'
import { zoneBadges } from '../coach/badges.ts'
import { inspectorMath } from '../coach/inspector.ts'
import { layoutMeter } from '../coach/meter.ts'
import { badgeKey, type ZoneBadge } from '../coach/types.ts'
import { safeGet, safeSetMany } from '../persistence/storage.ts'
import type {
  AnalysisRequest,
  AnalysisResponse,
  CatalogRequest,
  InspectRequest,
  LayoutRequest,
} from './analysisProtocol.ts'

/**
 * The analysis worker's request handler, a plain async function so the core tests drive it under
 * Node and the UI tests use it as a fake transport. It compiles each config once per hash,
 * verifies the hash the client expected, and never throws: every failure becomes an `ok: false`
 * response.
 *
 * **IndexedDB cache** (plan §13 M8 → M9 hand-off): each zone badge and its raw catalog row (the
 * cheat sheet's data, §10 M9d) are cached together under the `analysisKey` components — config
 * hash, `ENGINE_VERSION`, `EXACT_VERSION`, the bet (typeId + number), the start (`typical`) and
 * the horizon (`lifecycle`) — plus a provenance digest, because a provenance-only edit keeps the
 * config hash while changing `assumedPaths` (M5/M6 audit). A spec the catalog cannot price stores
 * a `'none'` marker so a full cache hit is detectable. The cache rides
 * `src/persistence/storage.ts`'s never-throw wrappers: with no IndexedDB at all the handler just
 * recomputes. The layout meter is never cached here: its key is the whole table.
 */

const MAX_CONFIGS = 16
const compiled = new Map<string, MachineConfig>()

/** The compiled config for a request, by its client-stated hash, verified on first compile. */
function configOf(configHash: string, input: MachineConfigInput): MachineConfig {
  const cached = compiled.get(configHash)
  if (cached !== undefined) return cached
  const cfg = compileConfig(input)
  if (cfg.configHash !== configHash) {
    throw new Error(`config hash mismatch: expected ${configHash}, compiled ${cfg.configHash}`)
  }
  if (compiled.size >= MAX_CONFIGS) {
    const oldest = compiled.keys().next()
    if (oldest.done !== true) compiled.delete(oldest.value)
  }
  compiled.set(configHash, cfg)
  return cfg
}

/**
 * One spec's cache key: the analysisKey components plus the provenance digest. Since M9d the
 * entry holds the badge and its raw catalog row together (the row carries the badge's own
 * numbers and the cheat sheet's), under a new prefix so M9a's badge-only blobs just miss.
 */
function catalogCacheKey(cfg: MachineConfig, spec: BetSpec): string {
  return [
    'coach:catalog:1',
    cfg.configHash,
    `e${ENGINE_VERSION}`,
    `x${EXACT_VERSION}`,
    `p${hashJson(cfg.provenance)}`,
    spec.typeId,
    spec.number ?? '-',
    'typical',
    'lifecycle',
  ].join('|')
}

type CachedSpec = { readonly badge: Wire<ZoneBadge>; readonly row: Wire<CatalogRow> } | 'none'

export async function handleAnalysisRequest(request: AnalysisRequest): Promise<AnalysisResponse> {
  try {
    switch (request.kind) {
      case 'catalog':
        return await handleCatalog(request)
      case 'inspect':
        return handleInspect(request)
      case 'layout':
        return handleLayout(request)
    }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

async function handleCatalog(request: CatalogRequest): Promise<AnalysisResponse> {
  const cfg = configOf(request.configHash, request.input)
  const specs = catalogSpecs(cfg)
  const keys = specs.map((spec) => catalogCacheKey(cfg, spec))

  const cached = await Promise.all(keys.map((key) => safeGet<CachedSpec>(key)))
  const hit = cached.every((entry) => entry.ok && entry.value !== undefined)
  if (hit) {
    try {
      const badges: Wire<ZoneBadge>[] = []
      const rows: CatalogRow[] = []
      for (const entry of cached) {
        if (!entry.ok || entry.value === undefined) break
        if (entry.value === 'none') continue
        // Round-trip through fromWire so a corrupt blob is caught here, not in the UI.
        badges.push(toWire(fromWire<ZoneBadge>(entry.value.badge)))
        rows.push(fromWire<CatalogRow>(entry.value.row))
      }
      return {
        id: request.id,
        ok: true,
        kind: 'catalog',
        configHash: cfg.configHash,
        badges,
        rows: byEdge(rows).map((row) => toWire(row)),
        fromCache: true,
      }
    } catch {
      // A malformed cached entry: fall through and recompute.
    }
  }

  const rows = catalogTable(cfg)
  const badges = zoneBadges(cfg)
  const byKey = new Map(badges.map((badge) => [badgeKey(badge.typeId, badge.number), badge]))
  const rowByKey = new Map(rows.map((row) => [badgeKey(row.spec.typeId, row.spec.number), row]))
  const wired = badges.map((badge) => toWire(badge))
  const entries: (readonly [string, CachedSpec])[] = specs.map((spec, index) => {
    const key = keys[index] ?? catalogCacheKey(cfg, spec)
    const badge = byKey.get(badgeKey(spec.typeId, spec.number))
    const row = rowByKey.get(badgeKey(spec.typeId, spec.number))
    return [
      key,
      badge === undefined || row === undefined
        ? 'none'
        : { badge: toWire(badge), row: toWire(row) },
    ] as const
  })
  // Best effort: a failed write only means the next load recomputes.
  await safeSetMany(entries)
  return {
    id: request.id,
    ok: true,
    kind: 'catalog',
    configHash: cfg.configHash,
    badges: wired,
    rows: byEdge(rows).map((row) => toWire(row)),
    fromCache: false,
  }
}

/**
 * The layout meter (§10 M9d): priced fresh per table — the state keys it, so nothing is cached in
 * IndexedDB; the exact module's own memos keep repeat pricing of the same bets cheap.
 */
function handleLayout(request: LayoutRequest): AnalysisResponse {
  const cfg = configOf(request.configHash, request.input)
  const meter = layoutMeter(request.state, cfg, request.toggle)
  return {
    id: request.id,
    ok: true,
    kind: 'layout',
    configHash: cfg.configHash,
    meter: toWire(meter),
  }
}

function handleInspect(request: InspectRequest): AnalysisResponse {
  const cfg = configOf(request.configHash, request.input)
  const math = inspectorMath(request.spec, request.amount, cfg, request.state, request.betId)
  return {
    id: request.id,
    ok: true,
    kind: 'inspect',
    configHash: cfg.configHash,
    math: toWire(math),
  }
}
