import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { formatCents } from '../../engine/index.ts'
import type { Cents, Die as DieFace } from '../../engine/index.ts'
import { formatCoachNumber } from '../../coach/format.ts'
import { badgeVisibleIn, coachModeName } from '../../coach/policy.ts'
import { badgeKey } from '../../coach/types.ts'
import type { ZoneBadge } from '../../coach/types.ts'
import { Die } from '../dice2d/Die.tsx'
import { badgeFor, ensureCatalog, subscribeAnalysis } from '../services/analysisClient.ts'
import type { ZoneKind, ZoneSpec } from '../layout/layoutSpec.ts'
import type { SideBetProgress } from '../layout/sideBetProgress.ts'
import type { ZoneOutcome } from '../state/rollOutcomes.ts'
import { useGameState, useSettingsState, useUi } from './context.tsx'
import { useLongPress } from './useLongPress.ts'

/**
 * One layout zone as a button (plan §6 accessibility): the aria-label reads like "Place 6, $12.00,
 * pays 7 to 6, house edge 1.52 percent, good" — the coach badge's words only where the coach mode
 * shows the badge, its number the same `CoachNumber` the badge renders (`zoneName`). A refused
 * action shakes the zone (CSS honours `prefers-reduced-motion`), the guide's highlight draws a
 * dashed outline and scrolls the zone into view, and a long-press or right-click opens the
 * inspector. The zone stays tappable when it cannot take a bet (`aria-disabled`, never
 * `disabled`), so a tap can show the machine's own refusal in the reason strip.
 *
 * **Coach badge (plan §10 M9a, §13 M8 → M9 hand-off):** next to the machine's own badge
 * (`ZoneSpec.badge`, machine text like vig timing and odds caps) the zone carries a second,
 * coach-owned slot — the bet's house edge at its exact unit, computed by the analysis worker and
 * rendered from a `CoachNumber`. The e2e badge check reads `data-coach-badge` and compares the
 * text against `__CRAPS_TEST__.analyze`. Machine text and coach numbers never share a slot, so a
 * machine with its own badge wording keeps it verbatim.
 *
 * **Side-bet progress (plan §10 M11):** a zone with a `track` draws its numbers as pips and lights
 * the ones the bet has collected (`progressOf` over the engine's `BetInstance.progress`), with the
 * Lucky Shooter's point drawn apart; the Hot Shooter shows its roll count instead. `data-lit` on
 * the track names the lit numbers for the e2e check.
 *
 * **The station's faces (plan §0 #28):** each zone draws what the player's Interblock station
 * prints on that spot and nothing more — a BUY tab says just "Buy" (its pays, vig and edge are in
 * the inspector), a line bar or come box its name, a place tab its name over the pay in the
 * machine's own notation (`ZoneSpec.payText`), the field its totals with "pays double" under the
 * 2, a hop its dice picture over "2-2", a side bet its collected numbers over its pay; a locked
 * side bet's chip carries a lock, as on the station. Everything the face leaves out is said in the
 * zone's name. `slot` says where the zone sits (a number tab, the number box, a band, a circle, a
 * prop or hop button, a side-bet box) for the CSS, and `showPay` false leaves the pay to the
 * section heading that already prints it ("16 for 1 • Hop bets • 16 for 1"). The coach's edge tag
 * is a small corner tag that never sits on the face.
 *
 * **Win and lose marks:** when the dice land, a zone the roll decided flashes (gold for a win, red
 * for a loss, white for a push) and the amount floats off it, "+$7.00" rising or "−$5.00" swept
 * down, from the engine's own settlements (`zoneOutcomes`). The marks are `aria-hidden` (the roll's
 * announcement says the same), never catch a tap, and keep still under reduced motion.
 */

/** A win paying at least this many times its stake gets the big-win mark. */
const BIG_WIN_MULTIPLE = 10

/** The amount a mark floats: "+$7.00" for a win, "−$5.00" for a loss, "Push" for a push. */
export function outcomeText(outcome: ZoneOutcome): string {
  if (outcome.kind === 'push') return 'Push'
  const amount = formatCents(outcome.kind === 'win' ? outcome.net : (-outcome.net as Cents))
  return outcome.kind === 'win' ? `+${amount}` : `−${amount}`
}

/** Where a zone sits on the felt, for its shape: see the module comment. */
export type ZoneSlot = 'tab' | 'box' | 'band' | 'circle' | 'prop' | 'hop' | 'side' | 'sheet'

/** Kinds whose face carries no pay: the station prints none there (the inspector says it). */
const NO_PAY_ON_FACE: ReadonlySet<ZoneKind> = new Set<ZoneKind>([
  'buy',
  'lay',
  'line',
  'odds',
  'comeBox',
  'comeSpot',
  'composite',
  'big',
  'field',
])

