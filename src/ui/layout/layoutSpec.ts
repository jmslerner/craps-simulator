import { formatCents } from '../../engine/index.ts'
import type {
  CommissionRule,
  CompiledSideBet,
  LineBetType,
  MachineConfig,
  NumberBetType,
  OddsBetType,
  OneRollBetType,
  PointNumber,
  Ratio,
  Total,
} from '../../engine/index.ts'
import { topPayLabel, trackOf } from './sideBetProgress.ts'

/**
 * The table layout as data (plan §6): pure over the compiled config, so the machine decides what
 * the table shows. Zones are generated from `ruleset.points` and the catalog — per-number columns
 * (BUY strip when buy is offered, badged from its commission; the PLACE cell with the machine's
 * payout wording; a come strip per line type that travels), the line bars with their odds, the
 * come box, the field with its multiplier wording, hardways, the props panel (composites as
 * buttons) and the side-bet panel (M11: one zone per side bet, with the numbers it collects as a
 * `track` the zone lights from the bet's progress). Nothing the config knows is hard-coded here:
 * pays come from the catalog's `Ratio.label`s as the machine writes them, commission badges from
 * the commission rules, odds badges from the odds caps. The Table component joins these zones
 * with the live `legalBets` spots by (typeId, number, parentId); side-bet zones join the side-bet
 * spots (`selectSideBetSpots`).
 *
 * **The machine's grouping (plan §0 #28, the player's Interblock station):** the same zones are
 * also grouped the way the station draws them, every group found from the config's structure,
 * never from type ids — `circles`, the C, C&E and E column (a two-part composite of one-roll bets
 * between its two parts); `propTabs`, the HARDWAYS tab (hardways and the other one-roll props) and
 * the HOP BETS tab (one-roll bets on one dice pair, the pairs as "hopping hard ways" and the rest
 * as "hop bets", each section headed by the pay its buttons share and stood in the station's
 * columns by total: under 7, the 7s, over 7); `bands`, the felt's wide bars top to bottom (the
 * come boxes; the field and big 6/8; each line bar with its odds); and `sideBox`, the side bets in
 * the order the station's box draws them (ROLL 'EM ALL between LOW and HIGH ROLLS). Every
 * zone also carries `payText`, its pay as the felt prints it under the config's `payLabelStyle`
 * (`for`: a 7:6 place pays "13 for 6", as the station prints it), computed from the parsed ratio;
 * `payLabel` keeps the wording as written, which the zone's accessible name speaks.
 */

export type ZoneKind =
  | 'line'
  | 'odds'
  | 'comeBox'
  | 'comeSpot'
  | 'place'
  | 'buy'
  | 'lay'
  | 'placeToLose'
  | 'big'
  | 'hardway'
  | 'field'
  | 'prop'
  | 'composite'
  | 'sideBet'

