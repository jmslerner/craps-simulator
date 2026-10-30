import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { Dice } from '../engine/index.ts'
import { DiceView2D } from './dice2d/DiceView2D.tsx'
import { TUMBLE, TUMBLE_FAST, createDice2D } from './dice2d/diceController.ts'
import { bootGame, wireAutosave } from './services/bootstrap.ts'
import { runRoll, type RollRun } from './services/rollFlow.ts'
import { selectMacros, selectWorkingToggle } from './state/gameStore.ts'
import { cachedNextStep } from './components/nextStepCache.ts'
import { ActionBar } from './components/ActionBar.tsx'
import { AddCreditDialog } from './components/AddCreditDialog.tsx'
import { BetInspector } from './components/BetInspector.tsx'
import { ChipRail } from './components/ChipRail.tsx'
import {
  DEFAULT_STORES,
  StoresProvider,
  UiProvider,
  type AppStores,
  type DialogKind,
  type SpotRef,
  type TapMode,
  type UiState,
} from './components/context.tsx'
import { rollAnnouncement } from './components/copy.ts'
import { NewGameDialog } from './components/NewGameDialog.tsx'
import { NextStepBar } from './components/NextStepBar.tsx'
import { ReasonStrip } from './components/ReasonStrip.tsx'
import { RollHistoryPanel } from './components/RollHistoryPanel.tsx'
import { SessionStrip } from './components/SessionStrip.tsx'
import { Topbar } from './components/Topbar.tsx'
import { TableGrid } from './components/TableGrid.tsx'

/**
 * The trainer's shell (plan §6): topbar, the dome slot (the 2D dice until M10), the table, the
 * next-step bar, the action bar and chip rail, the roll history and the session strip, plus the
 * dialogs, the inspector and one aria-live region that announces rolls, guide actions and mode
 * changes. The App owns the per-render UI state (tap mode, open dialog, inspector, announcements)
 * and the roll controller; the game itself lives in the stores, which tests replace through
 * `stores`.
 */

export interface AppProps {
  /** Test seam: replaces the app singletons. */
  stores?: AppStores
  /** False in tests that pre-start their own session (production boots and resumes). */
  boot?: boolean
}

