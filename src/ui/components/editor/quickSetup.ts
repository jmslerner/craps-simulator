import { PRESETS, PRESET_IDS } from '../../../engine/index.ts'
import type { MachineConfigInput, PresetId, Variant } from '../../../engine/index.ts'
import { pruneProvenance } from '../../../engine/config/provenance.ts'
import { parseRatio } from '../../../engine/config/ratio.ts'
import type { CommissionInput } from '../../../engine/config/schema.ts'
import { editValue, getAt, sameJson, setAt, type Path } from './draft.ts'

/**
 * Match My Machine (plan §10 M12): five questions a player can answer standing at their machine,
 * turned into a config from the nearest built-in machine. The questions are the knobs that
 * differ most between real bubble machines and move the coach's numbers most:
 *
 * 1. **Buy vig** — taken from the win, paid up front and again whenever a winner stays up, or
 *    paid up front once (`/catalog/buy/commission/{timing, rearm, refundOnTakeDown}`, and the
 *    same on every number that overrides it).
 * 2. **Place and buy on the come-out** — working or OFF (`/catalog/{place,buy}/comeOutDefault`;
 *    ON also takes them off a Shoot To Win machine's come-out switch-off lists).
 * 3. **Odds caps** — crapless 2/12 and 3/11 (traditional 4/10, 5/9, 6/8), as times the flat bet
 *    (`/catalog/<take odds>/limit/multiple/<n>` on pass and come odds).
 * 4. **Field pays on 2 and 12** — double on both, or triple on one (`/catalog/field/pays/{2,12}`).
 * 5. **Side bets** — which the machine shows, each taken whole, provenance and all, from the
 *    built-in machine of the same kind that has it (`/sideBets/<id>`, `/limits/perType/<id>`).
 *
 * The nearest preset is the one of the player's kind of machine (crapless or traditional) that
 * already matches the most answers; the answers are then applied to a copy of it, every value the
 * player changed recorded as theirs (`USER`), every value left alone keeping its research.
 */

export type BuyVig = 'onWin' | 'upfrontRecollect' | 'upfrontOnce'
export type ComeOutWorking = 'on' | 'off'
export type FieldPays = 'double' | 'tripleOn12' | 'tripleOn2'

export interface MatchAnswers {
  /** Null when the machine offers no buy bet. */
  readonly buyVig: BuyVig | null
  readonly comeOut: ComeOutWorking
  /** The odds cap, as times the flat bet, for each group of points (`ODDS_GROUPS`). */
  readonly oddsCaps: Readonly<Record<string, number>>
  /** Null when the machine has no field, or pays it some other way. */
  readonly field: FieldPays | null
  /** The side bets the machine shows, by id. */
  readonly sideBets: readonly string[]
}

/** The point groups question 3 asks about, by variant: a label and the points it covers. */
export const ODDS_GROUPS: Readonly<
  Record<Variant, readonly { readonly key: string; readonly points: readonly string[] }[]>
> = {
  crapless: [
    { key: '2/12', points: ['2', '12'] },
    { key: '3/11', points: ['3', '11'] },
  ],
  traditional: [
    { key: '4/10', points: ['4', '10'] },
    { key: '5/9', points: ['5', '9'] },
    { key: '6/8', points: ['6', '8'] },
  ],
}

/** Odds caps a player may pick (times the flat bet). */
export const ODDS_CAP_CHOICES: readonly number[] = [1, 2, 3, 4, 5, 6, 10]

export const BUY_VIG_CHOICES: readonly { readonly value: BuyVig; readonly label: string }[] = [
  { value: 'onWin', label: 'Taken out of the win, only when the bet wins' },
  {
    value: 'upfrontRecollect',
    label: 'Paid when I place it, and again each time it wins and stays up',
  },
  { value: 'upfrontOnce', label: 'Paid once when I place it, not again on a win' },
]

export const COME_OUT_CHOICES: readonly {
  readonly value: ComeOutWorking
  readonly label: string
}[] = [
  { value: 'on', label: 'Working (ON): a come-out 7 takes them' },
  { value: 'off', label: 'OFF: they rest until a point is set' },
]

export const FIELD_CHOICES: readonly { readonly value: FieldPays; readonly label: string }[] = [
  { value: 'double', label: 'Double on both 2 and 12' },
  { value: 'tripleOn12', label: 'Double on 2, triple on 12' },
  { value: 'tripleOn2', label: 'Triple on 2, double on 12' },
]

const FIELD_PAYS: Readonly<Record<FieldPays, readonly [number, number]>> = {
  double: [2, 2],
  tripleOn12: [2, 3],
  tripleOn2: [3, 2],
}

