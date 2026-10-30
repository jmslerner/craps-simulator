import {
  ALL_ROLLS,
  Fraction,
  TOTALS,
  canonicalJson,
  cents,
  effectiveWorking,
  hashJson,
  isDoubles,
  rollWindow,
  totalOf,
} from '../../engine/index.ts'
import type {
  BetId,
  BetInstance,
  Cents,
  Dice,
  MachineConfig,
  PointNumber,
  Rejection,
  SettlementTrace,
  TableState,
  Total,
  WindowedSession,
} from '../../engine/index.ts'
import { rollEntryOf, type RollItem, type RoundEvent } from './rollHistory.ts'

/**
 * The "Next roll" panel's data (plan §0 #18 lessons; the demo's Next roll section): what every
 * possible total would do to the bets on the table, computed by the real engine. Each of the 36
 * dice outcomes is dry-run through `rollWindow` on the session as it stands — a pure call that
 * returns a new session, which is read and dropped — so nothing is dispatched, logged or revealed,
 * and the real dice still come only from the engine's RNG. The rows read a dry-run's events
 * exactly as the roll history reads a real roll's (`rollEntryOf`: the round event, each bet's
 * settlement trace, the net from the ledgers) and group them by total. A total splits only where
 * the engine's events differ between its rolls — a hardway's 4-4 against the easy 8s, a hop's own
 * pair — which the dry-runs show rather than any rule written here. Ways out of 36 are counted
 * from the engine's dice module, and every chance is an exact `Fraction`.
 *
 * `cachedNextRoll` memoizes per shown table (by identity, then by state hash), so the 36 dry-runs
 * run once per betting change; `selectNextRoll` is the game-store selector built on it.
 */

/** What one roll would do to one bet, read from the dry-run's events. */
export type BetFate = 'win' | 'lose' | 'push' | 'travel' | 'returned' | 'none' | 'off'

export interface BetOutcome {
  readonly betId: BetId
  readonly typeId: string
  readonly number: PointNumber | null
  /** The bet's stake when the roll is made. */
  readonly amount: Cents
  readonly fate: BetFate
  /**
   * The bet's own net to the player: its winnings after commission (a commission re-collected
   * from credit included), its lost stake, or 0 for a push, a travel or no action. The bets' nets
   * add up to the outcome's `net`, which comes from the ledgers; the honesty tests pin that.
   */
  readonly net: Cents
  /** Where a travelling bet moves; null otherwise. */
  readonly travelTo: PointNumber | null
  /** The full settlement of a settled bet; null otherwise. */
  readonly trace: SettlementTrace | null
}

/** One distinct outcome of a total: the dice that give it, their ways, and what they do. */
export interface DiceOutcome {
  readonly total: Total
  /** The ordered rolls (d1, d2) that give exactly this outcome, in `ALL_ROLLS` order. */
  readonly dice: readonly Dice[]
  readonly ways: number
  readonly chance: Fraction
  /** The player's net on the roll, bets and credit together, as the history would show it. */
  readonly net: Cents
  readonly creditAfter: Cents
  readonly roundEvent: RoundEvent | null
  readonly endedHand: boolean
  /** Every bet on the table, in table order, with its fate. */
  readonly bets: readonly BetOutcome[]
  readonly winners: readonly BetOutcome[]
  readonly losers: readonly BetOutcome[]
  /** The roll's bet-level events as the engine emitted them: what the history would list. */
  readonly items: readonly RollItem[]
}

export interface HardSplit {
  /** The doubles roll: 2-2, 3-3, 4-4 or 5-5. */
  readonly hard: DiceOutcome
  /** Every other roll of the total. */
  readonly easy: DiceOutcome
}

