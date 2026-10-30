import { createStore, type StoreApi } from 'zustand/vanilla'
import { force3d } from './webgl.ts'

/**
 * Quality tiers (plan §7 Quality and fallbacks, M10b): what the dome spends per frame, by device
 * class and by measured frame time, with a player override.
 *
 * | tier   | when                       | DPR      | glass        | shadows | MSAA |
 * |--------|----------------------------|----------|--------------|---------|------|
 * | high   | fine pointer (desktop)     | [1, 2]   | transmission | yes     | yes  |
 * | medium | coarse pointer (phone)     | [1, 1.5] | plain        | yes     | yes  |
 * | low    | dropped to by the monitor  | 1        | plain        | no      | no   |
 *
 * The frame monitor runs only while a throw plays: once it has 60 frame times it takes their
 * median, and a median over 22 ms (under 45 fps) drops one tier. The drop is kept per device in
 * localStorage, so the next visit starts on the tier this device holds, and the player can pin a
 * tier instead (`override`), which turns the monitor off. 2D is never chosen by the monitor: it
 * stays the fallback for a device without WebGL or one that loses its context. Geometry and
 * materials follow the tier live; MSAA is fixed when the renderer is created, so a drop's MSAA
 * change lands on the next load. Under `force3d=1` (the e2e, software WebGL) the tier is medium
 * and the monitor is off, so a slow rasteriser cannot change what the specs assert.
 */

export type QualityTier = 'high' | 'medium' | 'low'
/** What the player may pin: a tier, or auto (device class, then the monitor). */
export type QualityChoice = QualityTier | 'auto'

/** Best first; `lowerTier` walks down it. */
export const TIER_ORDER: readonly QualityTier[] = ['high', 'medium', 'low']

export interface TierSpec {
  /** R3F's `dpr`: a fixed ratio, or [min, max] clamping the device's. */
  readonly dpr: number | [number, number]
  /** MSAA, decided when the renderer is created. */
  readonly antialias: boolean
  /** The acrylic dome as transmission glass (renders the scene twice) or a plain transparent shell. */
  readonly transmission: boolean
  /** Blob shadows under the dice. */
  readonly shadows: boolean
  /** Mesh detail: the die's rounded-box segments, the dome sphere's and ring's, the felt disc's. */
  readonly segments: {
    readonly die: number
    readonly dome: readonly [number, number]
    readonly ring: readonly [number, number]
    readonly felt: number
  }
}

export const TIERS: Readonly<Record<QualityTier, TierSpec>> = {
  high: {
    dpr: [1, 2],
    antialias: true,
    transmission: true,
    shadows: true,
    segments: { die: 4, dome: [64, 24], ring: [16, 128], felt: 72 },
  },
  medium: {
    dpr: [1, 1.5],
    antialias: true,
    transmission: false,
    shadows: true,
    segments: { die: 3, dome: [48, 18], ring: [12, 96], felt: 64 },
  },
  low: {
    dpr: 1,
    antialias: false,
    transmission: false,
    shadows: false,
    segments: { die: 2, dome: [32, 12], ring: [8, 64], felt: 48 },
  },
}

export function isQualityChoice(value: unknown): value is QualityChoice {
  return value === 'auto' || TIER_ORDER.includes(value as QualityTier)
}

/** The next tier down, or null at the lowest. */
export function lowerTier(tier: QualityTier): QualityTier | null {
  return TIER_ORDER[TIER_ORDER.indexOf(tier) + 1] ?? null
}

/** The lower of two tiers. */
export function lowestTier(a: QualityTier, b: QualityTier): QualityTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b
}

/** The tier a device class starts on: transmission glass on fine pointers, plain glass elsewhere. */
export function defaultTier(forced: boolean = force3d()): QualityTier {
  if (forced || typeof matchMedia !== 'function') return 'medium'
  try {
    return matchMedia('(pointer: fine)').matches ? 'high' : 'medium'
  } catch {
    return 'medium'
  }
}

export interface MonitorSettings {
  /** Frame times taken before a verdict. */
  readonly frames: number
  /** A median over this, ms, drops a tier. */
  readonly thresholdMs: number
  /** Frames at the start of each throw that are ignored (shader compiles, texture uploads). */
  readonly warmup: number
}

