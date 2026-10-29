import type { MachineConfig } from '../config/compile.ts'
import { isDoubles, rollDice, totalOf, type Dice } from '../core/dice.ts'
import { advanceRound, type RoundStep, type RoundTransition } from '../round/round.ts'
import { AFTER_ROLL } from '../bets/policies.ts'
import { decideBet, settlementOrder } from '../bets/registry.ts'
import {
  NO_DECISION,
  isSettled,
  type BetId,
  type BetInstance,
  type Decision,
  type Rejection,
  type RollContext,
} from '../bets/types.ts'
import { validateRoll } from '../bets/validate.ts'
import { effectiveWorking } from '../bets/working.ts'
import { rearmAfterWin } from '../settle/commission.ts'
import { settle } from '../settle/settle.ts'
import type { SettlementTrace } from '../settle/trace.ts'
import type { RollAction } from './actions.ts'
import type { GameEvent } from './events.ts'
import { settleInto } from './ledger.ts'
import { heldOffOf, type TableState } from './state.ts'

/**
 * The roll pipeline (plan §4.8, rules spec §2.3). One roll, in this order:
 *
 * 1. **Dice.** `action.dice` when a test or an e2e build scripts them (logged as scripted; the RNG
 *    is left alone), or two `rollDie` draws from `state.rng`, `d1` first.
 * 2. **Round.** `advanceRound(before)` gives the transition. Every bet decides against the round
 *    *before* the roll plus that transition, never against the round after it.
 * 3. **Order.** Bets go by family (line, odds, numberVsSeven, hardway, oneRoll, composites, side
 *    bets), then by placement. Line bets come before odds so each odds bet can be given its
 *    parent's decision.
 * 4. **Working and decisions.** Each bet's working status comes from `effectiveWorking` on the
 *    table *before* the roll. A bet that is not working gets `none`, except odds: odds whose parent
 *    is decided while they are OFF are returned (`push`, `offReturned`). A come bet already on N
 *    and the come box travelling to N are separate decisions on the same roll: the first is
 *    decided by N, the second travels. They never merge; two bets on one spot would break the
 *    table invariants (rules spec §0.2 #12, plan §0 #9).
 * 5. **Settlement.** Each win, loss or push is settled (`settle`: exact amount, one rounding,
 *    commission) and posted to the ledger, with a `betResolved` event carrying its trace.
 * 6. **Apply.** Each family's `apply` moves the bet on: a traveller takes its number with no odds
 *    (odds are only ever placed on a bet already on a number), a winner stays up or comes down per
 *    its `afterWin`, losers and returned bets come down.
 * 7. **Re-collection.** Once every bet is settled, each buy or lay that won and stays up has its
 *    up-front commission re-collected per `rearm` (`rearmAfterWin`), in settlement order, against
 *    the credit the whole roll's payouts left (rules spec §4.5): announced when its win paid it,
 *    charged when credit pays it, and the bet taken down when credit cannot.
 * 8. **Commit.** The round, `lastRoll` and the history (`/flow/historyLength` long). A come-out
 *    clears the re-bet blocks of `rebetAfterRemove: nextCycle`. Where the ON/OFF toggle lasts for
 *    the next roll only (`/workingToggle/scope`), every toggle goes back to its default; the
 *    machine's own hold (`heldOff`) is not a toggle and stays. Bets that came down leave the hold.
 * 9. **Machine actions** (`AFTER_ROLL` in `bets/policies.ts`): Interblock's lay re-enable, and
 *    its after-seven-out OFF ending at the point where `until: pointEstablished`.
 *
 * `applyAction` then checks the table invariants (step 8 of plan §4.8).
 */
