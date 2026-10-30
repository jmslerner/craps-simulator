import { Die } from '../dice2d/Die.tsx'
import type { RollEntry } from '../state/rollHistory.ts'
import { roundEventWords } from './copy.ts'
import { useGameState } from './context.tsx'

/**
 * The machine's history strip (plan §0 #28): the station's row of recent rolls along the bottom of
 * the felt, newest at the left, each two small die faces over a tab with the total. The tab's
 * colour reads the roll's round event, as the photo of the player's station reads (rules hold for
 * every colour on it: blue where the pass line won — a come-out natural or the point made — red
 * where it lost — a seven-out, or craps on a come-out — dark for every other roll). Up to the
 * machine's own history length (`/flow/historyLength`). Each entry says its roll in words for
 * screen readers; the full history, with every bet and its arithmetic, is in the Coach drawer.
 */
export function RollStrip() {
  const rolls = useGameState((state) => state.history.rolls)
  const length = useGameState((state) => state.cfg?.flow.historyLength ?? 0)
  const shown = rolls.slice(0, length)
  return (
    <section className="roll-strip" aria-label="Recent rolls" data-felt="strip">
      {shown.length === 0 ? (
        <p className="roll-strip-empty">No rolls yet</p>
      ) : (
        // The row scrolls sideways on a narrow screen, so it takes focus to scroll from the keys.
        <ol className="roll-strip-list" tabIndex={0}>
          {shown.map((roll) => (
            <li
              key={roll.rollIndex}
              className="strip-roll"
              data-result={resultOf(roll)}
              data-total={roll.total}
            >
              <span className="strip-dice" aria-hidden="true">
                <Die face={roll.dice.d1} small variant="white" />
                <Die face={roll.dice.d2} small variant="white" />
              </span>
              <span className="strip-total" aria-hidden="true">
                {roll.total}
              </span>
              <span className="sr-only">{rollWords(roll)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Blue where the pass line won, red where it lost, plain for every other roll. */
export function resultOf(roll: RollEntry): 'won' | 'lost' | 'plain' {
  switch (roll.roundEvent?.type) {
    case 'natural':
    case 'pointMade':
      return 'won'
    case 'sevenOut':
    case 'crapsOut':
      return 'lost'
    case 'pointEstablished':
    case undefined:
      return 'plain'
  }
}

function rollWords(roll: RollEntry): string {
  const event = roundEventWords(roll.roundEvent)
  const dice = `${roll.dice.d1} and ${roll.dice.d2}`
  return event === null
    ? `Roll ${roll.rollIndex + 1}: ${roll.total} (${dice}).`
    : `Roll ${roll.rollIndex + 1}: ${roll.total} (${dice}), ${event}.`
}