/** One row of the panel: a total, its ways, and what it does to the table. */
export interface NextRollRow {
  readonly total: Total
  readonly ways: number
  readonly chance: Fraction
  /** The main outcome's figures: the only one, or the likeliest when the dice decide differently. */
  readonly net: Cents
  readonly roundEvent: RoundEvent | null
  readonly winners: readonly BetOutcome[]
  readonly losers: readonly BetOutcome[]
  readonly bets: readonly BetOutcome[]
  /** Set when the doubles roll decides differently from every other roll of the total. */
  readonly hardSplit?: HardSplit
  /** Every distinct outcome of the total, likeliest first: one unless a bet tells the dice apart. */
  readonly outcomes: readonly DiceOutcome[]
}

export type NeedWay = 'any' | 'hard' | 'easy' | 'dice'

/** A total a bet needs, or must avoid, and which of its rolls count. */
export interface NeedTotal {
  readonly total: Total
  /** `any` roll of the total; the `hard` doubles only; the `easy` rolls only; or one `dice` pair. */
  readonly way: NeedWay
  /** The pair, with `d1 <= d2`, when `way` is `dice`; null otherwise. */
  readonly dice: Dice | null
  readonly ways: number
}

export interface BetNeeds {
  readonly bet: BetInstance
  /** Whether the bet works on this roll (`effectiveWorking`). */
  readonly working: boolean
  readonly winsOn: readonly NeedTotal[]
  readonly losesOn: readonly NeedTotal[]
  readonly movesOn: readonly NeedTotal[]
  /** Totals that hand the stake back: odds returned unplayed, or a push that ends the bet. */
  readonly returnsOn: readonly NeedTotal[]
  /** The chance the next roll wins (loses) this bet: its ways out of 36. */
  readonly winChance: Fraction
  readonly loseChance: Fraction
}

export interface NextRollSummary {
  /** Rolls out of 36 on which the player's net is positive, negative, or zero. */
  readonly winWays: number
  readonly loseWays: number
  readonly evenWays: number
  readonly winChance: Fraction
  readonly loseChance: Fraction
  readonly evenChance: Fraction
}

export interface NextRollPreview {
  /** `hashJson` of the table the preview is for. */
  readonly stateHash: string
  readonly comeOut: boolean
  readonly point: PointNumber | null
  readonly betCount: number
  /** One per total, 2 to 12; empty when the machine refuses the roll. */
  readonly rows: readonly NextRollRow[]
  /** One per bet on the table, in table order; empty when the roll is refused. */
  readonly needs: readonly BetNeeds[]
  /** Why the machine refuses to roll as the table stands; null when it would roll. */
  readonly refused: Rejection | null
  readonly summary: NextRollSummary
}

const WAYS_IN_ALL = ALL_ROLLS.length

/** A dry-run's reading, before grouping. */
interface DryRun {
  readonly dice: Dice
  readonly total: Total
  readonly net: Cents
  readonly creditAfter: Cents
  readonly roundEvent: RoundEvent | null
  readonly endedHand: boolean
  readonly items: readonly RollItem[]
  readonly bets: readonly BetOutcome[]
  /** The events as data: two rolls with the same key would be listed identically by the history. */
  readonly key: string
}

/**
 * Dry-runs all 36 dice outcomes through `rollWindow` on `session` (never changed) and groups them
 * by total. When the machine refuses the roll as the table stands (the round minimum, credit), the
 * preview carries the refusal and no rows.
 */
export function nextRollPreview(session: WindowedSession, cfg: MachineConfig): NextRollPreview {
  const before = session.state
  const base = {
    stateHash: hashJson(before),
    comeOut: before.round.phase.kind === 'comeOut',
    point: before.round.phase.kind === 'point' ? before.round.phase.point : null,
    betCount: before.bets.length,
  }
  const runs: DryRun[] = []
  for (const dice of ALL_ROLLS) {
    const result = rollWindow(session, cfg, dice)
    if (!result.ok) {
      return {
        ...base,
        rows: [],
        needs: [],
        refused: result.rejection,
        summary: summaryOf([]),
      }
    }
    const entry = rollEntryOf(before, result.events, result.session.state)
    const bets = betOutcomesOf(before, entry.items, cfg)
    runs.push({
      dice,
      total: entry.total,
      net: entry.net,
      creditAfter: entry.creditAfter,
      roundEvent: entry.roundEvent,
      endedHand: entry.endedHand,
      items: entry.items,
      bets,
      key: canonicalJson({
        net: entry.net,
        creditAfter: entry.creditAfter,
        roundEvent: entry.roundEvent,
        endedHand: entry.endedHand,
        items: entry.items,
      }),
    })
  }
  const rows = TOTALS.map((total) => rowOf(total, runs))
  return {
    ...base,
    rows,
    needs: needsOf(before, rows, cfg),
    refused: null,
    summary: summaryOf(rows),
  }
}

