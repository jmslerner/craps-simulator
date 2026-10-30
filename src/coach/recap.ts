import { Fraction, cents, effectiveWorking } from '../engine/index.ts'
import type {
  BetId,
  Cents,
  GameEvent,
  MachineConfig,
  PointNumber,
  TableState,
  Total,
} from '../engine/index.ts'
import {
  loseMath,
  momentChasingLine,
  momentComeOddsReturnedLine,
  momentComeOutsideLine,
  momentPlaceOffSevenLine,
  momentPointOutsideLine,
  momentRoundingLine,
  noActionOffLine,
  noActionOffSevenLine,
  noActionOnLine,
  pushBarMath,
  pushOffReturnedMath,
  pushSideStaysMath,
  pushStakeBackMath,
  pushZeroNetMath,
  vigDeclinedNote,
  vigPlacementNote,
  vigRearmFromCreditNote,
  vigRearmFromWinNote,
  vigRefundNote,
  winMath,
} from './content/recaps.ts'
import { coachMoney, coachNumber, sourceOf } from './numbers.ts'
import type { CoachLine, CoachNumber, TemplateParts } from './types.ts'

/**
 * Post-roll recaps and teachable moments (plan §5.4 teachable, §5.5 surface 5, §10 M9b). The recap
 * arithmetic comes from the engine's own `SettlementTrace` in `betResolved` events and the table
 * the roll was made on — source `settle`/`table`/`event`, never the solver (§13 M5/M6 → M9) — so
 * this module must not import `src/exact`: the one solver number a moment shows, the equity of a
 * pass or come bet stuck on an outside point, arrives prebuilt from the analysis worker
 * (`InspectorMath.existing.equity`, fn `analyzeExisting`).
 *
 * Detection (`detectNoAction`, `detectMoments`, `chasingMoment`) is pure on the roll's inputs, so
 * the roll history can rebuild it deterministically; `rollHistory.pushRoll` assigns each moment
 * its 1-based `ordinal` per session, and the panel shows a moment only while its ordinal is at
 * most `MOMENT_SHOWN_COUNT` (plan §5.4: the first 3 occurrences of each).
 */

/** The roll-level events a recap lines up, exactly the ui history's `RollItem` union. */
export type RecapItem = Extract<
  GameEvent,
  {
    type:
      'betResolved' | 'betTraveled' | 'vigCharged' | 'vigRefunded' | 'betRemoved' | 'workingChanged'
  }
>

export interface RecapContext {
  readonly rollIndex: number
  /** The roll was made on a come-out (the table before the roll, not the round it left). */
  readonly comeOut: boolean
  readonly total: Total
}

/** `winExact`/`breakage` as the trace writes them: `Fraction#toString`, "1750/3" or "583". */
function parseFraction(text: string): Fraction {
  const [num, den] = text.split('/')
  return Fraction.of(BigInt(num ?? '0'), den === undefined ? 1n : BigInt(den))
}

/**
 * Which way the machine's rounding went on a win, from the trace's `breakage` (exact − paid):
 * `1` the machine kept part of the win (floor), `-1` it rounded UP and paid more than the exact
 * product (traditionalBubble's place 6/8 pay to the cent above), `0` the pay was exact. The words
 * must follow the sign: a round-up is never a shave, so it fires no rounding-loss moment and no
 * "divides evenly" advice.
 */
export function breakageSign(breakage: string): -1 | 0 | 1 {
  if (breakage === '' || breakage === '0') return 0
  const value = parseFraction(breakage)
  if (value.isZero()) return 0
  return value.isNegative() ? -1 : 1
}

/** The machine's label for a bet type (composites and side bets included). */
function labelOf(cfg: MachineConfig, typeId: string): string {
  return (
    cfg.catalog.get(typeId)?.label ??
    cfg.composites.get(typeId)?.label ??
    cfg.sideBets.get(typeId)?.label ??
    typeId
  )
}

function nameOf(cfg: MachineConfig, typeId: string, number: PointNumber | null): string {
  const label = labelOf(cfg, typeId)
  return number === null ? label : `${label} ${number}`
}

