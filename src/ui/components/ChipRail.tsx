import { cents, formatCents } from '../../engine/index.ts'
import { selectBettingOpen, selectCanUndo, selectMacros } from '../state/gameStore.ts'
import { useGameState, useSettingsState, useStores, useUi } from './context.tsx'
import { rejectionText } from './rejectionText.ts'
import { denomOf } from './ZoneButton.tsx'

/**
 * The chip rail (plan §6), laid out as the player's station lays it out (plan §0 #28): CLEAR LAST
 * BET at the left, the machine's chips (or the player's custom rack) in the station's colours with
 * the chip in hand glowing, then DOUBLE BET and REPEAT LAST BET — the station's chrome pills,
 * which are the trainer's Undo, Double and Repeat (keys U, Shift+R; chips on 1–9). Macro buttons
 * are enabled exactly when the engine's macro returns a batch (M5/M6 → M8 hand-off), and a
 * blocked REPEAT carries the engine's reason in its tooltip. Chip colours follow the denomination
 * (`data-denom`, CSS).
 */

export function ChipRail() {
  const { game, settings } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const rack = useSettingsState((state) => state.chips)
  const selected = useSettingsState((state) => state.selectedChip)
  const betting = useGameState(selectBettingOpen)
  const canUndo = useGameState(selectCanUndo)
  const macros = useGameState(selectMacros)
  if (cfg === null) return null
  const chips = rack ?? cfg.chips
  const inHand = selected !== null && chips.includes(selected) ? selected : (chips[0] ?? null)
  const repeat = macros.repeat[0]
  const double = macros.double[0]
  const blockedWhy =
    macros.repeatBlocked !== null ? rejectionText(macros.repeatBlocked, cfg) : undefined

  return (
    <div className="chip-rail" role="toolbar" aria-label="Chips and bet buttons">
      <button
        type="button"
        className="chrome-pill"
        disabled={!canUndo}
        onClick={() => game.getState().undoLast()}
        title="Take back the last action (U)"
      >
        <span className="chrome-icon" aria-hidden="true">
          ×
        </span>
        <span className="chrome-text">Clear last bet</span>
      </button>
      <div className="chips" role="group" aria-label="Chip in hand">
        {chips.map((chip, index) => {
          const target = `control:chip:${chip}`
          const picked = chip === inHand
          const amount = cents(chip)
          return (
            <button
              key={chip}
              type="button"
              className={`chip${picked ? ' chip-selected' : ''}${
                ui.highlight === target ? ' guide-target' : ''
              }`}
              data-denom={denomOf(amount)}
              data-target={target}
              aria-pressed={picked}
              aria-label={`${formatCents(amount)} chip${picked ? ', in hand' : ''} (${index + 1})`}
              onClick={() => settings.getState().update({ selectedChip: chip })}
            >
              {formatCents(amount, { trimWholeDollars: true })}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="chrome-pill"
        disabled={double === undefined || !betting}
        title="Double every bet that can double"
        onClick={() =>
          double === undefined ? undefined : game.getState().dispatch(double, 'control:double')
        }
      >
        <span className="chrome-icon" aria-hidden="true">
          ×2
        </span>
        <span className="chrome-text">Double bet</span>
      </button>
      <button
        type="button"
        className="chrome-pill"
        disabled={repeat === undefined || !betting}
        title={blockedWhy ?? 'Repeat the last window’s bets (Shift+R)'}
        onClick={() =>
          repeat === undefined ? undefined : game.getState().dispatch(repeat, 'control:repeat')
        }
      >
        <span className="chrome-icon chrome-icon-repeat" aria-hidden="true">
          ↻
        </span>
        <span className="chrome-text">Repeat last bet</span>
      </button>
    </div>
  )
}