export interface ZoneSpec {
  /** Unique within the layout: `place:6`, `line:pass`, `composite:horn`. */
  readonly key: string
  /** What the next-step guide highlights: `zone:<typeId>`. */
  readonly target: string
  readonly typeId: string
  readonly kind: ZoneKind
  readonly number: PointNumber | null
  readonly label: string
  /** The machine's payout wording for the zone, as written ("11:2", "5 for 1"); null when it varies. */
  readonly payLabel: string | null
  /**
   * The same pay as the felt prints it under the config's `payLabelStyle` ("13 for 6" for a 7:6
   * under `for`, "7 to 6" under `to`, the written label under `asWritten`); null when `payLabel`
   * is. The zone's view decides where the felt shows it (the station prints none on a line bar).
   */
  readonly payText: string | null
  /** A hop's dice pair, low face first, for the dice picture on its button; null elsewhere. */
  readonly dice: readonly [number, number] | null
  /** Which side a line bet (bar, come box or come spot) plays: `do` or `dont`; null elsewhere. */
  readonly side: 'do' | 'dont' | null
  /** A short qualifier from the config: a buy's "5% now", the odds bar's "2x odds". */
  readonly badge: string | null
  /** A longer line from the config, such as the field's covered totals. */
  readonly detail: string | null
  /** The odds type a bet on this zone can carry (line and come-spot zones). */
  readonly oddsTypeId: string | null
  /**
   * The numbers a side-bet zone draws as pips (M11): a collect set's targets, the Fire Bet's
   * counted points, the Lucky Shooter's box numbers; the zone lights the ones the bet has collected
   * (`progressOf`). Null for every other zone, and for the Hot Shooter, which counts rolls.
   */
  readonly track: readonly Total[] | null
  /**
   * False for a zone the engine does not take. Every zone is modelled since M11 brought the side
   * bets in; the flag stays so a machine value the trainer lists but does not model can be shown
   * as such.
   */
  readonly modelled: boolean
  /**
   * The field's totals as the felt prints them, in order, each with its caption where it pays more
   * than the field's base pay ("pays double" for 2:1, "pays triple" for 3:1); null on other zones.
   */
  readonly totals: readonly FieldTotal[] | null
}

export interface FieldTotal {
  readonly total: number
  /** "pays double", "pays triple" or "pays <felt pay>" where the total beats the base; else null. */
  readonly caption: string | null
}

/** One section of a prop tab: a heading, the pay its buttons share, and the buttons. */
export interface PropSection {
  readonly id: 'hardways' | 'props' | 'hopsHard' | 'hopsEasy'
  /** The felt's heading ("Hopping hard ways", "Hop bets"); null for an unheaded group. */
  readonly title: string | null
  /** The pay every zone in the section shares, as the felt prints it; null when they differ. */
  readonly pay: string | null
  readonly zones: readonly ZoneSpec[]
  /**
   * A hop section's buttons as the station stands them, in columns by the pair's total: the totals
   * under 7, the 7s, the totals over 7 (so 2-2 and 3-3 beside 4-4 and 5-5; 1-3 to 1-5, then 1-6,
   * 2-5 and 3-4, then 2-6 to 4-6), each column in total order, empty columns left out. Null for
   * a section that is a plain grid (the hardways and the other props).
   */
  readonly columns: readonly (readonly ZoneSpec[])[] | null
}

/** One of the station's prop tabs: HARDWAYS or HOP BETS, with the sections it holds. */
export interface PropTab {
  readonly id: 'hardways' | 'hops'
  /** The tab's name on the felt, as the station spells it. */
  readonly title: string
  readonly sections: readonly PropSection[]
}

export interface NumberColumn {
  readonly number: PointNumber
  /** The table's name for the number: SIX and NINE are spelled out. */
  readonly name: string
  /** Top to bottom: buy strip, lay strip, place cell, come spots. */
  readonly cells: readonly ZoneSpec[]
}

export interface LayoutSpec {
  readonly numbers: readonly NumberColumn[]
  /** The line bars with their odds bars: pass + odds, and the don't side when offered. */
  readonly lines: readonly ZoneSpec[]
  /** The come (and don't come) box, big 6/8 and the field. */
  readonly center: readonly ZoneSpec[]
  readonly hardways: readonly ZoneSpec[]
  /** One-roll bets and composites; the field is in `center`. */
  readonly props: readonly ZoneSpec[]
  readonly sideBets: readonly ZoneSpec[]
  /**
   * The side bets in the order the station's box draws them: a collect set whose numbers are
   * exactly two other collect sets' numbers together stands between those two (ROLL 'EM ALL
   * between LOW ROLLS and HIGH ROLLS); otherwise, and for every other side bet, config order.
   */
  readonly sideBox: readonly ZoneSpec[]
  readonly hasDont: boolean
  /**
   * The station's C, C&E and E circles: a two-part composite of one-roll bets between its two
   * parts, in the config's order; null when the machine has no such composite.
   */
  readonly circles: readonly [ZoneSpec, ZoneSpec, ZoneSpec] | null
  /** The station's prop tabs, each only when it has zones: HARDWAYS, then HOP BETS. */
  readonly propTabs: readonly PropTab[]
  /**
   * The felt's wide bands, top to bottom: the come boxes; the field with big 6/8; each line bar
   * with its odds (the do side, then the don't). Empty bands are left out.
   */
  readonly bands: readonly (readonly ZoneSpec[])[]
}

