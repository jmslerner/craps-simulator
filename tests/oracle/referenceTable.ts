/**
 * The reference table: a naive whole-table model of the rules spec (plan §0 amendment 17), for the
 * M4d differential against the engine. Written from docs/rules/rules-spec.md alone; see
 * machineFacts.ts for the independence rules. Amounts are integer cents.
 *
 * `refApply(facts, table, action)` mirrors plan §4.9's actions and returns a new table, or a
 * rejection that leaves the table as it was. `refSnapshot(facts, table)` is the normalized view
 * the differential compares with the engine after every action:
 *
 * - `bankroll`: the player's credit, every bet off it: `/money/startingBankroll` + deposits − stakes
 *   and commission paid in + everything credited back.
 * - `houseNet`: what the house has won: stakes lost + commission charged − winnings paid −
 *   commission refunded. Upfront vig moves to the house when it is charged.
 * - `deposits`: `/money/startingBankroll` + every `deposit`.
 * - `vigPaid`: all commission charged (upfront at placement and on increases, re-collected when a
 *   winner stays up, taken from wins) minus commission refunded on take-downs.
 * - `wagered`: the stake of every decision (rules spec §0.1, plan §5.1 "Decision"): each win, loss
 *   and push, a bar push, a world bet's zero net and odds returned because they were OFF
 *   included; a bet that travels, or that the roll leaves alone, adds nothing.
 * - `rebetBlocked`: the don't types removed from a number this cycle, which cannot be bet again
 *   until the next come-out (`rebetAfterRemove: nextCycle`), sorted.
 * - `phase`, `point`: the round the next roll is decided against (`point` null on the come-out).
 * - `bets`, sorted by `typeId`, then `number` (null first), then `parent`:
 *   - `typeId`: the catalog type, or the composite id for a composite (one bet, §0 amendment 15).
 *   - `number`: the place/buy/lay/big/hard number; a line bet's own point (pass on point 6 is
 *     `pass` 6; a come bet that travelled to 9 is `come` 9); odds: their parent's number. Null
 *     for a line bet in its box (pass before its point, come and don't come before their first
 *     roll) and for one-roll bets and composites.
 *   - `parent`: odds only, their line bet as `typeId@number` (`come@6`); null otherwise.
 *   - `amount`: the stake. `vigHeld`: upfront commission held against the bet.
 *   - `working`: whether the bet works on the next roll (rules spec §2.4), computed exactly as the
 *     roll will compute it. Line bets, one-roll bets and composites always work.
 *
 * Ledger identity, checked after every action: deposits = bankroll + Σ amount + houseNet.
 *
 * Rejection reasons use plan §4.6's codes, checked in its order (1 type and parameters, 2 phase and
 * window, 3 limits and increments, 4 odds, 5 credit, 6 contract bets and exclusive groups), plus
 * `BELOW_MIN_TOTAL` for a roll that fails the minimum total (rules spec §2.3 step 9).
 *
 * Readings added after M4d (any engine disagreement is adjudicated against the rules spec):
 * - Re-collected upfront vig (§4.3, §4.5) is judged after every payout of the roll, in settlement
 *   order (placement order here); a decline brings the bet down with its stake and refunds what
 *   the win paid toward the vig. A winner that comes down anyway is never charged again.
 * - `incrementByNumber` applies to the bet's own number, an odds bet's parent point and a put
 *   bet's point; a bet with no number takes its type's increment.
 * - An exclusion blocks every wager on the spot it covers, an addition or press of a bet already
 *   there included (IB221 on `excludeLineVsLayBuy`: "prevent the player from wagering on the Buy
 *   bet of the established Point"); cutting or taking that bet down stays allowed.
 */
import { incrementOf, typeFacts, type MachineFacts, type TypeFacts } from './machineFacts.ts'
import {
  refDecide,
  refMaxOdds,
  refSettle,
  refTransition,
  refVigOnReduce,
  refVigTopUp,
  type RefDecision,
  type RefPhase,
  type RefSettlement,
} from './referenceRules.ts'

/** One bet on the reference table. JSON-safe. */
export interface RefBetState {
  /** Internal sequence number; the snapshot identifies bets by type, number and parent instead. */
  readonly id: number
  readonly typeId: string
  readonly number: number | null
  /** Odds only: the id of the line bet they sit behind. */
  readonly parentId: number | null
  readonly amount: number
  readonly vigHeld: number
  /** The player's own ON/OFF for this bet; null follows the global toggle and the defaults. */
  readonly working: boolean | null
  /** Interblock: placed in the window after a seven-out, so OFF until the player sets bets On. */
  readonly offAfterSevenOut: boolean
  /** `rolls` when the bet was placed: equal to the table's `rolls` while it is newly placed. */
  readonly placedAt: number
}

