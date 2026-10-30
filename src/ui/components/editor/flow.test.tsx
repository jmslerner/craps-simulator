import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRESETS, cents, hashJson } from '../../../engine/index.ts'
import { machineFileText, settingsFileText } from '../../../persistence/exchange.ts'
import { DEFAULT_SETTINGS } from '../../../persistence/settings.ts'
import { KEYS, safeDel } from '../../../persistence/storage.ts'
import { renderApp } from '../../test/renderApp.tsx'

/**
 * The machine views in the New game dialog (plan §10 M12): Match My Machine to a saved machine
 * and a game on it; a game saved to a file and loaded back to the same hash; a machine file and a
 * settings file loaded; a corrupt file refused.
 */

/** Captures what the app offers as a download. */
function captureDownloads() {
  const files: { name: string; blob: Blob }[] = []
  let pending: Blob | null = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation((object: Blob | MediaSource) => {
    pending = object as Blob
    return 'blob:test'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (pending !== null) files.push({ name: this.download, blob: pending })
    pending = null
  })
  return files
}

function upload(text: string, name = 'file.json'): void {
  const input = screen.getByTestId('files-input')
  fireEvent.change(input, {
    target: { files: [new File([text], name, { type: 'application/json' })] },
  })
}

function openNewGame() {
  fireEvent.click(screen.getByRole('button', { name: 'New game' }))
  return screen.getByRole('dialog')
}

beforeEach(async () => {
  await safeDel(KEYS.machines)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// First in the file, so the views' lazy chunk has not loaded yet and its fallback shows.
describe('a machine view while its chunk loads', () => {
  it('keeps the dialog named by the view it opens (M14 a11y report)', async () => {
    renderApp()
    const dialog = openNewGame()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save or load files…' }))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Save or load' })).toBeInTheDocument()
    await screen.findByTestId('files-panel')
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Save or load' })).toBeInTheDocument()
  })
})

describe('Match My Machine to a game', () => {
  it('answers, reviews, saves a machine and starts a game on it', async () => {
    const { game, settings } = renderApp()
    let dialog = openNewGame()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Match my machine…' }))
    await screen.findByTestId('match-my-machine')
    fireEvent.click(screen.getByRole('radio', { name: /Taken out of the win/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Double on 2, triple on 12/ }))
    expect(screen.getByTestId('match-nearest')).toHaveTextContent(
      'Closest built-in machine: Crapless bubble craps, already matching 3 of 5 answers.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review in the editor' }))
    await screen.findByTestId('machine-editor')
    await waitFor(
      () => expect(screen.getByTestId('editor-status')).toHaveTextContent(/ready to save/i),
      { timeout: 15_000 },
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save machine' }))
    })
    dialog = await screen.findByRole('dialog', { name: 'New game' })
    const mine = within(dialog).getByRole('group', { name: 'Your machines' })
    const row = within(mine).getByRole('radio', {
      name: /My machine \(from Crapless bubble craps\)/,
    })
    expect(row).toBeChecked()
    // The presets' group is unchanged: still five.
    expect(
      within(within(dialog).getByRole('group', { name: 'Machine' })).getAllByRole('radio'),
    ).toHaveLength(5)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }))
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const cfg = game.getState().cfg
    expect(cfg?.id).toBe('my-machine-from-crapless-bubble-craps')
    const buy = cfg?.catalog.get('buy')
    expect(buy?.family === 'numberVsSeven' && buy.commission?.get(4)?.timing).toBe('onWin')
    expect(cfg?.input.provenance['/catalog/field/pays/12']?.source).toBe('USER')
    expect(settings.getState().machineId).toBe('my-machine-from-crapless-bubble-craps')
  }, 30_000)
})