/** A one-roll type paying this many totals or more is the field bar, not a prop button. */
const FIELD_SPAN = 5

const memo = new WeakMap<MachineConfig, LayoutSpec>()

export function layoutSpec(cfg: MachineConfig): LayoutSpec {
  const cached = memo.get(cfg)
  if (cached !== undefined) return cached
  const spec = build(cfg)
  memo.set(cfg, spec)
  return spec
}

/** SIX and NINE are spelled out, as on the felt, so 6 and 9 cannot be misread. */
export function numberName(n: PointNumber): string {
  return n === 6 ? 'SIX' : n === 9 ? 'NINE' : String(n)
}

function build(cfg: MachineConfig): LayoutSpec {
  const style = cfg.payLabelStyle
  const lines: ZoneSpec[] = []
  const center: ZoneSpec[] = []
  const hardways: ZoneSpec[] = []
  const props: ZoneSpec[] = []
  const columns = new Map<PointNumber, ZoneSpec[]>(cfg.ruleset.points.map((n) => [n, []]))
  /** Come strips go under the buy/lay/place cells, in catalog order of the travelling lines. */
  const strips = new Map<PointNumber, ZoneSpec[]>(cfg.ruleset.points.map((n) => [n, []]))
  let hasDont = false

  for (const type of cfg.catalog.values()) {
    switch (type.family) {
      case 'line': {
        if (type.side === 'dont') hasDont = true
        const odds = oddsTypeOf(cfg, type)
        if (type.window === 'comeOut') {
          lines.push(lineZone(type, odds, style))
          if (odds !== null) lines.push(oddsZone(odds))
        } else {
          center.push(comeBoxZone(type, odds, style))
          for (const n of cfg.ruleset.points) strips.get(n)?.push(comeSpotZone(type, odds, n))
        }
        break
      }
      case 'odds':
        break // Emitted with its parent line.
      case 'numberVsSeven': {
        if (type.kind === 'big') {
          for (const n of type.numbers) center.push(numberZone(type, n, 'big', style))
        } else {
          for (const n of type.numbers) {
            columns.get(n)?.push(numberZone(type, n, type.kind, style))
          }
        }
        break
      }
      case 'hardway': {
        for (const n of type.numbers) {
          const ratio = type.pays.get(n) ?? null
          hardways.push({
            ...zoneBase(type.typeId, 'hardway', n),
            label: `Hard ${n}`,
            payLabel: ratio?.label ?? null,
            payText: ratio === null ? null : feltPay(ratio, style),
          })
        }
        break
      }
      case 'oneRoll': {
        if (type.match === 'total' && type.pays.size >= FIELD_SPAN) {
          center.push(fieldZone(type, style))
        } else {
          const ratio = oneRatio(type)
          props.push({
            ...zoneBase(type.typeId, 'prop', null),
            label: type.label,
            payLabel: ratio?.label ?? null,
            payText: ratio === null ? null : feltPay(ratio, style),
            dice: hopDice(type),
          })
        }
        break
      }
    }
  }

  for (const composite of cfg.composites.values()) {
    props.push({
      ...zoneBase(composite.typeId, 'composite', null),
      label: composite.label,
      payLabel: null,
      detail: composite.parts
        .map((part) => cfg.catalog.get(part.typeId)?.label ?? part.typeId)
        .join(' · '),
    })
  }

  const sideBets: ZoneSpec[] = [...cfg.sideBets.values()].map((side) => sideBetZone(side, style))
  const sideBox = sideBoxOrder([...cfg.sideBets.values()], sideBets)

  // The columns in the order the ruleset lists the points, each buy/lay/place then come strips.
  const numbers: NumberColumn[] = cfg.ruleset.points.map((n) => ({
    number: n,
    name: numberName(n),
    cells: [...(columns.get(n) ?? []), ...(strips.get(n) ?? [])],
  }))

  const circles = circlesOf(cfg, props)
  const inCircles = new Set(circles?.map((zone) => zone.key) ?? [])
  const propTabs = tabsOf(
    hardways,
    props.filter((zone) => !inCircles.has(zone.key)),
  )
  const bands = [
    center.filter((zone) => zone.kind === 'comeBox'),
    center.filter((zone) => zone.kind === 'field' || zone.kind === 'big'),
    ...lineBands(lines),
  ].filter((band) => band.length > 0)

  return {
    numbers,
    lines,
    center,
    hardways,
    props,
    sideBets,
    sideBox,
    hasDont,
    circles,
    propTabs,
    bands,
  }
}

