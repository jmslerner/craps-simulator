import { useState } from 'react'
import { cents, formatCents, parseDollars } from '../../engine/index.ts'
import type { Cents, PresetId } from '../../engine/index.ts'
import { startNewGame } from '../services/bootstrap.ts'
import {
  COMPILED_PRESETS,
  MACHINE_SUMMARIES,
  rememberedMachine,
  type MachineSummary,
} from '../state/machineStore.ts'
import { useSettingsState, useStores, useUi } from './context.tsx'
import { Dialog } from './Dialog.tsx'

/**
 * The New game dialog (plan §0 #19, mirroring the demo): the machine picker over every built-in
 * preset — each row showing the machine's variant and its real stakes, computed from the compiled
 * config (`MACHINE_SUMMARIES`, through `typeLimits`) and formatted with `formatCents`, never a
 * typed-in dollar string, with non-verified stakes marked the way the UI marks assumptions — a
 * choice of starting bankrolls plus a custom whole-dollar amount, inline validation, the "show the
 * guide" checkbox (plan §0 #18), and the last machine and buy-in remembered in settings. Focus
 * lands on the checked bankroll. Starting goes through `startNewGame`, which archives the stored
 * session, compiles the buy-in variant and seeds a fresh session.
 */

/** Common buy-ins offered besides the machine's own default, in cents. */
const OFFERED: readonly number[] = [10_000, 20_000, 50_000, 100_000]

function defaultBankrollOf(machine: PresetId): number {
  return COMPILED_PRESETS[machine].startingBankroll
}

function bankrollChoices(machine: PresetId): number[] {
  return [...new Set([defaultBankrollOf(machine), ...OFFERED])].sort((a, b) => a - b)
}

/** "crapless · Pass Line $5 min / $5,000 max, table max $20,000" — every amount from the config. */
function stakesLine(summary: MachineSummary): string {
  const { stakes } = summary
  const money = (amount: Cents) => formatCents(amount, { trimWholeDollars: true })
  const parts = [
    `${stakes.lineLabel} ${money(stakes.min)} min / ${money(stakes.max)} max`,
    ...(stakes.tableMax === null ? [] : [`table max ${money(stakes.tableMax)}`]),
  ]
  return `${summary.variant} · ${parts.join(', ')}`
}

export function NewGameDialog() {
  const stores = useStores()
  const ui = useUi()
  const rememberedId = useSettingsState((state) => state.machineId)
  const remembered = useSettingsState((state) => state.startingBankroll)
  const guideWas = useSettingsState((state) => state.guideEnabled)

  const [machine, setMachine] = useState<PresetId>(() => rememberedMachine(rememberedId))
  const machineDefault = defaultBankrollOf(machine)
  const choices = bankrollChoices(machine)
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
  // A remembered buy-in was the player's own choice; the machine default is only a suggestion.
  const [pickedExplicitly, setPickedExplicitly] = useState(remembered !== null)

  const pickMachine = (next: PresetId): void => {
    setMachine(next)
    setError(null)
    // The suggestion follows the machine; an explicit choice is kept while the machine offers it.
    if (!pickedExplicitly || (picked !== 'custom' && !bankrollChoices(next).includes(picked))) {
      setPicked(defaultBankrollOf(next))
    }
  }

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
      stores.machine.getState().select(machine)
      await startNewGame(
        { presetId: machine, bankroll },
        { store: stores.game, settings: stores.settings, repo: stores.repo },
      )
      ui.announce(
        `New game started on ${COMPILED_PRESETS[machine].name} with ${formatCents(bankroll)}.`,
      )
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
      <fieldset className="dialog-choices dialog-machines">
        <legend>Machine</legend>
        {MACHINE_SUMMARIES.map((summary) => (
          <label key={summary.id} className="dialog-choice dialog-machine">
            <input
              type="radio"
              name="machine"
              checked={machine === summary.id}
              onChange={() => pickMachine(summary.id)}
            />
            <span className="dialog-machine-name">{summary.name}</span>
            <span className="dialog-machine-stakes">
              {stakesLine(summary)}
              {summary.stakes.provenance !== 'verified' && (
                <em
                  className="dialog-machine-provenance"
                  title={
                    summary.stakes.provenance === 'assumed'
                      ? 'Some of these stakes are assumed: no public document posts this machine’s limits.'
                      : 'These stakes are reported by players or surveys, not machine documents.'
                  }
                >
                  {' '}
                  ({summary.stakes.provenance})
                </em>
              )}
            </span>
          </label>
        ))}
      </fieldset>
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
                setPickedExplicitly(true)
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
            onChange={() => {
              setPicked('custom')
              setPickedExplicitly(true)
            }}
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
            onFocus={() => {
              setPicked('custom')
              setPickedExplicitly(true)
            }}
            onChange={(event) => {
              setPicked('custom')
              setPickedExplicitly(true)
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
