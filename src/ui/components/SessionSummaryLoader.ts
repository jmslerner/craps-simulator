import type { SessionSummarizer, SessionSummary } from '../../coach/summary/index.ts'
import type { SummaryLog } from '../state/gameStore.ts'

/**
 * Loads and computes the session summary (plan §5.7, §10 M13) off the initial bundle: the summary
 * carries the exact solver, so its module is imported on first use (its own lazy chunk), and a
 * long log is accounted window by window in slices of a few milliseconds, yielding to the page
 * between them so the table stays responsive. Summarizers are kept per session, so a summary
 * opened again only accounts the windows rolled since; computations run one at a time, because two
 * of them must never feed the same summarizer.
 */

type SummaryModule = typeof import('../../coach/summary/index.ts')

let loading: Promise<SummaryModule> | null = null

/** The summary module, imported once (again after a failed import). */
export function loadSummaryModule(): Promise<SummaryModule> {
  loading ??= import('../../coach/summary/index.ts').catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}

export interface ComputeOptions {
  readonly signal?: AbortSignal
  /** Windows accounted so far, of the log's total. */
  readonly onProgress?: (done: number, total: number) => void
  /** Work per task before yielding to the page, in milliseconds. */
  readonly sliceMs?: number
}

/** How many sessions keep their summarizer: the live one, and the one New game just ended. */
const KEPT = 2

/** A kept summarizer and the `hashAfter` of every window it has accounted, in order. */
interface Kept {
  readonly summarizer: SessionSummarizer
  readonly hashes: string[]
}

const summarizers: Kept[] = []
let queue: Promise<unknown> = Promise.resolve()

/** The summary of `log`; rejects with the reason when the log cannot be replayed. */
export function computeSummary(
  log: SummaryLog,
  options: ComputeOptions = {},
): Promise<SessionSummary> {
  const run = queue.then(() => compute(log, options))
  queue = run.catch(() => undefined)
  return run
}

async function compute(log: SummaryLog, options: ComputeOptions): Promise<SessionSummary> {
  const summary = await loadSummaryModule()
  const sliceMs = options.sliceMs ?? 12
  let kept = reusable(log)
  if (kept === null) {
    kept = { summarizer: summary.createSessionSummarizer(log.header, log.cfg), hashes: [] }
    keep(kept)
  }
  const { summarizer, hashes } = kept
  const total = log.committed.length
  let sliceStart = performance.now()
  try {
    while (summarizer.windows < total) {
      if (options.signal?.aborted === true) throw new DOMException('Summary aborted', 'AbortError')
      const record = log.committed[summarizer.windows]
      if (record === undefined) break
      summarizer.addWindow(record)
      hashes.push(record.hashAfter)
      if (performance.now() - sliceStart >= sliceMs) {
        options.onProgress?.(summarizer.windows, total)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        sliceStart = performance.now()
      }
    }
    return summarizer.summarize(log.pending)
  } catch (error) {
    // A summarizer that failed part-way holds a half-accounted window: never reuse it.
    if (!(error instanceof DOMException && error.name === 'AbortError')) forget(kept)
    throw error
  }
}

/**
 * A kept summarizer of the same session whose accounted windows are exactly the first windows of
 * `log` (each window's table hash compared), or null.
 */
function reusable(log: SummaryLog): Kept | null {
  for (const kept of summarizers) {
    const { header } = kept.summarizer
    const same =
      header === log.header ||
      (header.seed === log.header.seed &&
        header.configHash === log.header.configHash &&
        header.engineVersion === log.header.engineVersion)
    if (!same || kept.hashes.length > log.committed.length) continue
    if (kept.hashes.every((hash, index) => log.committed[index]?.hashAfter === hash)) return kept
  }
  return null
}

function keep(kept: Kept): void {
  summarizers.unshift(kept)
  summarizers.length = Math.min(summarizers.length, KEPT)
}

function forget(kept: Kept): void {
  const index = summarizers.indexOf(kept)
  if (index !== -1) summarizers.splice(index, 1)
}