/**
 * The station's side-bet box order (`LayoutSpec.sideBox`): the first collect set whose targets are
 * exactly two other, disjoint collect sets' targets together goes between them, the three standing
 * where the first of them stood; every other side bet keeps its config place. `zones` is `sides`
 * mapped one to one.
 */
function sideBoxOrder(
  sides: readonly CompiledSideBet[],
  zones: readonly ZoneSpec[],
): readonly ZoneSpec[] {
  const targets = (side: CompiledSideBet | undefined): readonly number[] | null =>
    side?.family === 'collectSet' ? side.targets : null
  for (const [index, side] of sides.entries()) {
    const whole = targets(side)
    if (whole === null) continue
    const parts = sides
      .map((other, at) => ({ at, numbers: at === index ? null : targets(other) }))
      .filter(
        (part): part is { at: number; numbers: readonly number[] } =>
          part.numbers !== null && part.numbers.every((n) => whole.includes(n)),
      )
    if (parts.length !== 2) continue
    const [low, high] = parts
    if (low === undefined || high === undefined) continue
    const overlap = low.numbers.some((n) => high.numbers.includes(n))
    if (overlap || low.numbers.length + high.numbers.length !== whole.length) continue
    const trio = [low.at, index, high.at]
    const first = Math.min(...trio)
    return zones.flatMap((zone, at) => {
      if (at === first) return trio.map((member) => zones[member] ?? zone)
      return trio.includes(at) ? [] : [zone]
    })
  }
  return zones
}

// ---------------------------------------------------------------------------------------------

/**
 * A pay as the felt prints it under the machine's `payLabelStyle`, from the parsed ratio (net
 * `num:den` to one, in lowest terms): `for` adds the stake back ("13 for 6" for 7:6, "31 for 1"
 * for 30:1), `to` is the net ratio ("7 to 6"), and `asWritten` keeps the config's own wording.
 */
export function feltPay(ratio: Ratio, style: MachineConfig['payLabelStyle']): string {
  switch (style) {
    case 'asWritten':
      return ratio.label
    case 'for':
      return `${ratio.num + ratio.den} for ${ratio.den}`
    case 'to':
      return `${ratio.num} to ${ratio.den}`
  }
}

/**
 * The C, C&E and E circles: the first composite of exactly two one-roll parts that are both on the
 * props panel, drawn part, composite, part in the config's order. Found by structure, so a machine
 * whose C & E splits differently still gets its own circles, and one without gets none.
 */
