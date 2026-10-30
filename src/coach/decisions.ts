import type { Fraction, MachineConfig } from '../engine/index.ts'
import type { BetSpec } from '../exact/index.ts'

/**
 * What "of decisions" means for a chance the coach shows (rules spec §0.1, convention [M]): a
 * settlement that returns a bet unplayed — odds OFF when their parent is decided, the engine's
 * push `offReturned`, which only the odds family produces — is not a decision of that bet; its
 * stake was never at risk. `analyzeBet` and `catalogRow` report that mass as `pPush`, so a chance
 * "of decisions" for such a bet conditions on it being played: pWin ÷ (pWin + pLose). Come odds
 * on the 2 then read the same 14.3% as pass odds on the 2 (1:6 against), as the spec's edge
 * convention already prices them. Every other family's push — a barred 12, a zero-net composite —
 * IS a decision ("ties counted"), and its plain `pWin` stands. (M9 audit MINOR-2.)
 *
 * `import type` only: the cheat sheet rebuilds its rows in the UI without loading the solver.
 */

/** Whether `spec`'s pushes are returns of an unplayed bet rather than decisions. */
export function returnsUnplayed(cfg: MachineConfig, spec: BetSpec): boolean {
  return cfg.catalog.get(spec.typeId)?.family === 'odds'
}

/** The chance of winning per decision, with unplayed returns (if the family has them) excluded. */
export function winChanceOfDecisions(
  cfg: MachineConfig,
  spec: BetSpec,
  chances: { readonly pWin: Fraction; readonly pLose: Fraction },
): Fraction {
  if (!returnsUnplayed(cfg, spec)) return chances.pWin
  const played = chances.pWin.add(chances.pLose)
  return played.isZero() ? chances.pWin : chances.pWin.div(played)
}
