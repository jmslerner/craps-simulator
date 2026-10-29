import { expect as vitestExpect } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import {
  pruneProvenance,
  resolvePointer,
  statusAt,
  type ProvenanceStatus,
} from '../../src/engine/config/provenance.ts'
import { isPointNumber, type PointNumber } from '../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { makeRoll, type DieFace, type Total } from '../../src/engine/core/dice.ts'
import { cents, type Cents } from '../../src/engine/core/money.ts'
import {
  advanceRound,
  totalsInMask,
  type Hand,
  type RoundState,
  type RoundStep,
  type RoundTransition,
} from '../../src/engine/round/round.ts'
import type { BetId, BetInstance, RejectionCode } from '../../src/engine/bets/types.ts'
import { effectiveWorking } from '../../src/engine/bets/working.ts'
import type { SettlementTrace } from '../../src/engine/settle/trace.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import type { GameEvent } from '../../src/engine/table/events.ts'
import type { Ledger } from '../../src/engine/table/ledger.ts'
import { applyAction } from '../../src/engine/table/reducer.ts'
import { newTable, type TableState } from '../../src/engine/table/state.ts'

/**
 * The scenario DSL (plan §9 item 8): start a machine, bet, roll scripted dice, and check what the
 * game did. Every researched machine fact becomes a scenario, together with a check of the
 * provenance of the config value it rests on:
 *
 * ```ts
 * scenario('craplessBubble')
 *   .expectProvenance('/rules/points', 'verified')
 *   .place('pass', 1_000)
 *   .roll(5, 6)
 *   .expect({ transition: 'pointEstablished', point: 11 })
 *   .expectBet({ typeId: 'pass' }, { number: 11, amount: 1_000 })
 *   .expectBankroll(49_000)
 * ```
 *
 * A scenario drives a real table through the reducer (`applyAction`): every bet and roll is an
 * action. Steps run as they are called, so a failing check fails at its own line, and its message
 * names the machine and the rolls so far. Amounts are cents.
 *
 * After every action the DSL checks the ledger identity itself (deposits = bankroll + Σ bets +
 * house net), and after every roll that the table's round is exactly `advanceRound` of the round
 * before. The reducer also checks all table invariants on every action.
 */

/** A hand as a scenario sees it. */
export interface HandFacts {
  /** 0 for the session's first hand. */
  readonly index: number
  readonly rolls: number
  /** Ascending. */
  readonly pointsMade: readonly PointNumber[]
}

/** The round-level facts a scenario can check; `expect` compares only the facts it is given. */
export interface RoundFacts {
  /** The point now, or null when the next roll is a come-out (puck OFF). */
  readonly point: PointNumber | null
  /** What the last roll did to the round, or null before the first roll. */
  readonly transition: RoundTransition['kind'] | null
  /** Which hand this is: 0 for the session's first, one more after each seven-out. */
  readonly handIndex: number
  /** Rolls in this hand so far: 0 right after a seven-out. */
  readonly handRolls: number
  /** Points made in this hand, ascending. */
  readonly pointsMade: readonly PointNumber[]
  /** The hand the last roll ended, if it was a seven-out. Its rolls include the seven-out. */
  readonly endedHand: HandFacts | null
  /** Rolls this session. */
  readonly rolls: number
  /** Rolls since the last 7 of any kind, or since the session start. */
  readonly rollsSinceSeven: number
  /** Totals rolled since the last 7, ascending. */
  readonly totalsSinceSeven: readonly Total[]
}

/**
 * A bet on the table: its id, or its type and number. `number: null` is a line bet on the line or
 * in its box; leaving `number` out matches the type wherever it is. A reference must match exactly
 * one bet.
 */
export type BetRef = BetId | { readonly typeId: string; readonly number?: PointNumber | null }

/** Some of `T`'s fields, with amounts of money written as plain numbers of cents. */
export type Expected<T> = { readonly [K in keyof T]?: T[K] extends Cents ? number : T[K] }

/** The facts `expectBet` can check. `working` is whether the bet works on the next roll. */
export interface BetFacts {
  readonly id: BetId
  readonly typeId: string
  readonly number: PointNumber | null
  readonly amount: number
  readonly parentId: BetId | null
  readonly working: boolean
  readonly placedAtRoll: number
}

/** Where a `place` goes: a number (place bets), or the parent of an odds bet. */
export interface PlaceOptions {
  readonly number?: PointNumber
  /** For odds: the line bet they back. By default the only bet of the parent type on a number. */
  readonly on?: BetRef
}

