import { selectShown } from '../state/gameStore.ts'
import type { RollEntry } from '../state/rollHistory.ts'
import { roundEventWords } from './copy.ts'
import { useGameState } from './context.tsx'

/**
 * The dome's dressing (the demo's dice dome): the ON/OFF puck with the point, the recent-rolls
 * chip strip (newest first, sevens red) and the big callout under the dice — "Come-out roll",
 * "Point is 6", "7 · seven-out" in the machine's own words. Pure presentation over state the
 * screen already shows elsewhere: the point from the shown table (the round chip), the totals from
 * the roll history, the callout's words from `roundEventWords`. The history gains its entry only
 * at the reveal and the shown table is the pre-roll table while the dice are in the air, so
 * nothing here can show a result before the dice land. The whole overlay is `aria-hidden`: the
 * round chip, the history and the announcer already say all of it.
 */

/** How many recent totals the strip shows, newest first. */
const RECENT_ROLLS = 12

export function DomeOverlay() {
  const shown = useGameState(selectShown)
  const rolls = useGameState((state) => state.history.rolls)
  if (shown === null) return null
  const point = shown.round.phase.kind === 'point' ? shown.round.phase.point : null
  const callout = calloutOf(rolls[0] ?? null, point)
  return (
    <div className="dome-overlay" aria-hidden="true">
      <div className={point === null ? 'dome-puck' : 'dome-puck on'} data-testid="dome-puck">
        {point === null ? (
          <strong>OFF</strong>
        ) : (
          <>
            <small>ON</small>
            <strong>{point}</strong>
          </>
        )}
      </div>
      {rolls.length > 0 && (
        <ol className="dome-recent" data-testid="dome-recent">
          {rolls.slice(0, RECENT_ROLLS).map((roll) => (
            <li key={roll.rollIndex} className={roll.total === 7 ? 'seven' : undefined}>
              {roll.total}
            </li>
          ))}
        </ol>
      )}
      <div className={callout.tone === null ? 'callout' : `callout ${callout.tone}`}>
        {callout.text}
      </div>
    </div>
  )
}

interface Callout {
  readonly text: string
  /** Coloured by the round event: a made point or a natural wins, a seven-out or craps loses. */
  readonly tone: 'win' | 'lose' | null
}

/** The newest roll's total and round event; before any roll, the round itself. */
function calloutOf(newest: RollEntry | null, point: number | null): Callout {
  const round = point === null ? 'Come-out roll' : `Point is ${point}`
  if (newest === null) return { text: round, tone: null }
  const words = roundEventWords(newest.roundEvent) ?? round
  // "7 wins the come-out" already names the total.
  const text = words.startsWith(`${newest.total} `) ? words : `${newest.total} · ${words}`
  const type = newest.roundEvent?.type ?? null
  const tone =
    type === 'sevenOut' || type === 'crapsOut'
      ? 'lose'
      : type === 'pointMade' || type === 'natural'
        ? 'win'
        : null
  return { text, tone }
}
