import type { Action, MachineConfig, SessionHeader, WindowRecord } from '../../engine/index.ts'
import { SessionAccountant, accountSession, type SessionAccount } from '../../exact/summary.ts'
import { summarizeSession, type SessionSummary } from './summary.ts'

/**
 * The session summary (plan §5.7, §10 M13): the account (`src/exact/summary.ts`) and its coach
 * rendering (`summary.ts`). The UI loads this module lazily — it carries the exact solver, which
 * the initial bundle must not — and drives a `SessionSummarizer` window by window, so a long log
 * is spread over several tasks and a summary opened again picks up where the last one stopped.
 */

export { accountSession, identityGap } from '../../exact/summary.ts'
export type {
  CostEntry,
  LuckEntry,
  RollAccount,
  SessionAccount,
  Wealth,
} from '../../exact/summary.ts'
export { groupOf, summarizeSession, typeLabel } from './summary.ts'
export type {
  FamilyGroup,
  SessionSummary,
  SummaryFamily,
  SummaryFocus,
  SummaryLeak,
} from './summary.ts'
export { mayHaveTwin, sameEventSwitch } from './leaks.ts'
export type { SameEventSwitch } from './leaks.ts'

/** A session's summary built window by window. */
export interface SessionSummarizer {
  readonly header: SessionHeader
  /** Committed windows accounted so far. */
  readonly windows: number
  /** `hashAfter` of the last window accounted, or null before any. */
  readonly lastHash: string | null
  /** Accounts the next committed window; throws `ReplayError` when the log does not replay. */
  addWindow(record: WindowRecord): void
  /** The account so far with the open window's `pending` actions. */
  account(pending: readonly Action[]): SessionAccount
  /** The summary so far with the open window's `pending` actions. */
  summarize(pending: readonly Action[]): SessionSummary
}

export function createSessionSummarizer(
  header: SessionHeader,
  cfg: MachineConfig,
): SessionSummarizer {
  const accountant = new SessionAccountant(header, cfg)
  let lastHash: string | null = null
  return {
    header,
    get windows() {
      return accountant.windows
    },
    get lastHash() {
      return lastHash
    },
    addWindow(record) {
      accountant.addWindow(record)
      lastHash = record.hashAfter
    },
    account: (pending) => accountant.account(pending),
    summarize: (pending) => summarizeSession(accountant.account(pending), cfg),
  }
}

/** The summary of a whole log in one go (tests, and short logs). */
export function summarizeLog(
  header: SessionHeader,
  committed: readonly WindowRecord[],
  pending: readonly Action[],
  cfg: MachineConfig,
): SessionSummary {
  return summarizeSession(accountSession(header, committed, pending, cfg), cfg)
}