function circlesOf(
  cfg: MachineConfig,
  props: readonly ZoneSpec[],
): readonly [ZoneSpec, ZoneSpec, ZoneSpec] | null {
  const propOf = (typeId: string | undefined): ZoneSpec | undefined =>
    props.find((zone) => zone.kind === 'prop' && zone.typeId === typeId && zone.dice === null)
  for (const composite of cfg.composites.values()) {
    if (composite.parts.length !== 2) continue
    const first = propOf(composite.parts[0]?.typeId)
    const second = propOf(composite.parts[1]?.typeId)
    const middle = props.find((zone) => zone.kind === 'composite' && zone.typeId === composite.id)
    if (first === undefined || second === undefined || middle === undefined) continue
    if (first === second) continue
    return [first, middle, second]
  }
  return null
}

/**
 * The station's prop tabs: HARDWAYS holds the hardways and every one-roll prop that is not a hop
 * (the composites included); HOP BETS holds the hops, pairs first ("hopping hard ways") then the
 * rest ("hop bets"), each section headed by the pay its buttons share.
 */
function tabsOf(hardways: readonly ZoneSpec[], props: readonly ZoneSpec[]): readonly PropTab[] {
  const tabs: PropTab[] = []
  const others = props.filter((zone) => zone.dice === null)
  const hops = props.filter((zone) => zone.dice !== null)
  const hardSections: PropSection[] = [
    { id: 'hardways' as const, title: null, pay: null, zones: hardways, columns: null },
    { id: 'props' as const, title: null, pay: null, zones: others, columns: null },
  ].filter((section) => section.zones.length > 0)
  if (hardSections.length > 0) {
    tabs.push({ id: 'hardways', title: 'Hardways', sections: hardSections })
  }
  const pairs = hops.filter((zone) => zone.dice !== null && zone.dice[0] === zone.dice[1])
  const singles = hops.filter((zone) => zone.dice !== null && zone.dice[0] !== zone.dice[1])
  const hopSections: PropSection[] = [
    {
      id: 'hopsHard' as const,
      title: 'Hopping hard ways',
      pay: sharedPay(pairs),
      zones: pairs,
      columns: hopColumns(pairs),
    },
    {
      id: 'hopsEasy' as const,
      title: 'Hop bets',
      pay: sharedPay(singles),
      zones: singles,
      columns: hopColumns(singles),
    },
  ].filter((section) => section.zones.length > 0)
  if (hopSections.length > 0) {
    tabs.push({ id: 'hops', title: 'Hop bets', sections: hopSections })
  }
  return tabs
}

/** The dice's middle total: the station's hop columns stand either side of it. */
const SEVEN = 7

/**
 * A hop section's station columns (`PropSection.columns`): the pairs totalling under 7, the 7s,
 * the pairs over 7, each column by total and then by its low die.
 */
function hopColumns(zones: readonly ZoneSpec[]): readonly (readonly ZoneSpec[])[] {
  const total = (zone: ZoneSpec): number => (zone.dice?.[0] ?? 0) + (zone.dice?.[1] ?? 0)
  const sorted = [...zones].sort(
    (a, b) => total(a) - total(b) || (a.dice?.[0] ?? 0) - (b.dice?.[0] ?? 0),
  )
  return [
    sorted.filter((zone) => total(zone) < SEVEN),
    sorted.filter((zone) => total(zone) === SEVEN),
    sorted.filter((zone) => total(zone) > SEVEN),
  ].filter((column) => column.length > 0)
}

/** The felt pay every zone shares, or null when any differs or is missing. */
function sharedPay(zones: readonly ZoneSpec[]): string | null {
  const pays = new Set(zones.map((zone) => zone.payText))
  const [only] = pays
  return pays.size === 1 && only !== undefined ? only : null
}

/** Each line bar with the odds that follow it: [pass, passOdds], [dontPass, dontPassOdds]. */
function lineBands(lines: readonly ZoneSpec[]): ZoneSpec[][] {
  const bands: ZoneSpec[][] = []
  for (const zone of lines) {
    if (zone.kind === 'line' || bands.length === 0) bands.push([zone])
    else bands[bands.length - 1]?.push(zone)
  }
  return bands
}

