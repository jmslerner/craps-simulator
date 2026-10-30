import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings } from '../../persistence/settings.ts'
import { createSettingsStore, settingsOf } from './settingsStore.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

describe('settings store', () => {
  it('boots from storage synchronously', () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, diceMode: 'instant' }),
    })
    const store = createSettingsStore({ storage })
    expect(store.getState().diceMode).toBe('instant')
  })

  it('persists every update and remembers the starting bankroll (plan §0 #19)', () => {
    const storage = memoryStorage()
    const store = createSettingsStore({ storage })
    store.getState().update({ startingBankroll: 60_000, selectedChip: 500 })
    expect(store.getState().startingBankroll).toBe(60_000)
    // What New game reads next boot is what was chosen.
    expect(loadSettings(storage).startingBankroll).toBe(60_000)
    expect(loadSettings(storage).selectedChip).toBe(500)
  })

  it('remembers the coach mode across boots (plan §5.6; the mode control writes it)', () => {
    const storage = memoryStorage()
    const store = createSettingsStore({ storage })
    expect(store.getState().coachMode).toBe('full')
    store.getState().update({ coachMode: 'off' })
    expect(loadSettings(storage).coachMode).toBe('off')
    expect(createSettingsStore({ storage }).getState().coachMode).toBe('off')
    store.getState().update({ coachMode: 'hints' })
    expect(createSettingsStore({ storage }).getState().coachMode).toBe('hints')
  })

  it('keeps playing when storage writes fail', () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    const store = createSettingsStore({ storage: broken })
    store.getState().update({ guideEnabled: false })
    expect(store.getState().guideEnabled).toBe(false)
  })

  it('resets to the defaults', () => {
    const storage = memoryStorage()
    const store = createSettingsStore({ storage })
    store.getState().update({ speed: 'fast', guideEnabled: false })
    store.getState().reset()
    expect(settingsOf(store.getState())).toStrictEqual(DEFAULT_SETTINGS)
    expect(loadSettings(storage)).toStrictEqual(DEFAULT_SETTINGS)
  })
})
