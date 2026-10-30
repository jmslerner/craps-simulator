import { useId, useState } from 'react'
import { compileConfig, isPresetId } from '../../../engine/index.ts'
import type { MachineConfigInput } from '../../../engine/index.ts'
import {
  describeImportError,
  exportFileName,
  importFileText,
  sessionFileText,
  settingsFileText,
  type ImportedFile,
} from '../../../persistence/exchange.ts'
import { useGameState, useStores } from '../context.tsx'
import { settingsOf } from '../../state/settingsStore.ts'
import { uniqueMachineId } from '../../state/machineStore.ts'
import { blocks, runSanity } from './sanityRunner.ts'
import { downloadText, loadImportedGame, readFileText } from './session.ts'
import { specLabel } from './issueText.ts'
import './editor.css'

/**
 * Files (plan §8, §10 M12): the game in play, the settings and any machine, out to a file the
 * player keeps, and back in from one. Loading reads every format the trainer writes and checks it
 * first (`importFileText`): a game replays to its own hashes before it replaces the one in play,
 * a machine must validate and pass the sanity check before it joins the player's machines, and
 * settings are read field by field. A file that fails says why; nothing is changed by it.
 */

export interface FilesPanelProps {
  /** A game was loaded: the dialog closes on the loaded game. */
  onGameLoaded(message: string): void
  /** Machines were added: the picker shows them, the first selected. */
  onMachines(ids: readonly string[]): void
  onBack(): void
}

type Pending = Extract<ImportedFile, { kind: 'session' }>

export function FilesPanel({ onGameLoaded, onMachines, onBack }: FilesPanelProps) {
  const stores = useStores()
  const inputId = useId()
  const [message, setMessage] = useState<{ readonly text: string; readonly error: boolean } | null>(
    null,
  )
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const session = useGameState((state) => state.session)

  const report = (text: string, error = false): void => setMessage({ text, error })

  const saveGame = (): void => {
    const current = stores.game.getState().session
    if (current === null) return
    downloadText(
      exportFileName('session', current.header.seed.slice(0, 8)),
      sessionFileText(current),
    )
    report(`Saved this game (${current.committed.length} rolls) to a file.`)
  }

  const saveSettings = (): void => {
    downloadText(
      exportFileName('settings'),
      settingsFileText(settingsOf(stores.settings.getState())),
    )
    report('Saved your settings to a file, the 3D quality included.')
  }

  const addMachines = async (machines: readonly MachineConfigInput[]): Promise<void> => {
    const machineStore = stores.machine.getState()
    // Every machine must pass the sanity check the editor applies before it is saved.
    for (const config of machines) {
      const cfg = compileConfig(config)
      const issues = (await runSanity(cfg, new AbortController().signal)) ?? []
      if (blocks(issues)) {
        const first = issues.find((issue) => issue.severity === 'error')
        const about = first === undefined ? '' : ` (${specLabel(config, first)}: ${first.message})`
        report(`"${config.name}" was not added: a bet would favour the player${about}.`, true)
        return
      }
    }
    const ids: string[] = []
    for (const config of machines) {
      const taken = [...machineStore.custom.map((saved) => saved.id), ...ids]
      const clash = isPresetId(config.id) || taken.includes(config.id)
      const id = clash ? uniqueMachineId(config.name, taken) : config.id
      const written = await stores.machine.getState().saveCustom({
        id,
        savedAt: Date.now(),
        basedOn: null,
        config: { ...config, id },
      })
      if (!written.ok) {
        report(`"${config.name}" could not be saved: ${written.error}`, true)
        return
      }
      ids.push(id)
    }
    onMachines(ids)
  }

  const load = async (file: File): Promise<void> => {
    setBusy(true)
    setPending(null)
    try {
      const read = await readFileText(file)
      if (!read.ok) {
        report(read.error, true)
        return
      }
      const result = importFileText(read.text)
      if (!result.ok) {
        report(`Not loaded: ${describeImportError(result.error)}`, true)
        return
      }
      const imported = result.file
      switch (imported.kind) {
        case 'session':
          setPending(imported)
          setMessage(null)
          return
        case 'machines':
          await addMachines(imported.machines)
          return
        case 'settings':
          stores.settings.getState().update(imported.settings)
          report('Settings loaded, the 3D quality included.')
          return
      }
    } finally {
      setBusy(false)
    }
  }

  const loadGame = async (game: Pending): Promise<void> => {
    setBusy(true)
    await loadImportedGame(game, {
      store: stores.game,
      settings: stores.settings,
      repo: stores.repo,
    })
    setBusy(false)
    onGameLoaded(
      `Loaded a game of ${game.rolls} ${game.rolls === 1 ? 'roll' : 'rolls'} on ${game.cfg.name}.`,
    )
  }

  return (
    <div className="ed files" data-testid="files-panel">
      <h2 id="new-game-title" className="dialog-title" tabIndex={-1}>
        Save or load
      </h2>
      <p className="ed-intro">
        Keep your game, your machines and your settings as files, and load them in any browser.
      </p>
      <div className="files-actions">
        <button type="button" onClick={saveGame} disabled={session === null}>
          Save this game to a file
        </button>
        <button type="button" onClick={saveSettings}>
          Save settings to a file
        </button>
      </div>
      <label className="files-load" htmlFor={inputId}>
        <span>Load a game, machine or settings file</span>
        <input
          id={inputId}
          type="file"
          accept=".json,application/json"
          disabled={busy}
          data-testid="files-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined) void load(file)
          }}
        />
      </label>
      {pending !== null && (
        <div className="files-confirm" role="group" aria-label="Load this game?">
          <p>
            This file holds a game of {pending.rolls} {pending.rolls === 1 ? 'roll' : 'rolls'} on{' '}
            <strong>{pending.cfg.name}</strong>
            {pending.notice === null
              ? ''
              : `, recorded by an earlier version of the trainer and checked to play the same`}
            . Loading it replaces the game in play.
          </p>
          <div className="dialog-buttons">
            <button type="button" onClick={() => setPending(null)}>
              Keep my game
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void loadGame(pending)}
            >
              Load this game
            </button>
          </div>
        </div>
      )}
      {message !== null && (
        <p
          className={message.error ? 'dialog-error' : 'files-message'}
          role={message.error ? 'alert' : 'status'}
          data-testid="files-message"
        >
          {message.text}
        </p>
      )}
      <div className="dialog-buttons">
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}
