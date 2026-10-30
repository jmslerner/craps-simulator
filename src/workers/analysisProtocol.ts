import type { BetId, Cents, MachineConfigInput, TableState } from '../engine/index.ts'
import type { BetSpec, CatalogRow, Wire } from '../exact/index.ts'
import type { InspectorMath } from '../coach/inspector.ts'
import type { LayoutMeter, MeterToggle } from '../coach/meter.ts'
import type { ZoneBadge } from '../coach/types.ts'

/**
 * The analysis worker's protocol (plan §5.5 worker boundary, §13 M8 → M9 hand-off). Requests carry
 * `cfg.input` — the JSON-safe `MachineConfigInput` — and the expected `configHash`; the worker
 * compiles on its side (`compileConfig` memoizes) and refuses a hash mismatch. Responses carry
 * exact results through `toWire`/`fromWire`, because `Fraction`s lose their prototype in a
 * structured clone. Every request gets exactly one response, matched by `id`; a failure is an
 * `ok: false` response, never a worker crash.
 */

export interface CatalogRequest {
  readonly id: number
  readonly kind: 'catalog'
  readonly configHash: string
  readonly input: MachineConfigInput
}

export interface InspectRequest {
  readonly id: number
  readonly kind: 'inspect'
  readonly configHash: string
  readonly input: MachineConfigInput
  readonly spec: BetSpec
  readonly amount: Cents
  /** The table the bet sits on, for the equity block; null for an empty spot. */
  readonly state: TableState | null
  readonly betId: BetId | null
}

export interface LayoutRequest {
  readonly id: number
  readonly kind: 'layout'
  readonly configHash: string
  readonly input: MachineConfigInput
  /** The table the meter prices (JSON-safe by contract). */
  readonly state: TableState
  /** The working toggle to price on the dry-run table, when the machine offers one. */
  readonly toggle: MeterToggle | null
}

export type AnalysisRequest = CatalogRequest | InspectRequest | LayoutRequest

export interface CatalogResponse {
  readonly id: number
  readonly ok: true
  readonly kind: 'catalog'
  readonly configHash: string
  readonly badges: readonly Wire<ZoneBadge>[]
  /** The raw catalog rows behind the badges, `byEdge`-sorted (§10 M9d cheat sheet). */
  readonly rows: readonly Wire<CatalogRow>[]
  /** True when every badge and row came from the IndexedDB analysis cache (no solver work ran). */
  readonly fromCache: boolean
}

export interface LayoutResponse {
  readonly id: number
  readonly ok: true
  readonly kind: 'layout'
  readonly configHash: string
  readonly meter: Wire<LayoutMeter>
}

export interface InspectResponse {
  readonly id: number
  readonly ok: true
  readonly kind: 'inspect'
  readonly configHash: string
  readonly math: Wire<InspectorMath>
}

export interface FailureResponse {
  readonly id: number
  readonly ok: false
  readonly error: string
}

export type AnalysisResponse = CatalogResponse | InspectResponse | LayoutResponse | FailureResponse
