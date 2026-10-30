import { cents, formatCents } from '../../engine/index.ts'
import { useGameState, useSettingsState, useStores, useUi } from './context.tsx'
import { denomOf } from './ZoneButton.tsx'

/**
 * The chip rail (plan §6): the machine's chips (or the player's custom rack), the selected one in
 * hand, with keys 1–6; and the INFO and REMOVE mode toggles that change what a tap does. Chip
 * colours follow the denomination (`data-denom`, CSS).
 */

export function ChipRail() {
  const { settings } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const rack = useSettingsState((state) => state.chips)
  const selected = useSettingsState((state) => state.selectedChip)
  if (cfg === null) return null
  const chips = rack ?? cfg.chips
  const inHand = selected !== null && chips.includes(selected) ? selected : (chips[0] ?? null)

  return (
    <div className="chip-rail" role="toolbar" aria-label="Chips and modes">
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
      <div className="modes" role="group" aria-label="Tap mode">
        <button
          type="button"
          aria-pressed={ui.mode === 'info'}
          onClick={() => ui.setMode(ui.mode === 'info' ? 'bet' : 'info')}
          title="Tap a zone to inspect it (I)"
        >
          Info
        </button>
        <button
          type="button"
          aria-pressed={ui.mode === 'remove'}
          onClick={() => ui.setMode(ui.mode === 'remove' ? 'bet' : 'remove')}
          title="Tap a bet to take it down (X)"
        >
          Remove
        </button>
      </div>
    </div>
  )
}