/** Kinds whose machine badge (vig wording) the face leaves to the inspector. */
const NO_BADGE_ON_FACE: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['buy', 'lay', 'field'])

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
  /** A side bet's progress (M11); null on every other zone and on an empty side-bet spot. */
  readonly progress: SideBetProgress | null
  /** A side bet that can no longer come down (the engine's `canRemove` refuses): its chip is locked. */
  readonly locked: boolean
  /**
   * The machine's facts in words ("Place 6, $12.00, pays 7 to 6"); the button adds the coach's
   * badge, the point and "off for this roll" (`zoneName`).
   */
  readonly ariaLabel: string
}

/**
 * The zone's accessible name (plan §6; M14): the table's words, then the coach badge exactly as
 * the zone shows it when the coach mode shows it ("house edge 1.52 percent, good" — the grade
 * the badge's colour carries, in words), then the point puck and the off state. Every visible
 * part of the zone is said here, which is why the zone's own text past its label is aria-hidden.
 * The name starts with the zone's visible label; the button carries it as visually hidden text.
 */
export function zoneName(view: ZoneView, coach: ZoneBadge | null): string {
  const parts = [view.ariaLabel]
  if (coach !== null) {
    parts.push(`house edge ${formatCoachNumber(coach.edge).replace('%', ' percent')}`, coach.grade)
  }
  if (view.puck === 'on') parts.push('the point')
  if (view.off) parts.push('off for this roll')
  return parts.join(', ')
}

/** The class of one track pip: lit when collected, marked when it is the Lucky Shooter's point. */
export function pipClass(lit: boolean, point: boolean): string {
  return ['pip', lit ? 'pip-lit' : '', point ? 'pip-point' : ''].filter((c) => c !== '').join(' ')
}

export function ZoneButton({
  view,
  onTap,
  onInspect,
  slot = 'band',
  showPay = true,
  outcome = null,
}: {
  view: ZoneView
  onTap(): void
  onInspect(): void
  /** Where the zone sits on the felt (its shape). */
  slot?: ZoneSlot
  /** False when the zone's section heading already prints its pay. */
  showPay?: boolean
  /** What the just-revealed roll did on this zone; null when it did nothing here. */
  outcome?: ZoneOutcome | null
}) {
  const { zone, amount, oddsAmount, off, blocked, puck, progress, locked } = view
  const ui = useUi()
  const press = useLongPress(onTap, onInspect)
  const shake = useShake(zone.key)
  // The coach mode decides which badges show (plan §5.6): all in coach, poor/awful in quiet,
  // none when the coach is off. The machine's own badge text is not coaching and always shows.
  const coachMode = useSettingsState((state) => coachModeName(state.coachMode))
  const badge = useCoachBadge(zone)
  const coach = badge !== null && badgeVisibleIn(coachMode, badge.grade) ? badge : null
  const highlighted = ui.highlight === zone.target
  const stillMotion = useSettingsState((state) => state.reducedMotion === true)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // The guide's target is brought into view (plan §0 #18); block 'nearest' avoids page jumps.
    if (highlighted) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted])

  const classes = [
    'zone',
    `zone-${zone.kind}`,
    `zone-slot-${slot}`,
    amount > 0 ? 'zone-live' : '',
    blocked ? 'zone-blocked' : '',
    highlighted ? 'guide-target' : '',
    shake ? 'zone-shake' : '',
  ]
    .filter((name) => name !== '')
    .join(' ')

  const pay = showPay && !NO_PAY_ON_FACE.has(zone.kind) ? zone.payText : null
  const badgeText = NO_BADGE_ON_FACE.has(zone.kind) ? null : zone.badge
  // A collect set's "any 7 loses" and a composite's parts are said in the name, not drawn.
  const detail = zone.kind === 'sideBet' && zone.payText === null ? zone.detail : null

  // The accessible name comes from the content (M14, WCAG 2.5.3 label in name): one visually
  // hidden span says the whole zone in words (`zoneName`, which starts with the visible label),
  // while everything drawn on the felt — the label and the shorthand ("13 for 6", "$6", "OFF") —
  // is aria-hidden, so a screen reader hears "pays 7 to 6" once and voice control finds the zone
  // by the label it shows. The number box (`slot` box) draws no label of its own: the column's
  // numeral under it is the felt's, and the name says "Come on 6".
  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      aria-disabled={blocked || undefined}
      data-zone={zone.key}
      data-target={zone.target}
      data-side={zone.side ?? undefined}
      {...press}
    >
      {zone.dice !== null && (
        <span className="zone-dice" aria-hidden="true">
          <Die face={zone.dice[0] as DieFace} small variant="white" />
          <Die face={zone.dice[1] as DieFace} small variant="white" />
        </span>
      )}
      {slot !== 'box' && (
        <span className="zone-label" aria-hidden="true">
          {zone.dice !== null ? `${zone.dice[0]}-${zone.dice[1]}` : zone.label}
        </span>
      )}
      <span className="sr-only">{zoneName(view, coach)}</span>
      {zone.track !== null && (
        <span className="zone-track" aria-hidden="true" data-lit={progress?.lit.join(' ') ?? ''}>
          {zone.track.map((n) => (
            <span
              key={n}
              className={pipClass(progress?.lit.includes(n) ?? false, progress?.point === n)}
            >
              {n}
            </span>
          ))}
        </span>
      )}
      {progress !== null && progress.count !== null && (
        <span className="zone-count" data-count={progress.count} aria-hidden="true">
          {progress.count} {progress.count === 1 ? 'roll' : 'rolls'}
        </span>
      )}
      {zone.totals !== null && (
        <span className="zone-totals" aria-hidden="true">
          {zone.totals.map(({ total, caption }) => (
            <span key={total} className={caption === null ? 'ft' : 'ft ft-special'}>
              <span className="ft-n">{total}</span>
              {caption !== null && <span className="ft-cap">{caption}</span>}
            </span>
          ))}
        </span>
      )}
      {pay !== null && (
        <span className="zone-pay" aria-hidden="true">
          {pay}
        </span>
      )}
      {badgeText !== null && (
        <span className="zone-badge" aria-hidden="true">
          {badgeText}
        </span>
      )}
      {coach !== null && (
        <span
          className={`zone-coach grade-${coach.grade}`}
          data-coach-badge={badgeKey(zone.typeId, zone.number)}
          aria-hidden="true"
        >
          {formatCoachNumber(coach.edge)}
        </span>
      )}
      {detail !== null && (
        <span className="zone-detail" aria-hidden="true">
          {detail}
        </span>
      )}
      {amount > 0 && (
        <span className="zone-amount" data-denom={denomOf(amount)} aria-hidden="true">
          {formatCents(amount, { trimWholeDollars: true })}
        </span>
      )}
      {amount > 0 && locked && (
        <span className="zone-lock" aria-hidden="true" title="Locked">
          <svg viewBox="0 0 12 14" width="10" height="12" focusable="false">
            <path
              d="M3 6V4a3 3 0 0 1 6 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1.5 0h3V4a1.5 1.5 0 0 0-3 0z"
              fill="currentColor"
            />
          </svg>
        </span>
      )}
      {oddsAmount !== null && oddsAmount > 0 && (
        <span className="zone-odds-amount" aria-hidden="true">
          odds {formatCents(oddsAmount, { trimWholeDollars: true })}
        </span>
      )}
      {off && (
        <span className="zone-off" aria-hidden="true">
          OFF
        </span>
      )}
      {puck !== null && (
        <span className={puck === 'on' ? 'puck puck-on' : 'puck puck-off'} aria-hidden="true">
          {puck === 'on' ? 'ON' : 'OFF'}
        </span>
      )}
      {outcome !== null && <OutcomeMarks outcome={outcome} still={stillMotion} />}
    </button>
  )
}

