import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { Dice } from '../engine/index.ts'
import { DiceDome } from '../dome/DiceDome.tsx'
import { DiceModeToggle } from '../dome/DiceModeToggle.tsx'
import { createDiceDome } from '../dome/domeController.ts'
import { QualityControl } from '../dome/QualityControl.tsx'
import { DiceView2D } from './dice2d/DiceView2D.tsx'
import { TUMBLE, TUMBLE_FAST, createDice2D } from './dice2d/diceController.ts'
import { bootGame, wireAutosave } from './services/bootstrap.ts'
import { runRoll, selectNextPhysicsSeed, type DiceView, type RollRun } from './services/rollFlow.ts'
import {
  selectMacros,
  selectShown,
  selectSummaryLog,
  selectWorkingToggle,
  type GameState,
  type SummaryLog,
} from './state/gameStore.ts'
import { cachedNextStep } from './components/nextStepCache.ts'
import { ActionBar } from './components/ActionBar.tsx'
import { AddCreditDialog } from './components/AddCreditDialog.tsx'
import { BetInspector } from './components/BetInspector.tsx'
import { CheatSheet } from './components/CheatSheet.tsx'
import { ChipRail } from './components/ChipRail.tsx'
import { CoachPanel } from './components/CoachPanel.tsx'
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
import { DomeOverlay } from './components/DomeOverlay.tsx'
import { LayoutMeter } from './components/LayoutMeter.tsx'
import { NewGameDialog } from './components/NewGameDialog.tsx'
import { NextRollPanel } from './components/NextRollPanel.tsx'
import { NextStepBar } from './components/NextStepBar.tsx'
import { RollHistoryPanel } from './components/RollHistoryPanel.tsx'
import { RollStrip } from './components/RollStrip.tsx'
import { SessionStrip } from './components/SessionStrip.tsx'
import { SessionSummaryDialog } from './components/SessionSummary.tsx'
import { StatusBanner } from './components/StatusBanner.tsx'
import { Topbar } from './components/Topbar.tsx'
import { TableGrid } from './components/TableGrid.tsx'
import { DOCKED_DRAWER_QUERY, useMediaQuery } from './components/useMediaQuery.ts'

/**
 * The trainer's shell (plan §6), laid out as the player's own Interblock station (plan §0 #28):
 * the cabinet's top bar with the CREDIT, BET and WIN meters and the session meters; then the
 * machine — one bright felt laid out as the station's screen: the prop tabs down the left, the
 * machine's status banner at the top centre over the side bets, which sit on the number row, the
 * dice dome as a compact panel at the top right beside them (the bubble that sits above the real
 * screen), the C/C&E/E circles, the COME, FIELD and PASS LINE bands and the history strip — with
 * the Coach drawer docked beside it on a wide screen; and the chip rail with the
 * station's chrome buttons and ROLL docked at the bottom. Plus the dialogs, the inspector and one
 * aria-live region that announces rolls, guide actions and mode changes. The App owns the
 * per-render UI state (tap mode, open dialog, inspector, announcements) and the roll controller;
 * the game itself lives in the stores, which tests replace through `stores`.
 *
 * **The Coach drawer (plan §0 #28):** everything the trainer adds beyond the machine's own
 * one-liners — the guide's detail, "Next roll", the roll history with its arithmetic, the cost
 * meter, the session and the cheat sheet — is in one drawer, docked open from 1400 px and
 * collapsed below, the player's choice remembered (`CoachPanel`). `data-drawer` on the app says
 * which, for the grid.
 *
 * **The dome slot (M10a):** `.dome-slot` is the box the dice view fills — `position: absolute;
 * inset: 0` inside `.dome`, a `position: relative` 16:10 box with rounded, clipped corners. Behind
 * `settingsStore.diceMode` it holds either `DiceView2D` or the 3D `DiceDome`, whose lazy chunk
 * (three, R3F, the scene) loads only in 3D mode and only when WebGL is available; until its
 * renderer is live, and whenever WebGL fails, the same 2D controller shows the dice, so the roll
 * flow always has a `DiceView` (`dome.view()` reads `'3d'` only while live). The overlays
 * (`DomeOverlay`: the ON/OFF puck and the callout) sit above the slot on their own z-index, ignore
 * pointer events and are `aria-hidden`; the 2D/3D switch and the 3D quality pin sit in a row
 * under the box, where they cover neither the callout nor the dice; `data-testid="dice-view"`
 * with `data-dice` stays the e2e contract for the rest pose.
 *
 * **One rest for both views (M10 audit CRITICAL-1):** every reveal goes through the dome's
 * `showRest`, in 2D and instant mode too (it sets the 2D dice as well), so the dome always holds
 * the last roll whichever mode rolled it. And whenever no roll is in flight — a resume, a new
 * game, a switch to 3D — both views are put on the shown table's last roll, or cleared when it
 * has none. The 3D quality pin is a setting (`settings.domeQuality`), so it persists with them.
 *
 * **The session summary (M13):** the Summary control under the session strip opens it on the
 * session's log so far; when New game replaces a session that rolled, the ended session's summary
 * opens once the New game dialog has closed (not with the coach off). It is a modal like the
 * dialogs, so the keyboard map is dead while it is open.
 */

