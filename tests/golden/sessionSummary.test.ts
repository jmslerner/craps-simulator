import { describe, expect, it } from 'vitest'
import {
  Fraction,
  PRESETS,
  cents,
  compileConfig,
  deserializeSession,
  dispatchBetting,
  makeRoll,
  newSession,
  rollWindow,
  serializeSession,
  type Action,
  type Total,
  type WindowedSession,
} from '../../src/engine/index.ts'
import { formatCoachNumber, formatPart } from '../../src/coach/format.ts'
import { formatSignedMoney } from '../../src/coach/summary/format.ts'
import { summarizeSession, type SessionSummary } from '../../src/coach/summary/summary.ts'
import type { CoachLine, CoachNumber } from '../../src/coach/types.ts'
import { accountSession, identityGap } from '../../src/exact/summary.ts'

/**
 * The session summary's golden fixture (plan §10 M13: "a fixture session matches its golden
 * numbers"). A short scripted session on the default crapless machine, chosen to reach every kind
 * of entry the account books — a line bet, odds, place bets that win and stay up (the machine's
 * re-wager), a take-down, a point made, a come-out natural, a side bet that progresses and loses,
 * credit added mid-hand, and an open window — and every golden number below is derived here from
 * the rules alone (rules spec §2–§3, §6.1), with closed-form craps probabilities in exact
 * fractions: nothing comes from the engine's or the solver's code.
 *
 * - P(n before 7) = ways(n) / (ways(n) + 6).
 * - Crapless pass: a come-out 7 wins; every other total is a point, won if it repeats before a 7.
 *   Its edge, 1 − 2·P(win), must equal the published 373/6930 (plan §5.4 variantContext).
 * - Low Rolls (Lucky Roller, "31 for 1"): it pays 31 × the stake when 2, 3, 4, 5 and 6 have all
 *   rolled before any 7; P(all of R before a 7) by inclusion–exclusion over the subsets T of R:
 *   Σ (−1)^|T| · 6 / (6 + ways(T)).
 * - Equity = E[what the current decision returns], a stake that stays up counted as returned.
 *
 * The session (Crapless bubble craps preset: pass stays up after a win, place 4 pays 9:5, place 6
 * pays 7:6, buy vig 5% up front, pace 120 rolls an hour):
 *
 * | Window | Bets | Roll |
 * |---|---|---|
 * | 0 | Pass $10, Low Rolls $1 | 2+2: point 4; Low Rolls has the 4 |
 * | 1 | Pass odds $20, Place 4 $5, Place 6 $6, add $100 credit | 3+3: Place 6 wins $7 and stays; Low Rolls has the 6 |
 * | 2 | Place 6 down | 1+3: point made — pass wins and stays, odds win $40, Place 4 wins $9 and stays |
 * | 3 | — | 3+4: come-out natural — pass wins and stays, Place 4 and Low Rolls lose |
 * | open | Field $5 | |
 */

const CFG = compileConfig(PRESETS.craplessBubble)

const WAYS: Readonly<Record<Total, number>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
}
const p = (total: Total): Fraction => Fraction.of(WAYS[total], 36)
const before7 = (n: Total): Fraction => p(n).div(p(n).add(p(7)))
const POINTS: readonly Total[] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
const PASS_WIN = Fraction.sum([p(7), ...POINTS.map((n) => p(n).mul(before7(n)))])

/** P(every total in `targets` rolls before a 7). */
function allBefore7(targets: readonly Total[]): Fraction {
  let total = Fraction.ZERO
  for (let subset = 0; subset < 2 ** targets.length; subset++) {
    const chosen = targets.filter((_, index) => (subset & (2 ** index)) !== 0)
    const term = p(7).div(p(7).add(Fraction.sum(chosen.map(p))))
    total = chosen.length % 2 === 0 ? total.add(term) : total.sub(term)
  }
  return total
}

const c = (n: number): Fraction => Fraction.of(n)
// Equities, in cents.
const PASS_COME_OUT = c(2000).mul(PASS_WIN) // $10 pass: $20 back on a win
const PASS_ON_4 = c(2000).mul(before7(4))
const ODDS_ON_4 = c(6000).mul(before7(4)) // $20 at 2:1: $60 back
const PLACE_4 = c(1400).mul(before7(4)) // $5 at 9:5: $14 back
const PLACE_6 = c(1300).mul(before7(6)) // $6 at 7:6: $13 back
// $5 field: 2:1 on 2 and 12, 1:1 on 3, 4, 9, 10, 11.
const FIELD = c(500).mul(
  Fraction.sum(
    ([2, 3, 4, 9, 10, 11, 12] as const).map((t) => p(t).mul(c(t === 2 || t === 12 ? 3 : 2))),
  ),
)
const LOW = (rolled: readonly Total[]): Fraction =>
  c(3100).mul(allBefore7(([2, 3, 4, 5, 6] as const).filter((t) => !rolled.includes(t))))
