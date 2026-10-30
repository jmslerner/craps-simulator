import { ENGINE_VERSION, compileConfig, hashJson } from '../engine/index.ts'
import type { MachineConfig, MachineConfigInput } from '../engine/index.ts'
import { EXACT_VERSION, fromWire, toWire } from '../exact/index.ts'
import type { BetSpec, Wire } from '../exact/index.ts'
import { catalogSpecs } from '../exact/index.ts'
import { zoneBadges } from '../coach/badges.ts'
import { inspectorMath } from '../coach/inspector.ts'
import { badgeKey, type ZoneBadge } from '../coach/types.ts'
import { safeGet, safeSetMany } from '../persistence/storage.ts'
import type {
  AnalysisRequest,
  AnalysisResponse,
  CatalogRequest,
  InspectRequest,
} from './analysisProtocol.ts'

/**
 * The analysis worker's request handler, a plain async function so the core tests drive it under
 * Node and the UI tests use it as a fake transport. It compiles each config once per hash,
 * verifies the hash the client expected, and never throws: every failure becomes an `ok: false`
 * response.
 *
 * **IndexedDB cache** (plan §13 M8 → M9 hand-off): each zone badge is cached under its
 * `analysisKey` components — config hash, `ENGINE_VERSION`, `EXACT_VERSION`, the bet
 * (typeId + number), the start (`typical`) and the horizon (`lifecycle`) — plus a provenance
 * digest, because a provenance-only edit keeps the config hash while changing `assumedPaths`
 * (M5/M6 audit). A spec the catalog cannot price stores a `'none'` marker so a full cache hit is
 * detectable. The cache rides `src/persistence/storage.ts`'s never-throw wrappers: with no
 * IndexedDB at all the handler just recomputes.
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

/** One badge's cache key: the analysisKey components plus the provenance digest. */
function badgeCacheKey(cfg: MachineConfig, spec: BetSpec): string {
  return [
    'coach:badge:1',
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

type CachedBadge = Wire<ZoneBadge> | 'none'

export async function handleAnalysisRequest(request: AnalysisRequest): Promise<AnalysisResponse> {
  try {
    switch (request.kind) {
      case 'catalog':
        return await handleCatalog(request)
      case 'inspect':
        return handleInspect(request)
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
  const keys = specs.map((spec) => badgeCacheKey(cfg, spec))

  const cached = await Promise.all(keys.map((key) => safeGet<CachedBadge>(key)))
  const hit = cached.every((entry) => entry.ok && entry.value !== undefined)
  if (hit) {
    try {
      const badges: Wire<ZoneBadge>[] = []
      for (const entry of cached) {
        if (!entry.ok || entry.value === undefined) break
        if (entry.value === 'none') continue
        // Round-trip through fromWire so a corrupt blob is caught here, not in the UI.
        badges.push(toWire(fromWire<ZoneBadge>(entry.value)))
      }
      return {
        id: request.id,
        ok: true,
        kind: 'catalog',
        configHash: cfg.configHash,
        badges,
        fromCache: true,
      }
    } catch {
      // A malformed cached badge: fall through and recompute.
    }
  }

  const badges = zoneBadges(cfg)
  const byKey = new Map(badges.map((badge) => [badgeKey(badge.typeId, badge.number), badge]))
  const wired = badges.map((badge) => toWire(badge))
  const entries: (readonly [string, CachedBadge])[] = specs.map((spec, index) => {
    const badge = byKey.get(badgeKey(spec.typeId, spec.number))
    const key = keys[index] ?? badgeCacheKey(cfg, spec)
    return [key, badge === undefined ? 'none' : toWire(badge)] as const
  })
  // Best effort: a failed write only means the next load recomputes.
  await safeSetMany(entries)
  return {
    id: request.id,
    ok: true,
    kind: 'catalog',
    configHash: cfg.configHash,
    badges: wired,
    fromCache: false,
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
