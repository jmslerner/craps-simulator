import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  clearWindow,
  dispatchBetting,
  doubleBets,
  legalBets,
  maxOutOdds,
  newSession,
  pressBet,
  repeatBets,
  rollWindow,
  takeDownAll,
  undo,
  validateAction,
  winsOf,
  workingStatus,
} from '../../engine/index.ts'
import type {
  Action,
  BetId,
  BettingResult,
  Cents,
  Dice,
  GameEvent,
  LegalBet,
  MachineConfig,
  Rejection,
  RejectionCode,
  TableState,
  WindowRecord,
  WindowedSession,
} from '../../engine/index.ts'
import type { SessionMeta, SessionNotice } from '../../persistence/sessionRepo.ts'
import { nextStep, type NextStep, type NextStepSettings } from './nextStep.ts'
import {
  emptyHistory,
  groupByHand,
  pushRoll,
  rollEntryOf,
  type HandGroup,
  type RollEntry,
  type RollHistory,
} from './rollHistory.ts'

/**
 * The game store (plan §6): one zustand vanilla store holding the engine session and the view the
 * table renders. Every mutation goes through `engine/session` — `dispatchBetting`, `undo`,
 * `clearWindow`, `rollWindow` — never `applyAction` directly, so the log, undo and replay stay
 * exact. The table and the coach render `view.shown`, which trails the engine during a roll, so
 * nothing reveals the result early; input is locked unless `view.phase` is `'betting'`. Refusals
 * surface as data (`rejection`: the engine's code and details plus the zone that asked), never as
 * a throw. The roll lifecycle (`beginRoll` → `reveal` → `finishReveal`) is driven by
 * `ui/services/rollFlow.ts`, which persists the outcome before any animation.
 */

export type ViewPhase = 'betting' | 'rolling' | 'revealing'

export interface GameView {
  readonly phase: ViewPhase
  /** What the table renders: the engine's truth in `betting`, the pre-roll table while rolling. */
  readonly shown: TableState
  /** The table the roll left, shown at reveal. */
  readonly next?: TableState
  /** The roll's events, for the reveal's payout animations and the recap (M9). */
  readonly events?: readonly GameEvent[]
}

/** A refused action as data for the UI: the engine's rejection plus where it happened. */
export interface RejectionNotice {
  readonly code: RejectionCode
  readonly details: Rejection['details']
  /** The zone or control that asked (`zone:pass`, `control:roll`); null when none was named. */
  readonly zone: string | null
  /** Increases with every refusal, so the same zone can shake twice. */
  readonly seq: number
}

/** What `beginRoll` returns: the engine's truth, before any animation starts. */
export type RollStart =
  | {
      readonly ok: true
      readonly dice: Dice
      readonly rollIndex: number
      readonly record: WindowRecord
      readonly events: readonly GameEvent[]
      /** The table the roll was made on (what stays shown while the dice animate). */
      readonly prev: TableState
      /** The table the roll left. */
      readonly next: TableState
      readonly session: WindowedSession
    }
  | { readonly ok: false; readonly rejection: Rejection }

export interface GameSnapshot {
  /** The session's machine; stores the compiled config so nothing recompiles per render. */
  readonly cfg: MachineConfig | null
  /** The persistence identity (`sessionRepo`); null while nothing is stored. */
  readonly meta: SessionMeta | null
  readonly session: WindowedSession | null
  readonly view: GameView | null
  readonly rejection: RejectionNotice | null
  /** The latest roll's events: what Press presses by (`winsOf`) and the recap reads. */
  readonly lastRollEvents: readonly GameEvent[] | null
  /** Newest first, capped (plan §0 #20). */
  readonly history: RollHistory
  /** A resume's version or divergence notice (plan §8), dismissed by the player. */
  readonly notice: SessionNotice | null
  /** Dice queued by the e2e hooks; `beginRoll` plays them through `rollWindow(ws, cfg, dice)`. */
  readonly scriptQueue: readonly Dice[]
  /** The entry `reveal` appends, built at `beginRoll` so the reveal needs no recompute. */
  readonly pendingEntry: RollEntry | null
}

