import type { MachineConfig } from '../config/compile.ts'
import type { Dice, Total } from '../core/dice.ts'
import { seedRng, type RngState } from '../core/rng.ts'
import { initialRound, type RoundState } from '../round/round.ts'
import type { BetId, BetInstance } from '../bets/types.ts'
import { newLedger, type Ledger } from './ledger.ts'

/** The last roll, and whether its dice were scripted (tests and e2e builds) rather than drawn. */
export interface LastRoll {
  readonly dice: Dice
  readonly scripted: boolean
}

/**
 * Everything about a table between actions (plan §4.9). It is plain JSON (no bigint, Map, Set or
 * class instances), so it can be hashed, stored, sent to a worker and replayed; `applyAction` never
 * changes it, and returns a new state instead.
 *
 * - `rng`: the dice stream. Only an unscripted roll advances it.
 * - `bets`: in placement order, so their ids ascend.
 * - `globalOff`: the machine's ON/OFF button: true switches the types in `/workingToggle/types`
 *   OFF, false switches them ON, and null leaves each bet to its default.
 * - `recentTotals`: the history panel, oldest first, at most `/flow/historyLength` long.
 * - `rebetBlocked`: don't types that cannot be bet again until the next come-out, after a bet on a
 *   number was reduced or removed under `rebetAfterRemove: nextCycle` (rules spec §5.1).
 * - `heldOff`: bets the machine holds OFF, in placement order: Interblock's place and buy bets
 *   placed right after a seven-out (`/afterSevenOut/newPlacedOff`), until Set bets On (or the
 *   point, where `until: pointEstablished`). The hold is the machine's, not the bet's own setting:
 *   a bet set ON by itself works, and set back to its default (`working: null`) is held again
 *   (rules spec §2.4). Every table the engine makes has it; a table built by hand may leave it out
 *   for no holds (`heldOffOf`).
 */
export interface TableState {
  readonly v: 1
  readonly configHash: string
  readonly rng: RngState
  readonly round: RoundState
  readonly bets: readonly BetInstance[]
  /** The sequence number the next bet's id takes. */
  readonly nextBetSeq: number
  readonly ledger: Ledger
  readonly globalOff: boolean | null
  readonly lastRoll: LastRoll | null
  readonly recentTotals: readonly Total[]
  readonly rebetBlocked: readonly string[]
  readonly heldOff?: readonly BetId[]
}

/** A table at the session start: the starting bankroll, no bets, and dice seeded from `seed`. */
export function newTable(cfg: MachineConfig, seed: string): TableState {
  return {
    v: 1,
    configHash: cfg.configHash,
    rng: seedRng(seed),
    round: initialRound(),
    bets: [],
    nextBetSeq: 1,
    ledger: newLedger(cfg.startingBankroll),
    globalOff: null,
    lastRoll: null,
    recentTotals: [],
    rebetBlocked: [],
    heldOff: [],
  }
}

/** The bets the machine holds OFF (`TableState.heldOff`); none when the table leaves it out. */
export function heldOffOf(state: TableState): readonly BetId[] {
  return state.heldOff ?? []
}

export function findBet(state: TableState, id: BetId): BetInstance | undefined {
  return state.bets.find((bet) => bet.id === id)
}

/** The odds bets that back `parent`. */
export function oddsOf(state: TableState, parent: BetId): BetInstance[] {
  return state.bets.filter((bet) => bet.parentId === parent)
}