/** Builds actions against the scenario's current table, for `expectReject` and `act`. */
export interface ActionBuilder {
  place(typeId: string, amount: number, options?: PlaceOptions): Action
  setAmount(ref: BetRef, amount: number): Action
  takeDown(ref: BetRef): Action
  setWorking(ref: BetRef, working: boolean | null): Action
  setGlobalWorking(off: boolean | null): Action
  deposit(amount: number): Action
  roll(d1: DieFace, d2: DieFace): Action
  batch(...actions: Action[]): Action
}

export class Scenario {
  /** The machine, compiled. */
  readonly cfg: MachineConfig
  private current: TableState
  private lastStep: RoundStep | null = null
  private lastEvents: readonly GameEvent[] = []
  private readonly rolled: string[] = []
  /** Builds actions against the table as it is now. */
  readonly actions: ActionBuilder

  constructor(cfg: MachineConfig, seed: string) {
    this.cfg = cfg
    this.current = newTable(cfg, seed)
    this.actions = this.builder()
  }

  /** The table now. */
  get state(): TableState {
    return this.current
  }

  /** The round now, for checks the facts don't cover. */
  get round(): RoundState {
    return this.current.round
  }

  /** What the last roll did to the round, or null before the first roll. */
  get transition(): RoundTransition | null {
    return this.lastStep?.transition ?? null
  }

  /** The events of the last action. */
  get events(): readonly GameEvent[] {
    return this.lastEvents
  }

  /** The settlements of the last action, in settlement order. */
  get settlements(): readonly SettlementTrace[] {
    return this.lastEvents.flatMap((event) => (event.type === 'betResolved' ? [event.trace] : []))
  }

  /** Rolls these two dice, `d1` first, through the reducer. */
  roll(d1: DieFace, d2: DieFace): this {
    const dice = makeRoll(d1, d2)
    const expected = advanceRound(this.current.round, dice, this.cfg.ruleset)
    this.rolled.push(`${d1}-${d2}`)
    this.act({ type: 'roll', dice })
    vitestExpect(this.current.round, `${this.where()}: the round after the roll`).toEqual(
      expected.next,
    )
    this.lastStep = expected
    return this
  }

  /** Rolls the dice from the table's own RNG, as a real session does. */
  rollFromRng(): this {
    const before = this.current.round
    this.act({ type: 'roll' })
    const dice = this.current.lastRoll?.dice
    if (dice === undefined) throw new Error('a roll left no lastRoll')
    this.rolled.push(`${dice.d1}-${dice.d2} (rng)`)
    this.lastStep = advanceRound(before, dice, this.cfg.ruleset)
    return this
  }

  place(typeId: string, amount: number, options?: PlaceOptions): this {
    return this.act(this.actions.place(typeId, amount, options))
  }

  /** Presses or reduces a bet; 0 takes it down. */
  setAmount(ref: BetRef, amount: number): this {
    return this.act(this.actions.setAmount(ref, amount))
  }

  takeDown(ref: BetRef): this {
    return this.act(this.actions.takeDown(ref))
  }

  setWorking(ref: BetRef, working: boolean | null): this {
    return this.act(this.actions.setWorking(ref, working))
  }

  setGlobalWorking(off: boolean | null): this {
    return this.act(this.actions.setGlobalWorking(off))
  }

  deposit(amount: number): this {
    return this.act(this.actions.deposit(amount))
  }

  /** Applies any action; the scenario fails if the table rejects it. */
  act(action: Action): this {
    const result = applyAction(this.current, action, this.cfg)
    if (!result.ok) {
      const { code, details } = result.rejection
      throw new Error(
        `${this.where()}: ${JSON.stringify(action)} was rejected: ${code} ${JSON.stringify(details)}`,
      )
    }
    this.current = result.state
    this.lastEvents = result.events
    this.checkLedger()
    return this
  }

  /**
   * Checks that the table rejects an action with `code`, and that the rejection changed nothing.
   * `details` checks some of the rejection's details too.
   */
  expectReject(
    code: RejectionCode,
    attempt: Action | ((a: ActionBuilder) => Action),
    details?: Readonly<Record<string, string | number>>,
  ): this {
    const action = typeof attempt === 'function' ? attempt(this.actions) : attempt
    const before = structuredClone(this.current)
    const result = applyAction(this.current, action, this.cfg)
    const where = `${this.where()}: ${JSON.stringify(action)}`
    vitestExpect(result.ok ? 'accepted' : result.rejection.code, where).toBe(code)
    if (!result.ok && details !== undefined) {
      vitestExpect(result.rejection.details, where).toMatchObject(details)
    }
    vitestExpect(this.current, `${where} changed the table`).toEqual(before)
    return this
  }

