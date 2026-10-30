import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from './settings.ts'

/** A Storage stand-in the tests control; the throwing variant plays a blocked localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

describe('settings load', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings(memoryStorage())).toStrictEqual(DEFAULT_SETTINGS)
  })

  it('defaults to the 3D dice and an unpinned quality (plan §0 #27)', () => {
    expect(DEFAULT_SETTINGS.diceMode).toBe('3d')
    expect(DEFAULT_SETTINGS.domeQuality).toBe('auto')
  })

  it('keeps a saved dice choice and quality pin; fills a field an older save lacks', () => {
    for (const diceMode of ['2d', 'instant', '3d'] as const) {
      const storage = memoryStorage({
        [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, diceMode, domeQuality: 'low' }),
      })
      expect(loadSettings(storage)).toMatchObject({ diceMode, domeQuality: 'low' })
    }
    // Saved before the quality pin was a setting: the rest stands, the pin starts on auto.
    const { domeQuality, ...older } = { ...DEFAULT_SETTINGS, diceMode: '2d' as const }
    void domeQuality
    const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify(older) })
    expect(loadSettings(storage)).toMatchObject({ diceMode: '2d', domeQuality: 'auto' })
    const junk = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, domeQuality: 'ultra' }),
    })
    expect(loadSettings(junk).domeQuality).toBe('auto')
  })

  it('keeps the Coach drawer choice; an older save or junk takes auto (plan §0 #28)', () => {
    expect(DEFAULT_SETTINGS.coachDrawer).toBe('auto')
    for (const coachDrawer of ['auto', 'open', 'closed'] as const) {
      const storage = memoryStorage({
        [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, coachDrawer }),
      })
      expect(loadSettings(storage).coachDrawer).toBe(coachDrawer)
    }
    // Saved before the drawer existed: every other field stands, the drawer starts on auto.
    const { coachDrawer, ...older } = { ...DEFAULT_SETTINGS, coachMode: 'off' as const }
    void coachDrawer
    const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify(older) })
    expect(loadSettings(storage)).toMatchObject({ coachMode: 'off', coachDrawer: 'auto' })
    const junk = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, coachDrawer: 'half' }),
    })
    expect(loadSettings(junk).coachDrawer).toBe('auto')
  })

  it('returns the defaults when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadSettings(broken)).toStrictEqual(DEFAULT_SETTINGS)
  })

  it('returns the defaults on junk JSON', () => {
    const storage = memoryStorage({ [SETTINGS_KEY]: '{not json' })
    expect(loadSettings(storage)).toStrictEqual(DEFAULT_SETTINGS)
  })

  it('keeps good fields and defaults each bad one on its own', () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        schemaVersion: 1,
        selectedChip: 2500,
        diceMode: 'holographic',
        speed: 'fast',
        startingBankroll: -5,
        guideEnabled: false,
      }),
    })
    const settings = loadSettings(storage)
    expect(settings.selectedChip).toBe(2500)
    expect(settings.speed).toBe('fast')
    expect(settings.guideEnabled).toBe(false)
    expect(settings.diceMode).toBe(DEFAULT_SETTINGS.diceMode)
    expect(settings.startingBankroll).toBeNull()
    expect(settings.chips).toBeNull()
  })
})

describe('settings save', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage()
    const settings = {
      ...DEFAULT_SETTINGS,
      selectedChip: 500,
      diceMode: 'instant' as const,
      startingBankroll: 60_000,
    }
    expect(saveSettings(settings, storage)).toBe(true)
    expect(loadSettings(storage)).toStrictEqual(settings)
  })

  it('reports false when storage throws, and never throws itself', () => {
    const broken = {
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(saveSettings(DEFAULT_SETTINGS, broken)).toBe(false)
  })
})
