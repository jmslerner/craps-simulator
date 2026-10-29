import fc from 'fast-check'
import { expect } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { rollDice, type Dice } from '../../src/engine/core/dice.ts'
import { hashJson } from '../../src/engine/core/hash.ts'
import { cents } from '../../src/engine/core/money.ts'
import { seedRng } from '../../src/engine/core/rng.ts'
import { legalBets, type LegalBet } from '../../src/engine/bets/legal.ts'
import { maxOdds, smallestBet, typeLimits } from '../../src/engine/bets/limits.ts'
import { resolveType } from '../../src/engine/bets/registry.ts'
import type { BetInstance, Rejection } from '../../src/engine/bets/types.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import type { GameEvent } from '../../src/engine/table/events.ts'
import type { Ledger } from '../../src/engine/table/ledger.ts'
import { applyAction, validateAction } from '../../src/engine/table/reducer.ts'
import { newTable, type TableState } from '../../src/engine/table/state.ts'
import { factsFrom, type MachineFacts } from '../oracle/machineFacts.ts'
import { refMaxOdds } from '../oracle/referenceRules.ts'
import {
  engineActionFor,
  intentOrBatch,
  newCoverage,
  recordResult,
  type BatchIntent,
  type Coverage,
  type Intent,
} from './actions.ts'

/**
 * The engine properties of plan §9 item 6 that M4d owns, checked on seeded random sessions from
 * the shared generator (`actions.ts`), after every action:
 *
 * - **Rejected actions change nothing**: `applyAction` never changes the table it is given, and a
 *   refused action leaves it deep-equal to before; `validateAction` (the dry run) gives the same
 *   answer as the action itself.
 * - **Money conservation**: the ledger moves exactly as the action's events say (deposits, stakes,
 *   commission, settlements), `deposits = bankroll + Σ bets + houseNet`, and the bankroll is never
 *   negative.
 * - **Contract immutability**: every change the rules spec forbids on a bet (§3.1: pass and come on
 *   a number; don't bets per `onNumber`, never increased) is refused with `CONTRACT_BET`, and no
 *   change it allows is.
 * - **Odds ≤ maxOdds**, the engine's cap and the reference oracle's (`refMaxOdds`, §4.4), which
 *   must agree.
 * - **JSON round trip** of the table.
 * - **Same seed, same dice**: unscripted rolls draw the seed's dice stream in order, untouched by
 *   scripted or refused rolls; replaying the accepted actions on a fresh table with the same seed
 *   gives the same table.
 * - **legalBets agrees with validateAction** (`checkLegal`), every `legalEvery` actions.
 */

export interface SessionReport {
  readonly preset: PresetId
  actions: number
  accepted: number
  rejected: number
  /** Changes tried on bets the rules spec locks, all refused with `CONTRACT_BET`. */
  contractRefusals: number
  /** Odds bets checked against both caps. */
  oddsChecked: number
  /** Unscripted rolls checked against the seed's dice stream. */
  unscripted: number
  /** Tables whose `legalBets` was checked, and the spots on them. */
  legalTables: number
  legalSpots: number
  readonly coverage: Coverage
}

export interface SessionOptions {
  /** Check `legalBets` on every `legalEvery`th table (0: never). */
  readonly legalEvery?: number
  readonly seed?: number
}

/** Runs `numRuns` sessions of up to `maxActions` actions on preset `id`; throws on a violation. */
export function checkSessions(
  id: PresetId,
  numRuns: number,
  maxActions: number,
  options: SessionOptions = {},
): SessionReport {
  const cfg = compileConfig(PRESETS[id])
  const facts = factsFrom(PRESETS[id])
  const report: SessionReport = {
    preset: id,
    actions: 0,
    accepted: 0,
    rejected: 0,
    contractRefusals: 0,
    oddsChecked: 0,
    unscripted: 0,
    legalTables: 0,
    legalSpots: 0,
    coverage: newCoverage(),
  }
  fc.assert(
    fc.property(
      fc.string({ maxLength: 8 }),
      fc.array(intentOrBatch, { minLength: 1, maxLength: maxActions, size: 'max' }),
      (seed, intents) => playSession(cfg, facts, `session-${seed}`, intents, report, options),
    ),
    { seed: options.seed ?? 20261028, numRuns },
  )
  return report
}

/** Some rolls are drawn from the table's RNG instead of scripted: about a third of them. */
function drawn(next: Intent | BatchIntent): boolean {
  return next.kind === 'roll' && (next.d1 + 2 * next.d2) % 3 === 0
}