  /** Checks the round facts given, and only those. */
  expect(expected: Partial<RoundFacts>): this {
    const keys = Object.keys(expected) as (keyof RoundFacts)[]
    if (keys.length === 0) throw new Error('expect() needs at least one fact to check')
    const facts = this.facts()
    const actual = Object.fromEntries(keys.map((key) => [key, facts[key]]))
    vitestExpect(actual, this.where()).toEqual(expected)
    return this
  }

  expectBankroll(amount: number): this {
    vitestExpect(this.current.ledger.bankroll, `${this.where()}: bankroll`).toBe(amount)
    return this
  }

  expectLedger(expected: Expected<Ledger>): this {
    vitestExpect(this.current.ledger, `${this.where()}: ledger`).toMatchObject(expected)
    return this
  }

  /** Checks the facts given about one bet. */
  expectBet(ref: BetRef, expected: Partial<BetFacts>): this {
    const bet = this.find(ref)
    const facts: BetFacts = {
      id: bet.id,
      typeId: bet.typeId,
      number: bet.number,
      amount: bet.amount,
      parentId: bet.parentId,
      working: effectiveWorking(bet, this.current, this.cfg),
      placedAtRoll: bet.placedAtRoll,
    }
    const keys = Object.keys(expected) as (keyof BetFacts)[]
    const actual = Object.fromEntries(keys.map((key) => [key, facts[key]]))
    vitestExpect(actual, `${this.where()}: ${describe(ref)}`).toEqual(expected)
    return this
  }

  /** Checks that no bet matches `ref`. */
  expectNoBet(ref: BetRef): this {
    vitestExpect(this.matches(ref), `${this.where()}: ${describe(ref)}`).toEqual([])
    return this
  }

  /** Checks every bet on the table as `[typeId, number, amount]`, in placement order. */
  expectBets(expected: readonly (readonly [string, PointNumber | null, number])[]): this {
    const actual = this.current.bets.map((bet) => [bet.typeId, bet.number, bet.amount])
    vitestExpect(actual, `${this.where()}: bets`).toEqual(expected)
    return this
  }

  /** Checks the one settlement of the last action for a bet of `typeId` (on `number`, if given). */
  expectSettled(
    ref: { readonly typeId: string; readonly number?: PointNumber | null },
    expected: Expected<SettlementTrace>,
  ): this {
    const traces = this.settlements.filter(
      (trace) =>
        trace.typeId === ref.typeId && (ref.number === undefined || trace.number === ref.number),
    )
    const where = `${this.where()}: settlement of ${describe(ref)}`
    vitestExpect(traces.length, where).toBe(1)
    vitestExpect(traces[0], where).toMatchObject(expected)
    return this
  }

  /** Checks the types of the last action's events, in order. */
  expectEvents(types: readonly GameEvent['type'][]): this {
    const actual = this.lastEvents.map((event) => event.type)
    vitestExpect(actual, `${this.where()}: events`).toEqual(types)
    return this
  }

  /** Checks how well the config value at `pointer` is backed; the pointer must name a value. */
  expectProvenance(pointer: string, status: ProvenanceStatus): this {
    const where = `${this.cfg.id}${pointer}`
    const found = resolvePointer(this.cfg.input, pointer).found
    vitestExpect(found, `${where} names no value in the config`).toBe(true)
    vitestExpect(statusAt(this.cfg.provenance, pointer), where).toBe(status)
    return this
  }

  /** The round-level facts now. */
  facts(): RoundFacts {
    const { phase, rollIndex, hand, sinceSeven } = this.current.round
    const transition = this.transition
    return {
      point: phase.kind === 'point' ? phase.point : null,
      transition: transition?.kind ?? null,
      handIndex: hand.index,
      handRolls: hand.rolls,
      pointsMade: pointsIn(hand.pointsMadeMask),
      endedHand: transition?.kind === 'sevenOut' ? handFacts(transition.endedHand) : null,
      rolls: rollIndex,
      rollsSinceSeven: sinceSeven.rolls,
      totalsSinceSeven: totalsInMask(sinceSeven.totalsMask),
    }
  }

