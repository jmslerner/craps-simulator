import { useGameState } from './context.tsx'
import { rejectionText } from './rejectionText.ts'

/**
 * The reason strip (plan §6): the player wording for the latest refusal, in an `aria-live=polite`
 * region that always exists so screen readers hear each change. The engine's rejection is the only
 * source — the strip never invents a reason — and a successful action clears it through the store.
 */

export function ReasonStrip() {
  const cfg = useGameState((state) => state.cfg)
  const rejection = useGameState((state) => state.rejection)
  const text = cfg !== null && rejection !== null ? rejectionText(rejection, cfg) : ''
  return (
    <div className="reason-strip" role="status" aria-live="polite" data-testid="reason-strip">
      {text}
    </div>
  )
}