function playSession(
  cfg: MachineConfig,
  facts: MachineFacts,
  seed: string,
  intents: readonly (Intent | BatchIntent)[],
  report: SessionReport,
  options: SessionOptions,
): void {
  let state = newTable(cfg, seed)
  const log: Action[] = []
  const unscripted: Dice[] = []
  for (const next of intents) {
    const action: Action = drawn(next) ? { type: 'roll' } : engineActionFor(next, state, cfg)
    const before = state
    const copy = structuredClone(state)
    const every = options.legalEvery ?? 0
    if (every > 0 && report.actions % every === 0) {
      report.legalSpots += checkLegal(before, cfg, action)
      report.legalTables++
    }
    const result = applyAction(before, action, cfg)
    report.actions++
    recordResult(report.coverage, before, result)
    expect(before, 'applyAction changed the table it was given').toEqual(copy)
    const dry = validateAction(before, action, cfg)
    if (!result.ok) {
      report.rejected++
      expect(dry, 'the dry run refuses with the same rejection').toEqual(result.rejection)
      continue
    }
    report.accepted++
    expect(dry, 'the dry run accepts it').toBeNull()
    state = result.state
    log.push(action)
    expectLedgerFromEvents(before.ledger, state.ledger, result.events)
    const { deposits, bankroll, houseNet } = state.ledger
    expect(bankroll + onTable(state.bets) + houseNet).toBe(deposits)
    expect(bankroll).toBeGreaterThanOrEqual(0)
    expect(state.nextBetSeq).toBeGreaterThanOrEqual(before.nextBetSeq)
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
    report.oddsChecked += expectOddsWithinCaps(state, cfg, facts)
    report.contractRefusals += expectContracts(state, cfg)
    for (const event of result.events) {
      if (event.type === 'diceRolled' && !event.scripted) unscripted.push(event.dice)
    }
  }
  // Unscripted rolls take the seed's dice in order: scripted and refused rolls never draw.
  let rng = seedRng(seed)
  for (const dice of unscripted) {
    const [expected, next] = rollDice(rng)
    expect(dice).toEqual(expected)
    rng = next
  }
  report.unscripted += unscripted.length
  // The same actions on a fresh table with the same seed give the same table.
  let replay = newTable(cfg, seed)
  for (const action of log) {
    const result = applyAction(replay, action, cfg)
    if (!result.ok) throw new Error(`replay refused ${JSON.stringify(action)}`)
    replay = result.state
  }
  expect(hashJson(replay)).toBe(hashJson(state))
}

function onTable(bets: readonly BetInstance[]): number {
  return bets.reduce((sum, bet) => sum + bet.amount, 0)
}

/**
 * The ledger after an action, rebuilt from the ledger before it and the action's events alone: the
 * events must account for every cent that moved (plan §4.7, §4.9).
 */
function expectLedgerFromEvents(before: Ledger, after: Ledger, events: readonly GameEvent[]): void {
  let deposits: number = before.deposits
  let bankroll: number = before.bankroll
  let houseNet: number = before.houseNet
  let vigPaid: number = before.vigPaid
  for (const event of events) {
    switch (event.type) {
      case 'deposited':
        deposits += event.amount
        bankroll += event.amount
        break
      case 'betPlaced':
        bankroll -= event.bet.amount
        break
      case 'betAdjusted':
        bankroll -= event.to - event.from
        break
      case 'betRemoved':
        bankroll += event.amount
        break
      case 'vigCharged':
        // A re-collection from the win only announces the settlement's `vigRearm`.
        if (event.from === 'win') break
        bankroll -= event.amount
        houseNet += event.amount
        vigPaid += event.amount
        break
      case 'vigRefunded':
        bankroll += event.amount
        houseNet -= event.amount
        vigPaid -= event.amount
        break
      case 'betResolved': {
        const { trace } = event
        const released = trace.stakeDisposition === 'stays' ? 0 : trace.stake
        bankroll += trace.credited
        houseNet += released - trace.credited
        vigPaid += trace.vigOnWin + trace.vigRearm
        break
      }
      default:
        break
    }
  }
  expect({ deposits, bankroll, houseNet, vigPaid }, 'the ledger moved as the events say').toEqual({
    deposits: after.deposits,
    bankroll: after.bankroll,
    houseNet: after.houseNet,
    vigPaid: after.vigPaid,
  })
}

