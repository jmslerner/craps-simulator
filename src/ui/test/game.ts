import {
  cents,
  dispatchBetting,
  legalBets,
  makeRoll,
  newSession,
  rollWindow,
} from '../../engine/index.ts'
import type {
  Action,
  Dice,
  GameEvent,
  MachineConfig,
  WindowRecord,
  WindowedSession,
} from '../../engine/index.ts'
import { COMPILED_PRESETS } from '../state/machineStore.ts'

/**
 * Engine-driving helpers for the ui and persistence tests: tiny wrappers that throw on a refusal,
 * so a test reads as the play it scripts. The machine is the shared compiled crapless preset; dice
 * are scripted (`makeRoll`) or drawn from the session's seed, so every test is reproducible.
 */

export const CRAPLESS: MachineConfig = COMPILED_PRESETS.craplessBubble

export function testSession(seed = 'ui-test-seed', cfg: MachineConfig = CRAPLESS): WindowedSession {
  return newSession(cfg, seed)
}

/** Applies a betting action the test expects to be accepted. */
export function bet(
  session: WindowedSession,
  action: Action,
  cfg: MachineConfig = CRAPLESS,
): WindowedSession {
  const result = dispatchBetting(session, action, cfg)
  if (!result.ok) {
    throw new Error(`test bet refused: ${result.rejection.code} ${JSON.stringify(action)}`)
  }
  return result.session
}

export function placePass(
  session: WindowedSession,
  amount = 500,
  cfg: MachineConfig = CRAPLESS,
): WindowedSession {
  return bet(session, { type: 'place', typeId: 'pass', amount: cents(amount) }, cfg)
}

export function placeSix(
  session: WindowedSession,
  amount = 600,
  cfg: MachineConfig = CRAPLESS,
): WindowedSession {
  return bet(session, { type: 'place', typeId: 'place', number: 6, amount: cents(amount) }, cfg)
}

export interface TestRoll {
  readonly session: WindowedSession
  readonly events: readonly GameEvent[]
  readonly record: WindowRecord
}

/** Rolls (scripted when `dice` is given) and throws when the machine refuses the roll. */
export function roll(
  session: WindowedSession,
  dice?: readonly [number, number],
  cfg: MachineConfig = CRAPLESS,
): TestRoll {
  const result = rollWindow(session, cfg, dice === undefined ? undefined : makeRoll(...dice))
  if (!result.ok) throw new Error(`test roll refused: ${result.rejection.code}`)
  return { session: result.session, events: result.events, record: result.record }
}

/**
 * Plays `count` seeded rolls, keeping a pass bet up (and credit topped up) so every roll meets the
 * machine's minimum: enough to grow a multi-chunk log without scripting 100 windows by hand.
 */
export function playRolls(
  session: WindowedSession,
  count: number,
  cfg: MachineConfig = CRAPLESS,
): WindowedSession {
  let current = session
  for (let index = 0; index < count; index++) {
    if (current.state.ledger.bankroll < 2_000) {
      current = bet(current, { type: 'deposit', amount: cents(50_000) }, cfg)
    }
    const pass = legalBets(current.state, cfg).find((spot) => spot.typeId === 'pass')
    if (pass !== undefined && pass.betId === null && pass.canAdd === null) {
      // Enough pass to meet the machine's round minimum on its own.
      const minimum = cfg.limits.minTotal?.amount ?? pass.minAdd
      const amount = Math.min(Math.max(pass.minAdd, minimum), pass.maxAdd)
      current = bet(current, { type: 'place', typeId: 'pass', amount: cents(amount) }, cfg)
    }
    current = roll(current, undefined, cfg).session
  }
  return current
}

/** The dice pair `d1-d2`, for scripted expectations. */
export function dice(d1: number, d2: number): Dice {
  return makeRoll(d1, d2)
}
