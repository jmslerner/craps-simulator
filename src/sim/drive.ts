import {
  applyAction,
  cents,
  legalBets,
  newTable,
  resolveType,
  typeLimits,
  type Action,
  type Cents,
  type LegalBet,
  type MachineConfig,
  type Rejection,
  type RngState,
  type TableState,
} from '../engine/index.ts'
import { nextBelow } from './uniform.ts'

/**
 * Full-reducer Monte Carlo sessions (plan §9 item 9): whole sessions played through `applyAction`
 * with the invariants ON (the reducer's default), so solver-independent wiring bugs — order,
 * working flags, travel, the ledger — surface as an invariant violation or a thrown error. Dice
 * come from the table's own stream (unscripted rolls); the random betting choices come from a
 * separate engine RNG stream the caller seeds.
 *
 * Two runners:
 * - `playRandomRolls` plays random legal actions between rolls, for breadth: it asserts nothing
 *   beyond what the invariants and the final ledger identity catch, and reports what it did.
 * - `playFlatBet` plays one bet type flat (the same stake, placed whenever its spot is free, and
 *   nothing else), so every decision of that bet is an independent draw from the exact per-decision
 *   distribution. The tests compare the sessions' total house net with `decisionExpectation`.
 *   After `minRolls` rolls it keeps rolling until the open decision resolves, so no decision is
 *   cut off mid-flight (a censored last decision would bias the sample toward quick outcomes).
 */

/** What one random session did; the invariants checked every action along the way. */
export interface RandomSessionTally {
  readonly rolls: number
  readonly accepted: number
  readonly rejected: number
  readonly settlements: number
  readonly deposits: number
  /** `deposits − (bankroll + Σ bets + houseNet)` on the final table: 0 when the ledger balances. */
  readonly finalImbalance: number
}

/** What one flat-bet session did. */
export interface FlatBetTally {
  readonly rolls: number
  /** Settlements of the flat bet: complete decisions, the drained last one included. */
  readonly decisions: number
  /** The session's final house net, in cents: exactly the sum of the decisions' losses. */
  readonly houseNet: Cents
  readonly deposits: number
}

const DEPOSIT = cents(100_000)

/**
 * One session of `rolls` rolls on a fresh table seeded with `seed`, with up to three random legal
 * betting actions before each roll, drawn from `choices`. Returns the tally and the choice stream's
 * state after the run. Throws on an invariant violation, an unexpected roll refusal, or a session
 * that cannot meet the machine's roll minimum.
 */
export function playRandomRolls(
  cfg: MachineConfig,
  seed: string,
  rolls: number,
  choices: RngState,
): [RandomSessionTally, RngState] {
  let state = newTable(cfg, seed)
  let stream = choices
  let accepted = 0
  let rejected = 0
  let settlements = 0
  let deposits = 0
  const apply = (action: Action): boolean => {
    const result = applyAction(state, action, cfg)
    if (!result.ok) {
      rejected++
      return false
    }
    accepted++
    state = result.state
    settlements += result.events.filter((event) => event.type === 'betResolved').length
    if (action.type === 'deposit') deposits++
    return true
  }
  for (let roll = 0; roll < rolls; roll++) {
    const [moves, afterCount] = nextBelow(4, stream)
    stream = afterCount
    for (let move = 0; move < moves; move++) {
      const [action, afterMove] = randomAction(state, cfg, stream)
      stream = afterMove
      if (action !== null) apply(action)
    }
    // Roll; on a refusal for the round's minimum, top the table up and try again.
    for (let tries = 0; ; tries++) {
      const result = applyAction(state, { type: 'roll' }, cfg)
      if (result.ok) {
        state = result.state
        settlements += result.events.filter((event) => event.type === 'betResolved').length
        break
      }
      if (tries >= 6) throw new Error(`Roll still refused: ${result.rejection.code}`)
      const top = topUp(state, cfg, result.rejection)
      if (top === null) throw new Error(`Roll refused: ${result.rejection.code}`)
      if (!apply(top)) {
        apply({ type: 'deposit', amount: DEPOSIT })
        if (!apply(top)) throw new Error(`Cannot meet the roll minimum on ${cfg.id}`)
      }
    }
  }
  const tally: RandomSessionTally = {
    rolls,
    accepted,
    rejected,
    settlements,
    deposits,
    finalImbalance: imbalanceOf(state),
  }
  return [tally, stream]
}

/**
 * One flat-bet session: `typeId` at `amount`, placed whenever its spot is empty, rolled `minRolls`
 * times and then drained until the last decision resolves. Only line bets on the line and one-roll
 * bets qualify (their spot is the type itself, and they always work, so every decision matches the
 * bet's typical start exactly).
 */
export function playFlatBet(
  cfg: MachineConfig,
  typeId: string,
  amount: Cents,
  seed: string,
  minRolls: number,
): FlatBetTally {
  let state = newTable(cfg, seed)
  let rolls = 0
  let decisions = 0
  let deposits = 0
  const maxRolls = minRolls + 1_000
  while (rolls < minRolls || state.bets.length > 0) {
    if (rolls >= maxRolls) throw new Error(`${typeId} was still undecided after ${maxRolls} rolls`)
    if (state.bets.length === 0 && rolls < minRolls) {
      const place: Action = { type: 'place', typeId, amount }
      let placed = applyAction(state, place, cfg)
      if (!placed.ok) {
        const topped = applyAction(state, { type: 'deposit', amount: DEPOSIT }, cfg)
        if (!topped.ok) throw new Error(`Deposit refused: ${topped.rejection.code}`)
        state = topped.state
        deposits++
        placed = applyAction(state, place, cfg)
        if (!placed.ok) throw new Error(`${typeId} refused: ${placed.rejection.code}`)
      }
      state = placed.state
    }
    const result = applyAction(state, { type: 'roll' }, cfg)
    if (!result.ok) throw new Error(`Roll refused: ${result.rejection.code}`)
    state = result.state
    rolls++
    for (const event of result.events) {
      if (event.type !== 'betResolved') continue
      if (event.trace.typeId !== typeId) throw new Error(`A stray ${event.trace.typeId} settled`)
      decisions++
    }
  }
  const off = imbalanceOf(state)
  if (off !== 0) throw new Error(`The final ledger is off by ${off}¢`)
  return { rolls, decisions, houseNet: state.ledger.houseNet, deposits }
}