/** Every odds bet within the engine's cap and the oracle's, which agree. Returns how many. */
function expectOddsWithinCaps(state: TableState, cfg: MachineConfig, facts: MachineFacts): number {
  let checked = 0
  for (const bet of state.bets) {
    if (bet.parentId === null) continue
    const parent = state.bets.find((other) => other.id === bet.parentId)
    if (parent === undefined || parent.number === null) throw new Error(`${bet.id}: no parent`)
    const cap = maxOdds(parent, cfg)
    expect(cap, `${bet.typeId} cap`).toBe(
      refMaxOdds(facts, bet.typeId, parent.number, parent.amount),
    )
    expect(bet.amount, `${bet.id} ${bet.typeId} within its cap`).toBeLessThanOrEqual(cap)
    checked++
  }
  return checked
}

type Change = 'increase' | 'decrease' | 'remove'

/**
 * The changes rules spec §3.1 forbids on a bet, written from the spec and the raw config rather
 * than the line family: pass and come on a number are contract bets (a pass may grow by a put
 * where `/rules/allowPutBets`); a don't bet on a number is never increased, and is reduced or
 * removed only where `/catalog/<t>/onNumber` is `reduceRemove`. Every other bet may change.
 */
function forbidden(bet: BetInstance, cfg: MachineConfig): Set<Change> {
  const input = cfg.input.catalog[bet.typeId]
  if (input?.family !== 'line' || bet.number === null) return new Set()
  if (input.side === 'do') {
    const put = input.window === 'comeOut' && cfg.input.rules.allowPutBets
    return new Set<Change>(put ? ['decrease', 'remove'] : ['increase', 'decrease', 'remove'])
  }
  return new Set<Change>(
    input.onNumber === 'reduceRemove' ? ['increase'] : ['increase', 'decrease', 'remove'],
  )
}

/**
 * Tries every change on every bet: those the spec forbids get `CONTRACT_BET`, those it allows
 * never do. Returns how many were refused as contracts.
 */
function expectContracts(state: TableState, cfg: MachineConfig): number {
  let refused = 0
  for (const bet of state.bets) {
    const locked = forbidden(bet, cfg)
    const { increment } = typeLimits(cfg, bet.typeId)
    const tries: [Change, number][] = [
      ['increase', bet.amount + increment],
      ['remove', 0],
    ]
    if (bet.amount > increment) tries.push(['decrease', bet.amount - increment])
    for (const [change, amount] of tries) {
      const action: Action = { type: 'setAmount', betId: bet.id, amount: cents(amount) }
      const code = validateAction(state, action, cfg)?.code
      if (locked.has(change)) {
        expect(code, `${change} ${bet.typeId} on ${String(bet.number)}`).toBe('CONTRACT_BET')
        refused++
      } else {
        expect(code, `${change} ${bet.typeId} on ${String(bet.number)}`).not.toBe('CONTRACT_BET')
      }
    }
  }
  return refused
}

/** The action that adds `amount` to a spot: a press of its bet, or a new bet on it. */
function addTo(spot: LegalBet, amount: number, cfg: MachineConfig): Action {
  if (spot.betId !== null) {
    return { type: 'setAmount', betId: spot.betId, amount: cents(spot.amount + amount) }
  }
  return placeOn(spot, amount, cfg)
}

/**
 * A `place` on the spot, whether or not a bet is there: odds name their parent, number bets and
 * hardways their number, and every other bet nothing.
 */
function placeOn(spot: LegalBet, amount: number, cfg: MachineConfig): Action {
  const action = { type: 'place' as const, typeId: spot.typeId, amount: cents(amount) }
  if (spot.parentId !== null) return { ...action, parentId: spot.parentId }
  const family = resolveType(cfg, spot.typeId)?.type.family
  const numbered = family === 'numberVsSeven' || family === 'hardway'
  return numbered && spot.number !== null ? { ...action, number: spot.number } : action
}

/**
 * `legalBets` against `validateAction` on one table (plan §4.6), and `next` against it when the
 * table accepts it. Returns how many spots it checked.
 */