/** The whole table. JSON-safe. */
export interface RefTable {
  readonly phase: RefPhase
  readonly point: number | null
  /** Rolls so far. */
  readonly rolls: number
  /** The global ON/OFF button: true OFF, false ON, null the machine's defaults. */
  readonly globalOff: boolean | null
  /** Interblock: this betting window follows the trigger 7, so new place/buy bets start OFF. */
  readonly newPlacedOffWindow: boolean
  /** Don't types removed from a number this cycle, which cannot be bet again until it ends. */
  readonly rebetBlocked: readonly string[]
  readonly bets: readonly RefBetState[]
  readonly nextId: number
  readonly bankroll: number
  readonly houseNet: number
  readonly deposits: number
  readonly vigPaid: number
  readonly wagered: number
}

/**
 * A bet named by its type and, where needed, its number and parent (`come@6`). An omitted field
 * matches anything, so `{ typeId: 'pass' }` finds the pass bet whatever its point.
 */
export interface RefBetRef {
  readonly typeId: string
  readonly number?: number | null
  readonly parent?: string | null
}

export type RefAction =
  | {
      readonly type: 'place'
      readonly typeId: string
      readonly number?: number
      /** Odds: the line bet they go behind, as `typeId@number`. */
      readonly parent?: string
      readonly amount: number
    }
  | { readonly type: 'setAmount'; readonly bet: RefBetRef; readonly amount: number }
  | { readonly type: 'setWorking'; readonly bet: RefBetRef; readonly working: boolean | null }
  | { readonly type: 'setGlobalWorking'; readonly off: boolean | null }
  | { readonly type: 'deposit'; readonly amount: number }
  | { readonly type: 'roll'; readonly d1: number; readonly d2: number }

export type RefRejection =
  | 'NOT_OFFERED'
  | 'BAD_PARAMS'
  | 'WRONG_PHASE'
  | 'WINDOW_CLOSED'
  | 'BELOW_MIN'
  | 'ABOVE_MAX'
  | 'BAD_INCREMENT'
  | 'TABLE_MAX'
  | 'INSUFFICIENT_CREDIT'
  | 'CONTRACT_BET'
  | 'NO_PARENT'
  | 'PARENT_NOT_ON_POINT'
  | 'ODDS_LIMIT'
  | 'EXCLUSIVE_CONFLICT'
  | 'BET_NOT_FOUND'
  | 'NOT_TOGGLEABLE'
  | 'BELOW_MIN_TOTAL'

/**
 * One bet's decision on a roll (bets with no action are left out). `vigDeclined`: the winner was
 * to stay up, but credit could not pay the vig re-collected for it, so it came down instead and
 * the re-collection was not charged (rules spec §4.3, §4.5).
 */
export interface RefSettled {
  readonly typeId: string
  readonly number: number | null
  readonly parent: string | null
  readonly amount: number
  readonly decision: RefDecision
  readonly settlement: RefSettlement
  readonly vigDeclined: boolean
}

export type RefOutcome =
  | { readonly ok: true; readonly table: RefTable; readonly settled: readonly RefSettled[] }
  | { readonly ok: false; readonly reason: RefRejection; readonly detail: string }

export interface RefSnapshotBet {
  readonly typeId: string
  readonly number: number | null
  readonly parent: string | null
  readonly amount: number
  readonly vigHeld: number
  readonly working: boolean
}

export interface RefSnapshot {
  readonly bankroll: number
  readonly houseNet: number
  readonly deposits: number
  readonly vigPaid: number
  readonly wagered: number
  readonly rebetBlocked: readonly string[]
  readonly phase: RefPhase
  readonly point: number | null
  readonly bets: readonly RefSnapshotBet[]
}

/** A fresh session: the come-out, no bets, `/money/startingBankroll` deposited. */
export function refNewTable(facts: MachineFacts): RefTable {
  return {
    phase: 'comeOut',
    point: null,
    rolls: 0,
    globalOff: null,
    newPlacedOffWindow: false,
    rebetBlocked: [],
    bets: [],
    nextId: 1,
    bankroll: facts.startingBankroll,
    houseNet: 0,
    deposits: facts.startingBankroll,
    vigPaid: 0,
    wagered: 0,
  }
}

/** Applies one action. A rejected action changes nothing: the old table stays valid as it was. */
export function refApply(facts: MachineFacts, table: RefTable, action: RefAction): RefOutcome {
  const draft = toDraft(table)
  const result = dispatch(facts, draft, action)
  if (result !== null && 'reason' in result) return { ok: false, ...result }
  checkInvariants(facts, draft)
  return { ok: true, table: draft, settled: result?.settled ?? [] }
}

