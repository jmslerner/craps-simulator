import { useMemo, useState } from 'react'
import { betId, cents, formatCents, workingStatus } from '../../engine/index.ts'
import type {
  Action,
  BetInstance,
  Cents,
  LegalBet,
  MachineConfig,
  TableState,
} from '../../engine/index.ts'
import { Die } from '../dice2d/Die.tsx'
import {
  layoutSpec,
  type LayoutSpec,
  type NumberColumn,
  type PropTab,
  type ZoneSpec,
} from '../layout/layoutSpec.ts'
import { progressOf, type SideBetProgress } from '../layout/sideBetProgress.ts'
import { pressActionsFor, selectLegalBets, selectShown } from '../state/gameStore.ts'
import type { GameState } from '../state/gameStore.ts'
import { selectSideBetSpots } from '../state/sideBetSpots.ts'
import { spokenRatio } from './copy.ts'
import { useGameState, useSettingsState, useStores, useUi, type SpotRef } from './context.tsx'
import { PHONE_QUERY, useMediaQuery } from './useMediaQuery.ts'
import { useRollOutcomes } from './useRollOutcomes.ts'
import { ZoneButton, type ZoneSlot, type ZoneView } from './ZoneButton.tsx'

/**
 * The betting layout (plan §6), drawn as the player's Interblock station draws it (plan §0 #28):
 * the zones from `layoutSpec(cfg)` joined with the live `legalBets` spots, laid out as the
 * station's felt — the side bets in their box over the number row (in the station's order,
 * `sideBox`: ROLL 'EM ALL between LOW and HIGH ROLLS), the HARDWAYS and HOP BETS tabs down the left
 * (each tab with the total bet in it, as the station shows it; the hops in the station's columns
 * by total), the C, C&E and E circles, the number row (BUY tab, number box, PLACE tab per point,
 * the point puck on its box), and the wide COME, FIELD and PASS LINE bands with the PRESS button
 * beside them. It renders the felt's
 * sections as siblings, so the App's grid places them; on phones the number row folds to the 2×5
 * grid and the prop tabs and side bets open bottom sheets (plan §6). A tap places the selected chip
 * — or takes the bet down in REMOVE mode, or opens the inspector in INFO mode — and the engine
 * answers every refusal through the store's rejection, which shakes the zone and feeds the reason
 * strip. A zone that cannot take the tap is `aria-disabled`, never `disabled`: the tap still asks,
 * so the machine's own refusal is shown.
 *
 * **Side bets (plan §10 M11):** the side-bet zones join the side-bet spots (`selectSideBetSpots`,
 * `legalBets` with `{ sideBets: true }`), so they carry the machine's real limits and refusals —
 * the placement window, the lock after the first roll, drawn as a lock on the chip — and light the
 * numbers the bet has collected from the engine's `BetInstance.progress` (`progressOf`).
 *
 * **PRESS (plan §0 #12, #28):** the station's PRESS button presses every bet that won on the last
 * roll by what it won — the trainer's own per-bet press (`pressActionsFor`, the engine's
 * `pressBet` over `winsOf` the last roll), all of them in one batch the engine checks whole. It
 * shows where the machine lists Press among its group buttons. ACROSS is not offered: the rules
 * spec names the numbers it covers but not what it stakes on each.
 */

type TabId = PropTab['id'] | 'side'