const LOW_0 = LOW([])
const LOW_1 = LOW([4])
const LOW_2 = LOW([4, 6])

// Decision costs: outlay − Δequity.
const PASS_COST = c(1000).sub(PASS_COME_OUT)
const PLACE_4_COST = c(500).sub(PLACE_4)
const PLACE_6_COST = c(600).sub(PLACE_6)
const GOLDEN = {
  /** Pass placed + re-wagered twice; Low Rolls; odds (true odds: 0); Place 4 placed and re-wagered;
   * Place 6 placed, re-wagered and taken down (one decision's cost net); the field. */
  cost: Fraction.sum([
    PASS_COST.mul(c(3)),
    c(100).sub(LOW_0),
    PLACE_4_COST.mul(c(2)),
    PLACE_6_COST,
    c(500).sub(FIELD),
  ]),
  luck: Fraction.sum([
    // 2+2: the point is 4; Low Rolls has the 4.
    PASS_ON_4.sub(PASS_COME_OUT),
    LOW_1.sub(LOW_0),
    // 3+3: Place 6 pays $7 and stays ($13 realized); Low Rolls has the 6.
    c(1300).sub(PLACE_6),
    LOW_2.sub(LOW_1),
    // 1+3: pass $20 realized, odds $60, Place 4 $14.
    c(2000).sub(PASS_ON_4),
    c(6000).sub(ODDS_ON_4),
    c(1400).sub(PLACE_4),
    // 3+4: pass $20 realized; Place 4 and Low Rolls lose.
    c(2000).sub(PASS_COME_OUT),
    PLACE_4.neg(),
    LOW_2.neg(),
  ]),
  /** Credit $655 + $15 on the table − $600 put in. */
  resultCash: 7000,
  /** Credit $655 + the pass and field equities − $600 put in. */
  resultEquity: c(65500).add(PASS_COME_OUT).add(FIELD).sub(c(60000)),
  /** Place 4 at $5 loses 100/3¢ a decision, Buy 4 at $5 only its 25¢ vig: 2 decisions. */
  leak: c(500).sub(PLACE_4).sub(c(25)).mul(c(2)),
}

function play(): WindowedSession {
  let session = newSession(CFG, 'summary-golden')
  const bet = (action: Action): void => {
    const result = dispatchBetting(session, action, CFG)
    if (!result.ok) throw new Error(`refused ${JSON.stringify(action)}: ${result.rejection.code}`)
    session = result.session
  }
  const roll = (d1: number, d2: number): void => {
    const result = rollWindow(session, CFG, makeRoll(d1, d2))
    if (!result.ok) throw new Error(`roll refused: ${result.rejection.code}`)
    session = result.session
  }
  const idOf = (typeId: string, number: number | null = null) => {
    const found = session.state.bets.find((b) => b.typeId === typeId && b.number === number)
    if (found === undefined) throw new Error(`no ${typeId} ${number}`)
    return found.id
  }
  bet({ type: 'place', typeId: 'pass', amount: cents(1000) })
  bet({ type: 'place', typeId: 'luckyRollerLow', amount: cents(100) })
  roll(2, 2)
  bet({ type: 'place', typeId: 'passOdds', parentId: idOf('pass', 4), amount: cents(2000) })
  bet({ type: 'place', typeId: 'place', number: 4, amount: cents(500) })
  bet({ type: 'place', typeId: 'place', number: 6, amount: cents(600) })
  bet({ type: 'deposit', amount: cents(10_000) })
  roll(3, 3)
  bet({ type: 'setAmount', betId: idOf('place', 6), amount: cents(0) })
  roll(1, 3)
  roll(3, 4)
  bet({ type: 'place', typeId: 'field', amount: cents(500) })
  return session
}

const exact = (n: CoachNumber): Fraction =>
  typeof n.exact === 'number' ? Fraction.of(n.exact) : n.exact
const text = (line: CoachLine): string => line.parts.map((part) => formatPart(part)).join('')

