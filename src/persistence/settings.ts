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

export interface Settings {
  readonly schemaVersion: 1
  /** A custom chip rack in cents, smallest first; null shows the machine's own chips. */
  readonly chips: readonly number[] | null
  /** The chip in hand, in cents; null selects the machine's smallest chip. */
  readonly selectedChip: number | null
  readonly diceMode: DiceMode
  readonly speed: GameSpeed
  /** Overrides the system reduced-motion preference; null follows the system. */
  readonly reducedMotion: boolean | null
  /** What New game offers first, in cents (plan §0 #19); null offers the machine's default. */
  readonly startingBankroll: number | null
  /** The next-step guide bar (plan §0 #18). */
  readonly guideEnabled: boolean
  /** Placeholder until M9 defines the coach's modes; stored so M9 keeps the player's choice. */
  readonly coachMode: CoachMode
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  schemaVersion: 1,
  chips: null,
  selectedChip: null,
  diceMode: '2d',
  speed: 'normal',
  reducedMotion: null,
  startingBankroll: null,
  guideEnabled: true,
  coachMode: 'hints',
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
  guideEnabled: z.boolean().catch(true),
  coachMode: z.enum(['off', 'hints', 'full']).catch(DEFAULT_SETTINGS.coachMode),
})

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
