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
