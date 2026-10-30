import type { CoachNumber, TemplateParts } from '../types.ts'

/**
 * The advisors' words (plan §5.4, §10 M9c). Each template takes the advice's `CoachNumber`s and
 * machine words (bet labels, pay labels) and returns `TemplateParts`; a raw number cannot be
 * interpolated and the content lint keeps literal percentages, dollars and ratios out of here.
 * Which template an `Advice` uses is its `templateId`, resolved in `advisors/render.ts`.
 */

export function edgeWarningParts(
  n: { edge: CoachNumber; per: CoachNumber; base: CoachNumber },
  words: { name: string; grade: string },
): TemplateParts {
  return [
    words.name,
    ' costs ',
    n.edge,
    ' of what you risk (',
    words.grade,
    '): ',
    n.per,
    ' of every ',
    n.base,
    ' you put on it.',
  ]
}

export function sameEventParts(
  n: { ownEdge: CoachNumber; altEdge: CoachNumber; savingPerDecision: CoachNumber },
  words: { from: string; to: string },
): TemplateParts {
  return [
    words.to,
    ' wins and loses on exactly the same rolls as ',
    words.from,
    ', for less: ',
    n.altEdge,
    ' instead of ',
    n.ownEdge,
    ' — about ',
    n.savingPerDecision,
    ' back per decision at this stake.',
  ]
}

export function restructureParts(
  n: { ownEdge: CoachNumber; altEdge: CoachNumber },
  words: { from: string; to: string },
): TemplateParts {
  return [
    'Not the same bet, but worth knowing: ',
    words.to,
    ' runs at ',
    n.altEdge,
    ' against ',
    n.ownEdge,
    ' on ',
    words.from,
    '.',
  ]
}

export function sizingParts(
  n: { stake: CoachNumber; edge: CoachNumber; betterAmount: CoachNumber; betterEdge: CoachNumber },
  words: { name: string },
): TemplateParts {
  return [
    words.name,
    ' at ',
    n.stake,
    ' runs at ',
    n.edge,
    '; at ',
    n.betterAmount,
    ' the machine pays it exactly — ',
    n.betterEdge,
    '.',
  ]
}

export function oddsParts(
  n: { flatEdge: CoachNumber; withOdds: CoachNumber },
  words: { line: string; odds: string },
): TemplateParts {
  return [
    words.odds,
    ' behind your ',
    words.line,
    ' dilute the average cost: ',
    n.flatEdge,
    ' alone, ',
    n.withOdds,
    ' with full odds. Odds lower the edge per dollar wagered — they never shrink the flat bet’s expected loss.',
  ]
}

export function oddsNotFreeParts(
  n: { oddsEdge: CoachNumber },
  words: { odds: string; number: string },
): TemplateParts {
  return [
    'Careful: the ',
    words.odds,
    ' on ',
    words.number,
    ' are not free on this machine — on their own they cost ',
    n.oddsEdge,
    '.',
  ]
}

export function roundingParts(
  n: {
    stake: CoachNumber
    edge: CoachNumber
    nominalEdge: CoachNumber
    betterAmount: CoachNumber
    betterEdge: CoachNumber
  },
  words: { name: string },
): TemplateParts {
  return [
    words.name,
    ' at ',
    n.stake,
    ' loses part of each win to rounding: ',
    n.edge,
    ' as paid against ',
    n.nominalEdge,
    ' unrounded. At ',
    n.betterAmount,
    ' it pays exactly — ',
    n.betterEdge,
    '.',
  ]
}

export function minVigParts(n: { freeFrom: CoachNumber; edge: CoachNumber }): TemplateParts {
  return [
    'The commission minimum binds at this size, so the vig is a bigger share than the rate: ',
    n.edge,
    ' here. From ',
    n.freeFrom,
    ' up, the rate is all you pay.',
  ]
}

export function variantContextParts(
  n: { crapless: CoachNumber; traditional: CoachNumber; cheap: CoachNumber },
  words: { name: string; cheap: string },
): TemplateParts {
  return [
    'Crapless protects your ',
    words.name,
    ' from craps but charges for it: ',
    n.crapless,
    ' here, against ',
    n.traditional,
    ' for the same bet on a traditional machine. The cheap bet on this machine is ',
    words.cheap,
    ' at ',
    n.cheap,
    '.',
  ]
}

export function workingOffParts(words: { name: string }): TemplateParts {
  return [
    words.name,
    ' is OFF for this roll: it cannot win, and a seven cannot take it while it sits out.',
  ]
}

export function workingHeldParts(n: { count: CoachNumber }): TemplateParts {
  return [
    '',
    n.count,
    ' of your bets are held OFF since the seven-out. Set bets On returns them to the machine defaults.',
  ]
}

export function workingCostParts(n: {
  nowHour: CoachNumber
  thenHour: CoachNumber
}): TemplateParts {
  return [
    'Working bets on the come-out cost ',
    n.nowHour,
    ' at this pace; with them off for the come-out it is ',
    n.thenHour,
    '.',
  ]
}

export function layoutCostParts(n: {
  perRoll: CoachNumber
  hourLow: CoachNumber
  hourHigh: CoachNumber
}): TemplateParts {
  return [
    'This layout costs about ',
    n.perRoll,
    ' a roll — ',
    n.hourLow,
    ' to ',
    n.hourHigh,
    ' across machine paces.',
  ]
}

export function layoutSwapsParts(n: {
  nowRoll: CoachNumber
  thenRoll: CoachNumber
}): TemplateParts {
  return [
    'The same exposure is available for less: ',
    n.thenRoll,
    ' a roll instead of ',
    n.nowRoll,
    ', swapping each bet for its same-event twin.',
  ]
}