/** A hop's dice pair: a one-roll type on exactly one dice outcome ("2-5"), low face first. */
function hopDice(type: OneRollBetType): readonly [number, number] | null {
  if (type.match !== 'dice' || type.pays.size !== 1) return null
  const [key] = type.pays.keys()
  const match = /^([1-6])-([1-6])$/.exec(key ?? '')
  if (match === null) return null
  const low = Number(match[1])
  const high = Number(match[2])
  return low <= high ? [low, high] : [high, low]
}

function zoneBase(typeId: string, kind: ZoneKind, number: PointNumber | null) {
  return {
    key: number === null ? `${kind}:${typeId}` : `${kind}:${typeId}:${number}`,
    target: `zone:${typeId}`,
    typeId,
    kind,
    number,
    payLabel: null,
    payText: null,
    dice: null,
    side: null,
    badge: null,
    detail: null,
    oddsTypeId: null,
    track: null,
    modelled: true,
    totals: null,
  }
}

/**
 * A side bet's spot (M11): the machine's label, the numbers it collects as the zone's track, its
 * pay as written where there is one pay (a collect set's "31 for 1") or the top of its table where
 * the pays vary ("up to 999 to 1"), with the full table in the inspector. The Hot Shooter's
 * qualifier (`/sideBets/<t>/qualifyingBet`) is its badge; a collect set's detail says which 7
 * loses it (`/sideBets/<t>/endsOn`).
 */
function sideBetZone(side: CompiledSideBet, style: MachineConfig['payLabelStyle']): ZoneSpec {
  const base = {
    ...zoneBase(side.typeId, 'sideBet', null),
    label: side.label,
    track: trackOf(side),
  }
  switch (side.family) {
    case 'collectSet':
      return {
        ...base,
        payLabel: side.pays.label,
        payText: feltPay(side.pays, style),
        detail: side.endsOn === 'anySeven' ? 'any 7 loses' : 'seven-out loses',
      }
    case 'handLength':
      return {
        ...base,
        badge:
          side.qualifyingBet > 0
            ? `needs ${formatCents(side.qualifyingBet, { trimWholeDollars: true })} in play`
            : null,
        detail: `up to ${topPayLabel(side)}`,
      }
    case 'uniquePointsMade':
    case 'pointRun':
      return { ...base, detail: `up to ${topPayLabel(side)}` }
  }
}

function oddsTypeOf(cfg: MachineConfig, line: LineBetType): OddsBetType | null {
  const oddsId = cfg.oddsFor.get(line.typeId)
  const odds = oddsId === undefined ? undefined : cfg.catalog.get(oddsId)
  return odds?.family === 'odds' ? odds : null
}

function lineZone(
  type: LineBetType,
  odds: OddsBetType | null,
  style: MachineConfig['payLabelStyle'],
): ZoneSpec {
  return {
    ...zoneBase(type.typeId, 'line', null),
    label: type.label,
    payLabel: type.pays.label,
    payText: feltPay(type.pays, style),
    side: type.side,
    oddsTypeId: odds?.typeId ?? null,
  }
}

function oddsZone(odds: OddsBetType): ZoneSpec {
  return {
    ...zoneBase(odds.typeId, 'odds', null),
    label: odds.label,
    badge: oddsBadge(odds),
  }
}

function comeBoxZone(
  type: LineBetType,
  odds: OddsBetType | null,
  style: MachineConfig['payLabelStyle'],
): ZoneSpec {
  return {
    ...zoneBase(type.typeId, 'comeBox', null),
    label: type.label,
    payLabel: type.pays.label,
    payText: feltPay(type.pays, style),
    side: type.side,
    oddsTypeId: odds?.typeId ?? null,
  }
}

function comeSpotZone(type: LineBetType, odds: OddsBetType | null, n: PointNumber): ZoneSpec {
  return {
    ...zoneBase(type.typeId, 'comeSpot', n),
    label: type.label,
    side: type.side,
    oddsTypeId: odds?.typeId ?? null,
  }
}

