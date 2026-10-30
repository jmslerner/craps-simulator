import type { MachineConfigInput } from '../../../engine/index.ts'
import { toPointer } from '../../../engine/config/provenance.ts'
import { COME_OUT_RULES, POINT_NUMBERS } from '../../../engine/config/rulesets.ts'
import { MachineConfigInputSchema, RatioSchema } from '../../../engine/config/schema.ts'
import { getAt, type Path } from './draft.ts'

/**
 * The machine editor's fields (M12), built from the config schema itself: every value of a
 * `MachineConfigInput` gets a field whose widget follows its zod type — a select for an enum, a
 * checkbox for a boolean, a dollar input for cents, a text input for a pay ratio — so the editor
 * covers every knob the schema has, side bets included, and stays in step with it. The tree is
 * grouped into sections a player can scan: the machine, money and limits, each bet type, the
 * combination bets, each side bet, the working rules, and display and pace.
 *
 * Records keyed by point number (pays, odds caps, per-number limits) show every point of the
 * machine's variant, empty where the machine sets nothing, so adding a value is typing it; other
 * optional values are added and removed with buttons. Nothing here validates: the editor runs the
 * full schema and semantic checks on the whole draft and shows each issue at its field.
 */

/** The zod internals the walk reads (zod v4 keeps a schema's definition on `_zod.def`). */
export interface ZodLike {
  readonly _zod: { readonly def: ZodDef }
}

interface ZodDef {
  readonly type: string
  readonly shape?: Readonly<Record<string, ZodLike>>
  readonly keyType?: ZodLike
  readonly valueType?: ZodLike
  readonly element?: ZodLike
  readonly options?: readonly ZodLike[]
  readonly discriminator?: string
  readonly innerType?: ZodLike
  readonly entries?: Readonly<Record<string, string | number>>
  readonly values?: readonly unknown[]
}

const ROOT = MachineConfigInputSchema as unknown as ZodLike
const RATIO = RatioSchema as unknown as ZodLike

export interface ChoiceOption {
  readonly value: string | number | null
  readonly label: string
}

export type Widget =
  | { readonly kind: 'money'; readonly nullable: boolean }
  | { readonly kind: 'integer'; readonly nullable: boolean }
  | { readonly kind: 'ratio' }
  | { readonly kind: 'text' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'choice'; readonly options: readonly ChoiceOption[] }
  | { readonly kind: 'fixed' }
  | { readonly kind: 'set'; readonly options: readonly (string | number)[] }
  | { readonly kind: 'list'; readonly money: boolean; readonly numeric: boolean }

/** Something the player can add where a group shows: a missing optional value or a list item. */
export interface AddOption {
  readonly label: string
  readonly path: Path
  readonly value: unknown
}

export interface FieldNode {
  readonly type: 'field'
  readonly path: Path
  readonly pointer: string
  readonly label: string
  readonly widget: Widget
  /** The value, or undefined for an optional record key the machine leaves unset. */
  readonly value: unknown
  /** The value may be cleared (an optional record key): an empty input removes it. */
  readonly clearable: boolean
  /** A list or record entry, or an optional value, that the player may remove whole. */
  readonly removable: boolean
  /** Render compactly, as one cell of a by-number row. */
  readonly compact: boolean
}

export interface GroupNode {
  readonly type: 'group'
  readonly path: Path
  readonly pointer: string
  readonly label: string
  readonly children: readonly EditorNode[]
  readonly add: readonly AddOption[]
  /** A record keyed by free text (a pay table): the player may add an entry under a new key. */
  readonly addKey: { readonly value: unknown } | null
  readonly removable: boolean
  /** A by-number record: its fields render as one row of cells. */
  readonly grid: boolean
  /** A nullable object: the player may switch it off (null) or on (a default object). */
  readonly toggle: { readonly on: boolean; readonly value: unknown } | null
}

export type EditorNode = FieldNode | GroupNode

export interface Section {
  readonly id: string
  readonly title: string
  /** The pointer the section stands for (a bet's own), or null for a mixed section. */
  readonly pointer: string | null
  readonly nodes: readonly EditorNode[]
}

