import fc from 'fast-check'
import { expect } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { DieFace } from '../../src/engine/core/dice.ts'
import { hashJson } from '../../src/engine/core/hash.ts'
import { cents } from '../../src/engine/core/money.ts'
import { resolveType } from '../../src/engine/bets/registry.ts'
import type { BetId } from '../../src/engine/bets/types.ts'
import { commissionRule } from '../../src/engine/settle/commission.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import type { GameEvent } from '../../src/engine/table/events.ts'
import { applyAction } from '../../src/engine/table/reducer.ts'
import { newTable, type TableState } from '../../src/engine/table/state.ts'

/**
 * Seeded random play with number bets, commission and the machines' working rules (M4b), on every
 * preset: random bets (number bets on one of their numbers, odds behind a bet on the table),
 * presses and cuts, per-bet and global ON/OFF, deposits and scripted rolls. After every action:
 *
 * - a rejected action changes nothing;
 * - deposits = bankroll + Σ bets + house net, and the bankroll is never negative;
 * - the ledger's `vigPaid` equals the commission the events report: up-front charges and
 *   re-collections from credit, less refunds, plus what each settlement took from its win (a
 *   `vigCharged` from the win only announces the settlement's `vigRearm`, so it is not counted
 *   twice);
 * - every bet holds commission only where its type charges it up front;
 *
 * and at the end the table is plain JSON and the same actions replay to the same state. The quick
 * subset runs in the core project; `tests/slow/numberPlay.slow.test.ts` runs more.
 */

type Intent =
  | { kind: 'place'; pick: number; at: number; units: number }
  | { kind: 'amount'; pick: number; units: number }
  | { kind: 'working'; pick: number; value: boolean | null }
  | { kind: 'global'; value: boolean | null }
  | { kind: 'deposit'; units: number }
  | { kind: 'roll'; d1: DieFace; d2: DieFace }

const face = fc.constantFrom<DieFace>(1, 2, 3, 4, 5, 6)
const setting = fc.constantFrom(true, false, null)
const intent: fc.Arbitrary<Intent> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('place' as const),
      pick: fc.nat(),
      at: fc.nat(),
      units: fc.integer({ min: 1, max: 40 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('amount' as const),
      pick: fc.nat(),
      units: fc.integer({ min: 0, max: 40 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('working' as const), pick: fc.nat(), value: setting }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('global' as const), value: setting }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('deposit' as const),
      units: fc.integer({ min: 1, max: 100 }),
    }),
  },
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('roll' as const), d1: face, d2: face }) },
)

/** The action an intent stands for on this table. */
function toAction(next: Intent, state: TableState, cfg: MachineConfig): Action {
  const pick = <T>(list: readonly T[], n: number): T | undefined => list[n % list.length]
  const anyBet = (n: number): BetId => pick(state.bets, n)?.id ?? ('b999' as BetId)
  switch (next.kind) {
    case 'place': {
      const types = [...cfg.catalog.keys()].filter((id) => resolveType(cfg, id) !== null)
      const typeId = pick(types, next.pick) ?? 'pass'
      const type = cfg.catalog.get(typeId)
      const amount = cents(next.units * 100)
      if (type?.family === 'odds') {
        const parent = state.bets.filter((b) => b.typeId === type.parent)
        const on = pick(parent, next.at)
        return on === undefined
          ? { type: 'place', typeId, amount }
          : { type: 'place', typeId, amount, parentId: on.id }
      }
      if (type?.family === 'numberVsSeven' || type?.family === 'hardway') {
        const number = pick(type.numbers, next.at) ?? 6
        return { type: 'place', typeId, amount, number }
      }
      return { type: 'place', typeId, amount }
    }
    case 'amount':
      return { type: 'setAmount', betId: anyBet(next.pick), amount: cents(next.units * 100) }
    case 'working':
      return { type: 'setWorking', betId: anyBet(next.pick), working: next.value }
    case 'global':
      return { type: 'setGlobalWorking', off: next.value }
    case 'deposit':
      return { type: 'deposit', amount: cents(next.units * 100) }
    case 'roll':
      return { type: 'roll', dice: { d1: next.d1, d2: next.d2 } }
  }
}

