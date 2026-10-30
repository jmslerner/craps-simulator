import fc from 'fast-check'
import {
  cents,
  clearWindow,
  dispatchBetting,
  doubleBets,
  legalBets,
  makeRoll,
  maxOutOdds,
  newSession,
  pressBet,
  repeatBets,
  rollWindow,
  smallestBet,
  takeDownAll,
  typeLimits,
  undo,
  winsOf,
  type Action,
  type DieFace,
  type GameEvent,
  type MachineConfig,
  type WindowedSession,
} from '../../src/engine/index.ts'
import { addTo, lineFor, topUp } from '../replay/bets.ts'

/**
 * Random sessions for the session-summary properties (M13, plan §5.7): play driven through the
 * betting window (`dispatchBetting`, `undo`, `clearWindow`, `rollWindow`) exactly as the store
 * drives it, with the moves the summary must account for weighted in — side bets whenever their
 * window is open, credit added mid-hand, presses, cuts, take-downs, ON/OFF switches, the macros,
 * odds, undo — and dice scripted or drawn from the session's own stream. Refused moves change
 * nothing (the window keeps only what the table accepted), and a roll refused for the round's
 * minimum is topped up once, as `tests/replay/play.ts` does. Engine only: no Vitest here.
 */

type Size = 'min' | 'units' | 'max'

export type SummaryMove =
  | { readonly kind: 'bet'; readonly pick: number; readonly size: Size; readonly units: number }
  | { readonly kind: 'side'; readonly pick: number; readonly units: number }
  | { readonly kind: 'line'; readonly units: number }
  | { readonly kind: 'odds' }
  | { readonly kind: 'cut'; readonly pick: number; readonly units: number }
  | { readonly kind: 'takeDown'; readonly pick: number }
  | { readonly kind: 'working'; readonly pick: number; readonly value: boolean | null }
  | { readonly kind: 'global'; readonly value: boolean | null }
  | { readonly kind: 'deposit'; readonly dollars: number }
  | {
      readonly kind: 'macro'
      readonly macro: 'repeat' | 'double' | 'press' | 'takeDownAll'
      readonly pick: number
    }
  | { readonly kind: 'undo' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'roll'; readonly d1: DieFace; readonly d2: DieFace; readonly drawn: boolean }

const face = fc.constantFrom<DieFace>(1, 2, 3, 4, 5, 6)
const setting = fc.constantFrom(true, false, null)

/** One move: about a third are rolls, half of those drawn from the table's stream. */
export const summaryMove: fc.Arbitrary<SummaryMove> = fc.oneof(
  {
    weight: 24,
    arbitrary: fc.record({
      kind: fc.constant('bet' as const),
      pick: fc.nat(),
      size: fc.constantFrom<Size>('min', 'units', 'units', 'max'),
      units: fc.integer({ min: 0, max: 12 }),
    }),
  },
  {
    weight: 8,
    arbitrary: fc.record({
      kind: fc.constant('side' as const),
      pick: fc.nat(),
      units: fc.integer({ min: 0, max: 4 }),
    }),
  },
  {
    weight: 8,
    arbitrary: fc.record({
      kind: fc.constant('line' as const),
      units: fc.integer({ min: 1, max: 4 }),
    }),
  },
  { weight: 4, arbitrary: fc.constant({ kind: 'odds' as const }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('cut' as const),
      pick: fc.nat(),
      units: fc.integer({ min: 1, max: 6 }),
    }),
  },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('takeDown' as const), pick: fc.nat() }) },
  {
    weight: 3,
    arbitrary: fc.record({ kind: fc.constant('working' as const), pick: fc.nat(), value: setting }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('global' as const), value: setting }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('deposit' as const),
      dollars: fc.integer({ min: 1, max: 400 }),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('macro' as const),
      macro: fc.constantFrom(
        'repeat' as const,
        'double' as const,
        'press' as const,
        'takeDownAll' as const,
      ),
      pick: fc.nat(),
    }),
  },
  { weight: 3, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'clear' as const }) },
  {
    weight: 34,
    arbitrary: fc.record({
      kind: fc.constant('roll' as const),
      d1: face,
      d2: face,
      drawn: fc.boolean(),
    }),
  },
)

/** What the runs did, so a test can insist they reached what the summary must account for. */
export interface SummaryPlayReport {
  sessions: number
  rolls: number
  /** Side bets placed (accepted actions that put one up). */
  sideBets: number
  /** Deposits accepted while a point was on: credit added mid-hand. */
  depositsMidHand: number
  deposits: number
  takeDowns: number
  switches: number
  macros: number
  undos: number
}

export function newSummaryReport(): SummaryPlayReport {
  return {
    sessions: 0,
    rolls: 0,
    sideBets: 0,
    depositsMidHand: 0,
    deposits: 0,
    takeDowns: 0,
    switches: 0,
    macros: 0,
    undos: 0,
  }
}