const LABELS: Readonly<Record<string, string>> = {
  rules: 'Rules',
  naturals: 'Naturals',
  craps: 'Craps',
  points: 'Points',
  dontBar: "Don't bar",
  allowPutBets: 'Put bets',
  money: 'Money',
  payoutRounding: 'Payout rounding',
  startingBankroll: 'Starting bankroll',
  betIncrement: 'Bet increment',
  mode: 'Rounding',
  increment: 'Step',
  limits: 'Limits',
  min: 'Minimum',
  max: 'Maximum',
  tableMax: 'Table maximum',
  perType: 'Limits by bet',
  incrementByNumber: 'Stake unit on each number',
  minByNumber: 'Minimum on each number',
  minTotal: 'Minimum total to roll',
  amount: 'Amount',
  scope: 'Scope',
  countOff: 'OFF bets count',
  countSideBets: 'Side bets count',
  chips: 'Chips',
  label: 'Name on the layout',
  side: 'Side',
  window: 'Placed in',
  pays: 'Pays',
  afterWin: 'After a win',
  onNumber: 'Once on a number',
  rebetAfterRemove: 'Re-bet after taking down',
  parent: 'Behind',
  limit: 'Odds limit',
  basis: 'Basis',
  multiple: 'Times the flat bet',
  comeOutDefault: 'On the come-out',
  kind: 'Kind',
  numbers: 'Numbers',
  payoutRoundingByNumber: 'Rounding on each number',
  commission: 'Commission (vig)',
  commissionByNumber: 'Commission on each number',
  rate: 'Rate',
  timing: 'Charged',
  minimum: 'Smallest charge',
  refundOnTakeDown: 'Refunded on take-down',
  rearm: 'When a winner stays up',
  match: 'Matched on',
  parts: 'Parts',
  typeId: 'Bet',
  units: 'Units',
  targets: 'Targets',
  endsOn: 'Ends on',
  placement: 'Placed',
  countedPoints: 'Points that count',
  payTable: 'Pay table',
  payImmediatelyAt: 'Pays at once at',
  countDefinition: 'Rolls counted',
  tiers: 'Tiers',
  minRolls: 'From rolls',
  qualifyingBet: 'Qualifying main-game bet',
  topAward: 'Top award',
  repeatEndsBet: 'A repeat ends the bet',
  removableBeforePoint: 'Removable before the point',
  workingToggle: 'ON/OFF control',
  global: 'Global button',
  perBet: 'Per-bet toggles',
  types: 'Bets it covers',
  comeOut: 'Come-out',
  autoOff: 'Switched OFF at the come-out',
  carried: 'Carried bets',
  newlyPlaced: 'Newly placed bets',
  reOnAt: 'Back ON at',
  afterSevenOut: 'After a seven-out',
  newPlacedOff: 'New bets start OFF',
  trigger: 'Started by',
  until: 'Until',
  layAutoOn: 'Lay bets back ON',
  afterPointMade: 'After a point is made',
  afterSeven: 'After any 7',
  oddsOffReturnedAtPointMade: 'OFF odds returned when the point is made',
  offBets: 'OFF bets',
  consumeCredit: 'Use credit',
  exclusiveGroups: 'Bets that cannot be up together',
  excludeLineVsLayBuy: 'A line bet blocks lay or buy on its point',
  payLabelStyle: 'Pay labels',
  flow: 'Flow',
  shooter: 'Shooter',
  invalidRoll: 'Invalid roll',
  puckReset: 'Puck reset',
  groupButtons: 'Group buttons',
  buttons: 'Buttons',
  condition: 'Shown',
  historyLength: 'Roll history length',
  macros: 'Macros',
  pace: 'Pace',
  rollsPerHour: 'Rolls per hour',
  betWindowSec: 'Betting window (seconds)',
  shooterWindowSec: 'Shooter window (seconds)',
  name: 'Machine name',
  variant: 'Variant',
}

/** Keys whose numbers are cents: money is whole cents throughout the config. */
const MONEY_KEYS = new Set([
  'startingBankroll',
  'betIncrement',
  'increment',
  'min',
  'max',
  'tableMax',
  'amount',
  'minimum',
  'qualifyingBet',
])
const MONEY_RECORDS = new Set(['incrementByNumber', 'minByNumber'])

/** Keys the editor never shows: bookkeeping, a family no edit can change, the provenance. */
const HIDDEN = new Set(['schemaVersion', 'id', 'provenance', 'family'])