function rowOf(total: Total, runs: readonly DryRun[]): NextRollRow {
  const groups = new Map<string, DryRun[]>()
  for (const run of runs) {
    if (run.total !== total) continue
    const group = groups.get(run.key)
    if (group === undefined) groups.set(run.key, [run])
    else group.push(run)
  }
  const outcomes = [...groups.values()]
    .map((group): DiceOutcome => {
      const first = group[0]
      if (first === undefined) throw new Error('an outcome group cannot be empty')
      return {
        total,
        dice: group.map((run) => run.dice),
        ways: group.length,
        chance: Fraction.of(group.length, WAYS_IN_ALL),
        net: first.net,
        creditAfter: first.creditAfter,
        roundEvent: first.roundEvent,
        endedHand: first.endedHand,
        bets: first.bets,
        winners: first.bets.filter((bet) => bet.fate === 'win'),
        losers: first.bets.filter((bet) => bet.fate === 'lose'),
        items: first.items,
      }
    })
    // Likeliest first; among equals, the one that is not the doubles alone.
    .sort((a, b) => b.ways - a.ways || Number(isHardOnly(a)) - Number(isHardOnly(b)))
  const main = outcomes[0]
  if (main === undefined) throw new Error(`no dice roll a ${total}`)
  const ways = outcomes.reduce((sum, outcome) => sum + outcome.ways, 0)
  const hard = outcomes.length === 2 ? outcomes.find(isHardOnly) : undefined
  const easy = hard === undefined ? undefined : outcomes.find((outcome) => outcome !== hard)
  return {
    total,
    ways,
    chance: Fraction.of(ways, WAYS_IN_ALL),
    net: main.net,
    roundEvent: main.roundEvent,
    winners: main.winners,
    losers: main.losers,
    bets: main.bets,
    ...(hard !== undefined && easy !== undefined ? { hardSplit: { hard, easy } } : {}),
    outcomes,
  }
}

/** An outcome made by the doubles roll and nothing else. */
function isHardOnly(outcome: DiceOutcome): boolean {
  const only = outcome.dice[0]
  return outcome.dice.length === 1 && only !== undefined && isDoubles(only)
}

/**
 * Each bet's fate on a roll from the roll's bet-level events, in table order. A bet no event names
 * had no action: `none` when it works on the roll, `off` when it does not.
 */