describe('the session summary golden fixture', () => {
  const session = play()
  const account = accountSession(session.header, session.committed, session.pending, CFG)
  const summary = summarizeSession(account, CFG)

  it('derives the crapless pass from the rules: the published 373/6930 edge', () => {
    expect(
      c(1)
        .sub(PASS_WIN.mul(c(2)))
        .equals(Fraction.of(373, 6930)),
    ).toBe(true)
  })

  it('plays as scripted: credit $655, pass and field up, $600 put in', () => {
    expect(session.state.ledger.bankroll).toBe(65_500)
    expect(session.state.ledger.deposits).toBe(60_000)
    expect(session.state.bets.map((b) => [b.typeId, b.amount])).toEqual([
      ['pass', 1000],
      ['field', 500],
    ])
  })

  it('books the golden decision cost and luck, and the identity holds exactly', () => {
    expect(account.cost.equals(GOLDEN.cost)).toBe(true)
    expect(account.luck.equals(GOLDEN.luck)).toBe(true)
    expect(identityGap(account).isZero()).toBe(true)
    expect(account.end.wealth.sub(c(60_000)).equals(GOLDEN.resultEquity)).toBe(true)
    expect(GOLDEN.resultEquity.equals(GOLDEN.luck.sub(GOLDEN.cost))).toBe(true)
  })

  it('books the machine’s re-wagers of winners that stay up', () => {
    const rewagers = account.costs.filter((entry) => entry.kind === 'rewager')
    expect(rewagers.map((entry) => [entry.window, entry.spec.typeId])).toEqual([
      [1, 'place'],
      [2, 'pass'],
      [2, 'place'],
      [3, 'pass'],
    ])
    expect(rewagers.map((entry) => entry.cost.toString())).toEqual(
      [PLACE_6_COST, PASS_COST, PLACE_4_COST, PASS_COST].map((cost) => cost.toString()),
    )
    // The take-down hands back the expected loss of the decision it leaves.
    const down = account.costs.find((entry) => entry.window === 2 && entry.kind === 'action')
    expect(down?.cost.equals(PLACE_6_COST.neg())).toBe(true)
  })

  it('shows the golden result, expected and luck', () => {
    expect(exact(summary.resultCash).equals(c(GOLDEN.resultCash))).toBe(true)
    expect(exact(summary.resultEquity).equals(GOLDEN.resultEquity)).toBe(true)
    expect(exact(summary.expected).equals(GOLDEN.cost.neg())).toBe(true)
    expect(exact(summary.luck).equals(GOLDEN.luck)).toBe(true)
    expect(formatCoachNumber(summary.deposits)).toBe('$600.00')
    expect(formatSignedMoney(summary.resultCash)).toBe('+$70.00')
    expect(text(summary.facts)).toBe('Crapless bubble craps · 4 rolls · 0 seven-outs')
    expect(text(summary.depositsNote)).toBe(
      '$500.00 to start, $100.00 added — a top-up is never a win',
    )
  })

  it('splits the expected loss by family, with each family’s settled decisions', () => {
    const rows = Object.fromEntries(
      summary.byFamily.map((row) => [row.group, [exact(row.cost), exact(row.decisions)]]),
    )
    expect(Object.keys(rows).sort()).toEqual(['line', 'number', 'odds', 'oneRoll', 'side'])
    const expectRow = (group: string, cost: Fraction, decisions: number): void => {
      const [shown, count] = rows[group] ?? []
      expect(shown?.equals(cost), `${group} cost`).toBe(true)
      expect(count?.equals(c(decisions)), `${group} decisions`).toBe(true)
    }
    expectRow('line', PASS_COST.mul(c(3)), 2)
    expectRow('odds', Fraction.ZERO, 1)
    expectRow('number', PLACE_4_COST.mul(c(2)).add(PLACE_6_COST), 3)
    expectRow('oneRoll', c(500).sub(FIELD), 0)
    expectRow('side', c(100).sub(LOW_0), 1)
  })

  it('finds the one same-event leak: Place 4 instead of Buy, over its 2 decisions', () => {
    expect(summary.leaks).toHaveLength(1)
    const [leak] = summary.leaks
    expect(leak?.from.typeId).toBe('place')
    expect(leak?.to.typeId).toBe('buy')
    expect(leak?.numbers).toEqual([4])
    expect(leak !== undefined && exact(leak.cost).equals(GOLDEN.leak.neg())).toBe(true)
    expect(leak !== undefined && text(leak.line)).toBe(
      'Place 4 instead of Buy: ≈ -$0.17 over 2 decisions',
    )
  })

  it('makes that leak the focus: $5.00 an hour at 120 rolls an hour', () => {
    // 50/3¢ over 4 rolls, at 60, 120 (the machine's pace) and 150 rolls an hour.
    expect(summary.focus).toHaveLength(1)
    const [focus] = summary.focus
    expect(focus !== undefined && exact(focus.perHour).equals(c(500))).toBe(true)
    expect(focus?.leak.perHour.map((pace) => [pace.at, exact(pace.value).toString()])).toEqual([
      [60, '250'],
      [120, '500'],
      [150, '625'],
    ])
    expect(focus !== undefined && text(focus.line)).toBe(
      'Switch Place 4 to Buy: saves $5.00/hr at this machine’s 120 rolls an hour ($2.50/hr at 60, $6.25/hr at 150).',
    )
  })

  it('summarises the saved, loaded and resumed session identically', () => {
    const loaded = deserializeSession(serializeSession(session))
    if (!loaded.ok) throw new Error('the golden session does not load')
    const again: SessionSummary = summarizeSession(
      accountSession(loaded.session.header, loaded.session.committed, loaded.session.pending, CFG),
      CFG,
    )
    expect(again).toEqual(summary)
  })
})
