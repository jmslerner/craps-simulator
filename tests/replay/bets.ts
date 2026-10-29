import type { MachineConfig } from '../../src/engine/config/compile.ts'
import { cents } from '../../src/engine/core/money.ts'
import type { LegalBet } from '../../src/engine/bets/legal.ts'
import { smallestBet, typeLimits } from '../../src/engine/bets/limits.ts'
import { resolveType } from '../../src/engine/bets/registry.ts'
import type { Rejection } from '../../src/engine/bets/types.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import type { TableState } from '../../src/engine/table/state.ts'

/**
 * Bet-making helpers shared by the random session driver (`play.ts`) and the fixture recorder
 * (`recorder.ts`). They use only the engine, not Vitest, so `node tests/replay/record.ts` can load
 * them.
 */

/** The action that adds `amount` to a spot: a press of its bet, or a new bet on it. */
export function addTo(spot: LegalBet, amount: number, cfg: MachineConfig): Action {
  if (spot.betId !== null) {
    return { type: 'setAmount', betId: spot.betId, amount: cents(spot.amount + amount) }
  }
  const action = { type: 'place' as const, typeId: spot.typeId, amount: cents(amount) }
  if (spot.parentId !== null) return { ...action, parentId: spot.parentId }
  const family = resolveType(cfg, spot.typeId)?.type.family
  const numbered = family === 'numberVsSeven' || family === 'hardway'
  return numbered && spot.number !== null ? { ...action, number: spot.number } : action
}

/** The do side's line bet for the phase: pass on the come-out, come with a point on. */
export function lineFor(state: TableState, cfg: MachineConfig): string | null {
  const phase = state.round.phase.kind
  const line = [...cfg.catalog.values()].find(
    (type) => type.family === 'line' && type.side === 'do' && type.window === phase,
  )
  return line?.typeId ?? null
}

/**
 * What a roll refused for the round's minimum (`BELOW_MIN_TOTAL`) still lacks, added where it
 * counts: the phase's line bet under a `totalRound` minimum, or the short bet pressed under a
 * `perBet` one. Null when there is no such bet.
 */
export function topUp(state: TableState, cfg: MachineConfig, refusal: Rejection): Action | null {
  const short = Number(refusal.details.short)
  const up = (increment: number) => short + ((increment - (short % increment)) % increment)
  if (refusal.details.scope === 'perBet') {
    const target = state.bets.find((b) => b.id === refusal.details.betId)
    if (target === undefined) return null
    const { increment } = typeLimits(cfg, target.typeId, target.number)
    return { type: 'setAmount', betId: target.id, amount: cents(target.amount + up(increment)) }
  }
  const line = lineFor(state, cfg)
  if (line === null) return null
  const limits = typeLimits(cfg, line)
  const amount = Math.max(smallestBet(limits), up(limits.increment))
  return { type: 'place', typeId: line, amount: cents(amount) }
}
