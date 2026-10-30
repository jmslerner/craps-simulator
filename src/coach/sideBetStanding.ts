import {
  bitCount,
  handLengthCount,
  handLengthTier,
  pointRunState,
  type CompiledSideBet,
  type Decision,
  type Phase,
} from '../engine/index.ts'

/**
 * Where a side bet on the table stands (plan §5.4 `sideBetProgress`; the M11 audit): what it
 * settles for if it settles on its earliest deciding roll **without improving**, read from its
 * current progress — never "the lowest outcome left", which a pay table that pays less for more
 * progress makes different (six Fire points paying 999 to 1 where a seventh pays nothing: settling
 * now pays, and the lowest outcome is a loss). Pure over the compiled side bet, the bet's
 * `progress` and the round's phase, with the engine's own encodings and counts, so the coach's
 * lines (`coach/sideBetProgress.ts`) and the inspector's pay table (`ui/layout/sideBetProgress.ts`)
 * mark the same row.
 *
 * - **Lucky Roller:** a set not yet complete pays nothing: the next 7 loses it.
 * - **Fire Bet:** the seven-out pays the points made so far (`/sideBets/<t>/payTable`), or loses.
 * - **Hot Shooter:** the earliest seven-out counts the hand's rolls up to it: the next roll with a
 *   point on, else the roll after the come-out sets one, so a hand on the come-out has at least two
 *   rolls to go (`handLengthCount`, the count definition included); its tier pays, returns the
 *   stake, or loses.
 * - **Lucky Shooter:** before its point a come-out craps loses it; with its point it settles with
 *   the hits it has (a 7, a craps or eleven total, a repeat; after every other box number, any roll
 *   but the point), or loses where the table pays nothing for them.
 */

/** A settled decision, as the families decide it. */
export type SideBetSettlement = Extract<Decision, { kind: 'win' | 'lose' | 'push' }>

export interface SettlesNow {
  readonly decision: SideBetSettlement
  /**
   * The pay-table row it lands on, as the inspector keys its rows: the engine's pay key for a win,
   * the 1-for-1 tier's `minRolls` for the Hot Shooter's stake back; null for a loss.
   */
  readonly row: string | null
}

const LOST: SettlesNow = { decision: { kind: 'lose' }, row: null }

function won(payKey: string): SettlesNow {
  return { decision: { kind: 'win', payKey, stake: 'return' }, row: payKey }
}

/** What `type` with `progress` settles for now, with the round in `phase` (module comment). */
export function settlesNow(type: CompiledSideBet, progress: number, phase: Phase): SettlesNow {
  switch (type.family) {
    case 'collectSet':
      return LOST
    case 'uniquePointsMade': {
      const count = bitCount(progress)
      return type.payTable.has(count) ? won(String(count)) : LOST
    }
    case 'handLength': {
      const rolls = progress + (phase.kind === 'point' ? 1 : 2)
      const tier = handLengthTier(type, handLengthCount(type, rolls))
      if (tier === null) return LOST
      if (tier.pays !== 'push') return won(String(tier.minRolls))
      return {
        decision: { kind: 'push', reason: 'zeroNet', stake: 'return' },
        row: String(tier.minRolls),
      }
    }
    case 'pointRun': {
      const { point, hits } = pointRunState(progress)
      if (point === null) return LOST
      const count = bitCount(hits)
      return type.payTable.has(count) ? won(String(count)) : LOST
    }
  }
}
