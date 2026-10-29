import {
  betId,
  cents,
  isSettled,
  resolveType,
  type BetInstance,
  type Decision,
  type MachineConfig,
} from '../engine/index.ts'
import {
  checkTable,
  groupOf,
  rollOutcomes,
  tableKey,
  workingOf,
  type BetSpec,
  type StartContext,
  type TableNode,
} from './chain.ts'
import { at } from './solve.ts'
import { typicalStart } from './start.ts'

/**
 * Same events (plan §5.2): whether two bets win, lose and push on exactly the same rolls, so one
 * can stand in for the other with the same exposure. It compares event maps, never names: both
 * bets are placed side by side on one table (a product chain), and every roll of every reachable
 * table must give them the same kind of decision until both are decided. Working rules count: a
 * bet OFF on the come-out does not lose to the come-out 7 that takes the other.
 *
 * So place N and buy N match; big 6 and place 6 match only where place 6 works on the come-out
 * when big 6 does; hard 6 and place 6 never match (the easy 6 wins one and loses the other).
 *
 * Only bets that stand alone on any roll are compared (number bets, hardways, one-roll bets and
 * composites); for line bets and odds the answer is whether the two are the same bet.
 */
export function sameEvents(
  a: BetSpec,
  b: BetSpec,
  start: StartContext | 'typical',
  cfg: MachineConfig,
): boolean {
  if (!standsAlone(a, cfg) || !standsAlone(b, cfg)) {
    return a.typeId === b.typeId && a.number === b.number
  }
  const from = start === 'typical' ? typicalStart(a, cfg) : start
  const group = groupOf([a.typeId, b.typeId], cfg)
  const bets = [a, b].map(
    (spec, index): BetInstance => ({
      id: betId(index + 1),
      typeId: spec.typeId,
      number: spec.number,
      parentId: null,
      amount: at(group.nominal, index),
      vigHeld: cents(0),
      working: from.working,
      progress: 0,
      placedAtRoll: from.carried ? 0 : 1,
    }),
  )
  const seen = new Set<string>()
  const queue: TableNode[] = []
  for (const { phase } of from.phases) {
    const table: TableNode = {
      phase: group.tracksRound ? phase : { kind: 'comeOut' },
      bets,
      globalOff: from.globalOff,
    }
    checkTable(group, table, cfg)
    queue.push(table)
  }
  while (queue.length > 0) {
    const table = queue.pop()
    if (table === undefined) break
    const key = tableKey(group, table)
    if (seen.has(key)) continue
    seen.add(key)
    for (const outcome of rollOutcomes(group, table, workingOf(table, cfg), cfg)) {
      const [first, second] = outcome.decisions
      if (first === undefined || second === undefined) return false
      if (signature(first) !== signature(second)) return false
      // Same kinds: both are decided together, or both stay up for the next roll.
      if (!isSettled(first) && outcome.next.bets.every((bet) => bet !== null)) {
        queue.push(outcome.next)
      }
    }
  }
  return true
}

/** The event a decision is: its kind, and where a travelling bet goes. */
function signature(decision: Decision): string {
  return decision.kind === 'travel' ? `travel:${decision.number}` : decision.kind
}

function standsAlone(spec: BetSpec, cfg: MachineConfig): boolean {
  const family = resolveType(cfg, spec.typeId)?.type.family
  return (
    family === 'numberVsSeven' ||
    family === 'hardway' ||
    family === 'oneRoll' ||
    family === 'composite'
  )
}
