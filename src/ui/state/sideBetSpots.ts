import { legalBets } from '../../engine/index.ts'
import type { LegalBet, MachineConfig, TableState } from '../../engine/index.ts'
import type { GameState } from './gameStore.ts'

/**
 * The side bets' spots (plan §10 M11; the M11 engine hand-off): `legalBets` lists them only with
 * `{ sideBets: true }`, after the main game, because the coach's surfaces that read
 * `selectLegalBets` — the next-step guide, the macros — price and play the main game until the
 * exact solver prices side bets too. The layout's side-bet panel and the inspector join their zones
 * with these spots instead, so a side-bet zone shows the real limits and the engine's own refusal
 * (its placement window, its lock after the first roll) exactly as the main game's zones do.
 * Memoized per shown table like `selectLegalBets`, so zone props hold between unrelated changes.
 */

const cache = new WeakMap<
  TableState,
  { readonly cfg: MachineConfig; readonly spots: readonly LegalBet[] }
>()

/** The side-bet spots of `shown` on `cfg`, in config order; [] on a machine without side bets. */
export function sideBetSpotsOf(shown: TableState, cfg: MachineConfig): readonly LegalBet[] {
  const hit = cache.get(shown)
  if (hit !== undefined && hit.cfg === cfg) return hit.spots
  const spots =
    cfg.sideBets.size === 0
      ? []
      : legalBets(shown, cfg, { sideBets: true }).filter((spot) => cfg.sideBets.has(spot.typeId))
  cache.set(shown, { cfg, spots })
  return spots
}

export function selectSideBetSpots(state: GameState): readonly LegalBet[] | null {
  const shown = state.view?.shown
  if (shown === undefined || state.cfg === null) return null
  return sideBetSpotsOf(shown, state.cfg)
}
