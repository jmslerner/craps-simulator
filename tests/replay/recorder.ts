import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import { cents } from '../../src/engine/core/money.ts'
import { nextUint32, seedRng } from '../../src/engine/core/rng.ts'
import { legalBets, type LegalBet } from '../../src/engine/bets/legal.ts'
import { typeLimits } from '../../src/engine/bets/limits.ts'
import { resolveType } from '../../src/engine/bets/registry.ts'
import type { BetType } from '../../src/engine/bets/types.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import type { GameEvent } from '../../src/engine/table/events.ts'
import {
  doubleBets,
  maxOutOdds,
  pressBet,
  repeatBets,
  takeDownAll,
  winsOf,
} from '../../src/engine/session/macros.ts'
import {
  dispatchBetting,
  newSession,
  rollWindow,
  type WindowedSession,
} from '../../src/engine/session/window.ts'
import { addTo, lineFor, topUp } from './bets.ts'

/**
 * The player behind the pinned replay fixture, tests/replay/fixtures/crapless-200.json (plan §10
 * M5): 200 rolls on the default machine, craplessBubble, with dice drawn from the session seed.
 * Before every roll the player makes at least one bet: line bets and odds (often the maximum),
 * place and buy bets in the usual units, hardways, props and composites, presses of the last roll's
 * winners, Double, Repeat, take-downs and the Set bets Off/On button. Credit is added whenever it
 * runs low, and now and then besides, so the log carries deposits. When the round's minimum
 * refuses a roll, the player adds the line bet it lacks and rolls again.
 *
 * Its choices come from their own seeded stream, so `recordCrapless200()` plays the same session
 * every time on a given engine. Run `node tests/replay/record.ts` to write the fixture; only do so
 * together with an ENGINE_VERSION bump (see tests/replay/replay.test.ts).
 */

export const FIXTURE_ROLLS = 200
export const FIXTURE_SEED = 'crapless-200'
const PLAYER_SEED = 'crapless-200 player'

type Choice =
  | 'line'
  | 'odds'
  | 'number'
  | 'hard'
  | 'prop'
  | 'press'
  | 'double'
  | 'repeat'
  | 'takeDown'
  | 'takeDownAll'
  | 'button'

/** What the player does, by weight. */
const CHOICES: readonly (readonly [Choice, number])[] = [
  ['line', 18],
  ['odds', 14],
  ['number', 24],
  ['hard', 8],
  ['prop', 12],
  ['press', 8],
  ['double', 3],
  ['repeat', 5],
  ['takeDown', 4],
  ['takeDownAll', 1],
  ['button', 3],
]

export function recordCrapless200(): WindowedSession {
  const cfg = compileConfig(PRESETS.craplessBubble)
  let session = newSession(cfg, FIXTURE_SEED)
  let stream = seedRng(PLAYER_SEED)
  /** A whole number from 0 to n − 1, from the player's own stream. */
  const choose = (n: number): number => {
    const [value, next] = nextUint32(stream)
    stream = next
    return value % n
  }
  let lastRoll: readonly GameEvent[] = []
  /** Dispatches actions; returns whether any of them changed the table. */
  const act = (actions: readonly Action[]): boolean => {
    let changed = false
    for (const action of actions) {
      const result = dispatchBetting(session, action, cfg)
      if (result.ok && result.session !== session) {
        session = result.session
        changed = true
      }
    }
    return changed
  }

  for (let index = 0; index < FIXTURE_ROLLS; index++) {
    const { bankroll } = session.state.ledger
    if (bankroll < 15_000 || index % 50 === 25) {
      act([{ type: 'deposit', amount: cents(10_000 * (1 + choose(3))) }])
    }
    const moves = 1 + choose(3)
    let bet = false
    for (let move = 0; move < moves || !bet; move++) {
      if (move > 40) throw new Error(`window ${index}: no bet could be made`)
      const choice = weighted(choose)
      const changed = act(movesFor(choice, session, lastRoll, cfg, choose))
      if (changed && choice !== 'button') bet = true
    }
    let rolled = rollWindow(session, cfg)
    if (!rolled.ok) {
      const top = topUp(session.state, cfg, rolled.rejection)
      if (top === null || !act([top])) throw new Error(`window ${index}: cannot meet the minimum`)
      rolled = rollWindow(session, cfg)
      if (!rolled.ok) throw new Error(`window ${index}: ${rolled.rejection.code}`)
    }
    session = rolled.session
    lastRoll = rolled.events
  }
  return session
}