function betOutcomesOf(
  before: TableState,
  items: readonly RollItem[],
  cfg: MachineConfig,
): BetOutcome[] {
  interface Fold {
    readonly fate: BetFate
    readonly net: number
    readonly travelTo: PointNumber | null
    readonly trace: SettlementTrace | null
  }
  const folds = new Map<BetId, Fold>()
  const at = (betId: BetId): Fold =>
    folds.get(betId) ?? { fate: 'none', net: 0, travelTo: null, trace: null }
  for (const item of items) {
    switch (item.type) {
      case 'betResolved': {
        const { trace } = item
        const fate: BetFate =
          trace.outcome === 'push' && trace.pushReason === 'offReturned'
            ? 'returned'
            : trace.outcome
        const previous = at(trace.betId)
        // A returned or lost stake left the table; one that stays is still the player's.
        const stakeOut = trace.stakeDisposition === 'stays' ? 0 : trace.stake
        folds.set(trace.betId, {
          ...previous,
          fate,
          trace,
          net: previous.net + trace.credited - stakeOut,
        })
        break
      }
      case 'betTraveled':
        folds.set(item.betId, { ...at(item.betId), fate: 'travel', travelTo: item.number })
        break
      case 'vigCharged': {
        // A re-collection from the win is already inside the trace's `credited`.
        if (item.from === 'win') break
        const previous = at(item.betId)
        folds.set(item.betId, { ...previous, net: previous.net - item.amount })
        break
      }
      case 'vigRefunded': {
        const previous = at(item.betId)
        folds.set(item.betId, { ...previous, net: previous.net + item.amount })
        break
      }
      case 'betRemoved':
      case 'workingChanged':
        // A stake sent back to credit is neither won nor lost; a switch moves no money.
        break
    }
  }
  return before.bets.map((bet): BetOutcome => {
    const fold = folds.get(bet.id)
    return {
      betId: bet.id,
      typeId: bet.typeId,
      number: bet.number,
      amount: bet.amount,
      fate: fold?.fate ?? (effectiveWorking(bet, before, cfg) ? 'none' : 'off'),
      net: cents(fold?.net ?? 0),
      travelTo: fold?.travelTo ?? null,
      trace: fold?.trace ?? null,
    }
  })
}

/** What each bet needs: the totals (and which of their rolls) that win, lose, move or return it. */
function needsOf(before: TableState, rows: readonly NextRollRow[], cfg: MachineConfig): BetNeeds[] {
  return before.bets.map((bet, index): BetNeeds => {
    const where = (keep: (outcome: BetOutcome) => boolean): NeedTotal[] =>
      rows.flatMap((row) => {
        const dice = row.outcomes.flatMap((outcome) => {
          const mine = outcome.bets[index]
          return mine !== undefined && keep(mine) ? outcome.dice : []
        })
        return needTotals(row, dice)
      })
    const byFate = (fate: BetFate): NeedTotal[] => where((outcome) => outcome.fate === fate)
    const winsOn = byFate('win')
    const losesOn = byFate('lose')
    return {
      bet,
      working: effectiveWorking(bet, before, cfg),
      winsOn,
      losesOn,
      movesOn: byFate('travel'),
      // Odds returned unplayed, and a push that hands the stake back and ends the bet (M11: the
      // Hot Shooter's stake-back tier at the seven-out; a world bet's 7): never "no action".
      returnsOn: where(
        (outcome) =>
          outcome.fate === 'returned' ||
          (outcome.fate === 'push' && outcome.trace?.stakeDisposition === 'returned'),
      ),
      winChance: Fraction.of(waysIn(winsOn), WAYS_IN_ALL),
      loseChance: Fraction.of(waysIn(losesOn), WAYS_IN_ALL),
    }
  })
}

function waysIn(needs: readonly NeedTotal[]): number {
  return needs.reduce((sum, need) => sum + need.ways, 0)
}

/** The rolls of a total that give a bet one fate, named as the player names them. */
function needTotals(row: NextRollRow, dice: readonly Dice[]): NeedTotal[] {
  if (dice.length === 0) return []
  const { total } = row
  if (dice.length === row.ways) return [{ total, way: 'any', dice: null, ways: row.ways }]
  const doubles = dice.filter(isDoubles)
  const first = dice[0]
  if (doubles.length === dice.length && first !== undefined) {
    return [{ total, way: 'hard', dice: first, ways: dice.length }]
  }
  // Every roll of the total but its doubles: the easy way, on a total that has a doubles roll.
  if (doubles.length === 0 && total % 2 === 0 && dice.length === row.ways - 1) {
    return [{ total, way: 'easy', dice: null, ways: dice.length }]
  }
  // Anything else (a hop's own pair): one entry per unordered pair.
  const pairs = new Map<string, { readonly dice: Dice; ways: number }>()
  for (const roll of dice) {
    const low = roll.d1 <= roll.d2 ? roll.d1 : roll.d2
    const high = roll.d1 <= roll.d2 ? roll.d2 : roll.d1
    const key = `${low}-${high}`
    const found = pairs.get(key)
    if (found === undefined) pairs.set(key, { dice: { d1: low, d2: high }, ways: 1 })
    else found.ways += 1
  }
  return [...pairs.values()].map((pair) => ({
    total,
    way: 'dice',
    dice: pair.dice,
    ways: pair.ways,
  }))
}

