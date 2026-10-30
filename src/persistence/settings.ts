import { z } from 'zod'

/**
 * Player settings in localStorage (plan §8): key `bct:v1:settings`, read synchronously at boot so
 * the first paint already has the right dice mode. Settings are conveniences, never game state:
 * losing them must never lose a session, so every read and write is guarded and junk falls back,
 * field by field, to the defaults. The zustand store around them is `ui/state/settingsStore.ts`.
 */

export const SETTINGS_KEY = 'bct:v1:settings'

export type DiceMode = 'instant' | '2d' | '3d'
export type GameSpeed = 'normal' | 'fast'
export type CoachMode = 'off' | 'hints' | 'full'
/** The 3D dome's quality pin (dome/quality.ts): a tier, or auto (device class, then measured). */
export type DomeQuality = 'auto' | 'high' | 'medium' | 'low'
/**
 * The Coach drawer (plan §0 #28): `auto` docks it open on a viewport at least 1400 px wide and
 * keeps it collapsed below that; `open` and `closed` are the player's own choice, kept at every width.
 */
export type CoachDrawer = 'auto' | 'open' | 'closed'

export interface Settings {
  readonly schemaVersion: 1
  /** A custom chip rack in cents, smallest first; null shows the machine's own chips. */
  readonly chips: readonly number[] | null
  /** The chip in hand, in cents; null selects the machine's smallest chip. */
  readonly selectedChip: number | null
  /**
   * 3D by default (plan §0 #27): the dome, which falls back to 2D by itself without WebGL. A saved
   * choice is kept: only a missing or junk value takes the default.
   */
  readonly diceMode: DiceMode
  readonly speed: GameSpeed
  /** Overrides the system reduced-motion preference; null follows the system. */
  readonly reducedMotion: boolean | null
  /** What New game offers first, in cents (plan §0 #19); null offers the machine's default. */
  readonly startingBankroll: number | null
  /** The machine picked in the last New game, a preset id; null plays the default machine. */
  readonly machineId: string | null
  /** The next-step guide bar (plan §0 #18). */
  readonly guideEnabled: boolean
  /** The coach's mode (plan §5.6): 'off' | 'hints' (quiet) | 'full' (coach, the default). */
  readonly coachMode: CoachMode
  /**
   * The player's 3D quality pin. The tier the frame monitor measured for this device stays in the
   * dome's own key (`bct:v1:dome-quality`): it describes the device, not the player.
   */
  readonly domeQuality: DomeQuality
  /** The Coach drawer: open or collapsed by the player, or `auto` by the viewport's width. */
  readonly coachDrawer: CoachDrawer
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  schemaVersion: 1,
  chips: null,
  selectedChip: null,
  diceMode: '3d',
  speed: 'normal',
  reducedMotion: null,
  startingBankroll: null,
  machineId: null,
  guideEnabled: true,
  coachMode: 'full',
  domeQuality: 'auto',
  coachDrawer: 'auto',
})

// Each field falls back to its own default, so one bad field never discards the rest.
const SettingsSchema = z.object({
  schemaVersion: z.literal(1).catch(1),
  chips: z.array(z.int().positive()).readonly().nullable().catch(null),
  selectedChip: z.int().positive().nullable().catch(null),
  diceMode: z.enum(['instant', '2d', '3d']).catch(DEFAULT_SETTINGS.diceMode),
  speed: z.enum(['normal', 'fast']).catch(DEFAULT_SETTINGS.speed),
  reducedMotion: z.boolean().nullable().catch(null),
  startingBankroll: z.int().positive().nullable().catch(null),
  // The id is checked against the known presets where it is used, so junk only costs the memory.
  machineId: z.string().min(1).nullable().catch(null),
  guideEnabled: z.boolean().catch(true),
  coachMode: z.enum(['off', 'hints', 'full']).catch(DEFAULT_SETTINGS.coachMode),
  domeQuality: z.enum(['auto', 'high', 'medium', 'low']).catch(DEFAULT_SETTINGS.domeQuality),
  // Added with the machine design (plan §0 #28): settings stored before it take the default.
  coachDrawer: z.enum(['auto', 'open', 'closed']).catch(DEFAULT_SETTINGS.coachDrawer),
})

/**
 * Settings read from any JSON value, field by field as a load reads them (M12: a settings file the
 * player imports): a junk field takes its default, and anything that is not an object takes the
 * defaults whole. Never throws.
 */
export function parseSettings(value: unknown): Settings {
  const parsed = SettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

/**
 * The stored settings, or the defaults: missing storage, bad JSON and junk fields all land on
 * defaults without throwing. `storage` is injectable for tests; the default is the browser's.
 */
export function loadSettings(storage?: Pick<Storage, 'getItem'>): Settings {
  try {
    const source = storage ?? localStorage
    const text = source.getItem(SETTINGS_KEY)
    if (text === null) return DEFAULT_SETTINGS
    const parsed = SettingsSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Writes the settings; false when storage is unavailable or full, which the app ignores. */
export function saveSettings(settings: Settings, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const target = storage ?? localStorage
    target.setItem(SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}