export interface GameActions {
  /** A fresh session on `cfg` (plan §4.9: changing machines starts a new session). */
  startGame(cfg: MachineConfig, seed: string, options?: StartOptions): void
  /** A stored session back in play (plan §8). */
  restoreGame(restore: RestoreArgs): void
  /**
   * One betting action through `dispatchBetting`; never a roll. Refusals land in `rejection`
   * tagged with `zone`, and are also returned. Input is locked unless the view is `betting`.
   */
  dispatch(action: Action, zone?: string | null): BettingResult
  /** Add credit (plan §0 #19): `dispatch({ type: 'deposit', amount })`. */
  deposit(amount: Cents, zone?: string | null): BettingResult
  /** Takes back the open window's last action; false when there is nothing to undo. */
  undoLast(): boolean
  /** Takes back every action of the open window. */
  clearBets(): void
  /** Queues scripted dice (e2e builds); each roll consumes one pair. */
  enqueueDice(dice: readonly Dice[]): void
  /**
   * Rolls on the open window (plan §6 roll flow step 1): the engine state becomes the truth and
   * the view locks (`rolling`, showing the pre-roll table). Driven by `rollFlow`, which persists
   * before any animation; a refused roll leaves the window open and surfaces the rejection.
   */
  beginRoll(dice?: Dice): RollStart
  /** Roll flow step 5: show the table the roll left and append the history entry. */
  reveal(): void
  /** Roll flow step 6: back to `betting`. */
  finishReveal(): void
  dismissRejection(): void
  dismissNotice(): void
}

export interface StartOptions {
  readonly meta?: SessionMeta | null
  readonly notice?: SessionNotice | null
}

export interface RestoreArgs {
  readonly cfg: MachineConfig
  readonly session: WindowedSession
  readonly meta: SessionMeta | null
  readonly notice?: SessionNotice | null
  /** Rebuilt from `replayHistory` by the caller; a divergent resume passes a trimmed empty one. */
  readonly history?: RollHistory
}

export type GameState = GameSnapshot & GameActions

const EMPTY: GameSnapshot = {
  cfg: null,
  meta: null,
  session: null,
  view: null,
  rejection: null,
  lastRollEvents: null,
  history: emptyHistory(),
  notice: null,
  scriptQueue: [],
  pendingEntry: null,
}

function lockedRejection(): Rejection {
  return { code: 'WINDOW_CLOSED', details: { reason: 'The dice are rolling' } }
}

