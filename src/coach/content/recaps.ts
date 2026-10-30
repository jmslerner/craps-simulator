import type { CoachNumber, TemplatePart, TemplateParts } from '../types.ts'

/**
 * Recap and teachable-moment wording (plan §5.5 surface 5, §5.4 teachable, §10 M9b). Every number
 * arrives as a `CoachNumber` built from the engine's own events — the settlement trace and the
 * table the roll was made on, never the solver — and dice totals, points and bet names arrive as
 * the machine's own text at run time. The content lint (`tests/content-lint.test.ts`) scans this
 * file, so no percentage, dollar amount or pay ratio is ever typed in here.
 */

/**
 * A win's arithmetic, the §10 M9b accept shape: stake × ratio = the exact product, what the
 * machine paid after its rounding, which way the rounding went (`kept` when the machine rounded
 * down and kept the fraction, `extra` when it rounded up and paid it; at most one is set, both
 * null for an exact pay), commission, what reached credit, and where the stake went.
 */
export function winMath(
  n: {
    stake: CoachNumber
    ratio: CoachNumber
    exact: CoachNumber
    paid: CoachNumber
    kept: CoachNumber | null
    extra: CoachNumber | null
    vigOnWin: CoachNumber | null
    vigRearm: CoachNumber | null
    credited: CoachNumber
  },
  stakeStays: boolean,
): TemplateParts {
  const parts: TemplatePart[] = [
    '(',
    { n: n.stake, style: 'compact' },
    ' × ',
    n.ratio,
    ' = ',
    { n: n.exact, style: 'exact' },
    ' → paid ',
    n.paid,
  ]
  if (n.kept !== null) parts.push(', machine kept ', { n: n.kept, style: 'exact' })
  if (n.extra !== null) {
    parts.push(', rounded up — machine paid ', { n: n.extra, style: 'exact' }, ' extra')
  }
  if (n.vigOnWin !== null) parts.push(', minus ', n.vigOnWin, ' commission')
  if (n.vigRearm !== null) parts.push(', commission ', n.vigRearm, ' re-collected from the win')
  parts.push(', +', n.credited, ' to credit, stake ', stakeStays ? 'stays up' : 'returned', ')')
  return parts
}

export function loseMath(n: { stake: CoachNumber }): TemplateParts {
  return ['(−', { n: n.stake, style: 'compact' }, ' stake)']
}

/** A barred come-out total: no money moves and the bet stays. */
export function pushBarMath(): TemplateParts {
  return ['(barred — no money moved, stake stays up)']
}

/** Odds that were off when their line bet was decided: returned undecided. */
export function pushOffReturnedMath(n: { stake: CoachNumber }): TemplateParts {
  return ['(off for this decision — ', { n: n.stake, style: 'compact' }, ' returned to credit)']
}

/** A composite whose parts won and lost the same amount. */
export function pushZeroNetMath(stakeStays: boolean): TemplateParts {
  return ['(won and lost the same — no net pay, stake ', stakeStays ? 'stays up' : 'returned', ')']
}

/**
 * A side bet's stake-back tier (M11: the Hot Shooter's "for 1" tier that pays the stake alone),
 * which nets 0 without any part winning or losing.
 */
export function pushStakeBackMath(stakeStays: boolean): TemplateParts {
  return ['(a stake-back tier — no net pay, stake ', stakeStays ? 'stays up' : 'returned', ')']
}

/** A side bet's push that leaves it up (M11: the Lucky Shooter's come-out 7 or 11). */
export function pushSideStaysMath(): TemplateParts {
  return ['(a push — no money moved, the bet stays up)']
}

export function vigRearmFromWinNote(): TemplateParts {
  return ['(already taken out of the win above)']
}

export function vigRearmFromCreditNote(): TemplateParts {
  return ['(charged to credit — the win did not cover it)']
}

export function vigPlacementNote(): TemplateParts {
  return ['(charged to credit with the bet)']
}

export function vigRefundNote(): TemplateParts {
  return ['(returned to credit)']
}

export function vigDeclinedNote(): TemplateParts {
  return ['(credit could not cover the commission to keep it up)']
}

// --- No-action lines (plan §5.5: bets the roll did not touch) ---

export function noActionOffSevenLine(
  name: string,
  total: string,
  n: { amount: CoachNumber },
): TemplateParts {
  return [name, ' ', n.amount, ' was off — the ', total, ' didn’t take it']
}

export function noActionOffLine(name: string, n: { amount: CoachNumber }): TemplateParts {
  return [name, ' ', n.amount, ' was off — no action']
}

export function noActionOnLine(
  name: string,
  total: string,
  n: { amount: CoachNumber },
): TemplateParts {
  return [name, ' ', n.amount, ' — no action on the ', total]
}

// --- Teachable moments (plan §5.4: event-triggered, first occurrences only) ---

/** The crapless equity point: the point landed on an outside number the pass line rarely repeats. */
export function momentPointOutsideLine(
  point: string,
  n: { stake: CoachNumber; equity: CoachNumber | null },
): TemplateParts {
  const parts: TemplatePart[] = [
    'Lesson: the point is ',
    point,
    ' — pass wins only when ',
    point,
    ' rolls again before a seven.',
  ]
  if (n.equity !== null) {
    parts.push(
      ' Your ',
      { n: n.stake, style: 'compact' },
      ' on the line is worth ',
      n.equity,
      ' right now.',
    )
  }
  return parts
}

export function momentComeOutsideLine(
  name: string,
  number: string,
  n: { stake: CoachNumber; equity: CoachNumber | null },
): TemplateParts {
  const parts: TemplatePart[] = [
    'Lesson: ',
    name,
    ' moved to ',
    number,
    ' — it wins only when ',
    number,
    ' rolls again before a seven.',
  ]
  if (n.equity !== null) {
    parts.push(
      ' Your ',
      { n: n.stake, style: 'compact' },
      ' there is worth ',
      n.equity,
      ' right now.',
    )
  }
  return parts
}

export function momentPlaceOffSevenLine(): TemplateParts {
  return ['Lesson: a come-out seven only beats working bets — your off bets were untouched.']
}

export function momentComeOddsReturnedLine(name: string): TemplateParts {
  return [
    'Lesson: ',
    name,
    ' was off for the come-out, so the machine returned it instead of deciding it with its come bet.',
  ]
}

/**
 * Only for a pay the machine rounded DOWN (`recap.ts` checks the trace's breakage sign): the words
 * describe this settlement, not the machine's rounding in general, since one machine can round a
 * place 6/8 pay up and every other pay down.
 */
export function momentRoundingLine(n: { kept: CoachNumber }): TemplateParts {
  return [
    'Lesson: the machine rounded this pay down — it kept ',
    { n: n.kept, style: 'exact' },
    ' of this win. Amounts the pay divides evenly avoid the shave.',
  ]
}

export function momentChasingLine(): TemplateParts {
  return [
    'Lesson: three losing rolls, then a bigger bet — the dice have no memory, and the odds never change.',
  ]
}