/**
 * A random legal action for the table as it stands, or null when the drawn kind has no target:
 * mostly additions on spots `legalBets` offers, with working toggles, take-downs and deposits
 * mixed in. Every action is applied for real, so a refusal is itself exercise for the reducer.
 */
function randomAction(
  state: TableState,
  cfg: MachineConfig,
  stream: RngState,
): [Action | null, RngState] {
  const [kind, afterKind] = nextBelow(8, stream)
  let current = afterKind
  if (kind < 4) {
    const spots = legalBets(state, cfg).filter((spot) => spot.canAdd === null)
    if (spots.length === 0) return [null, current]
    const [pick, afterPick] = nextBelow(spots.length, current)
    const [units, afterUnits] = nextBelow(16, afterPick)
    current = afterUnits
    const spot = spots[pick]
    if (spot === undefined) return [null, current]
    const { increment } = typeLimits(cfg, spot.typeId, spot.number)
    const add = Math.min(spot.minAdd + increment * units, spot.maxAdd)
    if (spot.betId !== null) {
      return [{ type: 'setAmount', betId: spot.betId, amount: cents(spot.amount + add) }, current]
    }
    const action: Action = { type: 'place', typeId: spot.typeId, amount: cents(add) }
    if (spot.parentId !== null) return [{ ...action, parentId: spot.parentId }, current]
    return [spot.number === null ? action : { ...action, number: spot.number }, current]
  }
  if (kind === 4 || kind === 5) {
    const [setting, afterSetting] = nextBelow(3, current)
    current = afterSetting
    const value = setting === 0 ? true : setting === 1 ? false : null
    if (kind === 5) return [{ type: 'setGlobalWorking', off: value }, current]
    if (state.bets.length === 0) return [null, current]
    const [pick, afterPick] = nextBelow(state.bets.length, current)
    current = afterPick
    const bet = state.bets[pick]
    if (bet === undefined) return [null, current]
    return [{ type: 'setWorking', betId: bet.id, working: value }, current]
  }
  if (kind === 6) {
    if (state.bets.length === 0) return [null, current]
    const [pick, afterPick] = nextBelow(state.bets.length, current)
    current = afterPick
    const bet = state.bets[pick]
    if (bet === undefined) return [null, current]
    return [{ type: 'setAmount', betId: bet.id, amount: cents(0) }, current]
  }
  return [{ type: 'deposit', amount: cents(50_000) }, current]
}

/**
 * An addition that moves the table toward the roll minimum after a `BELOW_MIN_TOTAL` refusal: the
 * short bet pressed under a `perBet` minimum, or, under a `totalRound` one, the largest covering
 * addition on a spot that is sure to count — a one-roll bet or the phase's line bet, which always
 * work (`countOff` machines do not count a bet that is OFF). Null for any other refusal or when no
 * spot can take an addition; the caller deposits credit and retries, so a credit-capped `maxAdd`
 * resolves itself.
 */
function topUp(state: TableState, cfg: MachineConfig, refusal: Rejection): Action | null {
  if (refusal.code !== 'BELOW_MIN_TOTAL') return null
  const short = Number(refusal.details.short)
  const roundUp = (increment: number) => short + ((increment - (short % increment)) % increment)
  if (refusal.details.scope === 'perBet') {
    const target = state.bets.find((bet) => bet.id === refusal.details.betId)
    if (target === undefined) return null
    const { increment } = typeLimits(cfg, target.typeId, target.number)
    const amount = cents(target.amount + roundUp(increment))
    return { type: 'setAmount', betId: target.id, amount }
  }
  const alwaysWorks = (typeId: string): boolean => {
    const family = resolveType(cfg, typeId)?.type.family
    return family === 'oneRoll' || family === 'composite' || family === 'line'
  }
  const spots = legalBets(state, cfg).filter(
    (spot) => spot.canAdd === null && alwaysWorks(spot.typeId),
  )
  let best: { readonly spot: LegalBet; readonly add: number } | null = null
  for (const spot of spots) {
    const { increment } = typeLimits(cfg, spot.typeId, spot.number)
    const add = Math.min(Math.max(roundUp(increment), spot.minAdd), spot.maxAdd)
    if (best === null || add > best.add) best = { spot, add }
    if (add >= short) {
      best = { spot, add }
      break
    }
  }
  if (best === null) return null
  const { spot, add } = best
  if (spot.betId !== null) {
    return { type: 'setAmount', betId: spot.betId, amount: cents(spot.amount + add) }
  }
  return { type: 'place', typeId: spot.typeId, amount: cents(add) }
}

/** `deposits − (bankroll + Σ bets + houseNet)`: 0 when the ledger balances (plan §4.7). */
function imbalanceOf(state: TableState): number {
  const onTable = state.bets.reduce((sum, bet) => sum + bet.amount, 0)
  return state.ledger.deposits - (state.ledger.bankroll + onTable + state.ledger.houseNet)
}