/** Commission the events of one action report: charged (not counting announcements) less refunded. */
function commissionIn(events: readonly GameEvent[]): number {
  let total = 0
  for (const event of events) {
    if (event.type === 'vigCharged' && event.from !== 'win') total += event.amount
    if (event.type === 'vigRefunded') total -= event.amount
    if (event.type === 'betResolved') total += event.trace.vigOnWin + event.trace.vigRearm
  }
  return total
}

/** Counts of what the sessions did, so a test can insist they exercised the rules. */
export interface PlayCounts {
  rolls: number
  numberBets: number
  numberSettlements: number
  vigEvents: number
  machineSwitches: number
}

/** Runs the property; returns what the sessions did. */
export function numberPlay(numRuns: number, maxActions: number): PlayCounts {
  const counts: PlayCounts = {
    rolls: 0,
    numberBets: 0,
    numberSettlements: 0,
    vigEvents: 0,
    machineSwitches: 0,
  }
  const compiled = new Map<PresetId, MachineConfig>(
    PRESET_IDS.map((id) => [id, compileConfig(PRESETS[id])]),
  )
  fc.assert(
    fc.property(
      fc.constantFrom<PresetId>(...PRESET_IDS),
      fc.array(intent, { minLength: 20, maxLength: maxActions, size: 'max' }),
      (id, intents) => {
        const cfg = compiled.get(id)!
        let state = newTable(cfg, `number-play-${id}`)
        let vigPaid = 0
        const log: Action[] = []
        for (const next of intents) {
          const action = toAction(next, state, cfg)
          const before = structuredClone(state)
          const result = applyAction(state, action, cfg)
          if (!result.ok) {
            expect(state).toEqual(before)
            continue
          }
          state = result.state
          log.push(action)
          vigPaid += commissionIn(result.events)
          const { deposits, bankroll, houseNet } = state.ledger
          const staked = state.bets.reduce((sum, bet) => sum + bet.amount, 0)
          expect(bankroll + staked + houseNet).toBe(deposits)
          expect(bankroll).toBeGreaterThanOrEqual(0)
          expect(state.ledger.vigPaid).toBe(vigPaid)
          for (const bet of state.bets) {
            const type = cfg.catalog.get(bet.typeId)
            const upfront =
              type?.family === 'numberVsSeven' &&
              commissionRule(type, bet.number)?.timing === 'upfront'
            if (!upfront) expect(bet.vigHeld, `${bet.id} ${bet.typeId}`).toBe(0)
          }
          if (action.type === 'roll') counts.rolls++
          for (const event of result.events) {
            if (event.type === 'betPlaced' && isNumberBet(cfg, event.bet.typeId)) {
              counts.numberBets++
            }
            if (event.type === 'betResolved' && isNumberBet(cfg, event.trace.typeId)) {
              counts.numberSettlements++
            }
            if (event.type === 'vigCharged' || event.type === 'vigRefunded') counts.vigEvents++
            if (
              event.type === 'workingChanged' &&
              event.scope === 'bet' &&
              event.by !== undefined
            ) {
              counts.machineSwitches++
            }
          }
        }
        expect(JSON.parse(JSON.stringify(state))).toEqual(state)
        let replay = newTable(cfg, `number-play-${id}`)
        for (const action of log) {
          const result = applyAction(replay, action, cfg)
          if (!result.ok) throw new Error(`replay rejected ${JSON.stringify(action)}`)
          replay = result.state
        }
        expect(hashJson(replay)).toBe(hashJson(state))
      },
    ),
    { seed: 20261028, numRuns },
  )
  return counts
}

function isNumberBet(cfg: MachineConfig, typeId: string): boolean {
  return cfg.catalog.get(typeId)?.family === 'numberVsSeven'
}