/**
 * The recap arithmetic for one roll event, every number a `CoachNumber` carrying the event it came
 * from; null for an event whose history lead line already says everything (a travel, a working
 * switch, a plain take-down). A win reads "(stake × ratio = exact → paid …)": the ratio is the
 * trace's own `winExact ÷ stake`, so the arithmetic always multiplies out, whatever spelling the
 * machine's pay label uses.
 */
export function recapMath(
  item: RecapItem,
  ctx: RecapContext,
  cfg: MachineConfig,
): TemplateParts | null {
  switch (item.type) {
    case 'betResolved': {
      const t = item.trace
      const src = (field: string) =>
        sourceOf('settle', { rollIndex: ctx.rollIndex, betId: t.betId, field }, cfg)
      if (t.outcome === 'win') {
        const exact = parseFraction(t.winExact)
        const sign = breakageSign(t.breakage)
        return winMath(
          {
            stake: coachMoney(t.stake, src('stake')),
            ratio: coachNumber('ratio', exact.mul(Fraction.of(1, t.stake)), src('winExact')),
            exact: coachMoney(exact, src('winExact')),
            paid: coachMoney(t.winPaid, src('winPaid')),
            // Positive breakage is what the machine kept; negative means it rounded up and paid
            // the difference on top, which the words say as such (never as a shave).
            kept: sign > 0 ? coachMoney(parseFraction(t.breakage), src('breakage')) : null,
            extra: sign < 0 ? coachMoney(parseFraction(t.breakage).abs(), src('breakage')) : null,
            vigOnWin: t.vigOnWin > 0 ? coachMoney(t.vigOnWin, src('vigOnWin')) : null,
            vigRearm: t.vigRearm > 0 ? coachMoney(t.vigRearm, src('vigRearm')) : null,
            credited: coachMoney(t.credited, src('credited')),
          },
          t.stakeDisposition === 'stays',
        )
      }
      if (t.outcome === 'lose') return loseMath({ stake: coachMoney(t.stake, src('stake')) })
      if (t.pushReason === 'offReturned') {
        return pushOffReturnedMath({ stake: coachMoney(t.stake, src('stake')) })
      }
      // A side bet's push is neither a composite netting 0 nor a barred total (M11): the Hot
      // Shooter's stake-back tier and the Lucky Shooter's come-out 7 or 11 get their own words.
      const side = cfg.sideBets.has(t.typeId)
      const stays = t.stakeDisposition === 'stays'
      if (t.pushReason === 'zeroNet')
        return side ? pushStakeBackMath(stays) : pushZeroNetMath(stays)
      return side ? pushSideStaysMath() : pushBarMath()
    }
    case 'vigCharged':
      if (item.reason === 'rearm') {
        return item.from === 'win' ? vigRearmFromWinNote() : vigRearmFromCreditNote()
      }
      return vigPlacementNote()
    case 'vigRefunded':
      return vigRefundNote()
    case 'betRemoved':
      return item.reason === 'vigDeclined' ? vigDeclinedNote() : null
    case 'betTraveled':
    case 'workingChanged':
      return null
  }
}

// --- No-action lines -----------------------------------------------------------------------

/** A bet that was on the table when the dice rolled and that no event touched. */
export interface NoActionBet {
  readonly betId: BetId
  readonly typeId: string
  readonly number: PointNumber | null
  readonly amount: Cents
  /** Its effective working status when the roll was made (`effectiveWorking` on that table). */
  readonly working: boolean
}

/** The bets of the table the roll was made on that no roll event resolved, moved or removed. */
export function detectNoAction(
  atRoll: TableState,
  events: readonly GameEvent[],
  cfg: MachineConfig,
): readonly NoActionBet[] {
  const touched = new Set<BetId>()
  for (const event of events) {
    if (event.type === 'betResolved') touched.add(event.trace.betId)
    else if (
      event.type === 'betTraveled' ||
      event.type === 'betRemoved' ||
      event.type === 'betProgress'
    ) {
      touched.add(event.betId)
    }
  }
  return atRoll.bets
    .filter((bet) => !touched.has(bet.id))
    .map((bet) => ({
      betId: bet.id,
      typeId: bet.typeId,
      number: bet.number,
      amount: bet.amount,
      working: effectiveWorking(bet, atRoll, cfg),
    }))
}

