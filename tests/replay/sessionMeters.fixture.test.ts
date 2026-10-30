import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Fraction, headerConfig, parseSessionLog, sessionFromLog } from '../../src/engine/index.ts'
import { metersOfSession, sessionTotals } from '../../src/coach/summary/meters.ts'
import { summarizeSession } from '../../src/coach/summary/summary.ts'
import { accountSession } from '../../src/exact/summary.ts'
import { oracleMeters } from '../../src/ui/test/metersOracle.ts'

/**
 * Golden session meters (rules spec §4.6) on the pinned crapless-200 fixture: 200 rolls of the
 * default machine with eight top-ups, buy bets with their commission up front and re-collected
 * from wins, and 25 odds bets handed back unplayed. The figures are pinned to the cent, equal the
 * independent recomputation (`src/ui/test/metersOracle.ts`) and the fixture's ledger, and agree
 * with the session summary's own account (M13): its deposits figure is the credit added, and its
 * played decisions are exactly the decisions and stakes the total wagered counts.
 */

const FIXTURE = new URL('./fixtures/crapless-200.json', import.meta.url)

function fixtureSession() {
  const parsed = parseSessionLog(readFileSync(FIXTURE, 'utf8'))
  if (!parsed.ok) throw new Error(`the fixture does not parse: ${JSON.stringify(parsed.error)}`)
  const loaded = sessionFromLog(parsed.log)
  if (!loaded.ok) throw new Error(`the fixture does not load: ${JSON.stringify(loaded.error)}`)
  return { session: loaded.session, cfg: headerConfig(parsed.log.header) }
}

describe('the session meters of the crapless-200 fixture', () => {
  const { session, cfg } = fixtureSession()
  const { ledger } = session.state
  const pair = metersOfSession(session, cfg)
  const totals = sessionTotals(pair.current, ledger)

  it('credit added: $2,100.00 in nine deposits, the $500.00 buy-in and eight top-ups', () => {
    expect(totals.creditAdded).toBe(210_000)
    expect(totals.deposits).toBe(9)
    expect(totals.buyIn).toBe(50_000)
    expect(totals.topUps).toStrictEqual([
      { amount: 20_000, beforeRoll: 25 },
      { amount: 10_000, beforeRoll: 58 },
      { amount: 20_000, beforeRoll: 75 },
      { amount: 20_000, beforeRoll: 83 },
      { amount: 20_000, beforeRoll: 100 },
      { amount: 30_000, beforeRoll: 117 },
      { amount: 20_000, beforeRoll: 125 },
      { amount: 20_000, beforeRoll: 175 },
    ])
  })

  it('total wagered: $4,346.00 over 243 decisions', () => {
    expect(totals.wagered).toBe(434_600)
    expect(totals.decisions).toBe(243)
  })

  it('commission paid: $167.55, $146.30 up front and $21.25 re-collected from wins', () => {
    expect(totals.commission).toBe(16_755)
    expect(totals.commissionParts).toStrictEqual({
      upfront: 14_630,
      fromWins: 0,
      recollected: 2_125,
    })
  })

  it('equals the independent recomputation and the fixture ledger', () => {
    const oracle = oracleMeters(session, cfg)
    expect(totals.creditAdded).toBe(oracle.creditAdded)
    expect(totals.topUps).toStrictEqual(oracle.topUps)
    expect(totals.wagered).toBe(oracle.wagered)
    expect(totals.decisions).toBe(oracle.decisions)
    expect(totals.commission).toBe(oracle.commission)
    expect(ledger.deposits).toBe(210_000)
    expect(ledger.vigPaid).toBe(16_755)
    // The engine's own `wagered` also counts the 25 odds bets handed back unplayed ($384.00),
    // which rules spec §0.1 does not count as decisions.
    expect(oracle.notDecisions).toBe(25)
    expect(oracle.seen.offReturned).toBe(25)
    expect(oracle.notDecidedStakes).toBe(38_400)
    expect(ledger.wagered).toBe(473_000)
    // No open window: the committed windows are the whole session.
    expect(pair.committed).toStrictEqual(pair.current)
  })

  it('agrees with the session summary’s own account (M13)', () => {
    const account = accountSession(session.header, session.committed, session.pending, cfg)
    const summary = summarizeSession(account, cfg)
    expect(summary.deposits.exact).toBe(totals.creditAdded)
    const played = account.rolls.flatMap((roll) => roll.bets.filter((bet) => bet.playedDecision))
    expect(played).toHaveLength(243)
    expect(played.reduce((sum, bet) => sum + bet.amount, 0)).toBe(434_600)
    const familyDecisions = Fraction.sum(
      summary.byFamily.map(({ decisions }) =>
        typeof decisions.exact === 'number' ? Fraction.of(decisions.exact) : decisions.exact,
      ),
    )
    expect(familyDecisions.toString()).toBe('243')
  })
})
