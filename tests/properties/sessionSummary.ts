import fc from 'fast-check'
import { expect } from 'vitest'
import {
  ALL_ROLLS,
  Fraction,
  applyAction,
  compileConfig,
  deserializeSession,
  hashJson,
  newTable,
  serializeSession,
  type MachineConfig,
  type TableState,
  type WindowedSession,
} from '../../src/engine/index.ts'
import { SAME_EVENT_MIN_SAVING } from '../../src/coach/policy.ts'
import { sameEventSwitch } from '../../src/coach/summary/leaks.ts'
import { summarizeSession } from '../../src/coach/summary/summary.ts'
import { analyzeBet, sameEvents } from '../../src/exact/index.ts'
import {
  SessionAccountant,
  accountRoll,
  accountSession,
  identityGap,
  type SessionAccount,
} from '../../src/exact/summary.ts'
import type { DiffMachine } from './machineVariants.ts'
import {
  newSummaryReport,
  playSummarySession,
  summaryMove,
  type SummaryPlayReport,
} from './summaryDriver.ts'

/**
 * The session-summary properties (plan §5.7, §10 M13), shared by the quick suite
 * (`sessionSummary.prop.test.ts`) and the slow one (`tests/slow/sessionSummary.slow.test.ts`):
 *
 * 1. **The exact identity.** `W_end − W_start − topUps = Σ luck − Σ cost`, to the last fraction of
 *    a cent, where W is credit plus every bet's equity on the final table, and luck and cost are
 *    booked bet by bet from the engine's events and settlement traces. The account's final table
 *    is the live session's (same hash), so the replay saw what the player played.
 * 2. **The summary adds up.** The equity result is expected + luck exactly; the cash result is
 *    the ledger's credit plus stakes less deposits.
 * 3. **Leaks come only from same-event alternatives.** Every decision a leak counts has a twin
 *    that `sameEvents` re-verifies, that saves at least the coach's threshold per unit risked and
 *    strictly less money per decision, and the leak's total is the sum of those savings.
 * 4. **Replay-derived.** The session saved, loaded and resumed summarises identically, and the
 *    accountant fed window by window (asked for its account part-way) agrees with one pass.
 * 5. **Luck is fair.** On sampled tables before a roll, luck summed over the 36 rolls is exactly
 *    zero (equity is a martingale under the engine's own roll), unless one of the rolls would
 *    decline a re-collection the credit cannot pay — the analysis assumes enough credit (§0 #24).
 */

export interface SummaryRunStats {
  readonly report: SummaryPlayReport
  rewagers: number
  leakDecisions: number
  martingaleTables: number
  martingaleSkipped: number
  /** Accounts whose open window held actions. */
  pendingWindows: number
}

export interface SummaryRunOptions {
  readonly numRuns: number
  readonly maxMoves: number
  /** Check the 36-roll martingale on every `martingaleEvery`-th window (0: never). */
  readonly martingaleEvery: number
  readonly seed?: number
}

export function runSummaryProperty(
  machine: DiffMachine,
  options: SummaryRunOptions,
): SummaryRunStats {
  const cfg = compileConfig(machine.input)
  const stats: SummaryRunStats = {
    report: newSummaryReport(),
    rewagers: 0,
    leakDecisions: 0,
    martingaleTables: 0,
    martingaleSkipped: 0,
    pendingWindows: 0,
  }
  fc.assert(
    fc.property(
      fc.string({ maxLength: 6 }),
      fc.array(summaryMove, { minLength: 1, maxLength: options.maxMoves, size: 'max' }),
      (seed, moves) => {
        const session = playSummarySession(cfg, `summary-${seed}`, moves, stats.report)
        checkSession(session, cfg, stats, options.martingaleEvery)
      },
    ),
    { seed: options.seed ?? 20261028, numRuns: options.numRuns },
  )
  return stats
}

