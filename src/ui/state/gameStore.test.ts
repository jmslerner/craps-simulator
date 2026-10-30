import { describe, expect, it } from 'vitest'
import { cents, validateAction } from '../../engine/index.ts'
import type { StoreApi } from 'zustand/vanilla'
import { CRAPLESS, dice } from '../test/game.ts'
import {
  createGameStore,
  maxOddsActionsFor,
  pressActionsFor,
  selectBankroll,
  selectCanUndo,
  selectLegalBets,
  selectMacros,
  selectHands,
  selectPhase,
  selectWorkingToggle,
  type GameState,
} from './gameStore.ts'

/** A store with a fresh crapless session, the test's starting position. */
function playingStore(seed = 'store-test'): StoreApi<GameState> {
  const store = createGameStore()
  store.getState().startGame(CRAPLESS, seed)
  return store
}

function state(store: StoreApi<GameState>): GameState {
  return store.getState()
}

/** Places $5 on the pass line through the store; the tests build on it. */
function passBet(store: StoreApi<GameState>, amount = 500): void {
  const result = state(store).dispatch({ type: 'place', typeId: 'pass', amount: cents(amount) })
  if (!result.ok) throw new Error(`pass bet refused: ${result.rejection.code}`)
}

describe('startGame and dispatch', () => {
  it('opens a betting window on a fresh table', () => {
    const store = playingStore()
    const { session, view } = state(store)
    expect(view?.phase).toBe('betting')
    expect(view?.shown).toBe(session?.state)
    expect(selectBankroll(state(store))).toBe(50_000)
    expect(state(store).history.rolls).toHaveLength(0)
  })

  it('routes betting through dispatchBetting and shows the new table', () => {
    const store = playingStore()
    passBet(store)
    const { session, view } = state(store)
    expect(session?.pending).toHaveLength(1)
    expect(view?.shown.bets).toHaveLength(1)
    expect(selectBankroll(state(store))).toBe(49_500)
    expect(selectCanUndo(state(store))).toBe(true)
  })

  it('surfaces a refusal as data with the zone, and changes nothing', () => {
    const store = playingStore()
    const result = state(store).dispatch(
      { type: 'place', typeId: 'lay', number: 4, amount: cents(500) },
      'zone:lay',
    )
    expect(result.ok).toBe(false)
    const { rejection, session } = state(store)
    expect(rejection?.code).toBe('NOT_OFFERED')
    expect(rejection?.zone).toBe('zone:lay')
    expect(rejection?.seq).toBe(1)
    expect(session?.pending).toHaveLength(0)
    // The next refusal bumps seq, so the same zone shakes again.
    state(store).dispatch(
      { type: 'place', typeId: 'lay', number: 4, amount: cents(500) },
      'zone:lay',
    )
    expect(state(store).rejection?.seq).toBe(2)
  })

  it('deposits go through the engine and count as deposits, never wins (plan §0 #19)', () => {
    const store = playingStore()
    const result = state(store).deposit(cents(20_000))
    expect(result.ok).toBe(true)
    const ledger = state(store).session?.state.ledger
    expect(ledger?.bankroll).toBe(70_000)
    expect(ledger?.deposits).toBe(70_000)
    expect(ledger?.houseNet).toBe(0)
    expect(selectCanUndo(state(store))).toBe(true) // undoable until the roll
  })

  it('undoLast and clearBets walk the open window back', () => {
    const store = playingStore()
    passBet(store)
    passBet(store, 500)
    expect(state(store).view?.shown.bets[0]?.amount).toBe(1_000)
    expect(state(store).undoLast()).toBe(true)
    expect(state(store).view?.shown.bets[0]?.amount).toBe(500)
    state(store).clearBets()
    expect(state(store).view?.shown.bets).toHaveLength(0)
    expect(state(store).undoLast()).toBe(false)
  })
})

