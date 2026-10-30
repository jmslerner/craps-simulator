import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { PRESETS, cents, formatCents, isPresetId, parseDollars } from '../../engine/index.ts'
import type { Cents, MachineConfigInput, PresetId } from '../../engine/index.ts'
import { exportFileName, machineFileText } from '../../persistence/exchange.ts'
import type { SavedMachine } from '../../persistence/machineRepo.ts'
import { startNewGame } from '../services/bootstrap.ts'
import {
  COMPILED_PRESETS,
  MACHINE_SUMMARIES,
  rememberedMachine,
  savedConfig,
  savedGameConfig,
  summaryOf,
  uniqueMachineId,
  type MachineSummary,
} from '../state/machineStore.ts'
import { useSettingsState, useStores, useUi } from './context.tsx'
import { Dialog } from './Dialog.tsx'
import type { EditorView } from './editor/EditorViews.tsx'
import { downloadText, startMachineGame } from './editor/session.ts'
import './editor/editor.css'

/**
 * The New game dialog (plan §0 #19, §0 #25, M12): the machine picker over every built-in preset
 * and the player's own machines — each row showing the machine's variant and its real stakes,
 * computed from the compiled config (`summaryOf`, through `typeLimits`) and formatted with
 * `formatCents`, never a typed-in dollar string, with non-verified stakes marked the way the UI
 * marks assumptions — a choice of starting bankrolls plus a custom whole-dollar amount, inline
 * validation, the "show the guide" checkbox (plan §0 #18), and the last machine and buy-in
 * remembered in settings. Focus lands on the checked bankroll. Starting a preset goes through
 * `startNewGame`; starting one of the player's machines through `startMachineGame`, which does
 * the same for a saved config.
 *
 * It is also the way into the machine views (M12), loaded only when opened: Match My Machine
 * (five questions), the machine editor (a copy of a preset, or one of the player's machines) and
 * saving or loading files (the game, machines, settings). Escape in one of them goes back here.
 */

/** Common buy-ins offered besides the machine's own default, in cents. */
const OFFERED: readonly number[] = [10_000, 20_000, 50_000, 100_000]

const EditorViews = lazy(() => import('./editor/EditorViews.tsx'))

/**
 * Each machine view's heading, as the view itself renders it. The loading fallback shows the same
 * heading under the dialog's `new-game-title` id, so the dialog keeps its accessible name while the
 * lazy chunk loads (M14 a11y report; kept here so the fallback never pulls that chunk in).
 */
const VIEW_TITLES: Readonly<Record<EditorView['kind'], string>> = {
  edit: 'Machine editor',
  match: 'Match my machine',
  files: 'Save or load',
}

type View = 'pick' | 'match' | 'edit' | 'files'

interface Editing {
  readonly initial: MachineConfigInput
  readonly base: MachineConfigInput | null
  readonly baseName: string | null
  /** The preset the machine came from, if any (kept with the saved machine). */
  readonly basedOn: string | null
}

/** "crapless · Pass Line $5 min / $5,000 max, table max $20,000" — every amount from the config. */
function stakesLine(summary: MachineSummary<string>): string {
  const { stakes } = summary
  const money = (amount: Cents) => formatCents(amount, { trimWholeDollars: true })
  const parts = [
    `${stakes.lineLabel} ${money(stakes.min)} min / ${money(stakes.max)} max`,
    ...(stakes.tableMax === null ? [] : [`table max ${money(stakes.tableMax)}`]),
  ]
  return `${summary.variant} · ${parts.join(', ')}`
}

function MachineRow({
  summary,
  checked,
  onPick,
}: {
  readonly summary: MachineSummary<string>
  readonly checked: boolean
  onPick(): void
}) {
  return (
    <label className="dialog-choice dialog-machine">
      <input type="radio" name="machine" checked={checked} onChange={onPick} />
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
  )
}

/** The preset Match My Machine starts from: the picked preset, or the one a saved machine came from. */
function preferredPreset(machine: string, saved: SavedMachine | null): PresetId | null {
  if (isPresetId(machine)) return machine
  const basedOn = saved?.basedOn ?? null
  return basedOn !== null && isPresetId(basedOn) ? basedOn : null
}