function checkSession(
  session: WindowedSession,
  cfg: MachineConfig,
  stats: SummaryRunStats,
  martingaleEvery: number,
): void {
  const { header, committed, pending, state } = session
  const account = accountSession(header, committed, pending, cfg)

  // 1. The identity, and the replay ending on the live table.
  expect(identityGap(account).toString(), `identity on ${cfg.id}`).toBe('0')
  expect(hashJson(account.state)).toBe(hashJson(state))
  expect(account.end.bankroll).toBe(state.ledger.bankroll)
  expect(account.end.deposits).toBe(state.ledger.deposits)
  expect(account.start.wealth.equals(Fraction.of(cfg.startingBankroll))).toBe(true)
  stats.rewagers += account.costs.filter((entry) => entry.kind === 'rewager').length
  if (pending.length > 0) stats.pendingWindows += 1

  // 2. The summary adds up.
  const summary = summarizeSession(account, cfg)
  const exact = (n: { readonly exact: Fraction | number }): Fraction =>
    typeof n.exact === 'number' ? Fraction.of(n.exact) : n.exact
  expect(exact(summary.resultEquity).equals(exact(summary.expected).add(exact(summary.luck)))).toBe(
    true,
  )
  const onTable = state.bets.reduce((sum, bet) => sum + bet.amount, 0)
  expect(
    exact(summary.resultCash).equals(
      Fraction.of(state.ledger.bankroll + onTable - state.ledger.deposits),
    ),
  ).toBe(true)
  const familyCost = Fraction.sum(summary.byFamily.map((family) => exact(family.cost)))
  expect(familyCost.equals(account.cost)).toBe(true)

  // 3. Leaks: same-event twins only, each saving at least the threshold.
  checkLeaks(account, summary, cfg, stats)

  // 4. Replay-derived: saved, loaded and resumed, and fed window by window.
  const loaded = deserializeSession(serializeSession(session))
  if (!loaded.ok) throw new Error(`the session does not load: ${JSON.stringify(loaded.error)}`)
  const resumed = loaded.session
  expect(
    summarizeSession(accountSession(resumed.header, resumed.committed, resumed.pending, cfg), cfg),
  ).toEqual(summary)
  const accountant = new SessionAccountant(header, cfg)
  committed.forEach((record, index) => {
    accountant.addWindow(record)
    // Asked part-way (with an empty open window), the accountant must carry on unchanged.
    if (index % 3 === 1) accountant.account([])
  })
  const stepwise = accountant.account(pending)
  expect(stepwise.cost.equals(account.cost) && stepwise.luck.equals(account.luck)).toBe(true)
  expect(stepwise.costs).toEqual(account.costs)

  // 5. Luck averages exactly zero over the 36 rolls of sampled tables.
  if (martingaleEvery > 0) checkMartingale(session, cfg, stats, martingaleEvery)
}

function checkLeaks(
  account: SessionAccount,
  summary: ReturnType<typeof summarizeSession>,
  cfg: MachineConfig,
  stats: SummaryRunStats,
): void {
  const totals = new Map<string, Fraction>()
  for (const roll of account.rolls) {
    for (const bet of roll.bets) {
      if (!bet.playedDecision) continue
      const twin = sameEventSwitch(bet.spec, bet.amount, bet.family, cfg)
      if (twin === null) continue
      stats.leakDecisions += 1
      expect(sameEvents(twin.from, twin.to, 'typical', cfg), 'a leak twin with other events').toBe(
        true,
      )
      expect(twin.saving.compare(SAME_EVENT_MIN_SAVING)).toBeGreaterThanOrEqual(0)
      expect(twin.perDecision.compare(Fraction.ZERO)).toBeGreaterThan(0)
      const own = analyzeBet(twin.from, twin.amount, 'typical', cfg)
      const theirs = analyzeBet(twin.to, twin.amount, 'typical', cfg)
      expect(theirs.edge.compare(own.edge)).toBeLessThan(0)
      const key = `${twin.from.typeId}>${twin.to.typeId}`
      totals.set(key, (totals.get(key) ?? Fraction.ZERO).add(twin.perDecision))
    }
  }
  expect(summary.leaks.map((leak) => `${leak.from.typeId}>${leak.to.typeId}`).sort()).toEqual(
    [...totals.keys()].sort(),
  )
  for (const leak of summary.leaks) {
    const total = totals.get(`${leak.from.typeId}>${leak.to.typeId}`) ?? Fraction.ZERO
    const shown =
      typeof leak.cost.exact === 'number' ? Fraction.of(leak.cost.exact) : leak.cost.exact
    expect(shown.equals(total.neg())).toBe(true)
  }
  expect(summary.focus).toHaveLength(Math.min(2, summary.leaks.length))
}

function checkMartingale(
  session: WindowedSession,
  cfg: MachineConfig,
  stats: SummaryRunStats,
  every: number,
): void {
  for (const [index, atRoll] of replayTables(session, cfg).entries()) {
    if (index % every !== 0 || atRoll.bets.length === 0) continue
    let total = Fraction.ZERO
    let declined = false
    for (const dice of ALL_ROLLS) {
      const rolled = applyAction(atRoll, { type: 'roll', dice }, cfg)
      if (!rolled.ok) throw new Error(`a logged table refused a roll: ${rolled.rejection.code}`)
      if (rolled.events.some((e) => e.type === 'betRemoved' && e.reason === 'vigDeclined')) {
        declined = true
        break
      }
      total = total.add(accountRoll(atRoll, rolled.state, rolled.events, index, cfg).roll.luck)
    }
    if (declined) {
      stats.martingaleSkipped += 1
      continue
    }
    expect(total.toString(), `E[luck] on a ${cfg.id} table`).toBe('0')
    stats.martingaleTables += 1
  }
}

/** The table each committed roll was made on, replayed from the log. */
function replayTables(session: WindowedSession, cfg: MachineConfig): TableState[] {
  const tables: TableState[] = []
  let state = newTable(cfg, session.header.seed)
  for (const record of session.committed) {
    for (const action of record.actions) {
      const result = applyAction(state, action, cfg)
      if (!result.ok) throw new Error('a logged action was refused')
      state = result.state
    }
    tables.push(state)
    const rolled = applyAction(state, record.roll, cfg)
    if (!rolled.ok) throw new Error('a logged roll was refused')
    state = rolled.state
  }
  return tables
}
