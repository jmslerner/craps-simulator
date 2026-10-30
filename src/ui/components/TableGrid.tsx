import { useState } from 'react'
import { betId, cents, formatCents, workingStatus } from '../../engine/index.ts'
import type {
  Action,
  BetInstance,
  Cents,
  LegalBet,
  MachineConfig,
  TableState,
} from '../../engine/index.ts'
import { layoutSpec, type NumberColumn, type ZoneSpec } from '../layout/layoutSpec.ts'
import { selectLegalBets, selectShown } from '../state/gameStore.ts'
import { spokenRatio } from './copy.ts'
import { useGameState, useSettingsState, useStores, useUi, type SpotRef } from './context.tsx'
import { ZoneButton, type ZoneView } from './ZoneButton.tsx'

/**
 * The betting layout (plan §6): the zones from `layoutSpec(cfg)` joined with the live `legalBets`
 * spots, in the responsive shape the plan sets — a row of ten columns from 960 px, the same row
 * with the panels below from 600 px, and a 2×5 grid with the props, hardways and side bets behind
 * tabs that open a bottom sheet under 600 px (the shapes are CSS; the tabs exist at every width
 * and CSS shows them only on phones). A tap places the selected chip — or takes the bet down in
 * REMOVE mode, or opens the inspector in INFO mode — and the engine answers every refusal through
 * the store's rejection, which shakes the zone and feeds the reason strip. A zone that cannot take
 * the tap is `aria-disabled`, never `disabled`: the tap still asks, so the machine's own refusal
 * is shown.
 */

export function TableGrid() {
  const { game } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const shown = useGameState(selectShown)
  const legal = useGameState(selectLegalBets)
  const selectedChip = useSettingsState((state) => state.selectedChip)
  const rack = useSettingsState((state) => state.chips)
  const [sheet, setSheet] = useState<'props' | 'hardways' | 'side' | null>(null)

  if (cfg === null || shown === null || legal === null) return null
  const spec = layoutSpec(cfg)
  const chip = chipFromSettings(selectedChip, rack, cfg)

  const act = (zone: ZoneSpec): void => {
    const join = joinZone(zone, legal, shown)
    if (ui.mode === 'info') {
      ui.openInspector(spotOf(zone, join))
      return
    }
    if (ui.mode === 'remove') {
      // Odds come down first; a contract flat then shows its own lock message. An empty zone asks
      // with the next unused bet id, so the machine's own "no bet there" answers.
      const target = join.oddsBet ?? join.bet
      const id = target?.id ?? betId(shown.nextBetSeq)
      game.getState().dispatch({ type: 'setAmount', betId: id, amount: cents(0) }, zone.key)
      return
    }
    game.getState().dispatch(tapAction(zone, join, chip), zone.key)
  }

  const inspect = (zone: ZoneSpec): void => {
    ui.openInspector(spotOf(zone, joinZone(zone, legal, shown)))
  }

  const zoneButton = (zone: ZoneSpec, compact = false) => (
    <ZoneButton
      key={zone.key}
      view={viewOf(zone, legal, shown, cfg, ui.mode === 'remove')}
      onTap={() => act(zone)}
      onInspect={() => inspect(zone)}
      compact={compact}
    />
  )

  const panels = {
    props: (
      <div className="panel-zones" data-testid="panel-props">
        {spec.props.map((zone) => zoneButton(zone))}
      </div>
    ),
    hardways: (
      <div className="panel-zones" data-testid="panel-hardways">
        {spec.hardways.map((zone) => zoneButton(zone))}
      </div>
    ),
    side: (
      <div className="panel-zones" data-testid="panel-side">
        {spec.sideBets.length === 0 ? (
          <p className="panel-empty">No side bets on this machine.</p>
        ) : (
          spec.sideBets.map((zone) => zoneButton(zone))
        )}
      </div>
    ),
  }

  const point = shown.round.phase.kind === 'point' ? shown.round.phase.point : null

  return (
    <section className="table" aria-label="Betting layout">
      <p className="round-chip" data-testid="round-chip">
        {point === null ? 'Come-out roll' : `Point is ${point}`}
      </p>
      <div className="table-numbers" data-testid="table-numbers">
        {spec.numbers.map((column) => (
          <NumberColumnView
            key={column.number}
            column={column}
            point={point}
            render={(zone) => zoneButton(zone, true)}
          />
        ))}
      </div>
      <div className="table-bars">
        {spec.center.map((zone) => zoneButton(zone))}
        {spec.lines.map((zone) => zoneButton(zone))}
      </div>

      <div className="table-tabs" role="tablist" aria-label="More bets">
        {(['props', 'hardways', 'side'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={sheet === name}
            className="table-tab"
            onClick={() => setSheet(sheet === name ? null : name)}
          >
            {name === 'props' ? 'Props' : name === 'hardways' ? 'Hardways' : 'Side bets'}
          </button>
        ))}
      </div>

      <div className="table-panels">
        <section className="panel" aria-label="Props">
          <h3 className="panel-title">Props</h3>
          {panels.props}
        </section>
        <section className="panel" aria-label="Hardways">
          <h3 className="panel-title">Hardways</h3>
          {panels.hardways}
        </section>
        <section className="panel" aria-label="Side bets">
          <h3 className="panel-title">Side bets</h3>
          {panels.side}
        </section>
      </div>

      {sheet !== null && (
        <div className="bottom-sheet" role="region" aria-label="More bets">
          <div className="bottom-sheet-head">
            <h3 className="panel-title">
              {sheet === 'props' ? 'Props' : sheet === 'hardways' ? 'Hardways' : 'Side bets'}
            </h3>
            <button type="button" className="sheet-close" onClick={() => setSheet(null)}>
              Close
            </button>
          </div>
          {panels[sheet]}
        </div>
      )}
    </section>
  )
}

