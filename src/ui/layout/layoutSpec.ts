import type {
  CommissionRule,
  LineBetType,
  MachineConfig,
  NumberBetType,
  OddsBetType,
  OneRollBetType,
  PointNumber,
} from '../../engine/index.ts'

/**
 * The table layout as data (plan §6): pure over the compiled config, so the machine decides what
 * the table shows. Zones are generated from `ruleset.points` and the catalog — per-number columns
 * (BUY strip when buy is offered, badged from its commission; the PLACE cell with the machine's
 * payout wording; a come strip per line type that travels), the line bars with their odds, the
 * come box, the field with its multiplier wording, hardways, the props panel (composites as
 * buttons) and the side-bet panel. Nothing the config knows is hard-coded here: pays come from the
 * catalog's `Ratio.label`s as the machine writes them (`payLabelStyle: asWritten`), commission
 * badges from the commission rules, odds badges from the odds caps. The Table component joins
 * these zones with the live `legalBets` spots by (typeId, number, parentId).
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
  /** A short qualifier from the config: a buy's "5% now", the odds bar's "2x odds". */
  readonly badge: string | null
  /** A longer line from the config, such as the field's covered totals. */
  readonly detail: string | null
  /** The odds type a bet on this zone can carry (line and come-spot zones). */
  readonly oddsTypeId: string | null
  /** False for zones the engine does not take yet (side bets before M11). */
  readonly modelled: boolean
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
  readonly hasDont: boolean
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
          lines.push(lineZone(type, odds))
          if (odds !== null) lines.push(oddsZone(odds))
        } else {
          center.push(comeBoxZone(type, odds))
          for (const n of cfg.ruleset.points) strips.get(n)?.push(comeSpotZone(type, odds, n))
        }
        break
      }
      case 'odds':
        break // Emitted with its parent line.
      case 'numberVsSeven': {
        if (type.kind === 'big') {
          for (const n of type.numbers) center.push(numberZone(type, n, 'big'))
        } else {
          for (const n of type.numbers) {
            columns.get(n)?.push(numberZone(type, n, type.kind))
          }
        }
        break
      }
      case 'hardway': {
        for (const n of type.numbers) {
          hardways.push({
            ...zoneBase(type.typeId, 'hardway', n),
            label: `Hard ${n}`,
            payLabel: type.pays.get(n)?.label ?? null,
          })
        }
        break
      }
      case 'oneRoll': {
        if (type.match === 'total' && type.pays.size >= FIELD_SPAN) {
          center.push(fieldZone(type))
        } else {
          props.push({
            ...zoneBase(type.typeId, 'prop', null),
            label: type.label,
            payLabel: onePayLabel(type),
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

  const sideBets: ZoneSpec[] = [...cfg.sideBets.values()].map((side) => ({
    ...zoneBase(side.typeId, 'sideBet', null),
    label: side.label,
    modelled: false,
    detail: 'In a later update',
  }))

  // The columns in the order the ruleset lists the points, each buy/lay/place then come strips.
  const numbers: NumberColumn[] = cfg.ruleset.points.map((n) => ({
    number: n,
    name: numberName(n),
    cells: [...(columns.get(n) ?? []), ...(strips.get(n) ?? [])],
  }))

  return { numbers, lines, center, hardways, props, sideBets, hasDont }
}

// ---------------------------------------------------------------------------------------------

function zoneBase(typeId: string, kind: ZoneKind, number: PointNumber | null) {
  return {
    key: number === null ? `${kind}:${typeId}` : `${kind}:${typeId}:${number}`,
    target: `zone:${typeId}`,
    typeId,
    kind,
    number,
    payLabel: null,
    badge: null,
    detail: null,
    oddsTypeId: null,
    modelled: true,
  }
}

function oddsTypeOf(cfg: MachineConfig, line: LineBetType): OddsBetType | null {
  const oddsId = cfg.oddsFor.get(line.typeId)
  const odds = oddsId === undefined ? undefined : cfg.catalog.get(oddsId)
  return odds?.family === 'odds' ? odds : null
}

function lineZone(type: LineBetType, odds: OddsBetType | null): ZoneSpec {
  return {
    ...zoneBase(type.typeId, 'line', null),
    label: type.label,
    payLabel: type.pays.label,
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

function comeBoxZone(type: LineBetType, odds: OddsBetType | null): ZoneSpec {
  return {
    ...zoneBase(type.typeId, 'comeBox', null),
    label: type.label,
    payLabel: type.pays.label,
    oddsTypeId: odds?.typeId ?? null,
  }
}

function comeSpotZone(type: LineBetType, odds: OddsBetType | null, n: PointNumber): ZoneSpec {
  return {
    ...zoneBase(type.typeId, 'comeSpot', n),
    label: type.label,
    oddsTypeId: odds?.typeId ?? null,
  }
}

function numberZone(type: NumberBetType, n: PointNumber, kind: ZoneKind): ZoneSpec {
  const commission = type.commission?.get(n) ?? null
  return {
    ...zoneBase(type.typeId, kind, n),
    label: type.label,
    payLabel: type.pays.get(n)?.label ?? null,
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
function fieldZone(type: OneRollBetType): ZoneSpec {
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
  const covered = [...type.pays.keys()]
    .map(Number)
    .sort((a, b) => a - b)
    .join(' ')
  return {
    ...zoneBase(type.typeId, 'field', null),
    label: type.label,
    payLabel: base,
    badge: specials.length === 0 ? null : specials.join('; '),
    detail: covered,
  }
}

/** A prop's pay as written when its pays agree ("16 for 1"); null when they differ. */
function onePayLabel(type: OneRollBetType): string | null {
  const labels = new Set([...type.pays.values()].map((ratio) => ratio.label))
  return labels.size === 1 ? ([...labels][0] ?? null) : null
}

/** "5.00" → "5", "4.50" → "4.5": percent badges drop the noise, not the precision. */
function trimDecimal(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}
