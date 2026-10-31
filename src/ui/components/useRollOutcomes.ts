import { useEffect, useMemo, useState } from 'react'
import type { LayoutSpec } from '../layout/layoutSpec.ts'
import type { RollEntry } from '../state/rollHistory.ts'
import { zoneOutcomes, type ZoneOutcome } from '../state/rollOutcomes.ts'
import { useStores } from './context.tsx'

/** How long a revealed roll's win and lose marks stay on the felt: the CSS animations' length. */
export const OUTCOME_MS = 1800

const NONE: ReadonlyMap<string, ZoneOutcome> = new Map()

/**
 * The win and lose marks of the roll that was just revealed, by zone key (`zoneOutcomes`). A roll
 * is marked from the moment its dice land — the store's `rolling → revealing` step, caught in a
 * store subscription so no reveal is missed however fast the hold — until `OUTCOME_MS` later or
 * the next throw, whichever comes first. Nothing is marked while the dice are in the air, and a
 * history restored on resume is never marked, because it was not revealed here.
 */
export function useRollOutcomes(spec: LayoutSpec | null): ReadonlyMap<string, ZoneOutcome> {
  const { game } = useStores()
  const [fresh, setFresh] = useState<RollEntry | null>(null)

  useEffect(
    () =>
      game.subscribe((state, previous) => {
        const phase = state.view?.phase ?? null
        const before = previous.view?.phase ?? null
        if (phase === 'revealing' && before !== 'revealing') {
          setFresh(state.history.rolls[0] ?? null)
        } else if (phase === 'rolling' && before !== 'rolling') {
          setFresh(null)
        }
      }),
    [game],
  )

  useEffect(() => {
    if (fresh === null) return
    const timer = setTimeout(() => setFresh(null), OUTCOME_MS)
    return () => clearTimeout(timer)
  }, [fresh])

  return useMemo(
    () => (fresh === null || spec === null ? NONE : zoneOutcomes(fresh, spec)),
    [fresh, spec],
  )
}