export function TableGrid() {
  const { game } = useStores()
  const ui = useUi()
  const cfg = useGameState((state) => state.cfg)
  const shown = useGameState(selectShown)
  const mainLegal = useGameState(selectLegalBets)
  const sideLegal = useGameState(selectSideBetSpots)
  const selectedChip = useSettingsState((state) => state.selectedChip)
  const rack = useSettingsState((state) => state.chips)
  const phone = useMediaQuery(PHONE_QUERY, false)
  const [activeTab, setActiveTab] = useState<TabId | null>(null)
  const [sheet, setSheet] = useState<TabId | null>(null)
  // The just-revealed roll's win and lose marks, by zone (empty while the dice are in the air).
  const outcomes = useRollOutcomes(cfg === null ? null : layoutSpec(cfg))
  // Every spot the layout can show: the main game's, then the side bets' (M11).
  const legal = useMemo(
    () =>
      mainLegal === null ? null : sideLegal === null ? mainLegal : [...mainLegal, ...sideLegal],
    [mainLegal, sideLegal],
  )

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

  const zoneButton = (zone: ZoneSpec, slot: ZoneSlot, showPay = true) => (
    <ZoneButton
      key={zone.key}
      view={viewOf(zone, legal, shown, cfg, ui.mode === 'remove')}
      onTap={() => act(zone)}
      onInspect={() => inspect(zone)}
      slot={slot}
      showPay={showPay}
      outcome={outcomes.get(zone.key) ?? null}
    />
  )

  // The tabs: the station's HARDWAYS and HOP BETS, and on phones the side bets as a third.
  const tabs: readonly { readonly id: TabId; readonly title: string }[] = [
    ...spec.propTabs.map((tab) => ({ id: tab.id, title: tab.title })),
    ...(phone && spec.sideBets.length > 0 ? [{ id: 'side' as const, title: 'Side bets' }] : []),
  ]
  const firstTab = tabs[0]?.id ?? null
  const inline =
    activeTab !== null && tabs.some((tab) => tab.id === activeTab) ? activeTab : firstTab
  const tabTotal = (id: TabId): Cents => betTotal(shown, tabTypes(spec, id))
  const panelFor = (id: TabId, slot: 'inline' | 'sheet') =>
    id === 'side' ? (
      <div className="panel-zones side-zones" data-testid="panel-side">
        {spec.sideBox.map((zone) => zoneButton(zone, 'sheet'))}
      </div>
    ) : (
      <PropTabPanel
        tab={spec.propTabs.find((tab) => tab.id === id)}
        render={(zone, showPay) =>
          zoneButton(
            zone,
            zone.dice !== null ? 'hop' : slot === 'sheet' ? 'sheet' : 'prop',
            showPay,
          )
        }
      />
    )

  const point = shown.round.phase.kind === 'point' ? shown.round.phase.point : null

  return (
    <>
      {spec.sideBets.length > 0 && (
        <section className="felt-side" aria-label="Side bets" data-felt="side">
          <span className="side-emblem" aria-hidden="true">
            <Die face={5} variant="white" />
            <Die face={4} variant="white" />
          </span>
          <div className="side-zones" data-count={spec.sideBox.length}>
            {spec.sideBox.map((zone) => zoneButton(zone, 'side'))}
          </div>
        </section>
      )}

      {tabs.length > 0 && (
        <section className="felt-props" aria-label="Proposition bets" data-felt="props">
          <div className="prop-tabs" role="tablist" aria-label="Proposition bets">
            {tabs.map((tab) => {
              const selected = phone ? sheet === tab.id : inline === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`prop-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={!phone && selected ? `prop-panel-${tab.id}` : undefined}
                  className="prop-tab"
                  data-tab={tab.id}
                  onClick={() => {
                    if (phone) setSheet(sheet === tab.id ? null : tab.id)
                    else setActiveTab(tab.id)
                  }}
                >
                  <span className="prop-tab-name">{tab.title}</span>{' '}
                  <span className="prop-tab-total">{formatCents(tabTotal(tab.id))}</span>
                </button>
              )
            })}
          </div>
          {!phone && inline !== null && (
            <div
              className="prop-panel"
              role="tabpanel"
              id={`prop-panel-${inline}`}
              aria-labelledby={`prop-tab-${inline}`}
            >
              {panelFor(inline, 'inline')}
            </div>
          )}
        </section>
      )}

      {spec.circles !== null && (
        <div className="felt-circles" role="group" aria-label="C and E" data-felt="circles">
          {spec.circles.map((zone) => zoneButton(zone, 'circle'))}
        </div>
      )}

      <section className="felt-numbers" aria-label="Numbers" data-felt="numbers">
        <div
          className="table-numbers"
          data-testid="table-numbers"
          // The row's length comes from the ruleset; phones fold it into two rows (plan §6).
          style={
            {
              '--num-count': spec.numbers.length,
              '--num-half': Math.ceil(spec.numbers.length / 2),
            } as React.CSSProperties
          }
        >
          {spec.numbers.map((column) => (
            <NumberColumnView
              key={column.number}
              column={column}
              point={point}
              render={(zone, slot) => zoneButton(zone, slot)}
            />
          ))}
        </div>
      </section>

      <section className="felt-bands" aria-label="Line bets" data-felt="bands">
        <GroupButtons />
        <div className="bands">
          {spec.bands.map((band) => (
            <div key={band.map((zone) => zone.key).join(' ')} className="band">
              {band.map((zone) => zoneButton(zone, 'band'))}
            </div>
          ))}
        </div>
      </section>

      {phone && sheet !== null && tabs.some((tab) => tab.id === sheet) && (
        <div className="bottom-sheet" role="region" aria-label="More bets">
          <div className="bottom-sheet-head">
            <h3 className="panel-title">{tabs.find((tab) => tab.id === sheet)?.title}</h3>
            <button type="button" className="sheet-close" onClick={() => setSheet(null)}>
              Close
            </button>
          </div>
          {panelFor(sheet, 'sheet')}
        </div>
      )}
    </>
  )
}

/** One prop tab's sections: each section's heading prints the pay its buttons share. */
function PropTabPanel({
  tab,
  render,
}: {
  tab: PropTab | undefined
  render(zone: ZoneSpec, showPay: boolean): React.ReactNode
}) {
  if (tab === undefined) return null
  return (
    <div className={`panel-zones prop-sections tab-${tab.id}`} data-testid={`panel-${tab.id}`}>
      {tab.sections.map((section) => (
        <div key={section.id} className={`prop-section section-${section.id}`}>
          {section.title !== null && (
            <p className="prop-section-head" aria-hidden="true">
              {section.pay !== null && <span className="psh-pay">{section.pay}</span>}
              <span className="psh-title">{section.title}</span>
              {section.pay !== null && <span className="psh-pay">{section.pay}</span>}
            </p>
          )}
          {section.columns === null ? (
            <div className="prop-buttons">
              {section.zones.map((zone) => render(zone, section.pay === null))}
            </div>
          ) : (
            // The station's hop columns: under 7, the 7s, over 7 (`PropSection.columns`), the dice
            // drawn on each button's outer side and above the pair in a middle column.
            <div className="hop-columns" data-columns={section.columns.length}>
              {section.columns.map((column, index, all) => (
                <div
                  key={column[0]?.key ?? index}
                  className={`hop-col ${hopSide(index, all.length)}`}
                >
                  {column.map((zone) => render(zone, section.pay === null))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** Where a hop column stands: its dice face outwards at the edges, above the pair in the middle. */
function hopSide(index: number, count: number): string {
  if (index === 0) return 'hop-col-left'
  return index === count - 1 ? 'hop-col-right' : 'hop-col-mid'
}

function NumberColumnView({
  column,
  point,
  render,
}: {
  column: NumberColumn
  point: number | null
  render(zone: ZoneSpec, slot: ZoneSlot): React.ReactNode
}) {
  const on = point === column.number
  // SIX and NINE are words on the felt, set a size smaller than the numerals.
  const word = !/^\d+$/.test(column.name)
  // The station's column: BUY (and LAY) tabs above the number box, PLACE tabs below it; the come
  // spots are the box itself.
  const top = column.cells.filter((cell) => cell.kind === 'buy' || cell.kind === 'lay')
  const box = column.cells.filter((cell) => cell.kind === 'comeSpot')
  const bottom = column.cells.filter(
    (cell) => cell.kind !== 'buy' && cell.kind !== 'lay' && cell.kind !== 'comeSpot',
  )
  return (
    <div className={on ? 'number-column is-point' : 'number-column'} data-number={column.number}>
      {top.length > 0 && (
        <div className="num-tabs num-tabs-top">{top.map((z) => render(z, 'tab'))}</div>
      )}
      <div className={box.length > 1 ? 'num-box num-box-split' : 'num-box'}>
        <span className={word ? 'num-label word' : 'num-label'} aria-hidden="true">
          {column.name}
        </span>
        {on && (
          <>
            <span className="puck puck-on" aria-hidden="true">
              ON
            </span>
            <span className="sr-only">the point</span>
          </>
        )}
        {box.map((cell) => render(cell, 'box'))}
      </div>
      {bottom.length > 0 && (
        <div className="num-tabs num-tabs-bottom">{bottom.map((z) => render(z, 'tab'))}</div>
      )}
    </div>
  )
}

/**
 * The station's PRESS button: every bet the last roll paid, pressed by what it won, as one batch
 * (the trainer's per-bet press, `pressActionsFor`). Disabled when nothing won or nothing can be
 * pressed; shown only where the machine lists Press among its group buttons.
 */
function GroupButtons() {
  const { game } = useStores()
  const ui = useUi()
  const offered = useGameState(
    (state) => state.cfg?.flow.groupButtons.buttons.includes('press') ?? false,
  )
  const state = useGameState((s) => s)
  const press = useMemo(() => pressAll(state), [state])
  if (!offered) return null
  return (
    <div className="group-buttons" role="group" aria-label="Group bets">
      <button
        type="button"
        className="felt-pill"
        disabled={press.length === 0}
        title="Press every bet the last roll paid, by what it won"
        onClick={() => {
          const result = game
            .getState()
            .dispatch({ type: 'batch', actions: [...press] }, 'control:press')
          if (result.ok) ui.announce('Pressed the winning bets.')
        }}
      >
        Press
      </button>
    </div>
  )
}

/** Every press the last roll's wins allow, bet by bet, flattened into one list. */
function pressAll(state: GameState): readonly Action[] {
  const bets = state.view?.shown.bets ?? []
  return bets.flatMap((bet) => pressActionsFor(state, bet.id))
}

/** The type ids a tab's zones bet on, for its total. */
function tabTypes(spec: LayoutSpec, id: TabId): ReadonlySet<string> {
  if (id === 'side') return new Set(spec.sideBets.map((zone) => zone.typeId))
  const tab = spec.propTabs.find((candidate) => candidate.id === id)
  return new Set(tab?.sections.flatMap((section) => section.zones.map((zone) => zone.typeId)))
}

/** What the table holds on a set of types: the station's "$0.00" on each tab. */
function betTotal(shown: TableState, types: ReadonlySet<string>): Cents {
  return cents(shown.bets.reduce((sum, bet) => (types.has(bet.typeId) ? sum + bet.amount : sum), 0))
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
  // A side bet's progress comes straight off the bet (M11); an empty spot shows its track unlit.
  const side = zone.kind === 'sideBet' ? (cfg.sideBets.get(zone.typeId) ?? null) : null
  const progress = side === null || join.bet === null ? null : progressOf(side, join.bet.progress)
  // The station locks a side bet's chip once it can no longer come down (the engine's answer).
  const locked = side !== null && join.bet !== null && (join.spot?.canRemove ?? null) !== null
  return {
    zone,
    amount: join.amount,
    oddsAmount: join.oddsAmount !== null && join.oddsAmount > 0 ? join.oddsAmount : null,
    off,
    blocked,
    puck,
    progress,
    locked,
    ariaLabel: zoneAria(zone, join, progress),
  }
}

/**
 * "Place 6, $12.00, pays 7 to 6": the machine's facts about the zone in words, every visible part
 * of the zone said once (M14: the zone's other visible text is `aria-hidden`, so the name holds
 * everything the zone shows). The field says what it covers, a composite its parts, and a side
 * bet what loses it or its top pay, then its progress: "Low Rolls, $1.00, pays 31 for 1, any 7
 * loses, 2 and 4 rolled, needs 3, 5 and 6". `ZoneButton` adds the coach's edge badge, the point
 * and "off for this roll" after these.
 */
function zoneAria(zone: ZoneSpec, join: ZoneJoin, progress: SideBetProgress | null): string {
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
  if (zone.detail !== null) parts.push(detailWords(zone))
  if (progress !== null) parts.push(progress.words)
  return parts.join(', ')
}

/** A zone's detail line in words: the field's totals are what it covers; ratios are spoken. */
function detailWords(zone: ZoneSpec): string {
  const detail = zone.detail ?? ''
  if (zone.kind === 'field') return `covers ${detail}`
  if (zone.kind === 'composite') return `splits into ${detail.split(' · ').join(', ')}`
  return spokenRatio(detail)
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
