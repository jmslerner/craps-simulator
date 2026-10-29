import {
  Fraction,
  betId,
  cents,
  commissionRule,
  newTable,
  requireType,
  settle,
  typeLimits,
  validateAction,
  vigBase,
  type Action,
  type BetInstance,
  type Cents,
  type MachineConfig,
  type Phase,
  type TableState,
} from '../engine/index.ts'
import { COME_OUT, roundAt, type BetSpec, type ChainLabel } from './chain.ts'
import { betAt, unrounded, upfrontCharge } from './price.ts'

/**
 * Which stakes a bet can take, and which of them the machine pays exactly. Legality is the
 * engine's: every candidate is a dry-run `place` on a table where the bet can be made (its phase,
 * its parent for odds, ample credit), so per-type and per-number increments, limits and odds caps
 * all apply as the table applies them.
 */

/** Credit for the dry runs: enough for any stake, short of unsafe integers. */
const AMPLE = cents(1_000_000_000_000)

/**
 * The legal stakes for `spec` in `[from, to]`, ascending, at most `limit` of them: multiples of
 * the type's increment that a dry-run placement accepts.
 */
export function legalAmounts(
  spec: BetSpec,
  cfg: MachineConfig,
  range: { readonly from: number; readonly to: number },
  limit = 400,
): Cents[] {
  const legal: Cents[] = []
  for (const amount of legalStakes(spec, cfg, range)) {
    if (legal.length >= limit) break
    legal.push(amount)
  }
  return legal
}

/** `legalAmounts` one at a time, so a scan can stop at the stake it wants. */
export function* legalStakes(
  spec: BetSpec,
  cfg: MachineConfig,
  range: { readonly from: number; readonly to: number },
): Generator<Cents> {
  const { min, max, increment } = typeLimits(cfg, spec.typeId)
  const from = Math.max(range.from, min)
  const to = Math.min(range.to, max)
  const first = from + ((increment - (from % increment)) % increment)
  const placement = placementFor(spec, cfg)
  for (let amount = first; amount <= to; amount += increment) {
    const stake = cents(amount)
    if (validateAction(placement.state, placement.action(stake), cfg) === null) yield stake
  }
}

/** The smallest legal stake for `spec`, or null if it takes none. */
export function smallestAmount(spec: BetSpec, cfg: MachineConfig): Cents | null {
  return legalAmounts(spec, cfg, { from: 0, to: Number.MAX_SAFE_INTEGER }, 1)[0] ?? null
}

/** The largest legal stake for `spec` (the type's maximum, unless that is refused), or null. */
export function largestAmount(spec: BetSpec, cfg: MachineConfig): Cents | null {
  const { max, increment } = typeLimits(cfg, spec.typeId)
  const placement = placementFor(spec, cfg)
  for (let amount: number = max, tries = 0; amount > 0 && tries < 400; amount -= increment, tries++) {
    const stake = cents(amount)
    if (validateAction(placement.state, placement.action(stake), cfg) === null) return stake
  }
  return null
}

/**
 * Whether the machine pays `spec` exactly at `amount`: every settlement among `labels` and the
 * up-front vig come out the same rounded as unrounded, and no commission minimum is above the
 * rate's share (rules spec §4.3, "LIVE minimums").
 */
export function paysExactly(
  spec: BetSpec,
  labels: readonly ChainLabel[],
  amount: Cents,
  cfg: MachineConfig,
): boolean {
  for (const label of labels) {
    if (label.kind !== 'settle') continue
    const rounded = settle(betAt(spec, amount), label.decision, cfg)
    const exact = settle(betAt(spec, amount), label.decision, cfg, 'exact')
    if (!exact.winPaid.equals(Fraction.of(rounded.winPaid))) return false
    if (!exact.vigOnWin.equals(Fraction.of(rounded.vigOnWin))) return false
    if (!exact.vigRearm.equals(Fraction.of(rounded.vigRearm))) return false
  }
  const upfront = upfrontCharge(spec, amount, cfg, 'rounded')
  if (!upfront.equals(upfrontCharge(spec, amount, cfg, 'exact'))) return false
  return !commissionMinimumBinds(spec, amount, cfg)
}

/**
 * The bet's exact unit (rules spec §3.2's "exact unit, live / penny"): the smallest legal stake the
 * machine pays exactly (`paysExactly`), scanning `scan` stakes up from the minimum; the minimum
 * when none is found. A $6 place 6 on a live table, $3 on a penny machine; $20 for a live buy with
 * a $1 minimum vig.
 */
export function exactUnit(
  spec: BetSpec,
  labels: readonly ChainLabel[],
  cfg: MachineConfig,
  scan = 400,
): Cents | null {
  let first: Cents | null = null
  let tried = 0
  for (const amount of legalStakes(spec, cfg, { from: 0, to: Number.MAX_SAFE_INTEGER })) {
    first ??= amount
    if (paysExactly(spec, labels, amount, cfg)) return amount
    if (++tried >= scan) break
  }
  return first
}

/**
 * Whether a commission minimum is above the rate's share of the base at `amount` (a $1 minimum on
 * a $5 live buy): such a stake pays more than the configured rate.
 */