export function rollTable(
  state: TableState,
  action: RollAction,
  cfg: MachineConfig,
): { readonly state: TableState; readonly events: readonly GameEvent[] } | Rejection {
  const rejection = validateRoll(state, action, cfg)
  if (rejection !== null) return rejection
  const scripted = action.dice !== undefined
  const [dice, rng] =
    action.dice === undefined ? rollDice(state.rng) : [copyDice(action.dice), state.rng]
  const step = advanceRound(state.round, dice, cfg.ruleset)
  const total = totalOf(dice)
  const shared = {
    dice,
    total,
    isPair: isDoubles(dice),
    before: state.round,
    transition: step.transition,
    rules: cfg.ruleset,
    cfg,
  }
  const events: GameEvent[] = [
    { type: 'diceRolled', dice, total, scripted, rollIndex: state.round.rollIndex },
    ...roundEvents(step.transition),
  ]

  const decisions = new Map<BetId, Decision>()
  const results = new Map<BetId, BetInstance | null>()
  const settled: { readonly bet: BetInstance; readonly trace: SettlementTrace }[] = []
  let ledger = state.ledger
  for (const { bet, resolved } of settlementOrder(state.bets, cfg)) {
    const parentDecision =
      bet.parentId === null ? null : (decisions.get(bet.parentId) ?? NO_DECISION)
    const working = effectiveWorking(bet, state, cfg)
    const ctx: RollContext = { ...shared, working, parentDecision }
    const decision = decideBet(bet, ctx, resolved)
    decisions.set(bet.id, decision)
    if (isSettled(decision)) {
      const trace = settle(bet, decision, cfg)
      ledger = settleInto(ledger, trace)
      events.push({ type: 'betResolved', trace })
      settled.push({ bet, trace })
    } else if (decision.kind === 'travel') {
      events.push({
        type: 'betTraveled',
        betId: bet.id,
        typeId: bet.typeId,
        number: decision.number,
      })
    } else if (decision.kind === 'progress') {
      events.push({ type: 'betProgress', betId: bet.id, progress: decision.progress })
    }
    results.set(bet.id, resolved.family.apply(bet, decision, ctx, resolved.type))
  }
  // Re-collected commission is judged against what the whole roll paid (§4.5): a lay that wins
  // nothing keeps its place when the roll's other winners cover its vig.
  for (const { bet, trace } of settled) {
    const rearm = rearmAfterWin(ledger, bet, trace, cfg)
    ledger = rearm.ledger
    events.push(...rearm.events)
    if (rearm.down) results.set(bet.id, null)
  }
  if (step.transition.kind === 'sevenOut') {
    events.push({ type: 'newShooter', handIndex: step.next.hand.index })
  }

  const committed = commit(state, step, cfg, scripted, {
    rng,
    ledger,
    dice,
    bets: state.bets.flatMap((bet) => {
      const after = results.get(bet.id)
      return after === null || after === undefined ? [] : [after]
    }),
  })
  return AFTER_ROLL.reduce(
    (done, rule) => {
      const next = rule(done.state, step, cfg)
      return { state: next.state, events: [...done.events, ...next.events] }
    },
    { state: committed, events: events as readonly GameEvent[] },
  )
}

/** Step 8: the table after the roll. */
function commit(
  state: TableState,
  step: RoundStep,
  cfg: MachineConfig,
  scripted: boolean,
  changes: Pick<TableState, 'rng' | 'ledger' | 'bets'> & { readonly dice: Dice },
): TableState {
  const keep = cfg.flow.historyLength
  const history = [...state.recentTotals, totalOf(changes.dice)]
  const nextRollOnly = cfg.working.toggle.scope === 'nextRollOnly'
  const up = new Set(changes.bets.map((bet) => bet.id))
  return {
    ...state,
    rng: changes.rng,
    ledger: changes.ledger,
    round: step.next,
    bets: nextRollOnly ? changes.bets.map((bet) => ({ ...bet, working: null })) : changes.bets,
    lastRoll: { dice: changes.dice, scripted },
    recentTotals: keep === 0 ? [] : history.slice(-keep),
    rebetBlocked: step.next.phase.kind === 'comeOut' ? [] : state.rebetBlocked,
    globalOff: nextRollOnly ? null : state.globalOff,
    heldOff: heldOffOf(state).filter((id) => up.has(id)),
  }
}

/** The round's own event for a transition; a point-phase roll that misses has none. */
function roundEvents(transition: RoundTransition): GameEvent[] {
  switch (transition.kind) {
    case 'natural':
      return [{ type: 'natural', total: transition.total }]
    case 'craps':
      return [{ type: 'crapsOut', total: transition.total }]
    case 'pointEstablished':
      return [{ type: 'pointEstablished', point: transition.point }]
    case 'pointMade':
      return [{ type: 'pointMade', point: transition.point }]
    case 'sevenOut':
      return [{ type: 'sevenOut', point: transition.point, endedHand: transition.endedHand }]
    case 'none':
      return []
  }
}

/** Scripted dice as a fresh plain object, so the state never shares the caller's. */
function copyDice(dice: Dice): Dice {
  return { d1: dice.d1, d2: dice.d2 }
}