function weighted(choose: (n: number) => number): Choice {
  const total = CHOICES.reduce((sum, [, weight]) => sum + weight, 0)
  let draw = choose(total)
  for (const [choice, weight] of CHOICES) {
    if (draw < weight) return choice
    draw -= weight
  }
  return 'line'
}

/** The actions for one choice on the session's table; none when the choice does not apply. */
function movesFor(
  choice: Choice,
  session: WindowedSession,
  lastRoll: readonly GameEvent[],
  cfg: MachineConfig,
  choose: (n: number) => number,
): readonly Action[] {
  const { state } = session
  const open = legalBets(state, cfg).filter((spot) => spot.canAdd === null)
  const ofFamily = (...families: BetType['family'][]) =>
    open.filter((spot) => {
      const family = resolveType(cfg, spot.typeId)?.type.family
      return family !== undefined && families.includes(family)
    })
  const pickFrom = <T>(list: readonly T[]): T | undefined =>
    list.length === 0 ? undefined : list[choose(list.length)]
  /** `units` of `unit` on a spot, kept within what it takes and on its increment. */
  const sized = (spot: LegalBet | undefined, unit: number, units: number): readonly Action[] => {
    if (spot === undefined) return []
    const { increment } = typeLimits(cfg, spot.typeId, spot.number)
    const wanted = Math.min(spot.maxAdd, Math.max(spot.minAdd, unit * units))
    return [addTo(spot, wanted - (wanted % increment), cfg)]
  }
  switch (choice) {
    case 'line': {
      const typeId = lineFor(state, cfg)
      const spot = open.find((s) => s.typeId === typeId && s.number === null)
      return sized(spot, 500, 1 + choose(4))
    }
    case 'odds': {
      const spots = open.filter((s) => s.parentId !== null)
      const spot = pickFrom(spots)
      if (spot === undefined || spot.parentId === null) return []
      return choose(2) === 0
        ? maxOutOdds(state, spot.parentId, cfg)
        : sized(spot, 500, 1 + choose(2))
    }
    case 'number': {
      const spot = pickFrom(ofFamily('numberVsSeven'))
      if (spot === undefined) return []
      const unit =
        spot.typeId === 'buy' ? 2_500 : spot.number === 6 || spot.number === 8 ? 600 : 500
      return sized(spot, unit, 1 + choose(3))
    }
    case 'hard':
      return sized(pickFrom(ofFamily('hardway')), 100, 1 + choose(5))
    case 'prop': {
      const spot = pickFrom(ofFamily('oneRoll', 'composite'))
      return sized(spot, spot?.minAdd ?? 0, 1 + choose(3))
    }
    case 'press': {
      const up = new Set(state.bets.map((b) => b.id))
      const winner = pickFrom([...winsOf(lastRoll)].filter(([id]) => up.has(id)))
      return winner === undefined ? [] : pressBet(state, winner[0], winner[1], cfg)
    }
    case 'double':
      return state.ledger.bankroll > 30_000 ? doubleBets(state, cfg) : []
    case 'repeat':
      return repeatBets(state, session.lastWindow, cfg)
    case 'takeDown': {
      const spots = legalBets(state, cfg).filter((s) => s.betId !== null && s.canRemove === null)
      const spot = pickFrom(spots)
      if (spot === undefined || spot.betId === null) return []
      return [{ type: 'setAmount', betId: spot.betId, amount: cents(0) }]
    }
    case 'takeDownAll':
      return takeDownAll(state, cfg)
    case 'button':
      return [{ type: 'setGlobalWorking', off: state.globalOff === true ? null : true }]
  }
}