/** The note the answers' values carry in their provenance. */
export const MATCH_NOTE = 'Match My Machine: your answer about your machine.'

/** The take-odds types (behind pass and come) whose caps question 3 sets. */
function takeOdds(input: MachineConfigInput): string[] {
  return Object.entries(input.catalog).flatMap(([typeId, type]) => {
    if (type.family !== 'odds') return []
    const parent = input.catalog[type.parent]
    return parent?.family === 'line' && parent.side === 'do' ? [typeId] : []
  })
}

function buyVigOf(commission: CommissionInput | undefined): BuyVig | null {
  if (commission === undefined) return null
  if (commission.timing === 'onWin') return 'onWin'
  return commission.rearm === 'none' ? 'upfrontOnce' : 'upfrontRecollect'
}

/** How a config answers the five questions. */
export function answersOf(input: MachineConfigInput): MatchAnswers {
  const buy = input.catalog['buy']
  const place = input.catalog['place']
  const comeOutType = place ?? buy
  const odds = takeOdds(input)[0]
  const oddsType = odds === undefined ? undefined : input.catalog[odds]
  const oddsCaps: Record<string, number> = {}
  for (const group of ODDS_GROUPS[input.variant]) {
    const first = group.points[0]
    const multiple =
      oddsType?.family === 'odds' && first !== undefined
        ? oddsType.limit.multiple[first as keyof typeof oddsType.limit.multiple]
        : undefined
    if (multiple !== undefined) oddsCaps[group.key] = multiple
  }
  return {
    buyVig: buy?.family === 'numberVsSeven' ? buyVigOf(buy.commission) : null,
    comeOut:
      comeOutType?.family === 'numberVsSeven' && comeOutType.comeOutDefault === 'on' ? 'on' : 'off',
    oddsCaps,
    field: fieldOf(input),
    sideBets: Object.keys(input.sideBets),
  }
}

function fieldOf(input: MachineConfigInput): FieldPays | null {
  const field = input.catalog['field']
  if (field?.family !== 'oneRoll') return null
  const net = (key: string): number | null => {
    const text = field.pays[key]
    if (text === undefined) return null
    try {
      const ratio = parseRatio(text)
      return ratio.den === 1n ? Number(ratio.num) : null
    } catch {
      return null
    }
  }
  const pays = [net('2'), net('12')]
  for (const [answer, [two, twelve]] of Object.entries(FIELD_PAYS)) {
    if (pays[0] === two && pays[1] === twelve) return answer as FieldPays
  }
  return null
}

/** The side bets a machine of `variant` can have: each id from the first preset that has it. */
export function sideBetLibrary(variant: Variant): {
  readonly id: string
  readonly label: string
  readonly from: PresetId
}[] {
  const seen = new Map<string, { id: string; label: string; from: PresetId }>()
  for (const presetId of PRESET_IDS) {
    const preset = PRESETS[presetId]
    if (preset.variant !== variant) continue
    for (const [id, bet] of Object.entries(preset.sideBets)) {
      if (!seen.has(id)) seen.set(id, { id, label: bet.label, from: presetId })
    }
  }
  return [...seen.values()]
}

/** How many of the five answers `preset` already gives. */
export function matches(answers: MatchAnswers, preset: MachineConfigInput): number {
  const own = answersOf(preset)
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id) => b.includes(id))
  return [
    own.buyVig === answers.buyVig,
    own.comeOut === answers.comeOut,
    sameJson(own.oddsCaps, answers.oddsCaps),
    own.field === answers.field,
    sameSet(own.sideBets, answers.sideBets),
  ].filter(Boolean).length
}

/**
 * The built-in machine of `variant` nearest the answers: the most answers already given, ties to
 * `prefer` (the machine the player has picked) and then to preset order.
 */
export function nearestPreset(
  variant: Variant,
  answers: MatchAnswers,
  prefer: PresetId | null = null,
): { readonly id: PresetId; readonly matched: number } {
  let best: { id: PresetId; matched: number } | null = null
  for (const id of PRESET_IDS) {
    if (PRESETS[id].variant !== variant) continue
    const matched = matches(answers, PRESETS[id])
    if (best === null || matched > best.matched || (matched === best.matched && id === prefer)) {
      best = { id, matched }
    }
  }
  if (best === null) throw new Error(`No built-in machine is ${variant}`)
  return best
}