/**
 * A bet type's identity, shown but not edited: changing a place bet into a buy bet, a pass into a
 * don't pass or a one-roll bet's matching is a different bet, not a different machine value.
 */
const STRUCTURAL = new Set(['kind', 'side', 'window', 'parent', 'match'])

/** Whether the number at `path` is money (cents) rather than a count. */
export function isMoneyPath(path: Path): boolean {
  const last = path.at(-1)
  const parent = path.at(-2)
  if (path[0] === 'chips') return true
  if (typeof parent === 'string' && MONEY_RECORDS.has(parent)) return true
  return typeof last === 'string' && MONEY_KEYS.has(last)
}

/** A label for the value at `path` in `draft`. */
export function labelFor(draft: MachineConfigInput, path: Path): string {
  const last = path.at(-1)
  if (last === undefined) return 'Machine'
  const parent = path.at(-2)
  if (typeof last === 'number') return `${singular(parent)} ${last + 1}`
  if (parent === 'catalog' || parent === 'sideBets' || parent === 'composites') {
    const entry = getAt(draft, path) as { readonly label?: unknown } | undefined
    return typeof entry?.label === 'string' ? entry.label : last
  }
  if (parent === 'perType') return typeLabel(draft, last)
  if (parent === 'commissionByNumber' || parent === 'payoutRoundingByNumber') return `On ${last}`
  if (/^\d+$/.test(last) || /^[1-6]-[1-6]$/.test(last)) return last
  return LABELS[last] ?? humanize(last)
}

const SINGULAR: Readonly<Record<string, string>> = {
  tiers: 'Tier',
  parts: 'Part',
  exclusiveGroups: 'Group',
  chips: 'Chip',
}

function singular(key: string | number | undefined): string {
  return (typeof key === 'string' ? SINGULAR[key] : undefined) ?? 'Item'
}

/** A bet type, composite or side bet by its layout label. */
export function typeLabel(draft: MachineConfigInput, typeId: string): string {
  for (const record of [draft.catalog, draft.composites, draft.sideBets]) {
    const entry = Object.hasOwn(record, typeId) ? record[typeId] : undefined
    if (entry !== undefined) return entry.label
  }
  return typeId
}

function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, (_match, before: string, after: string) => `${before} ${after}`)
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const def = (schema: ZodLike): ZodDef => schema._zod.def

/** The schema without its optional and nullable wrappers, and whether each applied. */
function unwrap(schema: ZodLike): {
  readonly inner: ZodLike
  readonly optional: boolean
  readonly nullable: boolean
} {
  let inner = schema
  let optional = false
  let nullable = false
  for (;;) {
    const d = def(inner)
    if (d.type === 'optional' && d.innerType !== undefined) {
      optional = true
      inner = d.innerType
    } else if (d.type === 'nullable' && d.innerType !== undefined) {
      nullable = true
      inner = d.innerType
    } else {
      return { inner, optional, nullable }
    }
  }
}

/** The option of a discriminated union that `value` is, or the first. */
function unionOption(schema: ZodLike, value: unknown): ZodLike | undefined {
  const d = def(schema)
  const options = d.options ?? []
  const discriminator = d.discriminator
  if (discriminator !== undefined && value !== null && typeof value === 'object') {
    const tag = (value as Record<string, unknown>)[discriminator]
    const found = options.find((option) => {
      const field = def(option).shape?.[discriminator]
      return field !== undefined && (literalValues(field) ?? []).includes(tag)
    })
    if (found !== undefined) return found
  }
  return options[0]
}

function literalValues(schema: ZodLike): readonly unknown[] | null {
  const d = def(schema)
  if (d.type === 'literal') return d.values ?? []
  if (d.type === 'enum') return Object.values(d.entries ?? {})
  return null
}

/** The point numbers the variant plays, where a list or record names any point number. */
function variantNumbers(values: readonly unknown[], draft: MachineConfigInput): readonly unknown[] {
  const points: readonly unknown[] = POINT_NUMBERS
  const allPoints = values.length === points.length && values.every((v) => points.includes(v))
  const allKeys = values.length === points.length && values.every((v) => points.includes(Number(v)))
  if (allPoints) return COME_OUT_RULES[draft.variant].points
  if (allKeys) return COME_OUT_RULES[draft.variant].points.map(String)
  return values
}

