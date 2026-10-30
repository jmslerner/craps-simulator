import { useEffect, useRef, useState } from 'react'
import { formatCents } from '../../engine/index.ts'
import type { Cents } from '../../engine/index.ts'
import type { ZoneSpec } from '../layout/layoutSpec.ts'
import { useGameState, useUi } from './context.tsx'
import { useLongPress } from './useLongPress.ts'

/**
 * One layout zone as a button (plan §6 accessibility): the aria-label reads like "Place 6, $12.00,
 * pays 7 to 6" — no house-edge claim until M9's CoachNumbers. A refused action shakes the zone
 * (CSS honours `prefers-reduced-motion`), the guide's highlight draws a dashed outline and scrolls
 * the zone into view, and a long-press or right-click opens the inspector. The zone stays tappable
 * when it cannot take a bet (`aria-disabled`, never `disabled`), so a tap can show the machine's
 * own refusal in the reason strip.
 */

export interface ZoneView {
  readonly zone: ZoneSpec
  /** The flat amount on the zone; odds ride in `oddsAmount`. */
  readonly amount: Cents
  readonly oddsAmount: Cents | null
  /** The zone holds a bet that is OFF for the next roll. */
  readonly off: boolean
  /** The zone cannot take the primary tap right now (`aria-disabled`; the tap still answers). */
  readonly blocked: boolean
  /** The point puck sits on this zone. */
  readonly puck: 'on' | 'off' | null
  readonly ariaLabel: string
}

export function ZoneButton({
  view,
  onTap,
  onInspect,
  compact = false,
}: {
  view: ZoneView
  onTap(): void
  onInspect(): void
  /** Tighter styling for strips inside a number column. */
  compact?: boolean
}) {
  const { zone, amount, oddsAmount, off, blocked, puck, ariaLabel } = view
  const ui = useUi()
  const press = useLongPress(onTap, onInspect)
  const shake = useShake(zone.key)
  const highlighted = ui.highlight === zone.target
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // The guide's target is brought into view (plan §0 #18); block 'nearest' avoids page jumps.
    if (highlighted) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted])

  const classes = [
    'zone',
    `zone-${zone.kind}`,
    compact ? 'zone-compact' : '',
    amount > 0 ? 'zone-live' : '',
    blocked ? 'zone-blocked' : '',
    highlighted ? 'guide-target' : '',
    shake ? 'zone-shake' : '',
  ]
    .filter((name) => name !== '')
    .join(' ')

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      aria-label={ariaLabel}
      aria-disabled={blocked || undefined}
      data-zone={zone.key}
      data-target={zone.target}
      {...press}
    >
      <span className="zone-label">{zone.label}</span>
      {zone.payLabel !== null && <span className="zone-pay">{zone.payLabel}</span>}
      {zone.badge !== null && <span className="zone-badge">{zone.badge}</span>}
      {zone.detail !== null && <span className="zone-detail">{zone.detail}</span>}
      {amount > 0 && (
        <span className="zone-amount" data-denom={denomOf(amount)}>
          {formatCents(amount, { trimWholeDollars: true })}
        </span>
      )}
      {oddsAmount !== null && oddsAmount > 0 && (
        <span className="zone-odds-amount">
          odds {formatCents(oddsAmount, { trimWholeDollars: true })}
        </span>
      )}
      {off && <span className="zone-off">OFF</span>}
      {puck !== null && (
        <span className={puck === 'on' ? 'puck puck-on' : 'puck puck-off'}>
          {puck === 'on' ? 'ON' : 'OFF'}
        </span>
      )}
    </button>
  )
}

/** Shakes once per refusal aimed at this zone (`rejection.seq` keys repeat shakes). */
function useShake(zoneKey: string): boolean {
  const rejection = useGameState((state) => state.rejection)
  const seq = rejection !== null && rejection.zone === zoneKey ? rejection.seq : null
  // Shaking is derived: this refusal's seq, until the timeout marks it done.
  const [doneSeq, setDoneSeq] = useState<number | null>(null)
  useEffect(() => {
    if (seq === null) return
    const timer = setTimeout(() => setDoneSeq(seq), 400)
    return () => clearTimeout(timer)
  }, [seq])
  return seq !== null && seq !== doneSeq
}

/** The chip colour bucket for an amount: the denomination of the largest chip inside it. */
export function denomOf(amount: Cents): string {
  if (amount >= 100_000) return '1000'
  if (amount >= 50_000) return '500'
  if (amount >= 10_000) return '100'
  if (amount >= 2_500) return '25'
  if (amount >= 500) return '5'
  return '1'
}