export function NewGameDialog() {
  const stores = useStores()
  const ui = useUi()
  const rememberedId = useSettingsState((state) => state.machineId)
  const remembered = useSettingsState((state) => state.startingBankroll)
  const guideWas = useSettingsState((state) => state.guideEnabled)
  const custom = useStore(stores.machine, (state) => state.custom)

  useEffect(() => {
    void stores.machine.getState().loadCustom()
  }, [stores.machine])

  const [view, setView] = useState<View>('pick')
  // Back from a machine view, focus returns to the picker's heading (the dialog's own focus
  // handling runs only when it opens).
  const lastView = useRef<View>(view)
  useEffect(() => {
    if (view === 'pick' && lastView.current !== 'pick') {
      document.getElementById('new-game-title')?.focus()
    }
    lastView.current = view
  }, [view])
  const [editing, setEditing] = useState<Editing | null>(null)
  // The machine the player picked here; until then, the remembered one (a saved machine counts
  // once the saved machines have loaded).
  const [pickedMachine, setPickedMachine] = useState<string | null>(null)
  // Deleting a saved machine takes a second press, so a stray tap never loses one.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const rememberedCustom =
    rememberedId !== null && custom.some((saved) => saved.id === rememberedId) ? rememberedId : null
  const machine = pickedMachine ?? rememberedCustom ?? rememberedMachine(rememberedId)
  const saved: SavedMachine | null = isPresetId(machine)
    ? null
    : (custom.find((entry) => entry.id === machine) ?? null)

  const defaultBankrollOf = (id: string): number => {
    if (isPresetId(id)) return COMPILED_PRESETS[id].startingBankroll
    const entry = custom.find((candidate) => candidate.id === id)
    const cfg = entry === undefined ? null : savedConfig(entry)
    return cfg?.startingBankroll ?? COMPILED_PRESETS.craplessBubble.startingBankroll
  }
  const bankrollChoices = (id: string): number[] =>
    [...new Set([defaultBankrollOf(id), ...OFFERED])].sort((a, b) => a - b)

  const machineDefault = defaultBankrollOf(machine)
  const choices = bankrollChoices(machine)
  const rememberedChoice = remembered !== null && choices.includes(remembered) ? remembered : null
  const [picked, setPicked] = useState<number | 'custom'>(
    remembered === null ? machineDefault : (rememberedChoice ?? 'custom'),
  )
  const [customAmount, setCustomAmount] = useState(
    remembered !== null && rememberedChoice === null ? String(remembered / 100) : '',
  )
  const [guide, setGuide] = useState(guideWas)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // A remembered buy-in was the player's own choice; the machine default is only a suggestion.
  const [pickedExplicitly, setPickedExplicitly] = useState(remembered !== null)

  const pickMachine = (next: string): void => {
    setPickedMachine(next)
    setConfirmDelete(null)
    setError(null)
    // The suggestion follows the machine; an explicit choice is kept while the machine offers it.
    if (!pickedExplicitly || (picked !== 'custom' && !bankrollChoices(next).includes(picked))) {
      setPicked(defaultBankrollOf(next))
    }
  }

  const chosen = (): Cents | null => {
    if (picked !== 'custom') return cents(picked)
    const text = customAmount.trim()
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
      const deps = { store: stores.game, settings: stores.settings, repo: stores.repo }
      let name: string
      if (isPresetId(machine)) {
        stores.machine.getState().select(machine)
        await startNewGame({ presetId: machine, bankroll }, deps)
        name = COMPILED_PRESETS[machine].name
      } else {
        const cfg = saved === null ? null : savedGameConfig(saved, bankroll)
        if (saved === null || cfg === null) throw new Error('The machine does not compile')
        await startMachineGame(cfg, { machineId: saved.id, bankroll }, deps)
        name = cfg.name
      }
      ui.announce(`New game started on ${name} with ${formatCents(bankroll)}.`)
      ui.closeDialog()
    } catch {
      setError('The machine cannot start with that amount.')
      setStarting(false)
    }
  }

  const takenIds = (): string[] => custom.map((entry) => entry.id)

  /** The editor on a copy of the picked machine: a preset under a new id, or a saved machine. */
  const editPicked = (): void => {
    if (isPresetId(machine)) {
      const preset = PRESETS[machine]
      const name = `My ${preset.name}`
      setEditing({
        initial: { ...structuredClone(preset), id: uniqueMachineId(name, takenIds()), name },
        base: preset,
        baseName: preset.name,
        basedOn: machine,
      })
    } else if (saved !== null) {
      const basedOn = saved.basedOn !== null && isPresetId(saved.basedOn) ? saved.basedOn : null
      setEditing({
        initial: structuredClone(saved.config),
        base: basedOn === null ? null : PRESETS[basedOn],
        baseName: basedOn === null ? null : PRESETS[basedOn].name,
        basedOn: saved.basedOn,
      })
    }
    setView('edit')
  }

  const back = (): void => setView('pick')

  const viewProps = (): EditorView | null => {
    switch (view) {
      case 'pick':
        return null
      case 'edit':
        if (editing === null) return null
        return {
          kind: 'edit',
          initial: editing.initial,
          base: editing.base,
          baseName: editing.baseName,
          onSave: async (config) => {
            const written = await stores.machine.getState().saveCustom({
              id: config.id,
              savedAt: Date.now(),
              basedOn: editing.basedOn,
              config,
            })
            if (!written.ok) return `The machine could not be saved: ${written.error}`
            pickMachine(config.id)
            setView('pick')
            return null
          },
        }
      case 'match':
        return {
          kind: 'match',
          prefer: preferredPreset(machine, saved),
          onReview: (input, base) => {
            setEditing({
              initial: { ...input, id: uniqueMachineId(input.name, takenIds()) },
              base: PRESETS[base],
              baseName: PRESETS[base].name,
              basedOn: base,
            })
            setView('edit')
          },
        }
      case 'files':
        return {
          kind: 'files',
          onGameLoaded: (message) => {
            ui.announce(message)
            ui.closeDialog()
          },
          onMachines: (ids) => {
            const [first] = ids
            if (first !== undefined) pickMachine(first)
            setView('pick')
          },
        }
    }
  }

  const sub = viewProps()
  if (sub !== null) {
    return (
      <Dialog
        titleId="new-game-title"
        onClose={back}
        // The editor scrolls its sections above a footer that never covers them (index.css).
        className={sub.kind === 'edit' ? 'dialog-wide dialog-editor' : 'dialog-wide'}
      >
        <Suspense
          fallback={
            <>
              <h2 id="new-game-title" className="dialog-title" tabIndex={-1}>
                {VIEW_TITLES[sub.kind]}
              </h2>
              <p className="ed-loading">Loading…</p>
            </>
          }
        >
          <EditorViews view={sub} onBack={back} />
        </Suspense>
      </Dialog>
    )
  }

  const customSummaries = custom.flatMap((entry) => {
    const cfg = savedConfig(entry)
    return cfg === null ? [] : [summaryOf(entry.id, cfg)]
  })
  const pickedConfig: MachineConfigInput | null = isPresetId(machine)
    ? PRESETS[machine]
    : (saved?.config ?? null)

  return (
    <Dialog titleId="new-game-title" onClose={ui.closeDialog}>
      <h2 id="new-game-title" className="dialog-title" tabIndex={-1}>
        New game
      </h2>
      <fieldset className="dialog-choices dialog-machines">
        <legend>Machine</legend>
        {MACHINE_SUMMARIES.map((summary) => (
          <MachineRow
            key={summary.id}
            summary={summary}
            checked={machine === summary.id}
            onPick={() => pickMachine(summary.id)}
          />
        ))}
      </fieldset>
      {customSummaries.length > 0 && (
        <fieldset className="dialog-choices dialog-machines">
          <legend>Your machines</legend>
          {customSummaries.map((summary) => (
            <MachineRow
              key={summary.id}
              summary={summary}
              checked={machine === summary.id}
              onPick={() => pickMachine(summary.id)}
            />
          ))}
        </fieldset>
      )}
      <div className="dialog-machine-actions">
        <button type="button" onClick={() => setView('match')}>
          Match my machine…
        </button>
        <button type="button" onClick={editPicked}>
          {saved === null ? 'Edit a copy…' : 'Edit…'}
        </button>
        <button
          type="button"
          disabled={pickedConfig === null}
          onClick={() => {
            if (pickedConfig === null) return
            downloadText(
              exportFileName('machine', pickedConfig.id),
              machineFileText([pickedConfig]),
            )
          }}
        >
          Download machine
        </button>
        {saved !== null && (
          <button
            type="button"
            onClick={() => {
              if (confirmDelete !== saved.id) {
                setConfirmDelete(saved.id)
                return
              }
              void stores.machine.getState().removeCustom(saved.id)
              setConfirmDelete(null)
              setPickedMachine(null)
            }}
          >
            {confirmDelete === saved.id
              ? `Delete “${saved.config.name}” for good`
              : 'Delete machine'}
          </button>
        )}
        <button type="button" onClick={() => setView('files')}>
          Save or load files…
        </button>
      </div>
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
            value={customAmount}
            aria-invalid={error !== null && picked === 'custom' ? true : undefined}
            aria-describedby={error !== null ? 'new-game-error' : undefined}
            // Typing picks Custom; focus alone does not (as in Add credit, M14): a keyboard
            // player tabbing past the field to Start keeps the buy-in they chose.
            onChange={(event) => {
              setPicked('custom')
              setPickedExplicitly(true)
              setCustomAmount(event.target.value)
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
        <button
          type="button"
          className="btn-primary"
          disabled={starting}
          onClick={() => void start()}
        >
          Start
        </button>
        <button type="button" onClick={ui.closeDialog}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}
