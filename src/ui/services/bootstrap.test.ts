import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cents, hashJson } from '../../engine/index.ts'
import { createSessionRepo } from '../../persistence/sessionRepo.ts'
import { safeDelMany, safeKeys } from '../../persistence/storage.ts'
import { createGameStore } from '../state/gameStore.ts'
import { createSettingsStore } from '../state/settingsStore.ts'
import { dice } from '../test/game.ts'
import { bootGame, startNewGame, wireAutosave } from './bootstrap.ts'
import { runRoll } from './rollFlow.ts'
import type { DiceView } from './rollFlow.ts'

const NOW = 1_761_700_000_000
const repo = createSessionRepo({ now: () => NOW })

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

function freshDeps() {
  return {
    store: createGameStore(),
    settings: createSettingsStore({ storage: memoryStorage() }),
    repo,
    now: () => NOW,
  }
}

const instantDice: DiceView = {
  mode: 'instant',
  play: () => Promise.resolve(),
  showRest: () => undefined,
}

async function wipe(): Promise<void> {
  const all = await safeKeys()
  if (all.ok && all.value.length > 0) await safeDelMany(all.value)
}

beforeEach(wipe)
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('bootGame', () => {
  it('starts a new crapless game when nothing is stored, and persists it', async () => {
    const deps = freshDeps()
    const result = await bootGame(deps)
    expect(result).toStrictEqual({ started: 'new', pendingReveal: false })
    const { cfg, session, view, meta } = deps.store.getState()
    expect(cfg?.id).toBe('craplessBubble')
    expect(view?.phase).toBe('betting')
    expect(session?.committed).toHaveLength(0)
    expect(meta).not.toBeNull()
    // The new session took the active slot.
    const stored = await repo.loadActive()
    expect(stored.kind).toBe('active')
  })

  it('uses the remembered starting bankroll for the new game (plan §0 #19)', async () => {
    const deps = freshDeps()
    deps.settings.getState().update({ startingBankroll: 60_000 })
    await bootGame(deps)
    expect(deps.store.getState().session?.state.ledger.bankroll).toBe(60_000)
    expect(deps.store.getState().cfg?.startingBankroll).toBe(60_000)
  })

  it('resumes the stored session with its history on the next boot', async () => {
    const deps = freshDeps()
    await bootGame(deps)
    deps.store.getState().dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    await runRoll(
      { store: deps.store, repo, diceView: instantDice, delay: () => Promise.resolve() },
      dice(3, 4),
    ).settled
    const hash = hashJson(deps.store.getState().session!.state)

    const next = { ...freshDeps(), settings: deps.settings }
    const result = await bootGame(next)
    expect(result.started).toBe('resumed')
    const resumed = next.store.getState()
    expect(hashJson(resumed.session!.state)).toBe(hash)
    expect(resumed.history.rolls).toHaveLength(1)
    expect(resumed.history.rolls[0]?.net).toBe(500)
    expect(resumed.view?.phase).toBe('betting')
  })

  it('reveals a stored pendingReveal roll instantly on resume and clears the flag', async () => {
    const deps = freshDeps()
    await bootGame(deps)
    const store = deps.store
    store.getState().dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    const outcome = store.getState().beginRoll(dice(3, 4))
    if (!outcome.ok) throw new Error('roll refused')
    const meta = store.getState().meta!
    await repo.commitRoll(meta, outcome.session, outcome.record)
    // The tab dies mid-animation here: pendingReveal is still set.

    const next = { ...freshDeps(), settings: deps.settings }
    const result = await bootGame(next)
    expect(result.started).toBe('resumed')
    expect(result.pendingReveal).toBe(true)
    // The restored table already shows the outcome: revealed, not re-rolled.
    expect(hashJson(next.store.getState().session!.state)).toBe(outcome.record.hashAfter)
    const reloaded = await repo.loadActive()
    expect(reloaded.kind === 'active' && reloaded.pendingReveal).toBe(false)
  })
})

describe('startNewGame', () => {
  it('remembers the chosen bankroll and archives the old session', async () => {
    const deps = freshDeps()
    await bootGame(deps)
    const firstMeta = deps.store.getState().meta
    await startNewGame({ bankroll: cents(75_000) }, deps)
    expect(deps.settings.getState().startingBankroll).toBe(75_000)
    expect(deps.store.getState().session?.state.ledger.bankroll).toBe(75_000)
    expect(deps.store.getState().meta?.id).not.toBe(firstMeta?.id)
    const last = await repo.readLastResult()
    expect(last?.id).toBe(firstMeta?.id)
  })
})

describe('wireAutosave', () => {
  // Real timers with a short debounce: fake timers would also freeze fake-indexeddb's own
  // scheduling and wedge every transaction in the file.
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('saves betting actions after the debounce and flushes on hide', async () => {
    const deps = freshDeps()
    await bootGame(deps)
    const handle = wireAutosave({
      store: deps.store,
      repo,
      debounceMs: 20,
      pageEvents: null,
      documentLike: null,
    })

    deps.store.getState().dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    let stored = await repo.loadActive()
    expect(stored.kind === 'active' && stored.session.pending).toHaveLength(0) // debounce pending
    await settle(60)
    stored = await repo.loadActive()
    expect(stored.kind === 'active' && stored.session.pending).toHaveLength(1)

    // A second action, flushed at once (the page hiding), without waiting out the debounce.
    deps.store.getState().dispatch({ type: 'deposit', amount: cents(5_000) })
    await handle.flush()
    stored = await repo.loadActive()
    expect(stored.kind === 'active' && stored.session.pending).toHaveLength(2)

    handle.stop()
    deps.store.getState().dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    await settle(60)
    stored = await repo.loadActive()
    expect(stored.kind === 'active' && stored.session.pending).toHaveLength(2) // stopped: unsaved
  })
})

describe('the e2e boot', () => {
  it('forces a fresh scripted session from the URL and installs the hooks', async () => {
    vi.stubEnv('MODE', 'e2e')
    const deps = freshDeps()
    const result = await bootGame({
      ...deps,
      search: '?seed=e2e-run&dice=instant&script=1-1,3-3&bankroll=500',
    })
    expect(result.started).toBe('new')
    const state = deps.store.getState()
    expect(state.session?.header.seed).toBe('e2e-run')
    expect(state.scriptQueue).toStrictEqual([dice(1, 1), dice(3, 3)])
    expect(state.session?.state.ledger.bankroll).toBe(50_000)
    expect(deps.settings.getState().diceMode).toBe('instant')
    expect(window.__CRAPS_TEST__).toBeDefined()
    expect(window.__CRAPS_TEST__?.getState().machineId).toBe('craplessBubble')
    delete window.__CRAPS_TEST__
  })
})
