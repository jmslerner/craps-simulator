import { expect as vitestExpect } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import {
  resolvePointer,
  statusAt,
  type ProvenanceStatus,
} from '../../src/engine/config/provenance.ts'
import { isPointNumber, type PointNumber } from '../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { makeRoll, type Dice, type DieFace, type Total } from '../../src/engine/core/dice.ts'
import {
  advanceRound,
  initialRound,
  totalsInMask,
  type Hand,
  type RoundState,
  type RoundStep,
  type RoundTransition,
} from '../../src/engine/round/round.ts'

/**
 * The scenario DSL (plan §9 item 8): start a machine, roll scripted dice, and check what the game
 * did. Every researched machine fact becomes a scenario, together with a check of the provenance of
 * the config value it rests on:
 *
 * ```ts
 * scenario('craplessBubble')
 *   .expectProvenance('/rules/points', 'verified')
 *   .roll(5, 6)
 *   .expect({ transition: 'pointEstablished', point: 11 })
 * ```
 *
 * Steps run as they are called, so a failing check fails at its own line, and its message names
 * the machine and the rolls so far.
 *
 * **Extending it (M4).** A scenario drives the round alone for now. M4 extends this file in place:
 * `ScenarioState` becomes the table state (which keeps `round`), `advance` goes through the
 * reducer's roll action, and `place`, `expectBankroll` and `expectBet` join the methods below.
 * Those methods read only `state.round` and the last round step, so scenarios written now keep
 * passing.
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

/** What a scenario drives. M4: the table state, which keeps `round`. */
interface ScenarioState {
  readonly round: RoundState
}

export class Scenario {
  /** The machine, compiled. */
  readonly cfg: MachineConfig
  private state: ScenarioState
  private lastStep: RoundStep | null = null
  private readonly rolled: string[] = []

  constructor(cfg: MachineConfig) {
    this.cfg = cfg
    this.state = { round: initialRound() }
  }

  /** The round now, for checks the facts don't cover. */
  get round(): RoundState {
    return this.state.round
  }

  /** What the last roll did to the round, or null before the first roll. */
  get transition(): RoundTransition | null {
    return this.lastStep?.transition ?? null
  }

  /** Rolls these two dice, `d1` first. */
  roll(d1: DieFace, d2: DieFace): this {
    this.lastStep = this.advance(makeRoll(d1, d2))
    this.rolled.push(`${d1}-${d2}`)
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
    const { phase, rollIndex, hand, sinceSeven } = this.state.round
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

  /** Rolls `dice` through the engine. M4: through the reducer's roll action. */
  private advance(dice: Dice): RoundStep {
    const step = advanceRound(this.state.round, dice, this.cfg.ruleset)
    this.state = { round: step.next }
    return step
  }

  /** The machine and the rolls so far, for failure messages. */
  private where(): string {
    const rolls = this.rolled.length === 0 ? 'before any roll' : `after ${this.rolled.join(', ')}`
    return `${this.cfg.id}, ${rolls}`
  }
}

/** Starts a scenario at the session start, on a built-in machine or on any config. */
export function scenario(machine: PresetId | MachineConfigInput): Scenario {
  return new Scenario(compileConfig(typeof machine === 'string' ? PRESETS[machine] : machine))
}

function pointsIn(mask: number): PointNumber[] {
  return totalsInMask(mask).filter(isPointNumber)
}

function handFacts(hand: Hand): HandFacts {
  return { index: hand.index, rolls: hand.rolls, pointsMade: pointsIn(hand.pointsMadeMask) }
}
