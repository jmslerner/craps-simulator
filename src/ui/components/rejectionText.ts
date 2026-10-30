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
    case 'NOT_OFFERED': {
      // The machine can list a bet type the trainer has no family for (none since M11 brought the
      // side bets in, kept for machine values the trainer may list but not model): the engine
      // refuses it as NOT_OFFERED, but "not available on this machine" would be wrong.
      const typeId = text(details, 'typeId')
      const listed =
        typeId !== null &&
        (cfg.catalog.has(typeId) || cfg.composites.has(typeId) || cfg.sideBets.has(typeId))
      return listed
        ? `The machine lists ${label ?? 'that bet'}, but the trainer does not model it yet.`
        : `${label ?? 'That bet'} is not available on this machine.`
    }
    case 'BAD_PARAMS':
      return `The machine cannot take that${label === null ? '' : ` ${label}`} bet as entered.`
    case 'WRONG_PHASE': {
      const window = text(details, 'window')
      if (window === 'comeOut') return `${label ?? 'That bet'} only opens for the come-out roll.`
      if (window === 'point') return `${label ?? 'That bet'} only opens once a point is set.`
      return `${label ?? 'That bet'} is not open in this part of the round.`
    }
    case 'WINDOW_CLOSED': {
      const reason = text(details, 'reason')
      const name = label ?? 'That bet'
      if (reason === 'rebetAfterRemove') return `${name} cannot go back up until the next come-out.`
      // A side bet's placement window (M11; rules spec §2.6): `reason` names the window the
      // machine takes it in, `until` when it opens again.
      const window =
        reason === 'afterSevenOrStart'
          ? 'right after a 7 or before the first roll'
          : reason === 'newHand' || reason === 'comeOutAfterSevenOut'
            ? "before a new hand's first roll"
            : null
      const until = text(details, 'until')
      const reopens =
        until === 'nextSeven'
          ? 'after the next 7'
          : until === 'nextHand'
            ? 'after the next seven-out'
            : null
      if (window !== null || reopens !== null) {
        const opens =
          window === null ? `${name} is not open now` : `${name} can only be bet ${window}`
        return reopens === null ? `${opens}.` : `${opens} — it opens again ${reopens}.`
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
      const typeId = text(details, 'typeId')
      if (typeId !== null && cfg.sideBets.has(typeId)) {
        // A side bet is set before the dice roll and locked once they have (rules spec §2.6).
        return change === 'increase'
          ? `${name} cannot be added to now — a side bet is set before the dice roll.`
          : `${name} is locked once the dice roll — it stays up until it wins or loses.`
      }
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
      if (text(details, 'scope') === 'qualifyingBet') {
        // A side bet's qualifier (M11; the Hot Shooter's `/sideBets/<t>/qualifyingBet`): the main
        // game must carry `min` first; `short` is what the table lacks.
        const min = money(details, 'min')
        const name = label ?? 'That side bet'
        const needs = min === null ? 'a qualifying bet' : `${formatCents(min)}`
        return short === null
          ? `${name} needs ${needs} on the main game first.`
          : `${name} needs ${needs} on the main game first — the table is ${formatCents(short)} short.`
      }
      if (short === null) return 'BETS ARE NOT VALID YET! The table is under the machine minimum.'
      if (text(details, 'scope') === 'perBet') {
        const min = money(details, 'min')
        return `Each bet must be at least ${min === null ? 'the machine minimum' : formatCents(min)} — ${
          label ?? 'one bet'
        } is ${formatCents(short)} short.`
      }
      const refusal = `BETS ARE NOT VALID YET! Must bet ${creditsText(short, cfg)} more to roll.`
      // A side bet up does not count toward the round's minimum (rules spec §9 #11). Say so, and
      // on a community dome — which rolls on its own timer whatever a player has in, a flow the
      // trainer does not model (`/flow/shooter/mode` in `notModelled`) — say why it waits anyway.
      if (money(details, 'sideBets') === null) return refusal
      return cfg.input.flow.shooter.mode === 'community'
        ? `${refusal} Side bets don’t count toward it. A community dome would roll on regardless; the trainer rolls only once your main-game bets meet the minimum.`
        : `${refusal} Side bets don’t count toward it.`
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