/** The widget for a primitive schema at `path`; null for structures (objects, records, lists). */
function widgetFor(schema: ZodLike, path: Path, nullable: boolean): Widget | null {
  if (schema === RATIO) return { kind: 'ratio' }
  if (path.length === 1 && path[0] === 'variant') return { kind: 'fixed' }
  const last = path.at(-1)
  if (typeof last === 'string' && STRUCTURAL.has(last) && path[0] === 'catalog') {
    return { kind: 'fixed' }
  }
  const d = def(schema)
  switch (d.type) {
    case 'string':
      return { kind: 'text' }
    case 'boolean':
      return { kind: 'boolean' }
    case 'number':
      return isMoneyPath(path) ? { kind: 'money', nullable } : { kind: 'integer', nullable }
    case 'enum':
    case 'literal': {
      const values = literalValues(schema) ?? []
      if (values.length === 1 && !nullable) return { kind: 'fixed' }
      const options: ChoiceOption[] = values.map((value) => ({
        value: value as string | number,
        label: String(value),
      }))
      if (nullable) options.push({ value: null, label: 'none' })
      return { kind: 'choice', options }
    }
    case 'union': {
      // A union of single values — a Hot Shooter tier pays 'push' or a ratio — is typed as text
      // and checked by the schema; a union of objects (a bet type by family) is a structure.
      const primitive = (d.options ?? []).every((option) => {
        const type = def(unwrap(option).inner).type
        return type === 'literal' || type === 'string'
      })
      return primitive ? { kind: 'ratio' } : null
    }
    default:
      return null
  }
}

/**
 * A value for a schema, for an "add" button: required object keys filled in, enums at their
 * first option, money at a dollar, counts at 1, lists and records empty — and a pay left blank,
 * for the player to type: the editor flags it until they do, rather than inventing one.
 */
export function skeleton(schema: ZodLike, path: Path): unknown {
  const { inner, nullable } = unwrap(schema)
  if (inner === RATIO) return ''
  const d = def(inner)
  switch (d.type) {
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(d.shape ?? {})) {
        if (unwrap(child).optional) continue
        result[key] = skeleton(child, [...path, key])
      }
      return result
    }
    case 'record':
      return {}
    case 'array':
      return []
    case 'boolean':
      return false
    case 'string':
      return ''
    case 'number':
      return isMoneyPath(path) ? 100 : 1
    case 'enum':
    case 'literal':
      return (literalValues(inner) ?? [null])[0]
    case 'union': {
      const first = d.options?.[0]
      return first === undefined ? null : skeleton(first, path)
    }
    default:
      return nullable ? null : undefined
  }
}

interface NodeOptions {
  readonly removable: boolean
  readonly compact: boolean
}

/** Builds the node for the value at `path` with `schema`. */
function nodeFor(
  draft: MachineConfigInput,
  schema: ZodLike,
  path: Path,
  options: NodeOptions,
): EditorNode | null {
  const { inner, optional, nullable } = unwrap(schema)
  const value = getAt(draft, path)
  const pointer = toPointer(path)
  const label = labelFor(draft, path)
  const removable = options.removable || (optional && value !== undefined)
  const widget = widgetFor(inner, path, nullable)
  if (widget !== null) {
    return {
      type: 'field',
      path,
      pointer,
      label,
      widget,
      value,
      clearable: false,
      removable,
      compact: options.compact,
    }
  }
  const base = { path, pointer, label, removable }
  if (value === null && nullable) {
    return {
      ...base,
      type: 'group',
      children: [],
      add: [],
      addKey: null,
      grid: false,
      toggle: { on: false, value: skeleton(inner, path) },
    }
  }
  const toggle = nullable ? { on: true, value: null } : null
  const d = def(inner)
  if (d.type === 'array') return arrayNode(draft, d, base, value, toggle, options)
  if (d.type === 'record') return recordNode(draft, d, base, value, toggle)
  if (d.type === 'object' || d.type === 'union') {
    const shape = d.type === 'union' ? unionOption(inner, value) : inner
    if (shape === undefined) return null
    const record = (value ?? {}) as Record<string, unknown>
    const children: EditorNode[] = []
    const add: AddOption[] = []
    for (const [key, child] of Object.entries(def(shape).shape ?? {})) {
      if (HIDDEN.has(key)) continue
      const childPath = [...path, key]
      if (!Object.hasOwn(record, key)) {
        if (unwrap(child).optional) {
          const name = (LABELS[key] ?? humanize(key)).toLowerCase()
          add.push({ label: `Add ${name}`, path: childPath, value: skeleton(child, childPath) })
        }
        continue
      }
      const node = nodeFor(draft, child, childPath, { removable: false, compact: false })
      if (node !== null) children.push(node)
    }
    return { ...base, type: 'group', children, add, addKey: null, grid: false, toggle }
  }
  return null
}