/** The normalized view of the table that the differential compares (see the top of this file). */
export function refSnapshot(facts: MachineFacts, table: RefTable): RefSnapshot {
  const bets = table.bets.map((bet): RefSnapshotBet => ({
    typeId: bet.typeId,
    number: bet.number,
    parent: parentKey(table, bet),
    amount: bet.amount,
    vigHeld: bet.vigHeld,
    working: refWorking(facts, table, bet),
  }))
  bets.sort(
    (a, b) =>
      compareText(a.typeId, b.typeId) ||
      (a.number ?? 0) - (b.number ?? 0) ||
      compareText(a.parent ?? '', b.parent ?? ''),
  )
  return {
    bankroll: table.bankroll,
    houseNet: table.houseNet,
    deposits: table.deposits,
    vigPaid: table.vigPaid,
    wagered: table.wagered,
    rebetBlocked: [...table.rebetBlocked].sort(compareText),
    phase: table.phase,
    point: table.point,
    bets,
  }
}

/** deposits = bankroll + Σ amount + houseNet (rules spec §4.1). */
export function refLedgerHolds(table: RefTable): boolean {
  const onTable = table.bets.reduce((sum, bet) => sum + bet.amount, 0)
  return table.deposits === table.bankroll + onTable + table.houseNet
}

/**
 * Whether `bet` works on the next roll (rules spec §2.3 step 2, §2.4):
 * `bet.working ?? globalToggle ?? policyDefault`, with these readings:
 * 1. Line bets, one-roll bets and composites always work; only odds, number bets and hardways
 *    can be OFF.
 * 2. Shoot To Win's come-out auto-OFF comes first: on a come-out roll, a `carried` type placed
 *    before this betting window, or a `newlyPlaced` type placed in it, is OFF whatever the
 *    toggles say ("player toggles do not override it", §2.4, §9 #7).
 * 3. The player's per-bet choice; then Interblock's flag on a bet placed after a seven-out, which
 *    only a later tap of Set bets On clears (§2.3 step 8, §9 #6); then the global button for the
 *    types it covers.
 * 4. The default: in the point phase ON; on the come-out the type's `comeOutDefault` (odds on a
 *    pass bet never face a come-out).
 */
