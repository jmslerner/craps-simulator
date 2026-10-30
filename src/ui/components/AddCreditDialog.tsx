import { useState } from 'react'
import { cents, formatCents, parseDollars } from '../../engine/index.ts'
import type { Cents } from '../../engine/index.ts'
import { useGameState, useStores, useUi } from './context.tsx'
import { Dialog } from './Dialog.tsx'
import { rejectionText } from './rejectionText.ts'

/**
 * The Add credit dialog (plan §0 #19): like feeding bills into the machine. Preset bill amounts
 * plus a custom whole-dollar input; the deposit goes through the store's `deposit`, so it is
 * logged, undoable until the roll, and counted against results — never a win. The machine's own
 * maxima answer through the engine's rejection, shown inline with `aria-invalid`.
 */

/** Bill denominations the acceptor takes, in cents; the machine's buy-in joins them. */
const BILLS: readonly number[] = [2_000, 5_000, 10_000]

export function AddCreditDialog() {
  const { game } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const defaultBuyIn = cfg?.startingBankroll ?? null
  const choices = [...new Set([...BILLS, ...(defaultBuyIn === null ? [] : [defaultBuyIn])])].sort(
    (a, b) => a - b,
  )
  const [picked, setPicked] = useState<number | 'custom'>(choices[0] ?? 'custom')
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const chosen = (): Cents | null => {
    if (picked !== 'custom') return cents(picked)
    const text = custom.trim()
    if (!/^\d+$/.test(text)) {
      setError('Enter whole dollars, like 100.')
      return null
    }
    try {
      const amount = parseDollars(text)
      if (amount <= 0) {
        setError('The deposit must be at least $1.')
        return null
      }
      return amount
    } catch {
      setError('The machine cannot take that deposit.')
      return null
    }
  }

  const add = (): void => {
    const amount = chosen()
    if (amount === null) return
    const result = game.getState().deposit(amount, 'dialog:add-credit')
    if (!result.ok) {
      const machine = game.getState().cfg
      setError(
        machine === null
          ? 'The machine cannot take that deposit.'
          : rejectionText(result.rejection, machine),
      )
      return
    }
    ui.announce(`Added ${formatCents(amount)} credit.`)
    ui.closeDialog()
  }

  return (
    <Dialog titleId="add-credit-title" onClose={ui.closeDialog}>
      <h2 id="add-credit-title" className="dialog-title">
        Add credit
      </h2>
      <fieldset className="dialog-choices">
        <legend>Amount</legend>
        {choices.map((choice) => (
          <label key={choice} className="dialog-choice">
            <input
              type="radio"
              name="credit"
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
            name="credit"
            checked={picked === 'custom'}
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
            aria-invalid={error !== null ? true : undefined}
            aria-describedby={error !== null ? 'add-credit-error' : undefined}
            // Typing picks Custom; focus alone does not (M14): a keyboard player tabbing past the
            // field to Add credit keeps the amount they chose with the arrow keys.
            onChange={(event) => {
              setPicked('custom')
              setCustom(event.target.value)
              setError(null)
            }}
          />
        </label>
      </fieldset>
      {error !== null && (
        <p id="add-credit-error" className="dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-buttons">
        <button type="button" className="btn-primary" onClick={add}>
          Add credit
        </button>
        <button type="button" onClick={ui.closeDialog}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}