function NumberColumnView({
  column,
  point,
  render,
}: {
  column: NumberColumn
  point: number | null
  render(zone: ZoneSpec): React.ReactNode
}) {
  const on = point === column.number
  return (
    <div className="number-column" data-number={column.number}>
      <div className="number-head">
        <span className="number-name">{column.name}</span>
        {on && (
          <>
            <span className="puck puck-on" aria-hidden="true">
              ON
            </span>
            <span className="sr-only">the point</span>
          </>
        )}
      </div>
      {column.cells.map((cell) => render(cell))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

/** What a zone holds right now: the primary spot, the flat bet and any odds riding on it. */
interface ZoneJoin {
  readonly spot: LegalBet | null
  readonly bet: BetInstance | null
  readonly oddsSpot: LegalBet | null
  readonly oddsBet: BetInstance | null
  readonly amount: Cents
  readonly oddsAmount: Cents | null
}

function joinZone(zone: ZoneSpec, legal: readonly LegalBet[], shown: TableState): ZoneJoin {
  const betOf = (id: string | null): BetInstance | null =>
    id === null ? null : (shown.bets.find((bet) => bet.id === id) ?? null)
  const mine = legal.filter((spot) => spot.typeId === zone.typeId)
  const spot =
    zone.number !== null
      ? (mine.find((s) => s.number === zone.number) ?? null)
      : (mine.find((s) => s.number === null) ?? mine[0] ?? null)
  const bet = betOf(spot?.betId ?? null)
  // Odds riding on this zone's bet (line zones and come spots), or the odds bar's own spot.
  let oddsSpot: LegalBet | null = null
  if (zone.kind === 'odds') {
    oddsSpot = spot
  } else if (zone.oddsTypeId !== null) {
    const oddsSpots = legal.filter((s) => s.typeId === zone.oddsTypeId)
    oddsSpot =
      bet !== null
        ? (oddsSpots.find((s) => s.parentId === bet.id) ?? null)
        : (oddsSpots.find((s) => s.parentId === null) ?? null)
  }
  const oddsBet = zone.kind === 'odds' ? bet : betOf(oddsSpot?.betId ?? null)
  const showsOdds = zone.oddsTypeId !== null && zone.kind !== 'odds'
  return {
    spot,
    bet,
    oddsSpot,
    oddsBet,
    amount: cents(bet?.amount ?? 0),
    oddsAmount: showsOdds ? cents(oddsBet?.amount ?? 0) : null,
  }
}

/** The action a plain tap dispatches: the selected chip onto the zone (plan §6). */
function tapAction(zone: ZoneSpec, join: ZoneJoin, chip: Cents): Action {
  if (zone.kind === 'comeSpot') {
    // The travelled bet is a contract; the tap adds odds behind it. With no bet here yet the
    // odds are asked for anyway, and the engine's NO_PARENT says why.
    const typeId = zone.oddsTypeId ?? zone.typeId
    if (join.bet !== null && zone.oddsTypeId !== null) {
      return { type: 'place', typeId, parentId: join.bet.id, amount: chip }
    }
    return { type: 'place', typeId, amount: chip }
  }
  if (zone.kind === 'odds') {
    const parentId = join.spot?.parentId ?? null
    return parentId === null
      ? { type: 'place', typeId: zone.typeId, amount: chip }
      : { type: 'place', typeId: zone.typeId, parentId, amount: chip }
  }
  return zone.number === null
    ? { type: 'place', typeId: zone.typeId, amount: chip }
    : { type: 'place', typeId: zone.typeId, number: zone.number, amount: chip }
}

function spotOf(zone: ZoneSpec, join: ZoneJoin): SpotRef {
  return {
    typeId: zone.typeId,
    number: zone.number,
    parentId: join.spot?.parentId ?? null,
  }
}

function viewOf(
  zone: ZoneSpec,
  legal: readonly LegalBet[],
  shown: TableState,
  cfg: MachineConfig,
  removeMode: boolean,
): ZoneView {
  const join = joinZone(zone, legal, shown)
  const bets = [join.bet, join.oddsBet].filter((bet): bet is BetInstance => bet !== null)
  const off = bets.some((bet) => !workingStatus(bet, shown, cfg).working)
  // A come spot without its travelled bet has nothing to add odds to.
  const addSpot =
    zone.kind === 'odds'
      ? join.oddsSpot
      : zone.kind === 'comeSpot'
        ? join.bet === null
          ? null
          : join.oddsSpot
        : join.spot
  const blocked = removeMode
    ? bets.length === 0 || (join.oddsSpot?.canRemove !== null && join.spot?.canRemove !== null)
    : addSpot === null || addSpot.canAdd !== null
  const point = shown.round.phase.kind === 'point' ? shown.round.phase.point : null
  const puck =
    zone.kind === 'place' && zone.number === point
      ? ('on' as const)
      : zone.kind === 'comeBox' && point === null
        ? ('off' as const)
        : null
  return {
    zone,
    amount: join.amount,
    oddsAmount: join.oddsAmount !== null && join.oddsAmount > 0 ? join.oddsAmount : null,
    off,
    blocked,
    puck,
    ariaLabel: zoneAria(zone, join, off),
  }
}

/** "Place 6, $12.00, pays 7 to 6" — never a house-edge claim before M9 (plan §6). */
function zoneAria(zone: ZoneSpec, join: ZoneJoin, off: boolean): string {
  // A label that already names its number (Hard 8) is not doubled.
  const name =
    zone.number === null || zone.label.includes(String(zone.number))
      ? zone.label
      : zone.kind === 'comeSpot'
        ? `${zone.label} on ${zone.number}`
        : `${zone.label} ${zone.number}`
  const parts = [name, join.amount > 0 ? formatCents(join.amount) : 'no bet']
  if (join.oddsAmount !== null && join.oddsAmount > 0) {
    parts.push(`odds ${formatCents(join.oddsAmount)}`)
  }
  if (zone.payLabel !== null) parts.push(`pays ${spokenRatio(zone.payLabel)}`)
  if (zone.badge !== null) parts.push(zone.badge)
  if (off) parts.push('off for this roll')
  return parts.join(', ')
}

/** The chip in hand: the setting when the rack holds it, else the machine's smallest chip. */
export function chipFromSettings(
  selected: number | null,
  rack: readonly number[] | null,
  cfg: MachineConfig,
): Cents {
  const chips = rack ?? cfg.chips
  const first = chips[0] ?? cfg.betIncrement
  const chip = selected !== null && chips.includes(selected) ? selected : first
  return cents(chip)
}
