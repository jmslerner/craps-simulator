import { cents, formatCents } from '../../engine/index.ts'
import type { Cents, MachineConfig, Rejection, RejectionCode } from '../../engine/index.ts'

/**
 * Player wording for every `Rejection` the engine can raise (plan §6): the one mapping between
 * rejection codes and what the reason strip, the dialogs and the inspector say. The engine's
 * `details` carry the numbers — `BELOW_MIN_TOTAL.short` is Interblock's "Must bet N credits
 * more!", a bet's `min`/`max`/`increment` are its limits — so every amount here is the machine's
 * own, formatted with `formatCents`, never recomputed. Copy follows the machine the player plays:
 * "come-out", "point", "contract bet", and Interblock's own banner for an invalid round.
 */

export function rejectionText(
  rejection: Pick<Rejection, 'code' | 'details'>,
  cfg: MachineConfig,
): string {
  const { details } = rejection
  const label = labelOf(cfg, text(details, 'typeId'))
  switch (rejection.code) {
    case 'NOT_OFFERED':
      return `${label ?? 'That bet'} is not available on this machine.`
    case 'BAD_PARAMS':
      return `The machine cannot take that${label === null ? '' : ` ${label}`} bet as entered.`
    case 'WRONG_PHASE': {
      const window = text(details, 'window')
      if (window === 'comeOut') return `${label ?? 'That bet'} only opens for the come-out roll.`
      if (window === 'point') return `${label ?? 'That bet'} only opens once a point is set.`
      return `${label ?? 'That bet'} is not open in this part of the round.`
    }
    case 'WINDOW_CLOSED': {
      if (text(details, 'reason') === 'rebetAfterRemove') {
        return `${label ?? 'That bet'} cannot go back up until the next come-out.`
      }
      return 'The dice are rolling — betting reopens after the roll.'
    }
    case 'BELOW_MIN': {
      const min = money(details, 'min')
      return min === null
        ? `That is under the minimum for ${label ?? 'that bet'}.`
        : `The smallest ${label ?? ''} bet is ${formatCents(min)}.`
    }
    case 'ABOVE_MAX': {
      if (text(details, 'scope') === 'ledger') return 'The machine cannot hold that much credit.'
      const max = money(details, 'max')
      return max === null
        ? `That is over the maximum for ${label ?? 'that bet'}.`
        : `The largest ${label ?? ''} bet is ${formatCents(max)}.`
    }
    case 'BAD_INCREMENT': {
      const step = money(details, 'increment')
      return step === null
        ? `${label ?? 'That bet'} must be bet in whole steps.`
        : `${label ?? 'That bet'} goes up in steps of ${formatCents(step)}.`
    }
    case 'TABLE_MAX': {
      const max = money(details, 'tableMax')
      return max === null
        ? 'That would put the table over its maximum.'
        : `The table maximum is ${formatCents(max)} across all bets.`
    }
    case 'INSUFFICIENT_CREDIT': {
      const needed = money(details, 'needed')
      const available = money(details, 'available')
      if (needed === null || available === null) return 'Not enough credit for that.'
      return `Not enough credit: that takes ${formatCents(needed)} and you have ${formatCents(available)}.`
    }
    case 'CONTRACT_BET': {
      const change = text(details, 'change')
      const name = label ?? 'That bet'
      if (change === 'increase') return `${name} is locked in: it cannot be added to now.`
      if (change === 'decrease') return `${name} is a contract bet: it cannot be reduced now.`
      return `${name} is a contract bet: it stays up until it wins or loses.`
    }
    case 'NO_PARENT': {
      const parent = labelOf(cfg, text(details, 'parent'))
      return `Odds need a ${parent ?? 'line'} bet to back.`
    }
    case 'PARENT_NOT_ON_POINT':
      return 'Odds wait until that bet is on a number.'
    case 'ODDS_LIMIT': {
      const max = money(details, 'max')
      return max === null
        ? 'That is more odds than the machine takes behind that bet.'
        : `The machine takes at most ${formatCents(max)} odds behind that bet.`
    }
    case 'EXCLUSIVE_CONFLICT': {
      const other = labelOf(cfg, text(details, 'conflictsWith'))
      return other === null
        ? `${label ?? 'That bet'} cannot go up against a bet you already have there.`
        : `${label ?? 'That bet'} cannot go up while your ${other} bet covers that number.`
    }
    case 'BET_NOT_FOUND':
      return 'There is no bet there.'
    case 'NOT_TOGGLEABLE': {
      if (text(details, 'scope') === 'global') return 'This machine has no bets on/off button.'
      return `${label ?? 'That bet'} cannot be switched off — it always plays.`
    }
    case 'BELOW_MIN_TOTAL': {
      const short = money(details, 'short')
      if (short === null) return 'BETS ARE NOT VALID YET! The table is under the machine minimum.'
      if (text(details, 'scope') === 'perBet') {
        const min = money(details, 'min')
        return `Each bet must be at least ${min === null ? 'the machine minimum' : formatCents(min)} — ${
          label ?? 'one bet'
        } is ${formatCents(short)} short.`
      }
      return `BETS ARE NOT VALID YET! Must bet ${creditsText(short, cfg)} more to roll.`
    }
  }
}

/** True for the codes a zone can clear by picking another amount or spot (kept for the inspector). */
export function isAmountProblem(code: RejectionCode): boolean {
  return (
    code === 'BELOW_MIN' ||
    code === 'ABOVE_MAX' ||
    code === 'BAD_INCREMENT' ||
    code === 'TABLE_MAX' ||
    code === 'INSUFFICIENT_CREDIT' ||
    code === 'ODDS_LIMIT'
  )
}

/**
 * Interblock counts the shortfall in credits (M4 → M8 hand-off: `details.short` ÷ the credit
 * value, the machine's denomination step): "$4.00 (4 credits)". Dollars alone when it is not a
 * whole number of credits.
 */
function creditsText(short: Cents, cfg: MachineConfig): string {
  const credit = cfg.betIncrement
  if (credit <= 0 || short % credit !== 0) return formatCents(short)
  const credits = short / credit
  return `${formatCents(short)} (${credits} ${credits === 1 ? 'credit' : 'credits'})`
}

function labelOf(cfg: MachineConfig, typeId: string | null): string | null {
  if (typeId === null) return null
  return (
    cfg.catalog.get(typeId)?.label ??
    cfg.composites.get(typeId)?.label ??
    cfg.sideBets.get(typeId)?.label ??
    null
  )
}

function text(details: Rejection['details'], key: string): string | null {
  const value = details[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function money(details: Rejection['details'], key: string): Cents | null {
  const value = details[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null
  return cents(value)
}