function numberZone(
  type: NumberBetType,
  n: PointNumber,
  kind: ZoneKind,
  style: MachineConfig['payLabelStyle'],
): ZoneSpec {
  const commission = type.commission?.get(n) ?? null
  const ratio = type.pays.get(n) ?? null
  return {
    ...zoneBase(type.typeId, kind, n),
    label: type.label,
    payLabel: ratio?.label ?? null,
    payText: ratio === null ? null : feltPay(ratio, style),
    badge: commission === null ? null : vigBadge(commission),
  }
}

/** "5% now" for an up-front vig, "5% on win" for one taken from the win (plan §6). */
export function vigBadge(rule: CommissionRule): string {
  const percent = trimDecimal(rule.rate.formatPercent(2))
  return rule.timing === 'upfront' ? `${percent}% now` : `${percent}% on win`
}

/** "2x odds" when every point takes the same multiple, "3x–5x odds" otherwise. */
function oddsBadge(odds: OddsBetType): string {
  const multiples = [...new Set(odds.limit.multiple.values())].sort((a, b) => a - b)
  if (multiples.length === 0) return 'odds'
  const first = multiples[0]
  const last = multiples[multiples.length - 1]
  return first === last ? `${first}x odds` : `${first}x–${last}x odds`
}

/** The field bar: base pay as written, the better totals called out, and the covered totals. */
function fieldZone(type: OneRollBetType, style: MachineConfig['payLabelStyle']): ZoneSpec {
  const byLabel = new Map<string, number[]>()
  for (const [key, ratio] of type.pays) {
    const totals = byLabel.get(ratio.label) ?? []
    totals.push(Number(key))
    byLabel.set(ratio.label, totals)
  }
  let base: string | null = null
  for (const [label, totals] of byLabel) {
    if (base === null || totals.length > (byLabel.get(base)?.length ?? 0)) base = label
  }
  const specials = [...byLabel]
    .filter(([label]) => label !== base)
    .sort(([, a], [, b]) => (a[0] ?? 0) - (b[0] ?? 0))
    .map(([label, totals]) => {
      const names = totals.sort((a, b) => a - b).join(' and ')
      return `${names} ${totals.length > 1 ? 'pay' : 'pays'} ${label}`
    })
  const ordered = [...type.pays].sort(([a], [b]) => Number(a) - Number(b))
  const covered = ordered.map(([key]) => key).join(' ')
  const baseRatio = ordered.find(([, ratio]) => ratio.label === base)?.[1] ?? null
  const totals: FieldTotal[] = ordered.map(([key, ratio]) => ({
    total: Number(key),
    caption: ratio.label === base ? null : fieldCaption(ratio, style),
  }))
  return {
    ...zoneBase(type.typeId, 'field', null),
    label: type.label,
    payLabel: base,
    payText: baseRatio === null ? null : feltPay(baseRatio, style),
    badge: specials.length === 0 ? null : specials.join('; '),
    detail: covered,
    totals,
  }
}

/**
 * The caption under a field total that pays more than the base, as the station words its 2:1
 * ("pays double"): a whole multiple of the stake reads as a word, any other pay as the felt
 * prints it.
 */
function fieldCaption(ratio: Ratio, style: MachineConfig['payLabelStyle']): string {
  if (ratio.den === 1n && ratio.num === 2n) return 'pays double'
  if (ratio.den === 1n && ratio.num === 3n) return 'pays triple'
  return `pays ${feltPay(ratio, style)}`
}

/** A prop's ratio when its pays agree ("16 for 1"); null when they differ. */
function oneRatio(type: OneRollBetType): Ratio | null {
  const labels = new Map([...type.pays.values()].map((ratio) => [ratio.label, ratio]))
  return labels.size === 1 ? ([...labels.values()][0] ?? null) : null
}

/** "5.00" → "5", "4.50" → "4.5": percent badges drop the noise, not the precision. */
function trimDecimal(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}
