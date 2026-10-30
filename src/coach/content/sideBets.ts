import type { CompiledSideBet } from '../../engine/index.ts'
import type { CoachNumber, TemplatePart, TemplateParts } from '../types.ts'

/**
 * The side bets' words (plan §5.4 `sideBetProgress`, §10 M11): where a bet on the table stands,
 * what settling now would pay, the next pay step and the exact chance of reaching it, and the
 * cheat sheet's note on how each family works. Every number arrives as a `CoachNumber`; the lists
 * of totals and points and the machine's pay labels arrive as the machine's own text at run time,
 * so no literal here carries a digit (the content lint rejects one). What ends or pays a bet is
 * read from its config (M11 → M12 hand-off), never assumed from a preset: a Lucky Roller that only
 * a seven-out takes (`endsOn`), a Fire Bet paid at once at a count (`payImmediatelyAt`).
 */

/** What ends a Lucky Roller's run, as the config says: any seven, or only a seven-out. */
export type CollectSetEnd = Extract<CompiledSideBet, { family: 'collectSet' }>['endsOn']

/** "before any seven" or "before a seven-out", by `/sideBets/<t>/endsOn`. */
function beforeTheEnd(endsOn: CollectSetEnd): string {
  return endsOn === 'anySeven' ? 'before any seven' : 'before a seven-out'
}

/** Lucky Roller: the targets rolled so far and the ones still needed before what ends it. */
export function collectSetStage(
  words: { rolled: string; remaining: string },
  n: { remaining: CoachNumber },
  endsOn: CollectSetEnd,
): TemplateParts {
  const before = beforeTheEnd(endsOn)
  if (words.rolled === '') {
    return ['Nothing collected yet: it needs ', words.remaining, ` ${before}.`]
  }
  return [
    'Rolled so far: ',
    words.rolled,
    '. Still needs ',
    words.remaining,
    ' (',
    n.remaining,
    ` more) ${before}.`,
  ]
}

/**
 * When a Fire Bet is paid: at the seven-out, or also at once on reaching the count the machine pays
 * immediately (`/sideBets/<t>/payImmediatelyAt`, given as `payAt`).
 */
function firePaid(payAt: CoachNumber | null): TemplatePart[] {
  return payAt === null
    ? [' It is paid at the seven-out.']
    : [' It is paid at the seven-out, or at once on reaching ', payAt, ' points.']
}

/** Fire Bet: the different points the hand has made among those that count. */
export function uniquePointsStage(
  words: { made: string },
  n: { count: CoachNumber; counted: CoachNumber; payAt: CoachNumber | null },
): TemplateParts {
  if (words.made === '') {
    return [
      'No point made yet this hand; ',
      n.counted,
      ' different points count.',
      ...firePaid(n.payAt),
    ]
  }
  return [
    'Points made this hand: ',
    words.made,
    ' — ',
    n.count,
    ' of the ',
    n.counted,
    ' that count.',
    ...firePaid(n.payAt),
  ]
}

/** Hot Shooter Jackpot: the rolls the hand has lasted so far. */
export function handLengthStage(n: { rolls: CoachNumber }): TemplateParts {
  return [
    'Rolls counted this hand: ',
    n.rolls,
    '. The seven-out settles it at the highest tier the count reaches.',
  ]
}

/** Lucky Shooter: its point and the other box numbers hit since. */
export function pointRunStage(
  words: { point: string; hits: string },
  n: { hits: CoachNumber },
): TemplateParts {
  if (words.point === '') return ['No point yet: the come-out roll sets it.']
  if (words.hits === '') {
    // Rules spec §6.3: the point, a seven, a craps or eleven total (and, where the machine says
    // so, a repeated number) all settle it, not only the point or a seven.
    return [
      'Point ',
      words.point,
      ', no hits yet: each different box number rolled next adds a hit, until the point, a seven or another settling roll ends it.',
    ]
  }
  return [
    'Point ',
    words.point,
    ' with ',
    n.hits,
    isOne(n.hits) ? ' hit so far: ' : ' hits so far: ',
    words.hits,
    '.',
  ]
}

/** What the bet pays if it settles on its next deciding roll without improving. */
export function settlesNowLine(
  kind: 'win' | 'push' | 'lose',
  payLabel: string,
  n: { cash: CoachNumber },
): TemplateParts {
  switch (kind) {
    case 'win':
      return ['Settled now it pays ', payLabel, ': ', n.cash, ' back.']
    case 'push':
      return ['Settled now it returns the stake: ', n.cash, '.']
    case 'lose':
      return ['Settled now it loses the stake.']
  }
}

/** The next pay step up, and the exact chance of ending there or higher. */
export function nextTierLine(
  kind: 'win' | 'push',
  payLabel: string,
  n: { chance: CoachNumber; cash: CoachNumber },
): TemplateParts {
  if (kind === 'push') {
    return ['Next step: the stake back (', n.cash, ') — ', n.chance, ' chance from here.']
  }
  return [
    'Next step: ',
    payLabel,
    ' (',
    n.cash,
    ' back) — ',
    n.chance,
    ' chance of reaching it from here.',
  ]
}

export function topTierLine(): TemplateParts {
  return ['Nothing left to reach: this is the top pay.']
}

/** When settling now loses and nothing from here pays more: every way down loses. */
export function nothingToWinLine(): TemplateParts {
  return ['Nothing left to win: every way it can still end loses the stake.']
}

/** The label of a tier that is no pay: the stake back (a push), or a loss. A win's is its pay. */
export function tierLabel(kind: 'push' | 'lose'): string {
  return kind === 'push' ? 'the stake back' : 'a loss'
}

/** The chance of any win from here, and how long the bet has left. */
export function sideChancesLine(n: { pWin: CoachNumber; rolls: CoachNumber }): TemplateParts {
  return ['Wins ', n.pWin, ' of the time from here, over about ', n.rolls, ' more rolls.']
}

/**
 * The cheat sheet's note on a side-bet row: how the bet settles, in words, from its config (what
 * ends a Lucky Roller; whether a Fire Bet is also paid at once).
 */
export function sideBetSheetNote(side: CompiledSideBet): TemplateParts {
  switch (side.family) {
    case 'collectSet':
      return [
        `Side bet: every target total must roll ${beforeTheEnd(side.endsOn)}, repeats and order aside; it locks once the dice roll.`,
      ]
    case 'uniquePointsMade':
      return side.payImmediatelyAt === null
        ? [
            'Side bet on the whole hand: paid at the seven-out by how many different points the hand made.',
          ]
        : [
            'Side bet on the whole hand: paid by how many different points the hand made, at once on reaching the count the machine pays immediately, else at the seven-out.',
          ]
    case 'handLength':
      return [
        'Side bet on the whole hand: paid at the seven-out by how many rolls the hand lasted.',
      ]
    case 'pointRun':
      return [
        'Side bet: a come-out box number becomes its point; each different box number hit next raises the pay, until the point, a seven or another settling roll ends it.',
      ]
  }
}

/** Whether a count is exactly one, for "1 hit" against "2 hits". */
function isOne(n: CoachNumber): boolean {
  return typeof n.exact === 'number' ? n.exact === 1 : n.exact.num === n.exact.den
}
