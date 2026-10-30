import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  compileConfig,
  deserializeSession,
  serializeSession,
  type MachineConfig,
  type WindowedSession,
} from '../../src/engine/index.ts'
import { metersOfSession, sessionTotals } from '../../src/coach/summary/meters.ts'
import { oracleMeters, type OracleMeters } from '../../src/ui/test/metersOracle.ts'
import { DIFF_MACHINES } from './machineVariants.ts'
import { newSummaryReport, playSummarySession, summaryMove } from './summaryDriver.ts'

/**
 * The session meters (rules spec §4.6) as a property over random sessions, fast-check seed
 * 20261028, on every preset and every machine variant of the differential — commission charged
 * up front, taken from wins, capped at the win, re-collected from the win or from credit, declined
 * when credit is short, refunded on take-downs. Each session is played through the betting window
 * (`summaryDriver.ts`: bets, side bets, odds, presses, cuts, take-downs, switches, macros, credit
 * added mid-hand, undo, clear, scripted and drawn rolls), then:
 *
 * 1. the fold over its log (`metersOfSession`, what a resume computes) equals an independent
 *    recomputation from the logged deposit actions and the replayed settlement traces and
 *    commission events (`src/ui/test/metersOracle.ts`): every deposit, the total wagered and its
 *    decisions, the commission and its parts;
 * 2. the engine's ledger agrees: credit added is `Ledger.deposits`, the commission's parts add up
 *    to `Ledger.vigPaid`, and the total wagered plus the stakes of the settlements that are no
 *    decision (odds handed back unplayed, a side bet left up) is `Ledger.wagered`;
 * 3. the session serialized, parsed and resumed folds to the same meters.
 *
 * The live store's side of the same property (the meters maintained action by action, undo and
 * clear included, then restored) runs in `src/ui/state/sessionMeters.test.ts`.
 */

/**
 * Runs per machine. The Lucky Shooter's come-out 7 or 11, the one settlement that leaves a side bet
 * up, needs the bet placed (one of four side bets) before a come-out that rolls 7 or 11: about one
 * session in thirty, so its machine gets more runs.
 */
const runsFor = (id: string): number => (id === 'strictBubble' ? 200 : 25)
const MAX_MOVES = 60

interface Reached {
  sessions: number
  topUps: number
  undos: number
  offReturned: number
  sideBetLeftUp: number
  barPushes: number
  declinedRecollections: number
  recollectedFromCredit: number
  fromWins: number
}

const reached: Reached = {
  sessions: 0,
  topUps: 0,
  undos: 0,
  offReturned: 0,
  sideBetLeftUp: 0,
  barPushes: 0,
  declinedRecollections: 0,
  recollectedFromCredit: 0,
  fromWins: 0,
}

function check(session: WindowedSession, cfg: MachineConfig): OracleMeters {
  const { ledger } = session.state
  const oracle = oracleMeters(session, cfg)
  const pair = metersOfSession(session, cfg)
  const totals = sessionTotals(pair.current, ledger)
  const where = `${cfg.id}, ${session.committed.length} rolls`

  // 1. The fold equals the independent recomputation.
  expect(totals.buyIn, where).toBe(oracle.buyIn)
  expect(totals.topUps, where).toStrictEqual(oracle.topUps)
  expect(totals.deposits, where).toBe((oracle.buyIn > 0 ? 1 : 0) + oracle.topUps.length)
  expect(totals.wagered, where).toBe(oracle.wagered)
  expect(totals.decisions, where).toBe(oracle.decisions)
  expect(totals.commissionParts, where).toStrictEqual({
    upfront: oracle.upfront,
    fromWins: oracle.fromWins,
    recollected: oracle.recollected,
  })

  // 2. The engine's ledger agrees with the definitions.
  expect(totals.creditAdded, where).toBe(oracle.creditAdded)
  expect(oracle.creditAdded, `${where}: deposits`).toBe(ledger.deposits)
  expect(oracle.commission, `${where}: vigPaid`).toBe(ledger.vigPaid)
  expect(totals.commission, where).toBe(oracle.commission)
  expect(oracle.wagered + oracle.notDecidedStakes, `${where}: wagered`).toBe(ledger.wagered)
  for (const [part, amount] of Object.entries(totals.commissionParts ?? {})) {
    expect(amount, `${where}: commission ${part}`).toBeGreaterThanOrEqual(0)
  }

  // The committed meters are the log up to the last roll: with an empty open window, the same.
  if (session.pending.length === 0) expect(pair.committed, where).toStrictEqual(pair.current)

  // 3. Saved, loaded and resumed: the same meters.
  const loaded = deserializeSession(serializeSession(session))
  expect(loaded.ok, where).toBe(true)
  if (loaded.ok) expect(metersOfSession(loaded.session, cfg), where).toStrictEqual(pair)
  return oracle
}

describe('the session meters over random sessions (rules spec §4.6)', () => {
  for (const machine of DIFF_MACHINES) {
    it(`fold = independent recomputation = ledger on ${machine.id}`, { timeout: 60_000 }, () => {
      const cfg = compileConfig(machine.input)
      const report = newSummaryReport()
      fc.assert(
        fc.property(
          fc.string({ maxLength: 6 }),
          fc.array(summaryMove, { minLength: 1, maxLength: MAX_MOVES, size: 'max' }),
          (seed, moves) => {
            const session = playSummarySession(cfg, `meters-${seed}`, moves, report)
            const oracle = check(session, cfg)
            reached.sessions += 1
            reached.topUps += oracle.topUps.length
            reached.offReturned += oracle.seen.offReturned
            reached.sideBetLeftUp += oracle.seen.sideBetLeftUp
            reached.barPushes += oracle.seen.barPushes
            reached.declinedRecollections += oracle.seen.declinedRecollections
            reached.recollectedFromCredit += oracle.seen.recollectedFromCredit
            if (oracle.fromWins > 0) reached.fromWins += 1
          },
        ),
        { seed: 20261028, numRuns: runsFor(machine.id) },
      )
      reached.undos += report.undos
    })
  }

  // A barred tie (a don't bet on a come-out 12), which counts, is rare in these sessions; the
  // scripted cases in src/coach/summary/meters.test.ts pin it.
  it('reached what the meters must account for', () => {
    expect(reached.sessions).toBe(
      DIFF_MACHINES.reduce((sum, machine) => sum + runsFor(machine.id), 0),
    )
    expect(reached.topUps, 'credit added after the buy-in').toBeGreaterThan(0)
    expect(reached.undos, 'undone actions').toBeGreaterThan(0)
    expect(reached.offReturned, 'odds handed back unplayed').toBeGreaterThan(0)
    expect(reached.sideBetLeftUp, 'a side bet left up by its settlement').toBeGreaterThan(0)
    expect(reached.recollectedFromCredit, 're-collections from credit').toBeGreaterThan(0)
    expect(reached.declinedRecollections, 'declined re-collections').toBeGreaterThan(0)
    expect(reached.fromWins, 'sessions with commission from wins').toBeGreaterThan(0)
  })
})
