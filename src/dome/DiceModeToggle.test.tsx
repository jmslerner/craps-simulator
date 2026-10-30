import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createSettingsStore } from '../ui/state/settingsStore.ts'
import { DiceModeToggle } from './DiceModeToggle.tsx'

/** The 2D ↔ 3D switch over the settings store: pressed in 3D, a tap flips the dice mode. */

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const kept = new Map<string, string>()
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value)
    },
  }
}

describe('DiceModeToggle', () => {
  it('reflects the dice mode, pressed by default (3D), and flips it between 3D and 2D', () => {
    const settings = createSettingsStore({ storage: memoryStorage() })
    render(<DiceModeToggle settings={settings} />)
    const button = screen.getByRole('button', { name: '3D dice' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(button)
    expect(settings.getState().diceMode).toBe('2d')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(settings.getState().diceMode).toBe('3d')
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('turns 3D on from instant too, and persists the choice', () => {
    const storage = memoryStorage()
    const settings = createSettingsStore({ storage })
    settings.getState().update({ diceMode: 'instant' })
    render(<DiceModeToggle settings={settings} />)
    fireEvent.click(screen.getByRole('button', { name: '3D dice' }))
    expect(settings.getState().diceMode).toBe('3d')
    expect(storage.getItem('bct:v1:settings')).toContain('"diceMode":"3d"')
  })
})
