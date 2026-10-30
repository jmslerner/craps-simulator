import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { StoreApi } from 'zustand/vanilla'
import {
  betId,
  cents,
  deserializeSession,
  legalBets,
  makeRoll,
  serializeSession,
  typeLimits,
  type Action,
  type DieFace,
  type MachineConfig,
} from '../../engine/index.ts'
import { oracleMeters } from '../test/metersOracle.ts'
import { CRAPLESS } from '../test/game.ts'
import {
  createGameStore,
  maxOddsActionsFor,
  selectSessionResult,
  selectSessionTotals,
  selectSummaryLog,
  type GameState,
} from './gameStore.ts'
import { COMPILED_PRESETS } from './machineStore.ts'

/**
 * The session meters in the game store (rules spec §4.6): maintained live action by action — a
 * deposit, an undo, a clear, a roll — trailing the engine during a roll like the shown table, and
 * recomputed from the whole log on a restore. A scripted crapless session pins every figure by
 * hand; a fast-check property (seed 20261028) drives the store through random sessions on every
 * preset and checks, after every move, that the shown figures equal an independent recomputation
 * from the logged deposit actions and the replayed settlement traces (`test/metersOracle.ts`) and
 * the engine's ledger, and that a session serialized, parsed and restored shows the same figures.
 */

function startedStore(cfg: MachineConfig = CRAPLESS, seed = 'meters-store'): StoreApi<GameState> {
  const store = createGameStore()
  store.getState().startGame(cfg, seed)
  return store
}

function act(store: StoreApi<GameState>, action: Action): void {
  const result = store.getState().dispatch(action)
  if (!result.ok) throw new Error(`refused ${JSON.stringify(action)}: ${result.rejection.code}`)
}

function rollAndReveal(store: StoreApi<GameState>, d1: DieFace, d2: DieFace): void {
  const outcome = store.getState().beginRoll(makeRoll(d1, d2))
  if (!outcome.ok) throw new Error(`roll refused: ${outcome.rejection.code}`)
  store.getState().reveal()
  store.getState().finishReveal()
}

function totals(store: StoreApi<GameState>) {
  const value = selectSessionTotals(store.getState())
  if (value === null) throw new Error('no meters')
  return value
}