export function checkLegal(state: TableState, cfg: MachineConfig, next?: Action): number {
  const spots = legalBets(state, cfg)
  const check = (action: Action): Rejection | null => validateAction(state, action, cfg)
  // Every bet on the table is on exactly one spot.
  const held = spots.flatMap((spot) => (spot.betId === null ? [] : [spot.betId]))
  expect([...held].sort()).toEqual(state.bets.map((bet) => bet.id).sort())
  for (const spot of spots) {
    const where = `${spot.typeId} ${String(spot.number)} ${String(spot.parentId)}`
    // The spot's own unit where its type sets one by number (a live table's odds on 6 go in $5),
    // and the smallest new bet the minimum rounded up to it.
    const limits = typeLimits(cfg, spot.typeId, spot.number)
    const { increment } = limits
    const min = smallestBet(limits)
    if (spot.betId === null) {
      expect(spot.canRemove?.code, where).toBe('BET_NOT_FOUND')
    } else {
      const down: Action = { type: 'setAmount', betId: spot.betId, amount: cents(0) }
      expect(check(down), where).toEqual(spot.canRemove)
    }
    if (spot.canAdd === null) {
      expect(spot.minAdd, where).toBe(spot.betId === null ? min : increment)
      expect((spot.maxAdd - spot.minAdd) % increment, where).toBe(0)
      expect(check(addTo(spot, spot.minAdd, cfg)), `${where} min`).toBeNull()
      expect(check(addTo(spot, spot.maxAdd, cfg)), `${where} max`).toBeNull()
      const middle =
        spot.minAdd + increment * Math.floor((spot.maxAdd - spot.minAdd) / increment / 2)
      expect(check(addTo(spot, middle, cfg)), `${where} middle`).toBeNull()
      expect(check(addTo(spot, spot.maxAdd + increment, cfg)), `${where} above max`).not.toBeNull()
      if (spot.betId === null && spot.minAdd > increment) {
        expect(
          check(addTo(spot, spot.minAdd - increment, cfg)),
          `${where} below min`,
        ).not.toBeNull()
      }
    } else {
      expect([spot.minAdd, spot.maxAdd], where).toEqual([0, 0])
      const first = spot.betId === null ? min : increment
      expect(check(addTo(spot, first, cfg)), where).toEqual(spot.canAdd)
      expect(check(addTo(spot, first + increment, cfg)), where).not.toBeNull()
    }
    // A `place` on a spot that holds a bet adds to it, so it agrees with pressing the bet.
    if (spot.betId !== null && isPlaceTarget(spot, cfg)) {
      const amount = spot.canAdd === null ? spot.minAdd : increment
      expect(check(placeOn(spot, amount, cfg)) === null, `${where} place`).toBe(
        check(addTo(spot, amount, cfg)) === null,
      )
    }
  }
  if (next !== undefined && check(next) === null) expectListed(spots, state, cfg, next)
  return spots.length
}

/** Whether a `place` of the spot's type lands on this spot: not a come bet already on a number. */
function isPlaceTarget(spot: LegalBet, cfg: MachineConfig): boolean {
  const type = resolveType(cfg, spot.typeId)?.type
  return !(type?.family === 'line' && type.window === 'point' && spot.number !== null)
}

/** An accepted bet change is within what `legalBets` offered for its spot. */
function expectListed(spots: LegalBet[], state: TableState, cfg: MachineConfig, next: Action) {
  if (next.type === 'setAmount') {
    const spot = spots.find((s) => s.betId === next.betId)
    const bet = state.bets.find((b) => b.id === next.betId)
    if (spot === undefined || bet === undefined) throw new Error('an accepted change has no spot')
    if (next.amount === 0) expect(spot.canRemove).toBeNull()
    else if (next.amount > bet.amount) expectWithin(spot, next.amount - bet.amount)
    return
  }
  if (next.type !== 'place') return
  const type = resolveType(cfg, next.typeId)?.type
  const spot = spots.find((s) => {
    if (s.typeId !== next.typeId) return false
    switch (type?.family) {
      case 'odds':
        return s.parentId === (next.parentId ?? null)
      case 'numberVsSeven':
      case 'hardway':
        return s.number === (next.number ?? null)
      case 'line':
        return type.window === 'comeOut' || s.number === null
      default:
        return true
    }
  })
  if (spot === undefined) throw new Error(`no spot for ${JSON.stringify(next)}`)
  expectWithin(spot, next.amount)
}

function expectWithin(spot: LegalBet, amount: number): void {
  expect(spot.canAdd, `${spot.typeId} offered`).toBeNull()
  expect(amount).toBeGreaterThanOrEqual(spot.minAdd)
  expect(amount).toBeLessThanOrEqual(spot.maxAdd)
}