/** The answers applied to a copy of `baseId` (see the module comment). */
export function applyAnswers(
  baseId: PresetId,
  answers: MatchAnswers,
  name = `My machine (from ${PRESETS[baseId].name})`,
): MachineConfigInput {
  const base = PRESETS[baseId]
  // An answer the machine already gives changes nothing: a live table's on-win 4 and 10 stay as
  // they are unless the player says the vig works otherwise.
  const own = answersOf(base)
  let draft: MachineConfigInput = structuredClone(base) as MachineConfigInput
  const set = (path: Path, value: unknown): void => {
    if (!sameJson(getAt(draft, path), value))
      draft = editValue(draft, base, path, value, MATCH_NOTE)
  }

  const buy = draft.catalog['buy']
  if (answers.buyVig !== null && answers.buyVig !== own.buyVig && buy?.family === 'numberVsSeven') {
    const vig = answers.buyVig
    const commissions: Path[] = []
    if (buy.commission !== undefined) commissions.push(['catalog', 'buy', 'commission'])
    for (const n of Object.keys(buy.commissionByNumber ?? {})) {
      commissions.push(['catalog', 'buy', 'commissionByNumber', n])
    }
    for (const path of commissions) {
      const was = getAt(draft, path) as CommissionInput
      const upfrontBefore = was.timing === 'upfront'
      set([...path, 'timing'], vig === 'onWin' ? 'onWin' : 'upfront')
      set([...path, 'rearm'], vig === 'upfrontRecollect' ? 'recollectFromWin' : 'none')
      set([...path, 'refundOnTakeDown'], vig !== 'onWin' && upfrontBefore && was.refundOnTakeDown)
    }
  }

  for (const typeId of answers.comeOut === own.comeOut ? [] : ['place', 'buy']) {
    const type = draft.catalog[typeId]
    if (type?.family === 'numberVsSeven') {
      set(['catalog', typeId, 'comeOutDefault'], answers.comeOut)
    }
  }
  const autoOff = draft.comeOut.autoOff
  if (answers.comeOut === 'on' && answers.comeOut !== own.comeOut && autoOff !== null) {
    for (const list of ['carried', 'newlyPlaced'] as const) {
      const kept = autoOff[list].filter((typeId) => typeId !== 'place' && typeId !== 'buy')
      set(['comeOut', 'autoOff', list], kept)
    }
  }

  for (const oddsId of takeOdds(draft)) {
    for (const group of ODDS_GROUPS[draft.variant]) {
      const cap = answers.oddsCaps[group.key]
      if (cap === undefined || cap === own.oddsCaps[group.key]) continue
      for (const n of group.points) set(['catalog', oddsId, 'limit', 'multiple', n], cap)
    }
  }

  const field = draft.catalog['field']
  if (answers.field !== null && answers.field !== own.field && field?.family === 'oneRoll') {
    const style = Object.values(field.pays).some((text) => text.includes(' to ')) ? ' to ' : ':'
    const [two, twelve] = FIELD_PAYS[answers.field]
    set(['catalog', 'field', 'pays', '2'], `${two}${style}1`)
    set(['catalog', 'field', 'pays', '12'], `${twelve}${style}1`)
  }

  draft = withSideBets(draft, answers.sideBets)
  draft = { ...draft, name }
  return { ...draft, provenance: pruneProvenance(draft) }
}

/**
 * `draft` with exactly the side bets `ids`: the ones it lacks copied whole from the first preset
 * of its kind that has them — config, limits and provenance — and the others removed.
 */
function withSideBets(draft: MachineConfigInput, ids: readonly string[]): MachineConfigInput {
  let next = draft
  for (const id of Object.keys(draft.sideBets)) {
    if (ids.includes(id)) continue
    next = setAt(next, ['sideBets', id], undefined)
    if (next.limits.perType !== undefined && Object.hasOwn(next.limits.perType, id)) {
      next = setAt(next, ['limits', 'perType', id], undefined)
    }
  }
  const library = sideBetLibrary(draft.variant)
  for (const id of ids) {
    if (Object.hasOwn(next.sideBets, id)) continue
    const source = library.find((entry) => entry.id === id)
    if (source === undefined) continue
    const from = PRESETS[source.from]
    const bet = from.sideBets[id]
    if (bet === undefined) continue
    next = setAt(next, ['sideBets', id], structuredClone(bet))
    const limits = from.limits.perType?.[id]
    if (limits !== undefined) next = setAt(next, ['limits', 'perType', id], structuredClone(limits))
    const roots = [`/sideBets/${id}`, `/limits/perType/${id}`]
    const copied = Object.fromEntries(
      Object.entries(from.provenance).filter(([pointer]) =>
        roots.some((root) => pointer === root || pointer.startsWith(`${root}/`)),
      ),
    )
    next = { ...next, provenance: { ...next.provenance, ...copied } }
  }
  return { ...next, provenance: pruneProvenance(next) }
}