export function createGameStore(): StoreApi<GameState> {
  return createStore<GameState>()((set, get) => {
    const refuse = (rejection: Rejection, zone: string | null): void => {
      set((state) => ({
        rejection: {
          code: rejection.code,
          details: rejection.details,
          zone,
          seq: (state.rejection?.seq ?? 0) + 1,
        },
      }))
    }

    const applyBetting = (action: Action, zone: string | null): BettingResult => {
      const { cfg, session, view } = get()
      if (cfg === null || session === null || view === null || view.phase !== 'betting') {
        const rejection = lockedRejection()
        refuse(rejection, zone)
        return { ok: false, rejection }
      }
      const result = dispatchBetting(session, action, cfg)
      if (!result.ok) {
        refuse(result.rejection, zone)
        return result
      }
      set({
        session: result.session,
        view: { phase: 'betting', shown: result.session.state },
        rejection: null,
      })
      return result
    }

    return {
      ...EMPTY,

      startGame: (cfg, seed, options = {}) => {
        const session = newSession(cfg, seed)
        set({
          ...EMPTY,
          cfg,
          meta: options.meta ?? null,
          session,
          view: { phase: 'betting', shown: session.state },
          notice: options.notice ?? null,
        })
      },

      restoreGame: ({ cfg, session, meta, notice, history }) => {
        set({
          ...EMPTY,
          cfg,
          meta,
          session,
          view: { phase: 'betting', shown: session.state },
          notice: notice ?? null,
          history: history ?? emptyHistory(true),
        })
      },

      dispatch: (action, zone = null) => applyBetting(action, zone),

      deposit: (amount, zone = 'control:add-credit') =>
        applyBetting({ type: 'deposit', amount }, zone),

      undoLast: () => {
        const { cfg, session, view } = get()
        if (cfg === null || session === null || view?.phase !== 'betting') return false
        const undone = undo(session, cfg)
        if (undone === null) return false
        set({ session: undone, view: { phase: 'betting', shown: undone.state }, rejection: null })
        return true
      },

      clearBets: () => {
        const { cfg, session, view } = get()
        if (cfg === null || session === null || view?.phase !== 'betting') return
        const cleared = clearWindow(session, cfg)
        set({ session: cleared, view: { phase: 'betting', shown: cleared.state }, rejection: null })
      },

      enqueueDice: (dice) => {
        set((state) => ({ scriptQueue: [...state.scriptQueue, ...dice] }))
      },

      beginRoll: (dice) => {
        const { cfg, session, view, scriptQueue } = get()
        if (cfg === null || session === null || view === null || view.phase !== 'betting') {
          const rejection = lockedRejection()
          refuse(rejection, 'control:roll')
          return { ok: false, rejection }
        }
        const queued = dice === undefined ? scriptQueue[0] : undefined
        const played = dice ?? queued
        const result = rollWindow(session, cfg, played)
        if (!result.ok) {
          refuse(result.rejection, 'control:roll')
          return result
        }
        const prev = session.state
        const next = result.session.state
        const rolled = result.events.find((event) => event.type === 'diceRolled')
        if (rolled === undefined) throw new Error('a roll must emit diceRolled')
        set({
          session: result.session,
          view: { phase: 'rolling', shown: prev, next, events: result.events },
          lastRollEvents: result.events,
          rejection: null,
          scriptQueue: queued === undefined ? scriptQueue : scriptQueue.slice(1),
          pendingEntry: rollEntryOf(prev, result.events, next, cfg),
        })
        return {
          ok: true,
          dice: rolled.dice,
          rollIndex: rolled.rollIndex,
          record: result.record,
          events: result.events,
          prev,
          next,
          session: result.session,
        }
      },

      reveal: () => {
        const { view, history, pendingEntry } = get()
        if (view === null || view.phase !== 'rolling' || view.next === undefined) return
        set({
          view: { ...view, phase: 'revealing', shown: view.next },
          history: pendingEntry === null ? history : pushRoll(history, pendingEntry),
          pendingEntry: null,
        })
      },

      finishReveal: () => {
        const { session, view } = get()
        if (session === null || view === null || view.phase !== 'revealing') return
        set({ view: { phase: 'betting', shown: session.state } })
      },

      dismissRejection: () => set({ rejection: null }),
      dismissNotice: () => set({ notice: null }),
    }
  })
}

/** The app's game store. Tests and services build their own with `createGameStore`. */
export const gameStore: StoreApi<GameState> = createGameStore()

export function useGame<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector)
}

// ---------------------------------------------------------------------------------------------
// Selectors. Pure over GameState; the expensive ones memoize by table identity, so every
// subscriber of the same render reads the same arrays.
// ---------------------------------------------------------------------------------------------

export const selectPhase = (state: GameState): ViewPhase | null => state.view?.phase ?? null

/** What the table renders; never the engine's future. */
export const selectShown = (state: GameState): TableState | null => state.view?.shown ?? null

export const selectBettingOpen = (state: GameState): boolean => state.view?.phase === 'betting'

export const selectBankroll = (state: GameState): Cents | null =>
  state.view?.shown.ledger.bankroll ?? null

export const selectCanUndo = (state: GameState): boolean =>
  state.view?.phase === 'betting' && (state.session?.pending.length ?? 0) > 0

/** Caches one value per shown table (and config), so selectors stay referentially stable. */
function memoByTable<T>(
  compute: (shown: TableState, cfg: MachineConfig, state: GameState) => T,
): (state: GameState) => T | null {
  const cache = new WeakMap<TableState, { readonly cfg: MachineConfig; readonly value: T }>()
  return (state) => {
    const shown = state.view?.shown
    if (shown === undefined || state.cfg === null) return null
    const hit = cache.get(shown)
    if (hit !== undefined && hit.cfg === state.cfg) return hit.value
    const value = compute(shown, state.cfg, state)
    cache.set(shown, { cfg: state.cfg, value })
    return value
  }
}

/**
 * Every spot of the shown table (plan §6: zones come from `legalBets`): `canAdd`, `minAdd`,
 * `maxAdd` and `canRemove` per spot, already limit- and credit-checked by the engine.
 */
export const selectLegalBets: (state: GameState) => readonly LegalBet[] | null = memoByTable(
  (shown, cfg) => legalBets(shown, cfg),
)

