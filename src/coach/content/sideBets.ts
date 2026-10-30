import type { CoachNumber, TemplateParts } from '../types.ts'

/**
 * The side bets' words (plan §5.4 `sideBetProgress`, §10 M11): where a bet on the table stands,
 * what settling now would pay, the next pay step and the exact chance of reaching it, and the
 * cheat sheet's note on how each family works. Every number arrives as a `CoachNumber`; the lists
 * of totals and points and the machine's pay labels arrive as the machine's own text at run time,
 * so no literal here carries a digit (the content lint rejects one).
 */

export type SideBetFamilyWord = 'collectSet' | 'uniquePointsMade' | 'handLength' | 'pointRun'

/** Lucky Roller: the targets rolled so far and the ones still needed before a seven. */
export function collectSetStage(
  words: { rolled: string; remaining: string },
  n: { remaining: CoachNumber },
): TemplateParts {
  if (words.rolled === '') {
    return ['Nothing collected yet: it needs ', words.remaining, ' before any seven.']
  }
  return [
    'Rolled so far: ',
    words.rolled,
    '. Still needs ',
    words.remaining,
    ' (',
    n.remaining,
    ' more) before any seven.',
  ]
}

/** Fire Bet: the different points the hand has made among those that count. */
export function uniquePointsStage(
  words: { made: string },
  n: { count: CoachNumber; counted: CoachNumber },
): TemplateParts {
  if (words.made === '') {
    return [
      'No point made yet this hand; ',
      n.counted,
      ' different points count. It is paid at the seven-out.',
    ]
  }
  return [
    'Points made this hand: ',
    words.made,
    ' — ',
    n.count,
    ' of the ',
    n.counted,
    ' that count. It is paid at the seven-out.',
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
  return ['Point ', words.point, ' with ', n.hits, ' hits so far: ', words.hits, '.']
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

/** The label of a tier that is no pay: the stake back (a push), or a loss. A win's is its pay. */
export function tierLabel(kind: 'push' | 'lose'): string {
  return kind === 'push' ? 'the stake back' : 'a loss'
}

/** The chance of any win from here, and how long the bet has left. */
export function sideChancesLine(n: { pWin: CoachNumber; rolls: CoachNumber }): TemplateParts {
  return ['Wins ', n.pWin, ' of the time from here, over about ', n.rolls, ' more rolls.']
}

/** The cheat sheet's note on a side-bet row: how the family settles, in words. */
export function sideBetSheetNote(kind: SideBetFamilyWord): TemplateParts {
  switch (kind) {
    case 'collectSet':
      return [
        'Side bet: every target total must roll before any seven, repeats and order aside; it locks once the dice roll.',
      ]
    case 'uniquePointsMade':
      return [
        'Side bet on the whole hand: paid at the seven-out by how many different points the hand made.',
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