/** Plays `moves` on a new session of `cfg`; returns the session (its log and open window). */
export function playSummarySession(
  cfg: MachineConfig,
  seed: string,
  moves: readonly SummaryMove[],
  report: SummaryPlayReport,
): WindowedSession {
  let session = newSession(cfg, seed)
  let lastRoll: readonly GameEvent[] = []
  report.sessions += 1
  const dispatch = (action: Action | null): boolean => {
    if (action === null) return false
    const result = dispatchBetting(session, action, cfg)
    if (!result.ok || result.session === session) return false
    session = result.session
    return true
  }
  const pick = <T>(list: readonly T[], n: number): T | undefined =>
    list.length === 0 ? undefined : list[n % list.length]
  for (const next of moves) {
    const { state } = session
    switch (next.kind) {
      case 'bet': {
        const spot = pick(
          legalBets(state, cfg).filter((s) => s.canAdd === null),
          next.pick,
        )
        if (spot === undefined) break
        const { increment } = typeLimits(cfg, spot.typeId, spot.number)
        const steps = Math.floor((spot.maxAdd - spot.minAdd) / increment)
        const add =
          next.size === 'min'
            ? spot.minAdd
            : next.size === 'max'
              ? spot.maxAdd
              : spot.minAdd + increment * (next.units % (steps + 1))
        dispatch(addTo(spot, add, cfg))
        break
      }
      case 'side': {
        const spots = legalBets(state, cfg, { sideBets: true }).filter(
          (s) => s.canAdd === null && cfg.sideBets.has(s.typeId),
        )
        const spot = pick(spots, next.pick)
        if (spot === undefined) break
        const { increment } = typeLimits(cfg, spot.typeId, spot.number)
        const add = Math.min(spot.maxAdd, spot.minAdd + increment * next.units)
        if (dispatch(addTo(spot, add, cfg))) report.sideBets += 1
        break
      }
      case 'line': {
        const line = lineFor(state, cfg)
        if (line === null) break
        const amount = smallestBet(typeLimits(cfg, line)) * next.units
        dispatch({ type: 'place', typeId: line, amount: cents(amount) })
        break
      }
      case 'odds': {
        const odds = maxOutOdds(state, null, cfg)
        if (odds.length > 0) dispatch({ type: 'batch', actions: odds })
        break
      }
      case 'cut': {
        const target = pick(state.bets, next.pick)
        if (target === undefined) break
        const { increment } = typeLimits(cfg, target.typeId, target.number)
        const amount = cents(Math.max(0, target.amount - next.units * increment))
        dispatch({ type: 'setAmount', betId: target.id, amount })
        break
      }
      case 'takeDown': {
        const target = pick(state.bets, next.pick)
        if (target === undefined) break
        if (dispatch({ type: 'setAmount', betId: target.id, amount: cents(0) })) {
          report.takeDowns += 1
        }
        break
      }
      case 'working': {
        const target = pick(state.bets, next.pick)
        if (target === undefined) break
        if (dispatch({ type: 'setWorking', betId: target.id, working: next.value })) {
          report.switches += 1
        }
        break
      }
      case 'global':
        if (dispatch({ type: 'setGlobalWorking', off: next.value })) report.switches += 1
        break
      case 'deposit': {
        const midHand = state.round.phase.kind === 'point'
        if (dispatch({ type: 'deposit', amount: cents(next.dollars * 100) })) {
          report.deposits += 1
          if (midHand) report.depositsMidHand += 1
        }
        break
      }
      case 'macro': {
        const actions = macroActions(next.macro, next.pick, session, lastRoll, cfg)
        if (actions.length > 0 && dispatch({ type: 'batch', actions })) report.macros += 1
        break
      }
      case 'undo': {
        const undone = undo(session, cfg)
        if (undone !== null) {
          session = undone
          report.undos += 1
        }
        break
      }
      case 'clear':
        session = clearWindow(session, cfg)
        break
      case 'roll': {
        const dice = next.drawn ? undefined : makeRoll(next.d1, next.d2)
        let rolled = rollWindow(session, cfg, dice)
        if (!rolled.ok && rolled.rejection.code === 'BELOW_MIN_TOTAL') {
          if (dispatch(topUp(session.state, cfg, rolled.rejection))) {
            rolled = rollWindow(session, cfg, dice)
          }
        }
        if (rolled.ok) {
          session = rolled.session
          lastRoll = rolled.events
          report.rolls += 1
        }
        break
      }
    }
  }
  return session
}

function macroActions(
  macro: 'repeat' | 'double' | 'press' | 'takeDownAll',
  pickIndex: number,
  session: WindowedSession,
  lastRoll: readonly GameEvent[],
  cfg: MachineConfig,
): readonly Action[] {
  const { state } = session
  switch (macro) {
    case 'repeat':
      return repeatBets(state, session.lastWindow, cfg)
    case 'double':
      return doubleBets(state, cfg)
    case 'takeDownAll':
      return takeDownAll(state, cfg)
    case 'press': {
      const wins = [...winsOf(lastRoll)].filter(([id]) => state.bets.some((b) => b.id === id))
      const won = wins[pickIndex % Math.max(wins.length, 1)]
      return won === undefined ? [] : pressBet(state, won[0], won[1], cfg)
    }
  }
}