export function App({ stores = DEFAULT_STORES, boot = true }: AppProps) {
  const dice = useMemo(() => createDice2D(), [])
  const runRef = useRef<RollRun | null>(null)
  const [mode, setMode] = useState<TapMode>('bet')
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [inspector, setInspector] = useState<SpotRef | null>(null)
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 })
  const [approxDismissed, setApproxDismissed] = useState<readonly string[]>([])

  const announce = useCallback((text: string): void => {
    setAnnouncement((previous) => ({ text, seq: previous.seq + 1 }))
  }, [])

  const diceMode = useStore(stores.settings, (state) => state.diceMode)
  const speed = useStore(stores.settings, (state) => state.speed)
  const reducedSetting = useStore(stores.settings, (state) => state.reducedMotion)
  const guideEnabled = useStore(stores.settings, (state) => state.guideEnabled)
  const selectedChip = useStore(stores.settings, (state) => state.selectedChip)
  const chips = useStore(stores.settings, (state) => state.chips)
  const cfg = useStore(stores.game, (state) => state.cfg)
  const step = useStore(stores.game, (state) => cachedNextStep(state, { selectedChip, chips }))

  // The 3D dome is M10; its setting plays as 2D until then.
  const viewMode = diceMode === 'instant' ? 'instant' : '2d'

  const roll = useCallback(
    (scripted?: Dice): void => {
      const game = stores.game.getState()
      if (game.view?.phase !== 'betting') {
        runRef.current?.skip()
        return
      }
      const run = runRoll(
        {
          store: stores.game,
          repo: stores.repo,
          diceView: dice.view(viewMode, speed === 'fast' ? TUMBLE_FAST : TUMBLE),
          reducedMotion: prefersReducedMotion(reducedSetting),
        },
        scripted,
      )
      runRef.current = run
      void run.settled
    },
    [stores, dice, viewMode, speed, reducedSetting],
  )

  const ui: UiState = useMemo(
    () => ({
      mode,
      dialog,
      inspector,
      highlight: guideEnabled && step !== null ? step.target : null,
      setMode: (next) => {
        setMode(next)
        announce(
          next === 'remove'
            ? 'Remove mode: tap a bet to take it down.'
            : next === 'info'
              ? 'Info mode: tap a zone to inspect it.'
              : 'Bet mode: tap a zone to place the chip.',
        )
      },
      openDialog: (kind) => setDialog(kind),
      closeDialog: () => setDialog(null),
      openInspector: (spot) => setInspector(spot),
      closeInspector: () => setInspector(null),
      roll,
      announce,
    }),
    [mode, dialog, inspector, guideEnabled, step, roll, announce],
  )

  // Boot: resume the stored session or start fresh, then keep the betting window autosaved.
  useEffect(() => {
    if (!boot) return
    let autosave: ReturnType<typeof wireAutosave> | null = null
    let stopped = false
    void bootGame({ store: stores.game, settings: stores.settings, repo: stores.repo }).then(() => {
      if (stopped) return
      autosave = wireAutosave({ store: stores.game, repo: stores.repo })
      const last = stores.game.getState().session?.state.lastRoll ?? null
      if (last !== null) dice.view(viewMode).showRest(last.dice)
    })
    return () => {
      stopped = true
      autosave?.stop()
    }
    // Boot runs once per mount; the dice mode only picks the first rest pose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, stores, dice])

  // Announce each revealed roll: total, round event and the player's net, in words (plan §6).
  useEffect(() => {
    let lastIndex = stores.game.getState().history.rolls[0]?.rollIndex ?? null
    return stores.game.subscribe((state) => {
      const newest = state.history.rolls[0] ?? null
      if (newest !== null && newest.rollIndex !== lastIndex) {
        lastIndex = newest.rollIndex
        announce(rollAnnouncement(newest))
      }
    })
  }, [stores.game, announce])

  // Keyboard map (plan §6), ignored while a dialog is open and never over a text field.
  useEffect(() => {
    const dialogOpen = dialog !== null || inspector !== null
    const onKey = (event: KeyboardEvent): void => {
      if (dialogOpen) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return
      }
      const game = stores.game.getState()
      switch (event.key) {
        case ' ':
          // A focused button handles Space itself.
          if (target instanceof HTMLElement && target.tagName === 'BUTTON') return
          event.preventDefault()
          roll()
          return
        case 'r':
          roll()
          return
        case 'R': {
          const repeat = selectMacros(game).repeat[0]
          if (repeat !== undefined) game.dispatch(repeat, 'control:repeat')
          return
        }
        case 'u':
          game.undoLast()
          return
        case 'c':
          game.clearBets()
          return
        case 'i':
          ui.setMode(mode === 'info' ? 'bet' : 'info')
          return
        case 'x':
          ui.setMode(mode === 'remove' ? 'bet' : 'remove')
          return
        case 'o': {
          const toggle = selectWorkingToggle(game)
          if (toggle !== null) {
            const result = game.dispatch(toggle.action, 'control:working')
            if (result.ok) announce(toggle.showSetOn ? 'Bets set on.' : 'Bets set off.')
          }
          return
        }
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6': {
          const rack = chips ?? cfg?.chips ?? []
          const chip = rack[Number(event.key) - 1]
          if (chip !== undefined) stores.settings.getState().update({ selectedChip: chip })
          return
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [stores, dialog, inspector, mode, ui, roll, announce, chips, cfg])

  const approxNote =
    cfg !== null && cfg.notModelled.length > 0 && !approxDismissed.includes(cfg.configHash)

  return (
    <StoresProvider value={stores}>
      <UiProvider value={ui}>
        <div className="app-shell">
          <h1 className="app-brand">Bubble Craps Trainer</h1>
          <Topbar />
          <ReasonStrip />
          {approxNote && cfg !== null && (
            <div className="approx-note" role="note">
              <p>
                This machine sets options the trainer approximates ({cfg.notModelled.join(', ')}).
                Everything else plays exactly.
              </p>
              <button
                type="button"
                onClick={() => setApproxDismissed((done) => [...done, cfg.configHash])}
              >
                Got it
              </button>
            </div>
          )}
          <main className="app-main">
            <div className="app-side">
              <div className="dome-slot">
                <DiceView2D controller={dice} mode={viewMode} />
              </div>
              <SessionStrip />
              <RollHistoryPanel />
            </div>
            <div className="app-center">
              <TableGrid />
              <NextStepBar />
              <ActionBar />
              <ChipRail />
            </div>
          </main>
          {dialog === 'newGame' && <NewGameDialog />}
          {dialog === 'addCredit' && <AddCreditDialog />}
          {inspector !== null && <BetInspector spot={inspector} />}
          <div className="sr-only" role="status" aria-live="polite" data-testid="announcer">
            <span key={announcement.seq}>{announcement.text}</span>
          </div>
        </div>
      </UiProvider>
    </StoresProvider>
  )
}

/** Reduced motion: the player's setting wins; otherwise the system preference. */
function prefersReducedMotion(setting: boolean | null): boolean {
  if (setting !== null) return setting
  if (typeof matchMedia !== 'function') return false
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
