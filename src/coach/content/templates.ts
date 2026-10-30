import type { CoachNumber, TemplatePart, TemplateParts } from '../types.ts'

/**
 * The coach's words (plan §5.3). Every function takes `CoachNumber`s and returns `TemplateParts`,
 * so a raw number cannot be interpolated; pay wordings arrive as the machine's own label text at
 * run time. The content lint (`tests/content-lint.test.ts`) rejects literal percentages, dollar
 * amounts and ratios anywhere in this directory — numbers exist here only as placeholders.
 */

/** "[stake] × [label] = [win]": the machine's pay applied to this stake. */
export function paysLine(
  n: { stake: CoachNumber; win: CoachNumber },
  ratioLabel: string,
): TemplateParts {
  return [n.stake, ' × ', ratioLabel, ' = ', n.win]
}

export function edgeLine(n: { edge: CoachNumber }): TemplateParts {
  return ['House edge ', n.edge]
}

export function chanceLine(n: { pWin: CoachNumber }): TemplateParts {
  return ['Wins ', n.pWin, ' of decisions']
}

export function equityLine(n: { equity: CoachNumber }): TemplateParts {
  return ['Worth from now: ', n.equity]
}

export function lossFromNowLine(n: { loss: CoachNumber }): TemplateParts {
  return ['Expected loss from here: ', n.loss]
}

export function takeDownLine(n: { value: CoachNumber }): TemplateParts {
  return ['Taking it down returns ', n.value]
}

export function neverResolvesLine(): TemplateParts {
  return ['This bet may never be decided from here; what it returns is its take-down value.']
}

// --- "Show math" derivation steps (plan §5.2 `derive`) ---

/** The ways step: what the rolls from the bet's usual state do to it. */
export function waysStep(n: {
  rolls: CoachNumber
  win: CoachNumber
  lose: CoachNumber
  push: CoachNumber
  travel: CoachNumber
  none: CoachNumber
}): TemplateParts {
  const parts: (string | CoachNumber)[] = [
    'Of ',
    n.rolls,
    ' rolls: ',
    n.win,
    ' win, ',
    n.lose,
    ' lose',
  ]
  if (!isZero(n.push)) parts.push(', ', n.push, ' push')
  if (!isZero(n.travel)) parts.push(', ', n.travel, ' travel')
  if (!isZero(n.none)) parts.push(', ', n.none, ' change nothing')
  parts.push('.')
  return parts
}

/** Caveat when the chances do not follow from one state's ways alone. */
export function waysIncompleteNote(): TemplateParts {
  return [
    'The first decision runs through the round, so the chances below come from the whole chain.',
  ]
}

export function chancesStep(n: {
  win: CoachNumber
  lose: CoachNumber
  push: CoachNumber
}): TemplateParts {
  const parts: (string | CoachNumber)[] = ['P(win) ', n.win, ', P(lose) ', n.lose]
  if (!isZero(n.push)) parts.push(', P(push) ', n.push)
  parts.push('.')
  return parts
}

/** One way to win: the exact product, and what the machine actually pays. */
export function payoutStep(
  n: { stake: CoachNumber; exact: CoachNumber; paid: CoachNumber; vigOnWin: CoachNumber },
  ratioLabel: string,
): TemplateParts {
  const parts: TemplatePart[] = [
    n.stake,
    ' × ',
    ratioLabel,
    ' = ',
    { n: n.exact, style: 'exact' },
    ' → pays ',
    n.paid,
  ]
  if (!isZero(n.vigOnWin)) parts.push(' after ', n.vigOnWin, ' commission')
  parts.push('.')
  return parts
}

export function commissionStep(n: { placement: CoachNumber; rearm: CoachNumber }): TemplateParts {
  const parts: (string | CoachNumber)[] = []
  if (!isZero(n.placement)) parts.push('Commission up front: ', n.placement, '. ')
  if (!isZero(n.rearm)) parts.push('Collected again when a winner stays up: ', n.rearm, '.')
  return parts
}

export function expectedLossStep(n: {
  perDecision: CoachNumber
  lifecycle: CoachNumber
  risked: CoachNumber
}): TemplateParts {
  return [
    'Expected loss ',
    n.perDecision,
    ' per decision; over its lifetime ',
    n.lifecycle,
    ' of ',
    n.risked,
    ' risked.',
  ]
}

export function edgeStep(n: {
  edge: CoachNumber
  nominal: CoachNumber
  breakage: CoachNumber
  perWorkingRoll: CoachNumber
}): TemplateParts {
  const parts: (string | CoachNumber)[] = ['Edge ', n.edge, ' as paid']
  if (!isZero(n.breakage)) parts.push(' (', n.nominal, ' unrounded)')
  parts.push('; per working roll ', n.perWorkingRoll, '.')
  return parts
}

function isZero(n: CoachNumber): boolean {
  return typeof n.exact === 'number' ? n.exact === 0 : n.exact.isZero()
}