/**
 * The flash and the floating amount for one revealed roll. Keyed by the roll, so the next roll's
 * mark on the same zone starts its animation afresh.
 */
function OutcomeMarks({ outcome, still }: { outcome: ZoneOutcome; still: boolean }) {
  const big =
    outcome.kind === 'win' && outcome.stake > 0 && outcome.net >= outcome.stake * BIG_WIN_MULTIPLE
  const motion = still ? ' outcome-still' : ''
  return (
    <>
      <span
        key={`flash-${outcome.rollIndex}`}
        className={`zone-flash zone-flash-${outcome.kind}${motion}`}
        data-outcome={outcome.kind}
        aria-hidden="true"
      />
      <span
        key={`float-${outcome.rollIndex}`}
        className={`zone-float zone-float-${outcome.kind}${big ? ' zone-float-big' : ''}${motion}`}
        data-outcome-float={outcome.kind}
        aria-hidden="true"
      >
        {outcomeText(outcome)}
      </span>
    </>
  )
}

/**
 * The zone's coach badge from the analysis worker: null until the catalog arrives (or where the
 * bet has no catalog row — unmodelled side bets, per-number odds bars). The snapshot is the
 * stored badge object, so `useSyncExternalStore` sees a stable reference between arrivals.
 */
function useCoachBadge(zone: ZoneSpec): ZoneBadge | null {
  const cfg = useGameState((state) => state.cfg)
  useEffect(() => {
    if (cfg !== null) ensureCatalog(cfg)
  }, [cfg])
  return useSyncExternalStore(subscribeAnalysis, () =>
    cfg === null ? null : badgeFor(cfg.configHash, zone.typeId, zone.number),
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

/**
 * The chip colour bucket for an amount: the denomination of the largest chip inside it, from the
 * station's own rack ($1 white, $2 blue, $3 yellow, $5 red, $10 orange, $25 green, $50 blue,
 * $100 black; plan §0 #28) plus the high-limit chips above it.
 */
export function denomOf(amount: Cents): string {
  for (const bucket of DENOMS) {
    if (amount >= bucket.from) return bucket.denom
  }
  return '1'
}

/** Largest first: an amount takes the first bucket it reaches (whole dollars, in cents). */
const DENOMS: readonly { readonly from: number; readonly denom: string }[] = [
  1_000, 500, 100, 50, 25, 10, 5, 3, 2,
].map((dollars) => ({ from: dollars * 100, denom: String(dollars) }))