describe('the roll lifecycle', () => {
  it('beginRoll makes the engine the truth but keeps showing the pre-roll table', () => {
    const store = playingStore()
    passBet(store)
    const prevShown = state(store).view?.shown
    const outcome = state(store).beginRoll(dice(3, 4))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.dice).toStrictEqual({ d1: 3, d2: 4 })
    expect(outcome.rollIndex).toBe(0)
    const { session, view } = state(store)
    expect(session?.committed).toHaveLength(1)
    expect(view?.phase).toBe('rolling')
    expect(view?.shown).toBe(prevShown) // nothing reveals early
    expect(view?.next).toBe(session?.state)
    expect(state(store).history.rolls).toHaveLength(0) // not yet listed
  })

  it('locks input while the dice roll, as data', () => {
    const store = playingStore()
    passBet(store)
    state(store).beginRoll(dice(3, 4))
    const result = state(store).dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    expect(result.ok).toBe(false)
    expect(state(store).rejection?.code).toBe('WINDOW_CLOSED')
    expect(state(store).undoLast()).toBe(false)
    const again = state(store).beginRoll()
    expect(again.ok).toBe(false)
  })

  it('reveal shows the outcome and appends the history; finishReveal reopens betting', () => {
    const store = playingStore()
    passBet(store)
    state(store).beginRoll(dice(3, 4)) // natural: pass wins $5 and stays
    state(store).reveal()
    const revealed = state(store)
    expect(revealed.view?.phase).toBe('revealing')
    expect(revealed.view?.shown).toBe(revealed.session?.state)
    expect(revealed.history.rolls).toHaveLength(1)
    expect(revealed.history.rolls[0]?.net).toBe(500)
    state(store).finishReveal()
    expect(selectPhase(state(store))).toBe('betting')
    expect(selectBankroll(state(store))).toBe(50_000)
  })

  it('a refused roll keeps the window open and surfaces the shortfall', () => {
    const store = playingStore()
    passBet(store, 100) // $1 is under the $5 crapless round minimum
    const outcome = state(store).beginRoll()
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.rejection.code).toBe('BELOW_MIN_TOTAL')
    // "Must bet N credits more!": N comes from details.short (M4 → M8 hand-off).
    expect(outcome.rejection.details.short).toBe(400)
    const { session, view, rejection } = state(store)
    expect(view?.phase).toBe('betting')
    expect(session?.pending).toHaveLength(1) // the window is still open, the bet still placed
    expect(rejection?.zone).toBe('control:roll')
  })

  it('plays queued scripted dice through rollWindow, one pair per roll', () => {
    const store = playingStore()
    state(store).enqueueDice([dice(1, 1), dice(3, 3)])
    passBet(store)
    const first = state(store).beginRoll()
    expect(first.ok && first.dice).toStrictEqual({ d1: 1, d2: 1 }) // point 2
    state(store).reveal()
    state(store).finishReveal()
    const second = state(store).beginRoll()
    expect(second.ok && second.dice).toStrictEqual({ d1: 3, d2: 3 })
    expect(state(store).scriptQueue).toHaveLength(0)
    expect(state(store).session?.state.lastRoll?.scripted).toBe(true)
  })
})

