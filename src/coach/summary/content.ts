import type { CoachNumber, TemplateParts } from '../types.ts'

/**
 * The session summary's words (plan §5.7, §10 M13). Like `coach/content/**`, every function takes
 * `CoachNumber`s and returns `TemplateParts`, so a number can only arrive computed: this file is
 * held to the content lint's strict rules (no digit in any string literal, no typed percentage,
 * dollar amount or ratio) by `summary.test.ts`. Machine words — bet labels, point numbers — come
 * in as plain strings, as `Advice.words` do.
 */

/** "1 decision" / "2 decisions": the noun follows the computed count. */
function counted(n: CoachNumber, one: string, many: string): TemplateParts {
  const single = typeof n.exact === 'number' ? n.exact === 1 : n.exact.num === n.exact.den
  return [n, single ? one : many]
}

/** The header's facts: how long the session ran. */
export function sessionFacts(
  machine: string,
  n: { rolls: CoachNumber; sevenOuts: CoachNumber },
): TemplateParts {
  return [
    machine,
    ' · ',
    ...counted(n.rolls, ' roll', ' rolls'),
    ' · ',
    ...counted(n.sevenOuts, ' seven-out', ' seven-outs'),
  ]
}

/** What the player put in: the buy-in, and any credit added after it. */
export function depositsNote(n: { start: CoachNumber; added: CoachNumber | null }): TemplateParts {
  return n.added === null
    ? [n.start, ' to start']
    : [n.start, ' to start, ', n.added, ' added — a top-up is never a win']
}

/** The cash-basis result: credit and the bets still up at face value, less everything put in. */
export function cashNote(): TemplateParts {
  return ['credit plus the bets still up at face value, less everything put in']
}

/** The equity-basis result: the bets still up counted at what they are worth. */
export function equityNote(n: { openBets: CoachNumber | null }): TemplateParts {
  return n.openBets === null
    ? ['no bets are up, so this is the cash result']
    : ['the ', n.openBets, ' still up counted at what those bets will return on average']
}

/** Expected: what the choices cost on average. */
export function expectedNote(): TemplateParts {
  return ['what your bets cost on average: each decision’s house edge in dollars']
}

/** Luck: everything the dice did beyond the average. */
export function luckNote(): TemplateParts {
  return ['what the dice gave or took beyond that; it averages out to nothing over time']
}

/** One bet family's share of the expected loss. */
export function familyLine(
  label: string,
  n: { cost: CoachNumber; decisions: CoachNumber },
): TemplateParts {
  return [label, ': ', n.cost, ' over ', ...counted(n.decisions, ' decision', ' decisions')]
}

/** Shown when no bet was made. */
export function noBets(): TemplateParts {
  return ['No bets yet: nothing has cost anything.']
}

/**
 * A same-event leak (plan §5.7): the bet made instead of a cheaper one that wins and loses on the
 * same rolls, and what the choice cost over the decisions it was made for.
 */
export function leakLine(
  from: string,
  to: string,
  numbers: string,
  n: { cost: CoachNumber; decisions: CoachNumber },
): TemplateParts {
  const on = numbers === '' ? '' : ` ${numbers}`
  return [
    from,
    on,
    ' instead of ',
    to,
    ': ',
    n.cost,
    ' over ',
    ...counted(n.decisions, ' decision', ' decisions'),
  ]
}

/** No leak: no bet had a cheaper same-event twin. */
export function noLeaks(): TemplateParts {
  return ['None: no bet you made had a cheaper bet that wins and loses on exactly the same rolls.']
}

/**
 * A next-session focus (plan §5.7): one switch, and what it saves an hour at this session's
 * betting, at the machine's pace and across the pace range.
 */
export function focusLine(
  from: string,
  to: string,
  numbers: string,
  n: {
    perHour: CoachNumber
    pace: CoachNumber
    low: { value: CoachNumber; pace: CoachNumber }
    high: { value: CoachNumber; pace: CoachNumber }
  },
): TemplateParts {
  const on = numbers === '' ? '' : ` ${numbers}`
  return [
    'Switch ',
    from,
    on,
    ' to ',
    to,
    ': saves ',
    n.perHour,
    ' at this machine’s ',
    n.pace,
    ' rolls an hour (',
    n.low.value,
    ' at ',
    n.low.pace,
    ', ',
    n.high.value,
    ' at ',
    n.high.pace,
    ').',
  ]
}

/** No focus: nothing in this session to switch. */
export function noFocus(): TemplateParts {
  return ['Nothing to switch: keep the bets you like, and watch what each family costs above.']
}
