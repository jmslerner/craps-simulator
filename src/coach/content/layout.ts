import type { CoachNumber, TemplateParts } from '../types.ts'

/**
 * The layout meter's and cheat sheet's words (plan §10 M9d). Like every content module, these
 * functions take `CoachNumber`s and return `TemplateParts`: the lint rejects any literal
 * percentage, dollar amount or pay ratio in this directory, so a number can only arrive computed.
 */

/** The meter's headline: what keeping the table's bets up costs. */
export function meterHeadline(n: { perRoll: CoachNumber }): TemplateParts {
  return ['Keeping these bets up costs ', n.perRoll, ' a roll.']
}

/** Shown while nothing is on the table. */
export function emptyMeter(): TemplateParts {
  return ['No bets standing. The meter prices every bet you keep working.']
}

/** One pace figure of the hourly line; the machine's own pace says so. */
export function hourlyAt(
  n: { pace: CoachNumber; value: CoachNumber },
  machine: boolean,
): TemplateParts {
  return [n.pace, machine ? ' rolls/hr (this machine): ' : ' rolls/hr: ', n.value]
}

/** A bet that is priced inside another bet's stream, not on its own. */
export function countedWith(label: string): TemplateParts {
  return ['counted with ', label]
}

/** The cheapest same-event relayout: what it would cost and save. */
export function altHeadline(n: { perRoll: CoachNumber; saving: CoachNumber }): TemplateParts {
  return ['Same events, cheaper: ', n.perRoll, ' a roll — saves ', n.saving, ' a roll.']
}

/** One swap of the cheaper layout. */
export function swapLine(from: string, to: string, n: { amount: CoachNumber }): TemplateParts {
  return ['Swap ', from, ' into ', to, ' at ', n.amount, '.']
}

/** What the working toggle would make the meter, priced on the dry-run table. */
export function toggleEffect(n: { perRoll: CoachNumber }, willBeOn: boolean): TemplateParts {
  return [
    willBeOn ? 'Set bets ON and this becomes ' : 'Set bets OFF and this becomes ',
    n.perRoll,
    ' a roll.',
  ]
}

/** A cheat-sheet row's facts: the machine's pay label, the priced stake, chance and length. */
export function sheetDetail(
  payoutLabel: string,
  n: { amount: CoachNumber; pWin: CoachNumber; rolls: CoachNumber },
): TemplateParts {
  return [
    'pays ',
    payoutLabel,
    ' · at ',
    n.amount,
    ' · wins ',
    n.pWin,
    ' of decisions · decides in ',
    n.rolls,
    ' rolls',
  ]
}

/** A row's cost line: the edge per working roll, and what standing costs at the priced stake. */
export function sheetCost(n: {
  perWorkingRoll: CoachNumber
  standing: CoachNumber | null
}): TemplateParts {
  const parts: TemplateParts =
    n.standing === null
      ? ['per working roll ', n.perWorkingRoll, ' · one decision, no stream']
      : ['per working roll ', n.perWorkingRoll, ' · standing ', n.standing, ' a roll']
  return parts
}

/** The warning where the smallest legal stake prices worse than the exact unit. */
export function atMinimumNote(n: { amount: CoachNumber; edge: CoachNumber }): TemplateParts {
  return ['At the minimum ', n.amount, ' this worsens to ', n.edge, '.']
}

/** The sheet's note for machine options the trainer does not model (CLAUDE.md: say so). */
export function notModelledNote(items: string): TemplateParts {
  return ['This machine also sets options the trainer approximates: ', items, '.']
}
