import type { CoachNumber, TemplatePart, TemplateParts } from '../types.ts'

/**
 * The next-step guide's words (plan §0 #18, §10 M9c): every number arrives as a `CoachNumber`
 * (amounts from `legalBets`, the 7-preview from the engine's own settlement), labels arrive as the
 * machine's own text at run time, and the content lint keeps literal numbers out of this file.
 */

export function betLineBody(n: { min: CoachNumber }, label: string): TemplateParts {
  return ['Tap the ', label, ' to start the round. Smallest bet: ', n.min, '.']
}

export function lineClosedBody(label: string): TemplateParts {
  return ['The ', label, ' is not open right now.']
}

export function comeOutRollBody(label: string): TemplateParts {
  return ['Roll the dice to set the point for your ', label, '.']
}

export function pointRollBody(): TemplateParts {
  return ['Roll again: hit the point before a seven.']
}

/**
 * What a 7 would do to every bet on the table (plan §0 #18 lessons): wins, losses, returns and the
 * net, each computed by the engine, with OFF bets named as sitting out — the guide never claims a
 * bet plays while it is OFF.
 */
export function sevenLine(n: {
  wins: CoachNumber
  takes: CoachNumber
  returns: CoachNumber
  net: CoachNumber
  off: CoachNumber
}): TemplateParts {
  const effects: TemplatePart[] = []
  if (!isZero(n.wins)) effects.push('wins you ', n.wins)
  if (!isZero(n.takes)) effects.push(...sep(effects), 'takes ', n.takes)
  if (!isZero(n.returns)) effects.push(...sep(effects), 'returns ', n.returns)
  if (effects.length === 0) effects.push('changes nothing')
  const parts: TemplatePart[] = ['A seven now: ', ...effects, ' — net ', n.net, '.']
  if (!isZero(n.off)) {
    parts.push(' ', n.off, ' OFF: a seven cannot take an OFF bet, and an OFF bet cannot win.')
  }
  return parts
}

export function oddsBody(
  n: { most: CoachNumber },
  lineLabel: string,
  oddsLabel: string,
): TemplateParts {
  return [
    'Back your ',
    lineLabel,
    ' with ',
    oddsLabel,
    ': the machine takes up to ',
    n.most,
    ' more.',
  ]
}

export function skipOddsBody(): TemplateParts {
  return ['Odds are optional: you can roll for the point without them.']
}

export function chipBody(n: { chip: CoachNumber }, label: string): TemplateParts {
  return [
    'The chip in hand is too big for the ',
    label,
    ' right now. Switch to the ',
    n.chip,
    ' chip.',
  ]
}

export function minTotalBody(n: { add: CoachNumber }, label: string): TemplateParts {
  return [
    "Your working bets are under the machine's minimum, so the roll is refused. Add at least ",
    n.add,
    ' on ',
    label,
    '.',
  ]
}

export function rollBlockedBody(): TemplateParts {
  return ['The machine refuses the roll right now.']
}

export function addCreditBody(reason: TemplateParts): TemplateParts {
  return [...reason, ' Add credit like feeding a bill into the machine.']
}

export function needCreditForLine(label: string): TemplateParts {
  return ['You need credit before you can bet the ', label, '.']
}

export function minTotalNoCredit(): TemplateParts {
  return ['Your working bets are under the machine minimum and your credit cannot cover more.']
}

/** The come-out idea (plan §0 #18): number bets working into a come-out that a seven would take. */
export function comeOutWorkingIdeaBody(n: { atRisk: CoachNumber }): TemplateParts {
  return [
    'Your number bets work on this come-out — a seven would take ',
    n.atRisk,
    '. Bets Off sits them out for the roll.',
  ]
}

function isZero(n: CoachNumber): boolean {
  return typeof n.exact === 'number' ? n.exact === 0 : n.exact.isZero()
}

function sep(parts: readonly TemplatePart[]): TemplatePart[] {
  return parts.length === 0 ? [] : [', ']
}
