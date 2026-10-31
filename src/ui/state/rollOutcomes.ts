import { cents } from '../../engine/index.ts'
import type { Cents, SettlementTrace } from '../../engine/index.ts'
import type { LayoutSpec, ZoneSpec } from '../layout/layoutSpec.ts'
import type { RollEntry } from './rollHistory.ts'

/**
 * What a revealed roll did on each zone of the felt, for the win and lose marks the reveal draws
 * (the zone flashes and the amount floats off it). The marks are the engine's own settlements —
 * the roll's `betResolved` traces in its history entry — mapped onto the zone that holds each bet,
 * so a mark never says anything the engine did not pay: a win shows what it added to the player's
 * money after commission (`winPaid − vigOnWin − vigRearm`; a stake returned is not a gain), a loss
 * its stake. A line bet decided on its point marks the line bar, odds mark the odds bar or the
 * come spot that carries them, and two settlements on one zone (a come bet and its odds) add up.
 */

export type OutcomeKind = 'win' | 'lose' | 'push'

export interface ZoneOutcome {
  /** The roll the mark belongs to: a new roll re-runs the zone's animation. */
  readonly rollIndex: number
  readonly kind: OutcomeKind
  /** The player's net on the zone for the roll: + won after commission, − the stake lost, 0 push. */
  readonly net: Cents
  /** The stakes the roll decided on the zone (a big win is one that pays many times its stake). */
  readonly stake: Cents
}

const NONE: ReadonlyMap<string, ZoneOutcome> = new Map()

export function zoneOutcomes(entry: RollEntry, spec: LayoutSpec): ReadonlyMap<string, ZoneOutcome> {
  const zones = allZones(spec)
  const totals = new Map<string, { net: number; stake: number }>()
  for (const item of entry.items) {
    if (item.type !== 'betResolved') continue
    const zone = zoneFor(item.trace, zones)
    if (zone === null) continue
    const sum = totals.get(zone.key) ?? { net: 0, stake: 0 }
    totals.set(zone.key, { net: sum.net + netOf(item.trace), stake: sum.stake + item.trace.stake })
  }
  if (totals.size === 0) return NONE
  const outcomes = new Map<string, ZoneOutcome>()
  for (const [key, { net, stake }] of totals) {
    outcomes.set(key, {
      rollIndex: entry.rollIndex,
      kind: net > 0 ? 'win' : net < 0 ? 'lose' : 'push',
      net: cents(net),
      stake: cents(stake),
    })
  }
  return outcomes
}

/** A settlement's effect on the player's money: what a win added, minus the stake of a loss. */
function netOf(trace: SettlementTrace): number {
  if (trace.outcome === 'win') return trace.winPaid - trace.vigOnWin - trace.vigRearm
  if (trace.outcome === 'lose') return -trace.stake
  return 0
}

/**
 * The zone that holds a settled bet: its own type's zone on its number, else that type's bar (a
 * line bet decided on its point); for odds without a zone of their own, the zone that carries them
 * (the come spot on that number). Null when the layout draws no such zone.
 */
function zoneFor(trace: SettlementTrace, zones: readonly ZoneSpec[]): ZoneSpec | null {
  const own = zones.filter((zone) => zone.typeId === trace.typeId)
  const carriers = zones.filter((zone) => zone.oddsTypeId === trace.typeId)
  for (const pool of [own, carriers]) {
    const exact = pool.find((zone) => zone.number === trace.number)
    if (exact !== undefined) return exact
    const bar = pool.find((zone) => zone.number === null)
    if (bar !== undefined) return bar
  }
  return null
}

/** Every zone the layout draws, once each (the circles and bands reuse the props' and lines'). */
function allZones(spec: LayoutSpec): readonly ZoneSpec[] {
  const byKey = new Map<string, ZoneSpec>()
  const groups = [
    spec.numbers.flatMap((column) => column.cells),
    spec.lines,
    spec.center,
    spec.hardways,
    spec.props,
    spec.sideBets,
  ]
  for (const zone of groups.flat()) byKey.set(zone.key, zone)
  return [...byKey.values()]
}