  /** The one bet `ref` names. */
  find(ref: BetRef): BetInstance {
    const found = this.matches(ref)
    if (found.length !== 1) {
      const bets = this.current.bets.map((b) => `${b.id} ${b.typeId}@${String(b.number)}`)
      throw new Error(
        `${this.where()}: ${describe(ref)} matches ${found.length} bets (${bets.join(', ') || 'none on the table'})`,
      )
    }
    return found[0]!
  }

  private matches(ref: BetRef): BetInstance[] {
    return this.current.bets.filter((bet) =>
      typeof ref === 'string'
        ? bet.id === ref
        : bet.typeId === ref.typeId && (ref.number === undefined || bet.number === ref.number),
    )
  }

  /** The ledger identity, recomputed here rather than trusted to the engine. */
  private checkLedger(): void {
    const { deposits, bankroll, houseNet } = this.current.ledger
    const staked = this.current.bets.reduce((sum, bet) => sum + bet.amount, 0)
    vitestExpect(
      bankroll + staked + houseNet,
      `${this.where()}: deposits = bankroll + bets + house`,
    ).toBe(deposits)
  }

  private builder(): ActionBuilder {
    const money = (amount: number): Cents => cents(amount)
    return {
      place: (typeId, amount, options = {}) => {
        const type = this.cfg.catalog.get(typeId)
        if (type?.family === 'odds') {
          const parent = this.find(options.on ?? { typeId: type.parent, number: options.number })
          return { type: 'place', typeId, amount: money(amount), parentId: parent.id }
        }
        return options.number === undefined
          ? { type: 'place', typeId, amount: money(amount) }
          : { type: 'place', typeId, amount: money(amount), number: options.number }
      },
      setAmount: (ref, amount) => ({
        type: 'setAmount',
        betId: this.find(ref).id,
        amount: money(amount),
      }),
      takeDown: (ref) => ({ type: 'setAmount', betId: this.find(ref).id, amount: money(0) }),
      setWorking: (ref, working) => ({ type: 'setWorking', betId: this.find(ref).id, working }),
      setGlobalWorking: (off) => ({ type: 'setGlobalWorking', off }),
      deposit: (amount) => ({ type: 'deposit', amount: money(amount) }),
      roll: (d1, d2) => ({ type: 'roll', dice: makeRoll(d1, d2) }),
      batch: (...actions) => ({ type: 'batch', actions }),
    }
  }

  /** The machine and the rolls so far, for failure messages. */
  private where(): string {
    const rolls = this.rolled.length === 0 ? 'before any roll' : `after ${this.rolled.join(', ')}`
    return `${this.cfg.id}, ${rolls}`
  }
}

/**
 * Starts a scenario at the session start, on a built-in machine or on any config. `seed` seeds the
 * dice for `rollFromRng`; scripted rolls never touch them.
 */
export function scenario(
  machine: PresetId | MachineConfigInput | MachineConfig,
  options: { readonly seed?: string } = {},
): Scenario {
  const cfg =
    typeof machine === 'string'
      ? compileConfig(PRESETS[machine])
      : 'configHash' in machine
        ? machine
        : compileConfig(machine)
  return new Scenario(cfg, options.seed ?? 'scenario')
}

const withoutMinimums = new Map<PresetId, MachineConfig>()

/**
 * A built-in machine without its minimum total (`/limits/minTotal` null), for scenarios about the
 * round alone, which roll an empty table: a machine with a minimum will not roll a table whose
 * working bets fall short of it (rules spec §2.3 step 9), and the round does not depend on the
 * bets. Provenance left pointing at nothing is pruned; everything else, the id included, is the
 * preset's. (M4d, when the minimum check landed.)
 */
export function withoutMinimum(id: PresetId): MachineConfig {
  const cached = withoutMinimums.get(id)
  if (cached !== undefined) return cached
  const input = structuredClone(PRESETS[id])
  input.limits.minTotal = null
  input.provenance = pruneProvenance(input)
  const cfg = compileConfig(input)
  withoutMinimums.set(id, cfg)
  return cfg
}

function describe(
  ref: BetRef | { readonly typeId: string; readonly number?: PointNumber | null },
): string {
  if (typeof ref === 'string') return ref
  return ref.number === undefined ? ref.typeId : `${ref.typeId} on ${String(ref.number)}`
}

function pointsIn(mask: number): PointNumber[] {
  return totalsInMask(mask).filter(isPointNumber)
}

function handFacts(hand: Hand): HandFacts {
  return { index: hand.index, rolls: hand.rolls, pointsMade: pointsIn(hand.pointsMadeMask) }
}
