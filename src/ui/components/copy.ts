import { formatCents } from '../../engine/index.ts'
import type { Cents, MachineConfig } from '../../engine/index.ts'
import type { RollEntry, RoundEvent } from '../state/rollHistory.ts'

/**
 * Player wording shared by the zones, the announcer and the history (plan §6, §0 #20): how a pay
 * ratio is spoken, how a round event is said the way the machine says it, and how a roll is
 * announced. Every amount goes through `formatCents`; the words are the crapless player's —
 * "come-out", "point", "seven-out" — and no number is invented here: dice, totals and amounts all
 * come from the engine's events.
 */

/** "7:6" is spoken "7 to 6"; "5 for 1" already reads as said. */
export function spokenRatio(label: string): string {
  return label.replace(':', ' to ')
}

/** The machine's label for a bet type, composites and side bets included. */
export function typeLabel(cfg: MachineConfig, typeId: string): string {
  return (
    cfg.catalog.get(typeId)?.label ??
    cfg.composites.get(typeId)?.label ??
    cfg.sideBets.get(typeId)?.label ??
    typeId
  )
}

/** The round event in the machine's words; null for a point-phase roll that misses. */
export function roundEventWords(event: RoundEvent | null): string | null {
  if (event === null) return null
  switch (event.type) {
    case 'natural':
      return `${event.total} wins the come-out`
    case 'crapsOut':
      return `craps ${event.total}`
    case 'pointEstablished':
      return `the point is ${event.point}`
    case 'pointMade':
      return `point ${event.point} made`
    case 'sevenOut':
      return 'seven-out'
  }
}

/** The player's net on a roll, in words: "you won $7.00", "you lost $5.00", "no change". */
export function netWords(net: Cents): string {
  if (net > 0) return `you won ${formatCents(net)}`
  if (net < 0) return `you lost ${formatCents(-net as Cents)}`
  return 'no change'
}

/** One sentence per roll for the aria-live region: total, dice, round event and net. */
export function rollAnnouncement(entry: RollEntry): string {
  const round = roundEventWords(entry.roundEvent)
  const parts = [
    `Rolled ${entry.total}: ${entry.dice.d1} and ${entry.dice.d2}`,
    ...(round === null ? [] : [round]),
    netWords(entry.net),
  ]
  return `${parts.join(', ')}.`
}
