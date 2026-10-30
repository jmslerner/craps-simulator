import type { MachineConfig } from '../../../engine/index.ts'
import { catalogSpecs, checkBet, type SanityIssue } from '../../../exact/index.ts'

/**
 * The editor's sanity check (plan §4.4, §10 M12): `checkBet` from `src/exact` over every bet the
 * draft offers — the catalog, the combination bets and the side bets — one bet at a time, giving
 * the browser a turn between bets, so a whole machine (about 100 bets, 100–150 ms of solving)
 * never holds the page in one long task. A newer draft cancels an older run, and a finished run is
 * remembered by the config's hash, which leaves out the name and the provenance: renaming a
 * machine or changing a note does not run it again.
 */

export interface SanityProgress {
  readonly checked: number
  readonly total: number
}

const finished = new Map<string, readonly SanityIssue[]>()
/** Finished runs kept: an editing session's recent drafts, never an unbounded history. */
const KEPT = 64

/** The issues a finished run found for this config, or null if none has finished. */
export function cachedSanity(cfg: MachineConfig): readonly SanityIssue[] | null {
  return finished.get(cfg.configHash) ?? null
}

/** Gives the browser a turn: rendering and input run before the next bet is checked. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Every sanity issue of `cfg`'s bets, or null when `signal` aborted the run first. A bet the
 * solver cannot take at all is reported as unanalysable rather than thrown.
 */
export async function runSanity(
  cfg: MachineConfig,
  signal: AbortSignal,
  onProgress?: (progress: SanityProgress) => void,
): Promise<readonly SanityIssue[] | null> {
  const cached = cachedSanity(cfg)
  if (cached !== null) return cached
  const specs = catalogSpecs(cfg)
  const issues: SanityIssue[] = []
  for (const [index, spec] of specs.entries()) {
    await nextTurn()
    if (signal.aborted) return null
    try {
      issues.push(...checkBet(spec, cfg))
    } catch (error) {
      issues.push({
        severity: 'warning',
        code: 'unanalysable',
        spec,
        amount: null,
        edge: null,
        message: error instanceof Error ? error.message : String(error),
        paths: [],
      })
    }
    onProgress?.({ checked: index + 1, total: specs.length })
  }
  finished.set(cfg.configHash, issues)
  for (const oldest of finished.keys()) {
    if (finished.size <= KEPT) break
    finished.delete(oldest)
  }
  return issues
}

/** Whether any issue blocks saving: a player-favoured or dead-even bet. */
export function blocks(issues: readonly SanityIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}