/** The no-action line for one untouched bet (plan §5.5: "the 7 didn't take it"). */
export function noActionLine(bet: NoActionBet, ctx: RecapContext, cfg: MachineConfig): CoachLine {
  const name = nameOf(cfg, bet.typeId, bet.number)
  const amount = coachMoney(
    bet.amount,
    sourceOf('table', { rollIndex: ctx.rollIndex, betId: bet.betId, field: 'amount' }, cfg),
  )
  const total = String(ctx.total)
  if (!bet.working) {
    return ctx.comeOut && ctx.total === 7
      ? { id: 'no-action:off-seven', parts: noActionOffSevenLine(name, total, { amount }) }
      : { id: 'no-action:off', parts: noActionOffLine(name, { amount }) }
  }
  return { id: 'no-action:on', parts: noActionOnLine(name, total, { amount }) }
}

// --- Teachable moments ---------------------------------------------------------------------

export type MomentId =
  | 'point-outside'
  | 'come-outside'
  | 'place-off-comeout-7'
  | 'come-odds-returned'
  | 'rounding-loss'
  | 'chasing-losses'

export interface TeachableMoment {
  readonly id: MomentId
  /** 1-based occurrence in the session, assigned by `rollHistory.pushRoll`; 0 until then. */
  readonly ordinal: number
  readonly betId: BetId | null
  readonly typeId: string | null
  readonly number: PointNumber | null
  readonly amount: Cents | null
  /**
   * What the rounding kept, as the trace's positive fraction of cents ('rounding-loss' only; a
   * round-up never makes this moment).
   */
  readonly kept: string | null
}

const OUTSIDE: ReadonlySet<number> = new Set([2, 3, 11, 12])

function moment(
  id: MomentId,
  betId: BetId | null = null,
  typeId: string | null = null,
  number: PointNumber | null = null,
  amount: Cents | null = null,
  kept: string | null = null,
): TeachableMoment {
  return { id, ordinal: 0, betId, typeId, number, amount, kept }
}

function amountOf(atRoll: TableState, betId: BetId): Cents | null {
  return atRoll.bets.find((bet) => bet.id === betId)?.amount ?? null
}

/**
 * The moments one roll triggers (plan §5.4 teachable), in a deterministic order so replayed
 * histories assign the same ordinals. The chasing-losses moment needs earlier rolls and is
 * detected in `rollHistory.pushRoll` with `chasingMoment` instead.
 */
export function detectMoments(
  atRoll: TableState,
  events: readonly GameEvent[],
  cfg: MachineConfig,
): readonly TeachableMoment[] {
  const comeOut = atRoll.round.phase.kind === 'comeOut'
  const total = events.find((event) => event.type === 'diceRolled')?.total ?? null
  const moments: TeachableMoment[] = []

  // The crapless equity point: the pass line travelled to an outside point.
  const established = events.find((event) => event.type === 'pointEstablished')
  if (established !== undefined && OUTSIDE.has(established.point)) {
    for (const event of events) {
      if (event.type !== 'betTraveled') continue
      const type = cfg.catalog.get(event.typeId)
      if (type?.family !== 'line' || type.side !== 'do' || type.window !== 'comeOut') continue
      moments.push(
        moment(
          'point-outside',
          event.betId,
          event.typeId,
          established.point,
          amountOf(atRoll, event.betId),
        ),
      )
      break
    }
  }

  // A come bet travelled to an outside number.
  for (const event of events) {
    if (event.type !== 'betTraveled') continue
    const type = cfg.catalog.get(event.typeId)
    if (type?.family !== 'line' || type.side !== 'do' || type.window !== 'point') continue
    if (!OUTSIDE.has(event.number)) continue
    moments.push(
      moment(
        'come-outside',
        event.betId,
        event.typeId,
        event.number,
        amountOf(atRoll, event.betId),
      ),
    )
  }

  // Off place-side bets untouched by a come-out 7.
  if (comeOut && total === 7) {
    const offDo = detectNoAction(atRoll, events, cfg).filter((bet) => {
      if (bet.working) return false
      const type = cfg.catalog.get(bet.typeId)
      if (type?.family !== 'numberVsSeven') return false
      return type.kind === 'place' || type.kind === 'buy' || type.kind === 'big'
    })
    const first = offDo[0]
    if (first !== undefined) {
      moments.push(
        moment('place-off-comeout-7', first.betId, first.typeId, first.number, first.amount),
      )
    }
  }

  for (const event of events) {
    if (event.type !== 'betResolved') continue
    const t = event.trace
    if (t.pushReason === 'offReturned' && comeOut && cfg.catalog.get(t.typeId)?.family === 'odds') {
      moments.push(moment('come-odds-returned', t.betId, t.typeId, t.number, t.stake))
    }
    // Only a pay the machine rounded DOWN is a rounding loss; a round-up paid the player extra.
    if (t.outcome === 'win' && breakageSign(t.breakage) > 0) {
      moments.push(moment('rounding-loss', t.betId, t.typeId, t.number, t.stake, t.breakage))
    }
  }

  return moments
}