describe('files', () => {
  it('saves the game to a file, and loading it back gives the same hash', async () => {
    const files = captureDownloads()
    const { game, roll, run } = renderApp({ seed: 'files-round-trip' })
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    })
    roll({ d1: 2, d2: 2 })
    run((state) => {
      state.dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    })
    const session = game.getState().session
    if (session === null) throw new Error('no session')
    const hash = hashJson(session.state)

    openNewGame()
    fireEvent.click(screen.getByRole('button', { name: 'Save or load files…' }))
    await screen.findByTestId('files-panel')
    fireEvent.click(screen.getByRole('button', { name: 'Save this game to a file' }))
    expect(files).toHaveLength(1)
    expect(files[0]?.name).toMatch(/^bubble-craps-session-.*\.json$/)
    const text = await files[0]!.blob.text()

    // Clear: a new game replaces it.
    run((state) => state.startGame(state.cfg!, 'another-game'))
    expect(hashJson(game.getState().session!.state)).not.toBe(hash)

    upload(text)
    await screen.findByRole('button', { name: 'Load this game' })
    expect(screen.getByRole('group', { name: 'Load this game?' })).toHaveTextContent(
      'This file holds a game of 1 roll on Crapless bubble craps',
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load this game' }))
    })
    // The New game dialog closes (M13 may then show the replaced session's summary).
    await waitFor(() => expect(screen.queryByTestId('files-panel')).toBeNull())
    expect(hashJson(game.getState().session!.state)).toBe(hash)
    expect(game.getState().history.rolls).toHaveLength(1)
  }, 30_000)

  it('refuses a corrupt file and changes nothing', async () => {
    const { game } = renderApp({ seed: 'files-corrupt' })
    const before = hashJson(game.getState().session!.state)
    openNewGame()
    fireEvent.click(screen.getByRole('button', { name: 'Save or load files…' }))
    await screen.findByTestId('files-panel')
    upload('{"format":"bubble-craps-session","version":1,"header":')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not loaded: The file is not valid JSON.',
    )
    upload('{"format":"bubble-craps-session","__proto__":{"polluted":true}}')
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('uses the key "__proto__"'),
    )
    expect(hashJson(game.getState().session!.state)).toBe(before)
  })

  it('adds the machines a machine file holds, after the sanity check', async () => {
    renderApp()
    openNewGame()
    fireEvent.click(screen.getByRole('button', { name: 'Save or load files…' }))
    await screen.findByTestId('files-panel')
    const red = { ...PRESETS.craplessBubble, id: 'red-rock', name: 'Red Rock crapless' }
    upload(machineFileText([red]))
    const dialog = await screen.findByRole('dialog', { name: 'New game' }, { timeout: 15_000 })
    const mine = await within(dialog).findByRole(
      'group',
      { name: 'Your machines' },
      { timeout: 15_000 },
    )
    expect(within(mine).getByRole('radio', { name: /Red Rock crapless/ })).toBeChecked()
  }, 30_000)

  it('edits a saved machine in place and deletes it only on a second press', async () => {
    renderApp()
    openNewGame()
    fireEvent.click(screen.getByRole('button', { name: 'Save or load files…' }))
    await screen.findByTestId('files-panel')
    upload(machineFileText([{ ...PRESETS.craplessBubble, id: 'fremont', name: 'Fremont' }]))
    let dialog = await screen.findByRole('dialog', { name: 'New game' }, { timeout: 15_000 })
    // Edit it: the editor works on the saved machine itself, and saving replaces it.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit…' }))
    await screen.findByTestId('machine-editor')
    await waitFor(
      () => expect(screen.getByTestId('editor-status')).toHaveTextContent(/ready to save/i),
      { timeout: 15_000 },
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save machine' }))
    })
    dialog = await screen.findByRole('dialog', { name: 'New game' })
    const mine = within(dialog).getByRole('group', { name: 'Your machines' })
    expect(within(mine).getAllByRole('radio')).toHaveLength(1)
    // Delete: the first press asks, the second deletes.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete machine' }))
    const confirm = within(dialog).getByRole('button', { name: 'Delete “Fremont” for good' })
    await act(async () => {
      fireEvent.click(confirm)
    })
    await waitFor(() =>
      expect(within(dialog).queryByRole('group', { name: 'Your machines' })).toBeNull(),
    )
    // The default machine is picked again.
    const presets = within(within(dialog).getByRole('group', { name: 'Machine' })).getAllByRole(
      'radio',
    )
    expect(presets[0]).toBeChecked()
  }, 30_000)

  it('refuses a machine file whose machine favours the player', async () => {
    renderApp()
    openNewGame()
    fireEvent.click(screen.getByRole('button', { name: 'Save or load files…' }))
    await screen.findByTestId('files-panel')
    const bad = structuredClone(PRESETS.craplessBubble)
    const place = bad.catalog['place']
    if (place?.family !== 'numberVsSeven') throw new Error('no place')
    place.pays = { ...place.pays, '6': '7:5' }
    upload(machineFileText([{ ...bad, id: 'too-good', name: 'Too good' }]))
    expect(await screen.findByRole('alert', {}, { timeout: 15_000 })).toHaveTextContent(
      '"Too good" was not added: a bet would favour the player (Place 6',
    )
  }, 30_000)

  it('loads a settings file, the 3D quality pin included', async () => {
    const { settings } = renderApp()
    openNewGame()
    fireEvent.click(screen.getByRole('button', { name: 'Save or load files…' }))
    await screen.findByTestId('files-panel')
    upload(settingsFileText({ ...DEFAULT_SETTINGS, domeQuality: 'low', diceMode: '2d' }))
    expect(await screen.findByTestId('files-message')).toHaveTextContent('Settings loaded')
    expect(settings.getState().domeQuality).toBe('low')
    expect(settings.getState().diceMode).toBe('2d')
  })
})