interface NodeBase {
  readonly path: Path
  readonly pointer: string
  readonly label: string
  readonly removable: boolean
}

function arrayNode(
  draft: MachineConfigInput,
  d: ZodDef,
  base: NodeBase,
  value: unknown,
  toggle: GroupNode['toggle'],
  options: NodeOptions,
): EditorNode | null {
  const element = d.element
  if (element === undefined) return null
  const elementInner = unwrap(element).inner
  const values = literalValues(elementInner)
  if (values !== null) {
    const shown = variantNumbers(values, draft) as (string | number)[]
    return fieldOf(base, { kind: 'set', options: shown }, value, options.compact)
  }
  const elementType = def(elementInner).type
  if (elementType === 'number' || elementType === 'string') {
    const money = isMoneyPath([...base.path, 0])
    const widget: Widget = { kind: 'list', money, numeric: elementType === 'number' }
    return fieldOf(base, widget, value, options.compact)
  }
  const items = Array.isArray(value) ? value : []
  const children = items.flatMap((_, index) => {
    const child = nodeFor(draft, element, [...base.path, index], {
      removable: true,
      compact: false,
    })
    return child === null ? [] : [child]
  })
  const next = [...base.path, items.length]
  const add = [
    {
      label: `Add ${singular(base.path.at(-1)).toLowerCase()}`,
      path: next,
      value: skeleton(element, next),
    },
  ]
  return { ...base, type: 'group', children, add, addKey: null, grid: false, toggle }
}

function recordNode(
  draft: MachineConfigInput,
  d: ZodDef,
  base: NodeBase,
  value: unknown,
  toggle: GroupNode['toggle'],
): EditorNode | null {
  const { valueType, keyType } = d
  if (valueType === undefined || keyType === undefined) return null
  const record = (value ?? {}) as Record<string, unknown>
  const present = Object.keys(record)
  const keyValues = literalValues(keyType)
  const keys =
    keyValues === null
      ? null
      : [
          ...(variantNumbers(keyValues, draft) as string[]).map(String),
          ...present.filter((key) => !keyValues.map(String).includes(key)),
        ]
  const valueWidget = widgetFor(unwrap(valueType).inner, [...base.path, '0'], false)
  if (keys !== null && valueWidget !== null) {
    // A by-number record of single values: every number shows; empty means unset.
    const children = keys.map((key): FieldNode => ({
      type: 'field',
      path: [...base.path, key],
      pointer: toPointer([...base.path, key]),
      label: key,
      widget: valueWidget,
      value: Object.hasOwn(record, key) ? record[key] : undefined,
      clearable: true,
      removable: false,
      compact: true,
    }))
    return { ...base, type: 'group', children, add: [], addKey: null, grid: true, toggle }
  }
  const children = present.flatMap((key) => {
    const child = nodeFor(draft, valueType, [...base.path, key], {
      removable: true,
      compact: false,
    })
    return child === null ? [] : [child]
  })
  const missing = keys === null ? perTypeKeys(draft, base.path) : keys
  const add: AddOption[] = missing
    .filter((key) => !present.includes(key))
    .map((key) => ({
      label: `Add ${base.path.at(-1) === 'perType' ? typeLabel(draft, key) : key}`,
      path: [...base.path, key],
      value: skeleton(valueType, [...base.path, key]),
    }))
  const freeKeys = keys === null && missing.length === 0 && valueWidget !== null
  const addKey = freeKeys ? { value: skeleton(valueType, [...base.path, '0']) } : null
  return { ...base, type: 'group', children, add, addKey, grid: false, toggle }
}

/** The bets `/limits/perType` can add limits for: every bet type, combination and side bet. */
function perTypeKeys(draft: MachineConfigInput, path: Path): string[] {
  if (path.length !== 2 || path[0] !== 'limits' || path[1] !== 'perType') return []
  return [
    ...Object.keys(draft.catalog),
    ...Object.keys(draft.composites),
    ...Object.keys(draft.sideBets),
  ]
}

