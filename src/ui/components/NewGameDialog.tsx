import { useState } from 'react'
import { cents, formatCents, parseDollars } from '../../engine/index.ts'
import type { Cents } from '../../engine/index.ts'
import { startNewGame } from '../services/bootstrap.ts'
import { selectDefaultBankroll, selectSelectedId } from '../state/machineStore.ts'
import { useStore } from 'zustand'
import { useSettingsState, useStores, useUi } from './context.tsx'
import { Dialog } from './Dialog.tsx'

/**
 * The New game dialog (plan §0 #19, mirroring the demo): a choice of starting bankrolls plus a
 * custom whole-dollar amount, inline validation, the "show the guide" checkbox (plan §0 #18), and
 * the last choice remembered in settings. Focus lands on the checked choice. Starting goes through
 * `startNewGame`, which archives the stored session, compiles the buy-in variant and seeds a fresh
 * session.
 */

/** Common buy-ins offered besides the machine's own default, in cents. */
const OFFERED: readonly number[] = [10_000, 20_000, 50_000, 100_000]

export function NewGameDialog() {
  const stores = useStores()
  const ui = useUi()
  const presetId = useStore(stores.machine, selectSelectedId)
  const machineDefault = useStore(stores.machine, selectDefaultBankroll)
  const remembered = useSettingsState((state) => state.startingBankroll)
  const guideWas = useSettingsState((state) => state.guideEnabled)

  const choices = [...new Set([machineDefault, ...OFFERED])].sort((a, b) => a - b)
  const rememberedChoice = remembered !== null && choices.includes(remembered) ? remembered : null
  const [picked, setPicked] = useState<number | 'custom'>(
    remembered === null ? machineDefault : (rememberedChoice ?? 'custom'),
  )
  const [custom, setCustom] = useState(
    remembered !== null && rememberedChoice === null ? String(remembered / 100) : '',
  )
  const [guide, setGuide] = useState(guideWas)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const chosen = (): Cents | null => {
    if (picked !== 'custom') return cents(picked)
    const text = custom.trim()
    if (!/^\d+$/.test(text)) {
      setError('Enter whole dollars, like 300.')
      return null
    }
    try {
      const amount = parseDollars(text)
      if (amount <= 0) {
        setError('The buy-in must be at least $1.')
        return null
      }
      return amount
    } catch {
      setError('The machine cannot start with that amount.')
      return null
    }
  }

  const start = async (): Promise<void> => {
    const bankroll = chosen()
    if (bankroll === null) return
    setStarting(true)
    try {
      stores.settings.getState().update({ guideEnabled: guide })
      await startNewGame(
        { presetId, bankroll },
        { store: stores.game, settings: stores.settings, repo: stores.repo },
      )
      ui.announce(`New game started with ${formatCents(bankroll)}.`)
      ui.closeDialog()
    } catch {
      setError('The machine cannot start with that amount.')
      setStarting(false)
    }
  }

  return (
    <Dialog titleId="new-game-title" onClose={ui.closeDialog}>
      <h2 id="new-game-title" className="dialog-title">
        New game
      </h2>
      <fieldset className="dialog-choices">
        <legend>Starting bankroll</legend>
        {choices.map((choice) => (
          <label key={choice} className="dialog-choice">
            <input
              type="radio"
              name="bankroll"
              checked={picked === choice}
              data-autofocus={picked === choice || undefined}
              onChange={() => {
                setPicked(choice)
                setError(null)
              }}
            />
            {formatCents(cents(choice), { trimWholeDollars: true })}
          </label>
        ))}
        <label className="dialog-choice">
          <input
            type="radio"
            name="bankroll"
            checked={picked === 'custom'}
            data-autofocus={picked === 'custom' || undefined}
            onChange={() => setPicked('custom')}
          />
          Custom
        </label>
        <label className="dialog-custom">
          <span>Whole dollars</span>
          <input
            type="text"
            inputMode="numeric"
            value={custom}
            aria-invalid={error !== null && picked === 'custom' ? true : undefined}
            aria-describedby={error !== null ? 'new-game-error' : undefined}
            onFocus={() => setPicked('custom')}
            onChange={(event) => {
              setPicked('custom')
              setCustom(event.target.value)
              setError(null)
            }}
          />
        </label>
      </fieldset>
      <label className="dialog-check">
        <input
          type="checkbox"
          checked={guide}
          onChange={(event) => setGuide(event.target.checked)}
        />
        Show the guide
      </label>
      {error !== null && (
        <p id="new-game-error" className="dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-buttons">
        <button type="button" disabled={starting} onClick={() => void start()}>
          Start
        </button>
        <button type="button" onClick={ui.closeDialog}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}