/** What a streak check needs of a roll; the history's entries carry both fields. */
export interface StreakRoll {
  readonly net: Cents
  readonly stakes: Cents
}

/** Σ bet amounts on a table, for the streak comparison. */
export function stakesOf(state: TableState): Cents {
  let total = 0
  for (const bet of state.bets) total += bet.amount
  return cents(total)
}

/**
 * "Dice have no memory" (plan §5.4): at least 3 straight losing rolls, then more money on the
 * table for this one. `prev` is newest first, as the history keeps it.
 */
export function chasingMoment(prev: readonly StreakRoll[], stakes: Cents): TeachableMoment | null {
  if (prev.length < 3) return null
  if (!prev.slice(0, 3).every((roll) => roll.net < 0)) return null
  const lastStakes = prev[0]?.stakes ?? cents(0)
  if (stakes <= lastStakes) return null
  return moment('chasing-losses')
}

/** The equity request a moment's line wants answered by the analysis worker, if any. */
export interface EquityWant {
  readonly spec: { readonly typeId: string; readonly number: PointNumber | null }
  readonly amount: Cents
  readonly betId: BetId
}

export function momentWantsEquity(m: TeachableMoment): EquityWant | null {
  if (m.id !== 'point-outside' && m.id !== 'come-outside') return null
  if (m.betId === null || m.typeId === null || m.amount === null) return null
  return { spec: { typeId: m.typeId, number: null }, amount: m.amount, betId: m.betId }
}

/**
 * A moment as a line. `equity` is the worker's `InspectorMath.existing.equity` for the moment's
 * bet (fn `analyzeExisting`), or null while it has not arrived: the line then reads without the
 * worth sentence rather than invent a number.
 */
export function momentLine(
  m: TeachableMoment,
  equity: CoachNumber | null,
  cfg: MachineConfig,
): CoachLine {
  const id = `moment:${m.id}`
  const stake = coachMoney(
    m.amount ?? cents(0),
    sourceOf('table', { betId: m.betId, field: 'amount' }, cfg),
  )
  switch (m.id) {
    case 'point-outside':
      return { id, parts: momentPointOutsideLine(String(m.number), { stake, equity }) }
    case 'come-outside':
      return {
        id,
        parts: momentComeOutsideLine(labelOf(cfg, m.typeId ?? ''), String(m.number), {
          stake,
          equity,
        }),
      }
    case 'place-off-comeout-7':
      return { id, parts: momentPlaceOffSevenLine() }
    case 'come-odds-returned':
      return { id, parts: momentComeOddsReturnedLine(labelOf(cfg, m.typeId ?? '')) }
    case 'rounding-loss':
      return {
        id,
        parts: momentRoundingLine({
          kept: coachMoney(
            parseFraction(m.kept ?? '0'),
            sourceOf('settle', { betId: m.betId, field: 'breakage' }, cfg),
          ),
        }),
      }
    case 'chasing-losses':
      return { id, parts: momentChasingLine() }
  }
}