describe('selectors', () => {
  it('selectLegalBets memoizes per shown table', () => {
    const store = playingStore()
    const first = selectLegalBets(state(store))
    expect(first).not.toBeNull()
    expect(selectLegalBets(state(store))).toBe(first)
    passBet(store)
    const second = selectLegalBets(state(store))
    expect(second).not.toBe(first)
    expect(second?.find((spot) => spot.typeId === 'pass')?.amount).toBe(500)
  })

  it('selectMacros enables a macro when its list is non-empty (M5/M6 → M8 hand-off)', () => {
    const store = playingStore()
    expect(selectMacros(state(store)).repeat).toHaveLength(0)
    passBet(store)
    expect(selectMacros(state(store)).double.length).toBeGreaterThan(0)
    expect(selectMacros(state(store)).takeDownAll.length).toBeGreaterThan(0)
    state(store).beginRoll(dice(3, 4)) // natural; the window with the pass bet becomes lastWindow
    state(store).reveal()
    state(store).finishReveal()
    const macros = selectMacros(state(store))
    expect(macros.repeat.length).toBeGreaterThan(0)
    for (const action of macros.repeat) {
      expect(validateAction(state(store).session!.state, action, CRAPLESS)).toBeNull()
    }
  })

  it('explains a disabled Repeat through validateAction on the batch', () => {
    const store = playingStore()
    passBet(store)
    state(store).beginRoll(dice(1, 1)) // point 2: a new pass bet is out of phase now
    state(store).reveal()
    state(store).finishReveal()
    const macros = selectMacros(state(store))
    expect(macros.repeat).toHaveLength(0)
    expect(macros.repeatBlocked).not.toBeNull()
  })

  it('pressActionsFor presses by what the bet won on the last roll', () => {
    const store = playingStore()
    passBet(store)
    state(store).beginRoll(dice(1, 1)) // point 2
    state(store).reveal()
    state(store).finishReveal()
    state(store).dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    state(store).beginRoll(dice(3, 3)) // place 6 wins $7 at 7:6
    state(store).reveal()
    state(store).finishReveal()
    const placeBet = state(store).session?.state.bets.find((bet) => bet.typeId === 'place')
    expect(placeBet).toBeDefined()
    const press = pressActionsFor(state(store), placeBet!.id)
    expect(press).toHaveLength(1)
    expect(validateAction(state(store).session!.state, press[0]!, CRAPLESS)).toBeNull()
    // $7.00 won presses the $6 bet to $13.
    expect(press[0]).toMatchObject({ type: 'batch' })
  })

  it('maxOddsActionsFor fills the odds behind the line', () => {
    const store = playingStore()
    passBet(store)
    state(store).beginRoll(dice(1, 1)) // point 2
    state(store).reveal()
    state(store).finishReveal()
    const actions = maxOddsActionsFor(state(store), null)
    expect(actions).toHaveLength(1)
    expect(validateAction(state(store).session!.state, actions[0]!, CRAPLESS)).toBeNull()
  })

  it('selectWorkingToggle shows Set bets On while the button holds covered bets OFF (plan §0 #21)', () => {
    const store = playingStore()
    passBet(store)
    state(store).beginRoll(dice(1, 1)) // point 2
    state(store).reveal()
    state(store).finishReveal()
    state(store).dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    expect(selectWorkingToggle(state(store))?.showSetOn).toBe(false)

    // Interblock has no per-bet toggle (perBet: false); Set bets Off is the global button.
    state(store).dispatch({ type: 'setGlobalWorking', off: true })
    const toggle = selectWorkingToggle(state(store))
    expect(toggle?.showSetOn).toBe(true)
    expect(toggle?.action).toStrictEqual({ type: 'setGlobalWorking', off: null })
    expect(toggle?.assumed).toBe(true)

    // Set bets On returns the covered bets to their defaults, which work with the point on.
    state(store).dispatch(toggle!.action)
    expect(selectWorkingToggle(state(store))?.showSetOn).toBe(false)
    expect(selectWorkingToggle(state(store))?.action).toStrictEqual({
      type: 'setGlobalWorking',
      off: true,
    })
  })

  it('selectWorkingToggle also covers the after-seven-out hold', () => {
    const store = playingStore()
    passBet(store)
    state(store).beginRoll(dice(1, 1)) // point 2
    state(store).reveal()
    state(store).finishReveal()
    state(store).beginRoll(dice(3, 4)) // seven-out
    state(store).reveal()
    state(store).finishReveal()
    // A place bet made right after the seven-out is held OFF until Set bets On (rules spec §2.4).
    state(store).dispatch({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    const toggle = selectWorkingToggle(state(store))
    expect(toggle?.showSetOn).toBe(true)
    state(store).dispatch(toggle!.action) // Set bets On ends the hold
    expect(selectWorkingToggle(state(store))?.showSetOn).toBe(false)
  })

  it('selectHands groups the history by hand, newest first, memoized per history', () => {
    const store = playingStore()
    passBet(store)
    for (const roll of [dice(1, 1), dice(3, 4)]) {
      state(store).beginRoll(roll) // point 2, then seven-out: hand 0 ends
      state(store).reveal()
      state(store).finishReveal()
    }
    passBet(store)
    state(store).beginRoll(dice(1, 2)) // hand 1 begins
    state(store).reveal()
    state(store).finishReveal()

    const hands = selectHands(state(store))
    expect(hands.map((hand) => hand.handIndex)).toStrictEqual([1, 0])
    expect(hands[1]?.rollCount).toBe(2)
    expect(hands[1]?.net).toBe(-500) // the $5 pass lost to the seven-out
    expect(selectHands(state(store))).toBe(hands) // same history, same array
  })
})