/** The macros' availability (M5/M6 → M8 hand-off): a button is enabled when its list is non-empty. */
export interface MacroAvailability {
  readonly repeat: readonly Action[]
  /** Why Repeat is disabled although there is a last window to repeat; null otherwise. */
  readonly repeatBlocked: Rejection | null
  readonly double: readonly Action[]
  readonly takeDownAll: readonly Action[]
}

const NO_MACROS: MacroAvailability = {
  repeat: [],
  repeatBlocked: null,
  double: [],
  takeDownAll: [],
}

export const selectMacros: (state: GameState) => MacroAvailability = (() => {
  const compute = memoByTable((shown, cfg, state): MacroAvailability => {
    const session = state.session
    if (session === null) return NO_MACROS
    const repeat = repeatBets(shown, session.lastWindow, cfg)
    const repeatBlocked =
      repeat.length === 0 && session.lastWindow.length > 0
        ? validateAction(shown, { type: 'batch', actions: session.lastWindow }, cfg)
        : null
    return {
      repeat,
      repeatBlocked,
      double: doubleBets(shown, cfg),
      takeDownAll: takeDownAll(shown, cfg),
    }
  })
  return (state) => (state.view?.phase === 'betting' ? (compute(state) ?? NO_MACROS) : NO_MACROS)
})()

/**
 * Press for one bet: what it won on the last roll (`winsOf`), pressed in whole units as far as its
 * limits and credit allow; empty when there is nothing to press.
 */
export function pressActionsFor(state: GameState, betId: BetId): readonly Action[] {
  const { cfg, session, view, lastRollEvents } = state
  if (cfg === null || session === null || view?.phase !== 'betting') return []
  const won = lastRollEvents === null ? undefined : winsOf(lastRollEvents).get(betId)
  if (won === undefined || won <= 0) return []
  return pressBet(session.state, betId, won, cfg)
}

/** Max odds behind one line bet, or behind every one (`parentId` null). */
export function maxOddsActionsFor(state: GameState, parentId: BetId | null): readonly Action[] {
  const { cfg, session, view } = state
  if (cfg === null || session === null || view?.phase !== 'betting') return []
  return maxOutOdds(session.state, parentId, cfg)
}

/**
 * The machine's BETS ON/OFF button (plan §0 #21, M5/M6 → M8 hand-off): it shows **Set bets On**
 * while any covered bet is OFF by the player, the after-seven-out hold or the button itself; Set
 * bets On dispatches `setGlobalWorking(null)` [A] and Set bets Off `setGlobalWorking(true)`.
 */
export interface WorkingToggleView {
  readonly showSetOn: boolean
  readonly action: Action
  /** The mapping of Set bets On is assumed (plan §0 #21); the UI marks it so. */
  readonly assumed: true
}

/**
 * The next-step guide for the shown table (plan §0 #18): only in the betting window — nothing
 * that changes bets runs while a roll is settling — and null when the player hides the guide.
 */
/** The roll history grouped by hand (plan §0 #20), newest hand first; memoized per history. */
export const selectHands: (state: GameState) => readonly HandGroup[] = (() => {
  const cache = new WeakMap<RollHistory, readonly HandGroup[]>()
  const none: readonly HandGroup[] = []
  return (state) => {
    if (state.history.rolls.length === 0) return none
    const hit = cache.get(state.history)
    if (hit !== undefined) return hit
    const hands = groupByHand(state.history)
    cache.set(state.history, hands)
    return hands
  }
})()

export function selectNextStep(state: GameState, settings: NextStepSettings): NextStep | null {
  if (state.cfg === null || state.view === null || state.view.phase !== 'betting') return null
  const legal = selectLegalBets(state)
  if (legal === null) return null
  return nextStep(state.view.shown, state.cfg, legal, settings)
}

export const selectWorkingToggle: (state: GameState) => WorkingToggleView | null = (() => {
  const compute = memoByTable((shown, cfg): WorkingToggleView | null => {
    if (!cfg.working.toggle.global) return null
    const covered = new Set(cfg.working.toggle.types)
    const showSetOn = shown.bets.some((bet) => {
      if (!covered.has(bet.typeId)) return false
      const status = workingStatus(bet, shown, cfg)
      return (
        !status.working &&
        (status.source === 'bet' || status.source === 'afterSevenOut' || status.source === 'button')
      )
    })
    return {
      showSetOn,
      action: { type: 'setGlobalWorking', off: showSetOn ? null : true },
      assumed: true,
    }
  })
  return (state) => compute(state) ?? null
})()
