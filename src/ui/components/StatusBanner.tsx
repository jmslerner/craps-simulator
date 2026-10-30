import { useState } from 'react'
import { notModelledWords } from '../../coach/content/layout.ts'
import { selectShown } from '../state/gameStore.ts'
import { GuideLine } from './NextStepBar.tsx'
import { NoticeBanner } from './NoticeBanner.tsx'
import { ReasonStrip } from './ReasonStrip.tsx'
import { useGameState } from './context.tsx'

/**
 * The machine's status banner (plan §0 #28): the dark pill at the top of the station's screen where
 * the machine says its one-line messages ("Station in hand pay – call attendant" over a red second
 * line). The trainer's one-liners ride there: the session notice and the approximation note (each
 * dismissible), the guide's step with its Go (`GuideLine`), and the machine's latest refusal in
 * red ("BETS ARE NOT VALID YET! …", the reason strip — always in the tree, an aria-live region).
 * Under the guide it states the round, as the station prints "PASS LINE POINT" along its number
 * row: "Come-out roll" or "Point is 6" (the round chip).
 */
export function StatusBanner() {
  const cfg = useGameState((state) => state.cfg)
  const shown = useGameState(selectShown)
  const [approxDismissed, setApproxDismissed] = useState<readonly string[]>([])
  const approxNote =
    cfg !== null && cfg.notModelled.length > 0 && !approxDismissed.includes(cfg.configHash)
  const point =
    shown !== null && shown.round.phase.kind === 'point' ? shown.round.phase.point : null
  return (
    <section className="status-banner" aria-label="Machine messages" data-felt="banner">
      <NoticeBanner />
      {approxNote && cfg !== null && (
        <div className="tip approx-note" role="note" data-sev="note">
          <p>
            This machine sets options the trainer approximates: {notModelledWords(cfg.notModelled)}.
            Everything else plays exactly.
          </p>
          <button
            type="button"
            onClick={() => setApproxDismissed((done) => [...done, cfg.configHash])}
          >
            Got it
          </button>
        </div>
      )}
      <GuideLine />
      <p className="round-chip" data-testid="round-chip">
        {point === null ? 'Come-out roll' : `Point is ${point}`}
      </p>
      <ReasonStrip />
    </section>
  )
}