export const MONITOR: MonitorSettings = { frames: 60, thresholdMs: 22, warmup: 5 }

export interface FrameMonitor {
  /** A frame was drawn at `nowMs`; true when the window just filled with a median over the threshold. */
  frame(nowMs: number): boolean
  /**
   * A throw starts: forget the last frame time (the gap since the last throw is not a frame) and
   * the warm-up count, but keep the frame times gathered so far — one throw is shorter than the
   * window, so the verdict spans throws.
   */
  reset(): void
  /** The frame times under consideration, oldest first. */
  readonly samples: readonly number[]
}

/** The ~30-line frame-time monitor: a window of frame times, judged by its median once full. */
export function createFrameMonitor(settings: MonitorSettings = MONITOR): FrameMonitor {
  let last: number | null = null
  let skipped = 0
  let samples: number[] = []
  return {
    frame(nowMs) {
      if (last === null) {
        last = nowMs
        return false
      }
      const dt = nowMs - last
      last = nowMs
      if (!(dt >= 0)) return false
      if (skipped < settings.warmup) {
        skipped++
        return false
      }
      samples.push(dt)
      if (samples.length < settings.frames) return false
      const sorted = [...samples].sort((a, b) => a - b)
      const median = sorted[sorted.length >> 1] ?? 0
      samples = []
      return median > settings.thresholdMs
    },
    reset() {
      last = null
      skipped = 0
    },
    get samples() {
      return samples
    },
  }
}

export interface QualityState {
  /** The device class's tier. */
  readonly device: QualityTier
  /** The tier the monitor dropped this device to, kept across visits; null when it never did. */
  readonly measured: QualityTier | null
  /** The player's pin, or auto. */
  readonly override: QualityChoice
  /** What the dome draws at: the override, else the lower of the device's and the measured tier. */
  readonly tier: QualityTier
  setOverride(choice: QualityChoice): void
  /** The monitor's verdict: one tier down, unless pinned or already at the lowest. True when it moved. */
  drop(): boolean
}

export interface QualityOptions {
  /** Where the override and the measured tier are kept; null keeps them in memory only. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  /** The device class's tier; the default asks the browser. */
  readonly device?: QualityTier
  /** Whether the frame-time monitor runs during playback; the default is off only under force3d. */
  readonly monitor?: boolean
}

export const QUALITY_KEY = 'bct:v1:dome-quality'

interface Saved {
  readonly override: QualityChoice
  readonly measured: QualityTier | null
}

function load(storage: Pick<Storage, 'getItem'> | null): Saved {
  const fallback: Saved = { override: 'auto', measured: null }
  if (storage === null) return fallback
  try {
    const raw = storage.getItem(QUALITY_KEY)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return fallback
    const { override, measured } = parsed as { override?: unknown; measured?: unknown }
    return {
      override: isQualityChoice(override) ? override : 'auto',
      measured: isQualityChoice(measured) && measured !== 'auto' ? measured : null,
    }
  } catch {
    return fallback
  }
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function effective(device: QualityTier, measured: QualityTier | null, override: QualityChoice) {
  if (override !== 'auto') return override
  return measured === null ? device : lowestTier(device, measured)
}

export function createQualityStore(options: QualityOptions = {}): StoreApi<QualityState> {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const device = options.device ?? defaultTier()
  const saved = load(storage)
  const save = (state: Saved): void => {
    try {
      storage?.setItem(QUALITY_KEY, JSON.stringify(state))
    } catch {
      // Storage full or blocked: the tier still applies for this visit.
    }
  }
  return createStore<QualityState>()((set, get) => ({
    device,
    measured: saved.measured,
    override: saved.override,
    tier: effective(device, saved.measured, saved.override),
    setOverride: (choice) => {
      const { measured } = get()
      set({ override: choice, tier: effective(device, measured, choice) })
      save({ override: choice, measured })
    },
    drop: () => {
      const { override, tier, measured } = get()
      if (override !== 'auto') return false
      const lower = lowerTier(tier)
      if (lower === null) return false
      const next = measured === null ? lower : lowestTier(measured, lower)
      set({ measured: next, tier: effective(device, next, override) })
      save({ override, measured: next })
      return true
    },
  }))
}