export function refWorking(facts: MachineFacts, table: RefTable, bet: RefBetState): boolean {
  const type = typeFacts(facts, bet.typeId)
  if (!toggleable(type)) return true
  const comeOut = table.phase === 'comeOut'
  const autoOff = facts.working.autoOff
  if (comeOut && autoOff !== null) {
    const forced = bet.placedAt === table.rolls ? autoOff.newlyPlaced : autoOff.carried
    if (forced.includes(bet.typeId)) return false
  }
  if (bet.working !== null) return bet.working
  // The post-seven-out OFF is a flag on the bet (§2.3 step 8: "flagged OFF") that lasts until the
  // player taps Set bets On after it (§0.2 #4, §2.4 [V], §9 #6), so a button state left from
  // before the seven-out does not end it. (M4d: the button was checked first.)
  if (bet.offAfterSevenOut) return false
  if (table.globalOff !== null && facts.working.toggle.types.includes(bet.typeId)) {
    return !table.globalOff
  }
  if (!comeOut) return true
  return (type.comeOutDefault ?? 'on') === 'on'
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type Draft = Omit<Mutable<RefTable>, 'bets' | 'rebetBlocked'> & {
  bets: RefBetState[]
  rebetBlocked: string[]
}
type Rejected = { readonly reason: RefRejection; readonly detail: string }
type Done = { readonly settled: readonly RefSettled[] } | null

function toDraft(table: RefTable): Draft {
  return { ...table, bets: [...table.bets], rebetBlocked: [...table.rebetBlocked] }
}

const reject = (reason: RefRejection, detail: string): Rejected => ({ reason, detail })

function dispatch(facts: MachineFacts, s: Draft, action: RefAction): Rejected | Done {
  switch (action.type) {
    case 'place':
      return place(facts, s, action)
    case 'setAmount':
      return setAmount(facts, s, action.bet, action.amount)
    case 'setWorking':
      return setWorking(facts, s, action.bet, action.working)
    case 'setGlobalWorking':
      return setGlobalWorking(facts, s, action.off)
    case 'deposit':
      if (!isCents(action.amount) || action.amount === 0) {
        return reject('BAD_PARAMS', 'a deposit is a positive whole number of cents')
      }
      s.bankroll += action.amount
      s.deposits += action.amount
      return null
    case 'roll':
      return roll(facts, s, action.d1, action.d2)
  }
}

/**
 * Places a bet, or adds to the bet already on the same (type, number, parent).
 * - Line bets go in their box; pass is placed on the come-out (in the point phase only as a put
 *   bet, straight onto the point, when `/rules/allowPutBets`), come in the point phase (§3.1,
 *   §9 #26). A don't type removed from a number this cycle under `nextCycle` waits for the next.
 * - Odds go behind a line bet of their parent type that is on a number, up to `refMaxOdds`.
 * - Number bets and hardways name an offered number; one-roll bets and composites name none.
 * - The new total must fit the type's limits and increment; credit must cover the added stake and
 *   any upfront vig it brings (vig is topped up to the vig due on the new total, §4.3).
 * - A line bet on a number is a contract: no additions, except a put onto the pass bet's point
 *   (`putBet`). Exclusive groups and Interblock's pass-vs-lay / don't-pass-vs-buy setting block
 *   conflicting bets.
 */
function place(
  facts: MachineFacts,
  s: Draft,
  action: Extract<RefAction, { type: 'place' }>,
): Rejected | Done {
  const type = facts.types.get(action.typeId)
  if (type === undefined) {
    return reject('NOT_OFFERED', `${facts.id} does not offer ${action.typeId}`)
  }
  if (!isCents(action.amount) || action.amount === 0) {
    return reject('BAD_PARAMS', 'a stake is a positive whole number of cents')
  }
  const wantsNumber = type.family === 'numberVsSeven' || type.family === 'hardway'
  if (wantsNumber !== (action.number !== undefined)) {
    return reject('BAD_PARAMS', `${type.id} ${wantsNumber ? 'needs' : 'takes no'} number`)
  }
  if (wantsNumber && !type.numbers.includes(action.number ?? 0)) {
    return reject('BAD_PARAMS', `${type.id} is not offered on ${action.number}`)
  }
  if (type.family !== 'odds' && action.parent !== undefined) {
    return reject('BAD_PARAMS', `${type.id} takes no parent`)
  }

  let number = action.number ?? null
  if (type.family === 'line') {
    if (type.window !== s.phase) {
      const put = type.side === 'do' && type.window === 'comeOut' && facts.allowPutBets
      if (!put) {
        return reject('WRONG_PHASE', `${type.id} is placed only in the ${type.window} phase`)
      }
      number = s.point
    }
    if (s.rebetBlocked.includes(type.id)) {
      return reject('WINDOW_CLOSED', `${type.id} was removed this cycle and waits for the next`)
    }
  }

  let parent: RefBetState | undefined
  if (type.family === 'odds' && action.parent !== undefined) {
    const key = /^([a-z][A-Za-z0-9]*)(?:@(\d+))?$/.exec(action.parent)
    if (key === null) return reject('BAD_PARAMS', `"${action.parent}" is not a bet`)
    const parentNumber = key[2] === undefined ? null : Number(key[2])
    parent = s.bets.find(
      (bet) => bet.parentId === null && bet.typeId === key[1] && bet.number === parentNumber,
    )
    number = parent?.number ?? null
  }

  const existing = s.bets.find(
    (bet) =>
      bet.typeId === type.id && bet.number === number && bet.parentId === (parent?.id ?? null),
  )
  const total = (existing?.amount ?? 0) + action.amount
  const limits = checkLimits(facts, s, type, number, total, action.amount)
  if (limits !== null) return limits

  if (type.family === 'odds') {
    if (parent === undefined || parent.typeId !== type.parent) {
      return reject('NO_PARENT', `${type.id} goes behind a ${type.parent} bet`)
    }
    if (parent.number === null) return reject('PARENT_NOT_ON_POINT', `${type.parent} has no point`)
    const max = refMaxOdds(facts, type.id, parent.number, parent.amount)
    if (total > max) return reject('ODDS_LIMIT', `odds of ${total} exceed ${max}`)
  }

  const vigHeld = existing?.vigHeld ?? 0
  const topUp = refVigTopUp(facts, { typeId: type.id, number, amount: 0, vigHeld }, total)
  if (action.amount + topUp > s.bankroll) {
    return reject('INSUFFICIENT_CREDIT', `${action.amount + topUp} needed, ${s.bankroll} on credit`)
  }

  if (
    existing !== undefined &&
    type.family === 'line' &&
    existing.number !== null &&
    !putBet(facts, type)
  ) {
    return reject('CONTRACT_BET', `${type.id} on ${existing.number} cannot be added to`)
  }
  const conflict = exclusiveConflict(facts, s, type, number)
  if (conflict !== null) return reject('EXCLUSIVE_CONFLICT', conflict)

  s.bankroll -= action.amount + topUp
  s.houseNet += topUp
  s.vigPaid += topUp
  if (existing !== undefined) {
    replaceBet(s, { ...existing, amount: total, vigHeld: vigHeld + topUp })
    return null
  }
  const placedAfterSevenOut = facts.working.newPlacedOff
  s.bets.push({
    id: s.nextId,
    typeId: type.id,
    number,
    parentId: parent?.id ?? null,
    amount: total,
    vigHeld: topUp,
    working: null,
    offAfterSevenOut:
      s.newPlacedOffWindow && (placedAfterSevenOut?.types.includes(type.id) ?? false),
    placedAt: s.rolls,
  })
  s.nextId += 1
  return null
}

/**
 * Changes a bet's stake; 0 takes it down.
 * - Pass and come on a number are contracts (§3.1), though a pass bet may be added to where put
 *   bets are allowed (`putBet`). A don't bet on a number can be reduced or
 *   removed only with `onNumber: reduceRemove`, never increased; removing it under
 *   `rebetAfterRemove: nextCycle` blocks a new bet of that type until the phase returns to the
 *   come-out.
 * - Odds stay within `refMaxOdds`, and a parent cannot shrink below what its odds need; taking a
 *   parent down returns its odds with it.
 * - Upfront vig: an increase tops it up to the vig due on the new amount; a reduction or take-down
 *   refunds the excess only with `refundOnTakeDown`.
 * - An increase meets the exclusions a `place` there would, after the contract check.
 */
function setAmount(facts: MachineFacts, s: Draft, ref: RefBetRef, amount: number): Rejected | Done {
  const found = findBet(s, ref)
  if ('reason' in found) return found
  const bet = found
  if (!isCents(amount)) return reject('BAD_PARAMS', 'an amount is whole cents, 0 or more')
  if (amount === bet.amount) return null
  const type = typeFacts(facts, bet.typeId)
  const delta = amount - bet.amount

  if (delta > 0 && s.rebetBlocked.includes(type.id)) {
    return reject('WINDOW_CLOSED', `${type.id} was removed this cycle and waits for the next`)
  }
  if (amount > 0) {
    const limits = checkLimits(facts, s, type, bet.number, amount, delta)
    if (limits !== null) return limits
  }
  if (type.family === 'odds' && amount > 0) {
    const parent = s.bets.find((other) => other.id === bet.parentId)
    if (parent === undefined || parent.number === null) throw new Error('Odds without a point')
    const max = refMaxOdds(facts, type.id, parent.number, parent.amount)
    if (amount > max) return reject('ODDS_LIMIT', `odds of ${amount} exceed ${max}`)
  }
  const odds = s.bets.filter((other) => other.parentId === bet.id)
  if (amount > 0) {
    for (const child of odds) {
      if (child.number === null) throw new Error('Odds without a number')
      if (child.amount > refMaxOdds(facts, child.typeId, child.number, amount)) {
        return reject('ODDS_LIMIT', `the odds behind ${type.id} would exceed their cap`)
      }
    }
  }
  const topUp = delta > 0 ? refVigTopUp(facts, bet, amount) : 0
  if (delta > 0 && delta + topUp > s.bankroll) {
    return reject('INSUFFICIENT_CREDIT', `${delta + topUp} needed, ${s.bankroll} on credit`)
  }
  if (type.family === 'line' && bet.number !== null && !(delta > 0 && putBet(facts, type))) {
    if (type.side === 'do' || type.onNumber !== 'reduceRemove' || delta > 0) {
      return reject(
        'CONTRACT_BET',
        `${type.id} on ${bet.number} cannot be ${delta > 0 ? 'increased' : 'reduced or removed'}`,
      )
    }
  }
  // An increase is a wager on the bet's spot, so the exclusions that block a `place` there block
  // it too (rules spec §5.1 `excludeLineVsLayBuy`, IB221: the setting "will prevent the player
  // from wagering on the Buy bet of the established Point"). (M6 reconciliation: only `place`
  // checked them, so a press of a buy on the don't pass point went through.)
  if (delta > 0) {
    const conflict = exclusiveConflict(facts, s, type, bet.number)
    if (conflict !== null) return reject('EXCLUSIVE_CONFLICT', conflict)
  }

  const { vigHeld, refund } =
    delta > 0 ? { vigHeld: bet.vigHeld + topUp, refund: 0 } : refVigOnReduce(facts, bet, amount)

  s.bankroll += -delta - topUp + refund
  s.houseNet += topUp - refund
  s.vigPaid += topUp - refund
  if (amount > 0) {
    replaceBet(s, { ...bet, amount, vigHeld })
    return null
  }
  for (const child of odds) s.bankroll += child.amount
  s.bets = s.bets.filter((other) => other.id !== bet.id && other.parentId !== bet.id)
  if (type.family === 'line' && bet.number !== null && type.rebetAfterRemove === 'nextCycle') {
    if (!s.rebetBlocked.includes(type.id)) s.rebetBlocked.push(type.id)
  }
  return null
}

/**
 * The per-bet ON/OFF (`/workingToggle/perBet`), for the types the toggle covers. It does not end
 * an Interblock post-seven-out OFF: that lasts until the player taps Set bets On (rules spec §0.2
 * #4, §2.4), the global button. A bet set ON works while the setting lasts, and a bet set back to
 * its default (null) is OFF again while the flag holds. (Before M6 a per-bet ON ended the flag,
 * against this file's own reading in `refWorking`.)
 */
function setWorking(
  facts: MachineFacts,
  s: Draft,
  ref: RefBetRef,
  working: boolean | null,
): Rejected | Done {
  const found = findBet(s, ref)
  if ('reason' in found) return found
  const type = typeFacts(facts, found.typeId)
  const toggle = facts.working.toggle
  if (!toggle.perBet || !toggleable(type) || !toggle.types.includes(type.id)) {
    return reject('NOT_TOGGLEABLE', `${type.id} has no per-bet ON/OFF on ${facts.id}`)
  }
  replaceBet(s, { ...found, working })
  return null
}

/**
 * The global ON/OFF button (`/workingToggle/global`): true is OFF, false ON, null back to the
 * defaults. It sets every bet it covers, so it clears their per-bet choices ("All On", "All
 * Off"). Anything but OFF counts as the player setting bets On, which ends Interblock's
 * post-seven-out OFF.
 */
function setGlobalWorking(facts: MachineFacts, s: Draft, off: boolean | null): Rejected | Done {
  if (!facts.working.toggle.global) {
    return reject('NOT_TOGGLEABLE', `${facts.id} has no global ON/OFF button`)
  }
  const covered = facts.working.toggle.types
  s.globalOff = off
  s.bets = s.bets.map((bet) => ({
    ...bet,
    working: covered.includes(bet.typeId) ? null : bet.working,
    offAfterSevenOut: off === true ? bet.offAfterSevenOut : false,
  }))
  return null
}

/**
 * A roll (rules spec §2.3): the minimum check, then every bet decides against the round before
 * the roll, odds follow their parents, each decision settles once, results apply (stays, returns,
 * travel; a bet that travels takes no odds with it), the machine's post-roll actions run, and
 * the round advances.
 */
function roll(facts: MachineFacts, s: Draft, d1: number, d2: number): Rejected | Done {
  if (!isDie(d1) || !isDie(d2)) return reject('BAD_PARAMS', 'dice show 1 to 6')
  const minimum = facts.minTotal
  if (minimum !== null) {
    const counted = s.bets.filter((bet) => minimum.countOff || refWorking(facts, s, bet))
    const met =
      minimum.scope === 'totalRound'
        ? counted.reduce((sum, bet) => sum + bet.amount, 0) >= minimum.amount
        : counted.every((bet) => bet.amount >= minimum.amount)
    if (!met) return reject('BELOW_MIN_TOTAL', `active bets must total ${minimum.amount}`)
  }

  const before = { phase: s.phase, point: s.point }
  const dice = { d1, d2 }
  const total = d1 + d2
  const { transition, after } = refTransition(facts, before, total)
  const working = new Map(s.bets.map((bet) => [bet.id, refWorking(facts, s, bet)]))
  const decisions = new Map<number, RefDecision>()
  for (const bet of s.bets) {
    if (bet.parentId === null) {
      decisions.set(bet.id, refDecide(facts, bet, before, dice, working.get(bet.id) ?? true))
    }
  }
  for (const bet of s.bets) {
    if (bet.parentId !== null) {
      const parentDecision = decisions.get(bet.parentId)
      const own = refDecide(facts, bet, before, dice, working.get(bet.id) ?? true, parentDecision)
      decisions.set(bet.id, own)
    }
  }

  const settled: RefSettled[] = []
  let kept: RefBetState[] = []
  /** Winners staying up whose re-collected vig needs credit, in settlement order. */
  const charges: { readonly bet: RefBetState; readonly at: number; readonly s: RefSettlement }[] =
    []
  for (const bet of s.bets) {
    const decision = decisions.get(bet.id) ?? { kind: 'none' }
    const settlement = refSettle(facts, bet, decision)
    const returned = settlement.stakeDisposition === 'returned' ? bet.amount : 0
    const lost = settlement.stakeDisposition === 'lost' ? bet.amount : 0
    s.bankroll += settlement.credited
    s.houseNet += lost - (settlement.credited - returned)
    s.vigPaid += settlement.vigOnWin + settlement.vigRearmFromWin
    if (decision.kind === 'win' || decision.kind === 'lose' || decision.kind === 'push') {
      s.wagered += bet.amount
    }
    if (decision.kind !== 'none') {
      settled.push({
        typeId: bet.typeId,
        number: bet.number,
        parent: parentKey(s, bet),
        amount: bet.amount,
        decision,
        settlement,
        vigDeclined: false,
      })
    }
    if (settlement.stakeDisposition !== 'stays') continue
    const lineWinner = decision.kind === 'win' && typeFacts(facts, bet.typeId).family === 'line'
    // A travelled bet moves to its number; a line winner that stays goes back to its box.
    const number = decision.kind === 'travel' ? decision.number : lineWinner ? null : bet.number
    const after = { ...bet, number, vigHeld: settlement.vigHeldAfter }
    kept.push(after)
    if (settlement.vigRearmFromCredit > 0) {
      charges.push({ bet: after, at: settled.length - 1, s: settlement })
    }
  }
  // Re-collected vig that the win does not cover comes from credit, judged once every payout of
  // the roll is in (rules spec §4.3: upfront vig is "re-paid on every win"). When credit cannot
  // pay it, the bet comes down (§4.5: declining the vig removes the bet): its stake is returned,
  // what the win paid toward the vig is refunded, and nothing is re-collected.
  for (const { bet, at, s: settlement } of charges) {
    const due = settlement.vigRearmFromCredit
    if (due <= s.bankroll) {
      s.bankroll -= due
      s.houseNet += due
      s.vigPaid += due
      continue
    }
    s.bankroll += bet.amount + settlement.vigRearmFromWin
    s.houseNet -= settlement.vigRearmFromWin
    s.vigPaid -= settlement.vigRearmFromWin
    kept = kept.filter((other) => other.id !== bet.id)
    const declined = settled[at]
    if (declined !== undefined) settled[at] = { ...declined, vigDeclined: true }
  }
  s.bets = kept

  // Machine post-roll actions (rules spec §2.3 step 8).
  if (facts.working.toggle.scope === 'nextRollOnly') {
    s.globalOff = null
    s.bets = s.bets.map((bet) => ({ ...bet, working: null }))
  }
  const layAutoOn = facts.working.layAutoOn
  if (
    layAutoOn !== null &&
    ((transition.kind === 'pointMade' && layAutoOn.afterPointMade) ||
      (total === 7 && layAutoOn.afterSeven))
  ) {
    s.bets = s.bets.map((bet) =>
      isLay(facts, bet) && toggledOff(facts, s, bet) ? layOn(bet) : bet,
    )
  }
  const newPlacedOff = facts.working.newPlacedOff
  if (newPlacedOff !== null) {
    if (newPlacedOff.until === 'pointEstablished' && transition.kind === 'pointEstablished') {
      s.bets = s.bets.map((bet) => ({ ...bet, offAfterSevenOut: false }))
    }
    // Only the window right after the trigger flags new bets (§2.3 step 8: "the next window").
    s.newPlacedOffWindow =
      newPlacedOff.trigger === 'anySeven' ? total === 7 : transition.kind === 'sevenOut'
  }
  if (after.phase === 'comeOut') s.rebetBlocked = []
  s.phase = after.phase
  s.point = after.point
  s.rolls += 1
  return { settled }
}

/**
 * Per-type limits on the bet's new total (rules spec §4.5, §5.1): the minimum, the maximum, the
 * increment on the bet's number (`incrementByNumber`; for odds, the parent's point), and the table
 * maximum on what the action adds (every bet on the table counts, odds and OFF bets included).
 */
function checkLimits(
  facts: MachineFacts,
  s: Draft,
  type: TypeFacts,
  number: number | null,
  total: number,
  added: number,
): Rejected | null {
  const { min, max } = type.limits
  const increment = incrementOf(type, number)
  if (total < min) return reject('BELOW_MIN', `${type.id} needs at least ${min}`)
  if (total > max) return reject('ABOVE_MAX', `${type.id} takes at most ${max}`)
  if (total % increment !== 0) return reject('BAD_INCREMENT', `${type.id} goes up in ${increment}`)
  if (added > 0 && facts.tableMax !== null) {
    const onTable = s.bets.reduce((sum, bet) => sum + bet.amount, 0)
    if (onTable + added > facts.tableMax) return reject('TABLE_MAX', `table max ${facts.tableMax}`)
  }
  return null
}

/**
 * Exclusive groups (rules spec §5.1): no two types of a group up together, anywhere (`global`) or
 * on the same number (`sameNumber`). Interblock's `excludeLineVsLayBuy`: a pass bet blocks a lay
 * on its point; a don't pass bet blocks a buy on its point.
 */
function exclusiveConflict(
  facts: MachineFacts,
  s: Draft,
  type: TypeFacts,
  number: number | null,
): string | null {
  for (const group of facts.exclusiveGroups) {
    if (!group.types.includes(type.id)) continue
    const clash = s.bets.find(
      (bet) =>
        bet.typeId !== type.id &&
        group.types.includes(bet.typeId) &&
        (group.scope === 'global' || bet.number === number),
    )
    if (clash !== undefined) return `${type.id} cannot be up with ${clash.typeId}`
  }
  if (facts.excludeLineVsLayBuy && type.family === 'numberVsSeven' && number !== null) {
    const blocker = type.kind === 'lay' ? 'do' : type.kind === 'buy' ? 'dont' : null
    const line = s.bets.find((bet) => {
      const other = typeFacts(facts, bet.typeId)
      return (
        other.family === 'line' &&
        other.window === 'comeOut' &&
        other.side === blocker &&
        bet.number === number
      )
    })
    if (line !== undefined) return `${line.typeId} on ${number} blocks ${type.id} there`
  }
  return null
}

function findBet(s: Draft, ref: RefBetRef): RefBetState | Rejected {
  const matches = s.bets.filter(
    (bet) =>
      bet.typeId === ref.typeId &&
      (ref.number === undefined || bet.number === ref.number) &&
      (ref.parent === undefined || parentKey(s, bet) === ref.parent),
  )
  const [bet] = matches
  if (bet === undefined) return reject('BET_NOT_FOUND', `no ${ref.typeId} bet matches`)
  if (matches.length > 1) return reject('BAD_PARAMS', `${matches.length} ${ref.typeId} bets match`)
  return bet
}

function replaceBet(s: Draft, bet: RefBetState): void {
  s.bets = s.bets.map((other) => (other.id === bet.id ? bet : other))
}

function parentKey(table: Pick<RefTable, 'bets'>, bet: RefBetState): string | null {
  if (bet.parentId === null) return null
  const parent = table.bets.find((other) => other.id === bet.parentId)
  if (parent === undefined) throw new Error(`Bet ${bet.id} lost its parent`)
  return `${parent.typeId}@${parent.number ?? ''}`
}

/**
 * A pass bet where put bets are allowed (§3.1 PUT_N, window PT): a put on the point adds to the
 * pass bet already there. A contract bet cannot be removed or reduced (§3.1 "Remove / reduce");
 * adding to it is a put. (M4d: every addition was refused.)
 */
function putBet(facts: MachineFacts, type: TypeFacts): boolean {
  return (
    facts.allowPutBets && type.family === 'line' && type.side === 'do' && type.window === 'comeOut'
  )
}

function toggleable(
  type: TypeFacts,
): type is Exclude<TypeFacts, { family: 'line' | 'oneRoll' | 'composite' }> {
  return type.family === 'odds' || type.family === 'numberVsSeven' || type.family === 'hardway'
}

function isLay(facts: MachineFacts, bet: RefBetState): boolean {
  const type = typeFacts(facts, bet.typeId)
  return type.family === 'numberVsSeven' && type.kind === 'lay'
}

/**
 * Switched OFF by the player, by bet or by the global button (what Interblock turns back ON). Not
 * the post-seven-out OFF: rules spec §2.4 says only Set bets On (or the point, under `until:
 * pointEstablished`) ends it, and IB §3.2 gives the lay re-enable among the bets "Set bets Off"
 * disables, while bets held after a 7-out need "the Set bets On button". (M6 reconciliation: a lay
 * the hold covered came back ON here; no preset holds lays.)
 */
function toggledOff(facts: MachineFacts, s: Draft, bet: RefBetState): boolean {
  if (bet.working === false) return true
  return (
    bet.working === null && s.globalOff === true && facts.working.toggle.types.includes(bet.typeId)
  )
}

/** The lay set ON; a post-seven-out hold stays, below the bet's own setting (§2.4). */
function layOn(bet: RefBetState): RefBetState {
  return { ...bet, working: true }
}

/** Checks the model's own invariants; a failure is a bug in the oracle, never a finding. */
function checkInvariants(facts: MachineFacts, s: Draft): void {
  if (!refLedgerHolds(s)) throw new Error('Ledger identity broken')
  const keys = new Set<string>()
  for (const bet of s.bets) {
    if (!isCents(bet.amount) || bet.amount === 0 || !isCents(bet.vigHeld)) {
      throw new Error(`Bet ${bet.typeId} has a bad amount`)
    }
    // Two bets on one (type, number, parent) would be a come-bet merge: unreachable (§0.2 #12).
    const key = `${bet.typeId}|${bet.number ?? ''}|${parentKey(s, bet) ?? ''}`
    if (keys.has(key)) throw new Error(`Two bets on ${key}`)
    keys.add(key)
    const type = typeFacts(facts, bet.typeId)
    if (type.family === 'odds') {
      const parent = s.bets.find((other) => other.id === bet.parentId)
      if (parent === undefined || parent.number === null || parent.number !== bet.number) {
        throw new Error(`${bet.typeId} is not behind a bet on its number`)
      }
      if (bet.amount > refMaxOdds(facts, bet.typeId, parent.number, parent.amount)) {
        throw new Error(`${bet.typeId} exceeds its cap`)
      }
    }
  }
}

function isCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function isDie(face: number): boolean {
  return Number.isSafeInteger(face) && face >= 1 && face <= 6
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