export function commissionMinimumBinds(spec: BetSpec, amount: Cents, cfg: MachineConfig): boolean {
  const type = cfg.catalog.get(spec.typeId)
  const n = spec.number
  if (type?.family !== 'numberVsSeven' || n === null) return false
  const rule = commissionRule(type, n)
  if (rule === null || rule.minimum === 0) return false
  const base = vigBase(Fraction.of(amount), type, n, rule, unrounded)
  return base.mul(rule.rate).compare(Fraction.of(rule.minimum)) < 0
}

/**
 * The smallest stake at which no commission minimum binds any more, in cents (0 when there is no
 * minimum): the minimum ÷ (rate × the base per unit staked).
 */
export function minimumFreeFrom(spec: BetSpec, cfg: MachineConfig): number {
  const type = cfg.catalog.get(spec.typeId)
  const n = spec.number
  if (type?.family !== 'numberVsSeven' || n === null) return 0
  const rule = commissionRule(type, n)
  if (rule === null || rule.minimum === 0) return 0
  const perUnit = vigBase(Fraction.ONE, type, n, rule, unrounded).mul(rule.rate)
  const threshold = Fraction.of(rule.minimum).div(perUnit)
  return Number(-threshold.neg().floorDiv(Fraction.ONE))
}

/**
 * A period, in cents, of everything rounding does to `spec`: stakes that differ by a multiple of it
 * have the same remainders in every payout and commission. A win of stake × a/b rounded to r cents
 * repeats every b·r cents; commission at rate p/q of the stake, rounded to r', every q·r'; of a win
 * at a/b, every b·q·r'.
 */
export function roundingPeriod(
  spec: BetSpec,
  labels: readonly ChainLabel[],
  cfg: MachineConfig,
): number {
  const { family, type } = requireType(cfg, spec.typeId)
  const probe = typeLimits(cfg, spec.typeId).min
  let period = 1n
  for (const label of labels) {
    if (label.kind !== 'settle' || label.decision.kind !== 'win') continue
    const ratio = family.payout(type, label.decision.payKey)
    const rounding = settle(betAt(spec, probe), label.decision, cfg).rounding
    period = lcm(period, ratio.den * BigInt(rounding?.increment ?? 1))
  }
  if (type.family === 'numberVsSeven' && spec.number !== null) {
    const rule = commissionRule(type, spec.number)
    if (rule !== null) {
      const pays = family.payout(type, String(spec.number))
      const perBase = rule.rate.den * BigInt(rule.rounding.increment)
      period = lcm(period, rule.basis === 'win' ? perBase * pays.den : perBase)
    }
  }
  return Number(period)
}

interface Placement {
  readonly state: TableState
  readonly action: (amount: Cents) => Action
}

/**
 * A table on which `spec` can be placed, and the `place` action for a stake: its phase (pass on
 * the come-out, come with a point on, odds behind a parent on their number) and ample credit.
 */
function placementFor(spec: BetSpec, cfg: MachineConfig): Placement {
  const { type } = requireType(cfg, spec.typeId)
  const base = newTable(cfg, 'exact-amounts')
  const ledger = { ...base.ledger, deposits: AMPLE, bankroll: AMPLE }
  const on = (phase: Phase, bets: readonly BetInstance[]): TableState => ({
    ...base,
    round: roundAt(phase),
    bets,
    nextBetSeq: bets.length + 1,
    ledger,
  })
  const n = spec.number
  switch (type.family) {
    case 'line': {
      const phase: Phase =
        type.window === 'comeOut' ? COME_OUT : { kind: 'point', point: firstPoint(cfg) }
      return { state: on(phase, []), action: (amount) => ({ type: 'place', typeId: type.typeId, amount }) }
    }
    case 'odds': {
      const parent = cfg.catalog.get(type.parent)
      if (parent?.family !== 'line' || n === null) {
        throw new RangeError(`${spec.typeId} needs a number and a line bet to back`)
      }
      const parentBet: BetInstance = {
        id: betId(1),
        typeId: parent.typeId,
        number: n,
        parentId: null,
        amount: typeLimits(cfg, parent.typeId).max,
        vigHeld: cents(0),
        working: null,
        progress: 0,
        placedAtRoll: 0,
      }
      const phase: Phase = parent.window === 'comeOut' ? { kind: 'point', point: n } : COME_OUT
      return {
        state: on(phase, [parentBet]),
        action: (amount) => ({ type: 'place', typeId: type.typeId, parentId: parentBet.id, amount }),
      }
    }
    case 'numberVsSeven':
    case 'hardway':
      if (n === null) throw new RangeError(`${spec.typeId} needs a number`)
      return {
        state: on(COME_OUT, []),
        action: (amount) => ({ type: 'place', typeId: type.typeId, number: n, amount }),
      }
    case 'oneRoll':
    case 'composite':
      return { state: on(COME_OUT, []), action: (amount) => ({ type: 'place', typeId: type.typeId, amount }) }
  }
}

function firstPoint(cfg: MachineConfig) {
  const point = cfg.ruleset.points[0]
  if (point === undefined) throw new RangeError(`${cfg.id} has no points`)
  return point
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b
}