function summaryOf(rows: readonly NextRollRow[]): NextRollSummary {
  let winWays = 0
  let loseWays = 0
  let evenWays = 0
  for (const row of rows) {
    for (const outcome of row.outcomes) {
      if (outcome.net > 0) winWays += outcome.ways
      else if (outcome.net < 0) loseWays += outcome.ways
      else evenWays += outcome.ways
    }
  }
  return {
    winWays,
    loseWays,
    evenWays,
    winChance: Fraction.of(winWays, WAYS_IN_ALL),
    loseChance: Fraction.of(loseWays, WAYS_IN_ALL),
    evenChance: Fraction.of(evenWays, WAYS_IN_ALL),
  }
}

/** The outcome a preview predicts for one dice roll; null when the preview has no rows. */
export function outcomeOf(preview: NextRollPreview, dice: Dice): DiceOutcome | null {
  const row = preview.rows.find((candidate) => candidate.total === totalOf(dice))
  if (row === undefined) return null
  return (
    row.outcomes.find((outcome) =>
      outcome.dice.some((roll) => roll.d1 === dice.d1 && roll.d2 === dice.d2),
    ) ?? null
  )
}

// ---------------------------------------------------------------------------------------------
// Memoization: once per shown table.
// ---------------------------------------------------------------------------------------------

interface Cached {
  readonly cfg: MachineConfig
  readonly preview: NextRollPreview
}

/** How many previews the hash cache keeps, so undo and clear hit without re-running. */
export const PREVIEW_CACHE_SIZE = 32

const byTable = new WeakMap<TableState, Cached>()
const byHash = new Map<string, NextRollPreview>()

/**
 * The preview for `shown` on `session`'s machine, computed once per table: a hit by the table's
 * identity costs nothing, a hit by its hash (undo back to an earlier table, a cleared window) costs
 * one `hashJson`, and only a new table runs the 36 dry-runs. While a roll animates the shown
 * table trails the engine, so the session is rebased onto it; the dry-runs read only the table.
 * The result is referentially stable for a given table, as a store selector must be.
 */
export function cachedNextRoll(
  session: WindowedSession,
  cfg: MachineConfig,
  shown: TableState = session.state,
): NextRollPreview {
  const hit = byTable.get(shown)
  if (hit !== undefined && hit.cfg === cfg) return hit.preview
  const key = `${cfg.configHash}|${hashJson(shown)}`
  let preview = byHash.get(key)
  if (preview === undefined) {
    const at: WindowedSession =
      session.state === shown
        ? session
        : { ...session, windowStart: shown, pending: [], state: shown }
    preview = nextRollPreview(at, cfg)
  } else {
    byHash.delete(key) // re-inserted below as the newest
  }
  byHash.set(key, preview)
  if (byHash.size > PREVIEW_CACHE_SIZE) {
    const oldest = byHash.keys().next()
    if (!oldest.done) byHash.delete(oldest.value)
  }
  byTable.set(shown, { cfg, preview })
  return preview
}

/** What the selector reads of the game store (`GameState` satisfies it). */
export interface NextRollSource {
  readonly cfg: MachineConfig | null
  readonly session: WindowedSession | null
  readonly view: { readonly shown: TableState } | null
}

/** The game-store selector: the preview for the shown table, or null before a game starts. */
export function selectNextRoll(state: NextRollSource): NextRollPreview | null {
  const { cfg, session, view } = state
  if (cfg === null || session === null || view === null) return null
  return cachedNextRoll(session, cfg, view.shown)
}