function fieldOf(base: NodeBase, widget: Widget, value: unknown, compact: boolean): FieldNode {
  return { ...base, type: 'field', widget, value, clearable: false, compact }
}

/** The root schema's field for `key`. */
function rootField(key: string): ZodLike {
  const field = def(ROOT).shape?.[key]
  if (field === undefined) throw new Error(`The config schema has no ${key}`)
  return field
}

/** The schema of one record entry under a root key (`catalog`, `sideBets`). */
function entrySchema(key: 'catalog' | 'sideBets'): ZodLike {
  const valueType = def(rootField(key)).valueType
  if (valueType === undefined) throw new Error(`The config schema's ${key} is not a record`)
  return valueType
}

function rootNodes(draft: MachineConfigInput, keys: readonly string[]): EditorNode[] {
  return keys.flatMap((key) => {
    if (!Object.hasOwn(draft, key)) return []
    const node = nodeFor(draft, rootField(key), [key], { removable: false, compact: false })
    return node === null ? [] : [node]
  })
}

function entrySection(
  draft: MachineConfigInput,
  root: 'catalog' | 'sideBets',
  typeId: string,
): Section | null {
  const path = [root, typeId]
  const node = nodeFor(draft, entrySchema(root), path, {
    removable: root === 'sideBets',
    compact: false,
  })
  if (node === null) return null
  const prefix = root === 'sideBets' ? 'Side bet: ' : ''
  return {
    id: `${root}/${typeId}`,
    title: `${prefix}${node.label}`,
    pointer: toPointer(path),
    nodes: node.type === 'group' ? node.children : [node],
  }
}

/**
 * The editor's sections for `draft` (see the module comment). Each bet type and side bet is a
 * section of its own, titled by its label on the layout.
 */
export function editorSections(draft: MachineConfigInput): Section[] {
  const sections: Section[] = [
    {
      id: 'machine',
      title: 'Machine',
      pointer: null,
      nodes: rootNodes(draft, ['name', 'variant', 'rules']),
    },
    {
      id: 'money',
      title: 'Money and limits',
      pointer: null,
      nodes: rootNodes(draft, ['money', 'limits', 'chips']),
    },
  ]
  for (const typeId of Object.keys(draft.catalog)) {
    const section = entrySection(draft, 'catalog', typeId)
    if (section !== null) sections.push(section)
  }
  if (Object.keys(draft.composites).length > 0) {
    sections.push({
      id: 'composites',
      title: 'Combination bets',
      pointer: '/composites',
      nodes: rootNodes(draft, ['composites']),
    })
  }
  for (const typeId of Object.keys(draft.sideBets)) {
    const section = entrySection(draft, 'sideBets', typeId)
    if (section !== null) sections.push(section)
  }
  sections.push(
    {
      id: 'working',
      title: 'Working rules',
      pointer: null,
      nodes: rootNodes(draft, [
        'workingToggle',
        'comeOut',
        'afterSevenOut',
        'layAutoOn',
        'oddsOffReturnedAtPointMade',
        'offBets',
        'exclusiveGroups',
        'excludeLineVsLayBuy',
      ]),
    },
    {
      id: 'display',
      title: 'Display and pace',
      pointer: null,
      nodes: rootNodes(draft, ['payLabelStyle', 'flow', 'pace']),
    },
  )
  return sections
}

/** Every pointer the sections show, groups and the bets' own sections included. */
export function shownPointers(sections: readonly Section[]): Set<string> {
  const shown = new Set<string>()
  const visit = (node: EditorNode): void => {
    shown.add(node.pointer)
    if (node.type === 'group') node.children.forEach(visit)
  }
  for (const section of sections) {
    if (section.pointer !== null) shown.add(section.pointer)
    section.nodes.forEach(visit)
  }
  return shown
}

/** The section that shows `pointer` (or the value it names). */
export function sectionOf(sections: readonly Section[], pointer: string): Section | undefined {
  const under = (root: string) => pointer === root || pointer.startsWith(`${root}/`)
  return (
    sections.find((section) => section.pointer !== null && under(section.pointer)) ??
    sections.find((section) => section.nodes.some((node) => under(node.pointer)))
  )
}