export interface AppProps {
  /** Test seam: replaces the app singletons. */
  stores?: AppStores
  /** False in tests that pre-start their own session (production boots and resumes). */
  boot?: boolean
}

export function App({ stores = DEFAULT_STORES, boot = true }: AppProps) {
  const dice = useMemo(() => createDice2D(), [])
  const dome = useMemo(
    () =>
      createDiceDome({
        fallback: dice,
        quality: {
          pin: {
            read: () => stores.settings.getState().domeQuality,
            write: (choice) => stores.settings.getState().update({ domeQuality: choice }),
          },
        },
      }),
    [dice, stores.settings],
  )
  const runRef = useRef<RollRun | null>(null)
  // The 3D dome mounts once the boot is done: only then are the dice mode and the session final
  // (an e2e URL's `dice=` is applied during the boot), so a page that is about to play 2D never
  // probes WebGL or fetches the 3D chunk on the way.
  const [booted, setBooted] = useState(!boot)
  const [mode, setMode] = useState<TapMode>('bet')
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [inspector, setInspector] = useState<SpotRef | null>(null)
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 })
  const [summary, setSummary] = useState<{ log: SummaryLog; ended: boolean } | null>(null)

  const announce = useCallback((text: string): void => {
    setAnnouncement((previous) => ({ text, seq: previous.seq + 1 }))
  }, [])

  const diceMode = useStore(stores.settings, (state) => state.diceMode)
  const speed = useStore(stores.settings, (state) => state.speed)
  const reducedSetting = useStore(stores.settings, (state) => state.reducedMotion)
  const guideEnabled = useStore(stores.settings, (state) => state.guideEnabled)
  const selectedChip = useStore(stores.settings, (state) => state.selectedChip)
  const chips = useStore(stores.settings, (state) => state.chips)
  const coachMode = useStore(stores.settings, (state) => state.coachMode)
  // The App renders the stores' provider, so it reads its own stores directly (the drawer's
  // components read the same setting through the context).
  const drawerPref = useStore(stores.settings, (state) => state.coachDrawer)
  const drawerWide = useMediaQuery(DOCKED_DRAWER_QUERY, true)
  const drawerOpen = drawerPref === 'open' || (drawerPref === 'auto' && drawerWide)
  const cfg = useStore(stores.game, (state) => state.cfg)
  const step = useStore(stores.game, (state) => cachedNextStep(state, { selectedChip, chips }))
  const nextPhysicsSeed = useStore(stores.game, selectNextPhysicsSeed)

  // The dice view behind the setting: the dome plays 3D while its renderer is live, 2D otherwise.
  // In 2D and instant mode the 2D dice play, but the reveal still goes through the dome, so it
  // holds the same roll for the moment the player switches to 3D.
  const diceView = useCallback((): DiceView => {
    if (diceMode === '3d') return dome.view(speed === 'fast' ? 'fast' : 'normal')
    const flat = dice.view(diceMode, speed === 'fast' ? TUMBLE_FAST : TUMBLE)
    return {
      mode: flat.mode,
      play: (request, signal) => flat.play(request, signal),
      showRest: (rolled) => dome.view().showRest(rolled),
    }
  }, [diceMode, dome, dice, speed])

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
          diceView: diceView(),
          reducedMotion: prefersReducedMotion(reducedSetting),
        },
        scripted,
      )
      runRef.current = run
      void run.settled
    },
    [stores, diceView, reducedSetting],
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
    void bootGame({ store: stores.game, settings: stores.settings, repo: stores.repo }).then(
      () => {
        if (stopped) return
        autosave = wireAutosave({ store: stores.game, repo: stores.repo })
        setBooted(true)
      },
      () => {
        if (!stopped) setBooted(true)
      },
    )
    return () => {
      stopped = true
      autosave?.stop()
    }
  }, [boot, stores])

  // Both dice views on the shown table's last roll whenever no roll is in flight: a resumed
  // session shows its last roll, a new game clears the dice, and a switch to 3D (this runs again
  // for every mode) finds the dome on the roll the table shows. While a roll is in flight the shown
  // table is still the one it was made on, and the roll flow reveals the new dice itself.
  useEffect(() => {
    let synced: unknown = undefined
    const sync = (state: GameState): void => {
      const shown = selectShown(state)
      if (shown === null || state.view?.phase === 'rolling') return
      const last = shown.lastRoll
      if (last === synced) return
      synced = last
      if (last === null) {
        dice.reset()
        dome.reset()
      } else {
        // The dome's showRest also sets the 2D dice.
        dome.view().showRest(last.dice)
      }
    }
    sync(stores.game.getState())
    return stores.game.subscribe(sync)
  }, [stores.game, dome, dice, diceMode])

  // The quality pin follows the setting if it changes elsewhere (a settings import).
  useEffect(
    () =>
      stores.settings.subscribe((state) => {
        const quality = dome.quality.getState()
        if (state.domeQuality !== quality.override) quality.setOverride(state.domeQuality)
      }),
    [stores.settings, dome],
  )

  // e2e builds only: the test hooks read the drawn dice through the dome (`domeReadout`).
  useEffect(() => {
    if (import.meta.env.MODE === 'e2e') {
      let cancelled = false
      void import('./services/testHooks.ts').then((hooks) => {
        if (!cancelled) hooks.registerDome(dome)
      })
      return () => {
        cancelled = true
      }
    }
    return undefined
  }, [dome])

  // The session summary (M13). When New game replaces a session that rolled, keep the ended
  // session's log: its summary opens once the New game dialog has closed.
  const openSummary = useCallback((): void => {
    const log = selectSummaryLog(stores.game.getState())
    if (log !== null) setSummary({ log, ended: false })
  }, [stores.game])
  useEffect(() => {
    if (coachMode === 'off') return undefined
    let previous = selectSummaryLog(stores.game.getState())
    return stores.game.subscribe((state) => {
      const current = selectSummaryLog(state)
      if (
        previous !== null &&
        current !== null &&
        current.header !== previous.header &&
        current.committed.length === 0 &&
        previous.committed.length > 0
      ) {
        setSummary({ log: previous, ended: true })
      }
      previous = current
    })
  }, [stores.game, coachMode])

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
    const dialogOpen = dialog !== null || inspector !== null || summary !== null
    const onKey = (event: KeyboardEvent): void => {
      if (dialogOpen) return
      // Browser and system shortcuts (Cmd/Ctrl+R reload, Cmd/Ctrl+C copy, Alt+…) are never game keys.
      if (event.ctrlKey || event.metaKey || event.altKey) return
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
          // A held key auto-repeats; one press is one roll.
          if (!event.repeat) roll()
          return
        case 'r':
          if (!event.repeat) roll()
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
        case '6':
        case '7':
        case '8':
        case '9': {
          const rack = chips ?? cfg?.chips ?? []
          const chip = rack[Number(event.key) - 1]
          if (chip !== undefined) stores.settings.getState().update({ selectedChip: chip })
          return
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [stores, dialog, inspector, summary, mode, ui, roll, announce, chips, cfg])

  return (
    <StoresProvider value={stores}>
      <UiProvider value={ui}>
        <div className="app" data-drawer={drawerOpen ? 'open' : 'closed'}>
          <Topbar />
          <div className="stage">
            <main className="machine" aria-label="Machine">
              <div className="felt">
                <section className="dome-panel" aria-label="Dice dome">
                  <div className="dome">
                    <div className="dome-slot">
                      {diceMode === '3d' && booted ? (
                        <DiceDome controller={dome} nextSeed={nextPhysicsSeed} />
                      ) : (
                        <DiceView2D
                          controller={dice}
                          mode={diceMode === 'instant' ? 'instant' : '2d'}
                        />
                      )}
                    </div>
                    <DomeOverlay />
                  </div>
                  <div className="dome-controls">
                    {diceMode === '3d' && booted && <QualityControl controller={dome} />}
                    <DiceModeToggle settings={stores.settings} />
                  </div>
                </section>
                <StatusBanner />
                <TableGrid />
                <RollStrip />
              </div>
            </main>
            <CoachPanel>
              <NextStepBar />
              <NextRollPanel />
              <RollHistoryPanel />
              <LayoutMeter />
              <SessionStrip onSummary={openSummary} />
              <CheatSheet />
            </CoachPanel>
          </div>
          <footer className="rack" aria-label="Chips and controls">
            <div className="rack-inner">
              <ChipRail />
              <ActionBar />
            </div>
          </footer>
          {dialog === 'newGame' && <NewGameDialog />}
          {dialog === 'addCredit' && <AddCreditDialog />}
          {inspector !== null && <BetInspector spot={inspector} />}
          {summary !== null && dialog === null && inspector === null && (
            <SessionSummaryDialog
              key={`${summary.ended ? 'ended' : 'live'}:${summary.log.header.seed}:${summary.log.committed.length}:${summary.log.pending.length}`}
              log={summary.log}
              ended={summary.ended}
              onClose={() => setSummary(null)}
            />
          )}
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