describe('a scripted crapless session', () => {
  it('pins credit added, total wagered, commission and the result', () => {
    const store = startedStore()
    expect(totals(store)).toMatchObject({ creditAdded: 50_000, deposits: 1, wagered: 0 })

    // Come-out: pass $10 (b1) and Low Rolls $1 (b2); $100 added, then undone before the roll.
    act(store, { type: 'place', typeId: 'pass', amount: cents(1000) })
    act(store, { type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
    store.getState().deposit(cents(10_000))
    expect(totals(store)).toMatchObject({ creditAdded: 60_000, deposits: 2 })
    expect(store.getState().undoLast()).toBe(true)
    expect(totals(store)).toMatchObject({ creditAdded: 50_000, deposits: 1, topUps: [] })
    rollAndReveal(store, 2, 2) // point 4; nothing decided

    // Mid-hand: odds $20 (b3), Place 6 $6 (b4), Buy 10 $20 (b5) with $1 commission up front, and
    // a $100 top-up before roll 2.
    act(store, { type: 'place', typeId: 'passOdds', parentId: betId(1), amount: cents(2000) })
    act(store, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    act(store, { type: 'place', typeId: 'buy', number: 10, amount: cents(2000) })
    store.getState().deposit(cents(10_000))
    expect(totals(store).topUps).toStrictEqual([{ amount: 10_000, beforeRoll: 1 }])
    expect(totals(store).commission).toBe(100)
    rollAndReveal(store, 3, 3) // Place 6 wins $7 and stays: $6 wagered
    rollAndReveal(store, 6, 4) // Buy 10 wins $40, $1 re-collected from the win: $20 wagered
    act(store, { type: 'setAmount', betId: betId(5), amount: cents(0) }) // take the buy down
    rollAndReveal(store, 2, 4) // Place 6 wins again: $6
    rollAndReveal(store, 1, 3) // the point: pass $10 and odds $20 win
    rollAndReveal(store, 3, 4) // come-out 7: pass wins $10, Place 6 ($6) and Low Rolls ($1) lose

    const final = totals(store)
    expect(final.creditAdded).toBe(60_000)
    expect(final.deposits).toBe(2)
    expect(final.buyIn).toBe(50_000)
    expect(final.topUps).toStrictEqual([{ amount: 10_000, beforeRoll: 1 }])
    // Place 6 three times ($18), the buy once ($20), the pass twice ($20), the odds once ($20) and
    // Low Rolls once ($1): $79.00 over 8 decisions. The take-down is no decision.
    expect(final.wagered).toBe(7_900)
    expect(final.decisions).toBe(8)
    expect(final.commission).toBe(200)
    expect(final.commissionParts).toStrictEqual({ upfront: 100, fromWins: 0, recollected: 100 })
    // Credit $695 and the $10 pass still up, against $600 put in.
    const shown = store.getState().view?.shown
    expect(shown?.ledger.bankroll).toBe(69_500)
    expect(selectSessionResult(store.getState())).toBe(10_500)
  })

  it('keeps the pre-roll figures until the reveal', () => {
    const store = startedStore()
    act(store, { type: 'place', typeId: 'pass', amount: cents(1000) })
    const before = totals(store)
    const outcome = store.getState().beginRoll(makeRoll(3, 4)) // the pass wins: a $10 decision
    expect(outcome.ok).toBe(true)
    expect(totals(store)).toBe(before)
    expect(selectSessionResult(store.getState())).toBe(0)
    store.getState().reveal()
    expect(totals(store).wagered).toBe(1_000)
    expect(selectSessionResult(store.getState())).toBe(1_000)
    // The summary's log already holds the roll, so its meters do too.
    expect(selectSummaryLog(store.getState())?.money?.wagered).toBe(1_000)
  })

  it('folds the open window again on clear, and a restore shows the same figures', () => {
    const store = startedStore()
    act(store, { type: 'place', typeId: 'pass', amount: cents(1000) })
    rollAndReveal(store, 2, 2)
    act(store, { type: 'place', typeId: 'buy', number: 4, amount: cents(2000) })
    store.getState().deposit(cents(2_000))
    expect(totals(store)).toMatchObject({ creditAdded: 52_000, commission: 100 })
    store.getState().clearBets()
    expect(totals(store)).toMatchObject({ creditAdded: 50_000, commission: 0, topUps: [] })
    store.getState().deposit(cents(2_000))

    const { cfg, session } = store.getState()
    if (cfg === null || session === null) throw new Error('no session')
    const loaded = deserializeSession(serializeSession(session))
    if (!loaded.ok) throw new Error('the session does not load')
    const restored = createGameStore()
    restored.getState().restoreGame({ cfg, session: loaded.session, meta: null })
    expect(totals(restored)).toStrictEqual(totals(store))
    expect(restored.getState().committedMeters).toStrictEqual(store.getState().committedMeters)
  })

  it('never fails a restore over its meters: a log it cannot fold keeps its deposits', () => {
    const store = startedStore()
    act(store, { type: 'place', typeId: 'pass', amount: cents(1000) })
    store.getState().deposit(cents(2_000))
    rollAndReveal(store, 2, 2)
    const { cfg, session } = store.getState()
    if (cfg === null || session === null) throw new Error('no session')
    // A stored header whose machine now compiles to another hash (a divergent resume, plan §8).
    const header = { ...session.header, configHash: '0123456789abcdef' }
    const restored = createGameStore()
    restored.getState().restoreGame({ cfg, session: { ...session, header }, meta: null })
    expect(totals(restored)).toMatchObject({
      creditAdded: 52_000,
      topUps: [{ amount: 2_000, beforeRoll: 0 }],
      wagered: null,
      commissionParts: null,
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The property: random sessions through the store, every preset.
// ---------------------------------------------------------------------------------------------

type Move =
  | { readonly kind: 'bet'; readonly pick: number; readonly units: number }
  | { readonly kind: 'side'; readonly pick: number }
  | { readonly kind: 'odds' }
  | { readonly kind: 'cut'; readonly pick: number }
  | { readonly kind: 'takeDown'; readonly pick: number }
  | { readonly kind: 'working'; readonly pick: number; readonly value: boolean | null }
  | { readonly kind: 'deposit'; readonly dollars: number }
  | { readonly kind: 'depositBatch'; readonly dollars: number; readonly pick: number }
  | { readonly kind: 'undo' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'roll'; readonly d1: DieFace; readonly d2: DieFace; readonly drawn: boolean }

const face = fc.constantFrom<DieFace>(1, 2, 3, 4, 5, 6)

const move: fc.Arbitrary<Move> = fc.oneof(
  {
    weight: 20,
    arbitrary: fc.record({
      kind: fc.constant('bet' as const),
      pick: fc.nat(),
      units: fc.integer({ min: 0, max: 6 }),
    }),
  },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('side' as const), pick: fc.nat() }) },
  { weight: 4, arbitrary: fc.constant({ kind: 'odds' as const }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('cut' as const), pick: fc.nat() }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('takeDown' as const), pick: fc.nat() }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('working' as const),
      pick: fc.nat(),
      value: fc.constantFrom(true, false, null),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant('deposit' as const),
      dollars: fc.integer({ min: 1, max: 300 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('depositBatch' as const),
      dollars: fc.integer({ min: 1, max: 300 }),
      pick: fc.nat(),
    }),
  },
  { weight: 5, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'clear' as const }) },
  {
    weight: 30,
    arbitrary: fc.record({
      kind: fc.constant('roll' as const),
      d1: face,
      d2: face,
      drawn: fc.boolean(),
    }),
  },
)

interface Reached {
  checks: number
  rolls: number
  undoneDeposits: number
  depositBatches: number
  restored: number
}

/** The shown figures equal the independent recomputation and the engine's ledger. */
function checkShown(state: GameState, where: string): void {
  const { cfg, session, view } = state
  if (cfg === null || session === null || view === null) throw new Error('no session')
  expect(view.phase, where).toBe('betting')
  const shown = selectSessionTotals(state)
  if (shown === null) throw new Error(`${where}: no meters`)
  const oracle = oracleMeters(session, cfg)
  const { ledger } = view.shown
  expect(shown.creditAdded, where).toBe(oracle.creditAdded)
  expect(shown.topUps, where).toStrictEqual(oracle.topUps)
  expect(shown.wagered, where).toBe(oracle.wagered)
  expect(shown.decisions, where).toBe(oracle.decisions)
  expect(shown.commission, where).toBe(oracle.commission)
  expect(shown.commissionParts, where).toStrictEqual({
    upfront: oracle.upfront,
    fromWins: oracle.fromWins,
    recollected: oracle.recollected,
  })
  expect(oracle.creditAdded, `${where}: deposits`).toBe(ledger.deposits)
  expect(oracle.commission, `${where}: vigPaid`).toBe(ledger.vigPaid)
  expect(oracle.wagered + oracle.notDecidedStakes, `${where}: wagered`).toBe(ledger.wagered)
}

/** Plays one move through the store, as the UI would. */
function playMove(store: StoreApi<GameState>, next: Move, reached: Reached): void {
  const state = store.getState()
  const { cfg, view } = state
  if (cfg === null || view === null) throw new Error('no session')
  const table = view.shown
  const pick = <T>(list: readonly T[], n: number): T | undefined =>
    list.length === 0 ? undefined : list[n % list.length]
  const openSpots = legalBets(table, cfg).filter((spot) => spot.canAdd === null)
  const addTo = (spot: (typeof openSpots)[number], units: number): Action => {
    const { increment } = typeLimits(cfg, spot.typeId, spot.number)
    const amount = Math.min(spot.maxAdd, spot.minAdd + increment * units)
    return {
      type: 'place',
      typeId: spot.typeId,
      ...(spot.number === null ? {} : { number: spot.number }),
      ...(spot.parentId === null ? {} : { parentId: spot.parentId }),
      amount: cents(amount),
    }
  }
  switch (next.kind) {
    case 'bet': {
      const spot = pick(openSpots, next.pick)
      if (spot !== undefined) state.dispatch(addTo(spot, next.units))
      return
    }
    case 'side': {
      const sides = legalBets(table, cfg, { sideBets: true }).filter(
        (spot) => spot.canAdd === null && cfg.sideBets.has(spot.typeId),
      )
      const spot = pick(sides, next.pick)
      if (spot !== undefined) state.dispatch(addTo(spot, 0))
      return
    }
    case 'odds': {
      const odds = maxOddsActionsFor(state, null)
      if (odds.length > 0) state.dispatch({ type: 'batch', actions: odds })
      return
    }
    case 'cut': {
      const bet = pick(table.bets, next.pick)
      if (bet === undefined) return
      const { increment } = typeLimits(cfg, bet.typeId, bet.number)
      state.dispatch({ type: 'setAmount', betId: bet.id, amount: cents(bet.amount - increment) })
      return
    }
    case 'takeDown': {
      const bet = pick(table.bets, next.pick)
      if (bet !== undefined) state.dispatch({ type: 'setAmount', betId: bet.id, amount: cents(0) })
      return
    }
    case 'working': {
      const bet = pick(table.bets, next.pick)
      if (bet !== undefined) {
        state.dispatch({ type: 'setWorking', betId: bet.id, working: next.value })
      }
      return
    }
    case 'deposit':
      state.deposit(cents(next.dollars * 100))
      return
    case 'depositBatch': {
      const spot = pick(openSpots, next.pick)
      const deposit: Action = { type: 'deposit', amount: cents(next.dollars * 100) }
      const result = state.dispatch({
        type: 'batch',
        actions: spot === undefined ? [deposit] : [deposit, addTo(spot, 0)],
      })
      if (result.ok) reached.depositBatches += 1
      return
    }
    case 'undo': {
      const last = state.session?.pending.at(-1)
      if (state.undoLast() && last?.type === 'deposit') reached.undoneDeposits += 1
      return
    }
    case 'clear':
      state.clearBets()
      return
    case 'roll': {
      const dice = next.drawn ? undefined : makeRoll(next.d1, next.d2)
      let outcome = state.beginRoll(dice)
      if (!outcome.ok && outcome.rejection.code === 'BELOW_MIN_TOTAL') {
        // Meet the round's minimum with a line bet, as a player would, and roll again.
        const line = openSpots.find((spot) => spot.typeId === 'pass' || spot.typeId === 'come')
        const short = Number(outcome.rejection.details.short ?? 0)
        if (line !== undefined) {
          const { increment } = typeLimits(cfg, line.typeId, line.number)
          const units = Math.ceil(Math.max(0, short - line.minAdd) / increment)
          store.getState().dispatch(addTo(line, units))
          outcome = store.getState().beginRoll(dice)
        }
      }
      if (!outcome.ok) return
      // Mid-roll the meters still read as before the roll.
      const during = store.getState()
      expect(selectSessionTotals(during)?.wagered).toBe(selectSessionTotals(state)?.wagered)
      during.reveal()
      store.getState().finishReveal()
      reached.rolls += 1
      return
    }
  }
}

describe('the live meters over random sessions (fast-check seed 20261028)', () => {
  const reached: Reached = {
    checks: 0,
    rolls: 0,
    undoneDeposits: 0,
    depositBatches: 0,
    restored: 0,
  }

  for (const [id, cfg] of Object.entries(COMPILED_PRESETS)) {
    it(
      `shows what the log and the ledger say on ${id}, live and restored`,
      { timeout: 60_000 },
      () => {
        fc.assert(
          fc.property(
            fc.string({ maxLength: 6 }),
            fc.array(move, { minLength: 1, maxLength: 40, size: 'max' }),
            (seed, moves) => {
              const store = startedStore(cfg, `live-meters-${seed}`)
              moves.forEach((next, index) => {
                playMove(store, next, reached)
                checkShown(store.getState(), `${id} move ${index} (${next.kind})`)
                reached.checks += 1
              })
              const { session } = store.getState()
              if (session === null) throw new Error('no session')
              const loaded = deserializeSession(serializeSession(session))
              if (!loaded.ok) throw new Error('the session does not load')
              const restored = createGameStore()
              restored.getState().restoreGame({ cfg, session: loaded.session, meta: null })
              expect(selectSessionTotals(restored.getState())).toStrictEqual(
                selectSessionTotals(store.getState()),
              )
              expect(restored.getState().committedMeters).toStrictEqual(
                store.getState().committedMeters,
              )
              reached.restored += 1
            },
          ),
          { seed: 20261028, numRuns: 20 },
        )
      },
    )
  }

  it('reached rolls, undone deposits and deposits inside batches', () => {
    expect(reached.restored).toBe(Object.keys(COMPILED_PRESETS).length * 20)
    expect(reached.rolls).toBeGreaterThan(100)
    expect(reached.undoneDeposits).toBeGreaterThan(0)
    expect(reached.depositBatches).toBeGreaterThan(0)
  })
})
