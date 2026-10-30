import { createStore, type StoreApi } from 'zustand/vanilla'
import { force3d } from './webgl.ts'

/**
 * Quality tiers (plan §7 Quality and fallbacks, M10b): what the dome spends per frame, by device
 * class and by measured frame time, with a player override.
 *
 * | tier   | when                       | DPR      | mesh detail | shadows | MSAA |
 * |--------|----------------------------|----------|-------------|---------|------|
 * | high   | fine pointer (desktop)     | [1, 2]   | finest      | yes     | yes  |
 * | medium | coarse pointer (phone)     | [1, 1.5] | finer       | yes     | yes  |
 * | low    | dropped to by the monitor  | 1        | coarse      | no      | no   |
 *
 * Every tier draws the same plain glass. M10b gave the high tier transmission glass (the scene
 * rendered twice, refracted through the shell); with the camera reading the dice through the top
 * of the dome it blurred them and laid the room light's glare over their faces (fix:dome,
 * screenshots at each tier), so it went.
 *
 * The frame monitor runs only while a throw plays: once it has 60 frame times it takes their
 * median, and a median over 22 ms (under 45 fps) drops one tier. The drop is kept per device in
 * localStorage (`bct:v1:dome-quality`), so the next visit starts on the tier this device holds,
 * and the player can pin a tier instead (`override`), which turns the monitor off. The pin is a
 * player setting: it lives in `persistence/settings.ts` (`domeQuality`), which the App hands in as
 * `pin`, so a settings export carries it. 2D is never chosen by the monitor: it
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
    shadows: true,
    segments: { die: 4, dome: [64, 24], ring: [16, 128], felt: 72 },
  },
  medium: {
    dpr: [1, 1.5],
    antialias: true,
    shadows: true,
    segments: { die: 3, dome: [48, 18], ring: [12, 96], felt: 64 },
  },
  low: {
    dpr: 1,
    antialias: false,
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

/** The tier a device class starts on: high on fine pointers (desktop), medium elsewhere. */
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

/** Where the player's pin is kept: the settings store in the app, memory in tests. */
export interface QualityPin {
  read(): QualityChoice
  write(choice: QualityChoice): void
}

export interface QualityOptions {
  /** Where the measured tier is kept; null keeps it in memory only. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  /** The device class's tier; the default asks the browser. */
  readonly device?: QualityTier
  /** Whether the frame-time monitor runs during playback; the default is off only under force3d. */
  readonly monitor?: boolean
  /** The player's pin; without one it starts on auto and lives in memory. */
  readonly pin?: QualityPin
}

/** The device's measured tier (`{ measured }`); an older blob's `override` is ignored. */
export const QUALITY_KEY = 'bct:v1:dome-quality'

function loadMeasured(storage: Pick<Storage, 'getItem'> | null): QualityTier | null {
  if (storage === null) return null
  try {
    const raw = storage.getItem(QUALITY_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { measured } = parsed as { measured?: unknown }
    return isQualityChoice(measured) && measured !== 'auto' ? measured : null
  } catch {
    return null
  }
}

function memoryPin(): QualityPin {
  let choice: QualityChoice = 'auto'
  return {
    read: () => choice,
    write: (next) => {
      choice = next
    },
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
  const pin = options.pin ?? memoryPin()
  const measured = loadMeasured(storage)
  const pinned = pin.read()
  const override = isQualityChoice(pinned) ? pinned : 'auto'
  const saveMeasured = (tier: QualityTier | null): void => {
    try {
      storage?.setItem(QUALITY_KEY, JSON.stringify({ measured: tier }))
    } catch {
      // Storage full or blocked: the tier still applies for this visit.
    }
  }
  return createStore<QualityState>()((set, get) => ({
    device,
    measured,
    override,
    tier: effective(device, measured, override),
    setOverride: (choice) => {
      const { measured: kept, override: before } = get()
      if (choice !== before) set({ override: choice, tier: effective(device, kept, choice) })
      if (pin.read() !== choice) pin.write(choice)
    },
    drop: () => {
      const { override: current, tier, measured: kept } = get()
      if (current !== 'auto') return false
      const lower = lowerTier(tier)
      if (lower === null) return false
      const next = kept === null ? lower : lowestTier(kept, lower)
      set({ measured: next, tier: effective(device, next, current) })
      saveMeasured(next)
      return true
    },
  }))
}
