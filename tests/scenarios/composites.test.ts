import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import {
  PRESETS,
  PRESET_IDS,
  craplessBubble,
  type PresetId,
} from '../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import type { DieFace } from '../../src/engine/core/dice.ts'
import { cents, type Cents } from '../../src/engine/core/money.ts'
import type { BetId } from '../../src/engine/bets/types.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import { applyAction } from '../../src/engine/table/reducer.ts'
import { newTable, type TableState } from '../../src/engine/table/state.ts'
import { scenario } from './dsl.ts'

// Composite machine facts (rules spec §3.4, §4.1; plan §0 amendment 15), played through the table
// reducer: C&E, the horn, horn high and the world bet are each one bet of the composite's id,
// settled once on its whole-bet net. Amounts are cents; every machine starts with $500. Each roll
// on a machine with a minimum total keeps at least that much working on the table.

/** Crapless bubble with the horn bet in $4 steps from $4, one dollar per number. */
function hornInFours(): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  input.id = 'craplessHornInFours'
  input.limits.perType = { horn: { min: 400, increment: 400 } }
  return input
}

describe('the horn: one bet of 4 units (§3.4)', () => {
  it('$4 on the horn nets +$27 on a 2, +$12 on a 3 and −$4 on a 7, one settlement each', () => {
    scenario('craplessBubble')
      .expectProvenance('/composites', 'verified')
      .place('pass', 500)
      .roll(4, 4)
      .place('horn', 400)
      .expectBets([
        ['pass', 8, 500],
        ['horn', null, 400],
      ])
      .roll(1, 1)
      .expectEvents(['diceRolled', 'betResolved'])
      .expectSettled(
        { typeId: 'horn' },
        {
          outcome: 'win',
          payKey: '2',
          ratioLabel: '27:4',
          winPaid: 2_700,
          credited: 3_100,
          stakeDisposition: 'returned',
        },
      )
      .expectBets([['pass', 8, 500]])
      .place('horn', 400)
      .roll(2, 1)
      .expectSettled({ typeId: 'horn' }, { ratioLabel: '3:1', winPaid: 1_200, credited: 1_600 })
      .place('horn', 400)
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectSettled({ typeId: 'horn' }, { outcome: 'lose', credited: 0, stakeDisposition: 'lost' })
      .expectBets([])
      .expectBankroll(53_000)
  })

  it('$100 on the horn and 6-6 nets +$675, as Interblock pays it [V IB (Horn bets)]', () => {
    scenario('craplessBubble')
      .place('horn', 10_000)
      .roll(6, 6)
      .expectSettled({ typeId: 'horn' }, { winExact: '67500', winPaid: 67_500, credited: 77_500 })
      .expectBankroll(117_500)
  })

  it('Shoot To Win: a winning horn rides the next roll whole [V CW §25, §32]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/composites', 'verified')
      .place('pass', 500)
      .roll(4, 4)
      .place('horn', 400)
      .roll(6, 6)
      .expectSettled(
        { typeId: 'horn' },
        { winPaid: 2_700, credited: 2_700, stakeDisposition: 'stays' },
      )
      .expectBets([
        ['pass', 8, 500],
        ['horn', null, 400],
      ])
      .roll(2, 2)
      .expectSettled({ typeId: 'horn' }, { outcome: 'lose' })
      .expectBets([['pass', 8, 500]])
      .expectBankroll(51_800)
  })

  it('the horn and its singles are separate bets: one 2 pays both', () => {
    scenario('craplessBubble')
      .place('pass', 500)
      .roll(4, 4)
      .place('horn', 400)
      .place('snakeEyes', 100)
      .roll(1, 1)
      .expectSettled({ typeId: 'horn' }, { winPaid: 2_700 })
      .expectSettled({ typeId: 'snakeEyes' }, { ratioLabel: '31 for 1', winPaid: 3_000 })
      .expectBankroll(55_200)
  })
})

describe('C&E and the world bet (§3.4)', () => {
  it('C&E: $2 wins $6 on craps and $14 on 11, and loses on anything else [V IB §2.9]', () => {
    scenario('craplessBubble')
      .place('pass', 500)
      .roll(4, 4)
      .place('ce', 200)
      .roll(1, 2)
      .expectSettled({ typeId: 'ce' }, { ratioLabel: '3:1', winPaid: 600, credited: 800 })
      .place('ce', 200)
      .roll(5, 6)
      .expectSettled({ typeId: 'ce' }, { ratioLabel: '7:1', winPaid: 1_400, credited: 1_600 })
      .place('ce', 200)
      .roll(2, 2)
      .expectSettled({ typeId: 'ce' }, { outcome: 'lose' })
      .expectBankroll(51_300)
  })

  it('world on 7 pushes: the stake comes back and nothing is paid [V MD-C; WIKI]', () => {
    scenario('traditionalLive345')
      .expectProvenance('/composites', 'verified')
      .place('world', 500)
      .roll(3, 4)
      .expect({ transition: 'natural' })
      .expectSettled(
        { typeId: 'world' },
        {
          outcome: 'push',
          pushReason: 'zeroNet',
          winPaid: 0,
          credited: 500,
          stakeDisposition: 'returned',
        },
      )
      .expectBets([])
      .expectBankroll(50_000)
      .place('world', 500)
      .roll(1, 1)
      .expectSettled({ typeId: 'world' }, { ratioLabel: '26:5', winPaid: 2_600 })
      .place('world', 500)
      .roll(4, 4)
      .expectSettled({ typeId: 'world' }, { outcome: 'lose' })
      .expectBankroll(52_100)
  })

  it('a live table books a whole-dollar unit on each number: a $1 horn is refused, not floored [A]', () => {
    // The horn goes in $4, C&E in $2, horn high and the world in $5: every win is whole dollars.
    scenario('traditionalLive345')
      .expectProvenance('/limits/perType/horn', 'assumed')
      .expectProvenance('/limits/perType/ce', 'assumed')
      .expectProvenance('/limits/perType/world', 'assumed')
      .expectProvenance('/limits/perType/hornHigh12', 'assumed')
      .expectReject('BELOW_MIN', (a) => a.place('horn', 100), { typeId: 'horn', min: 400 })
      .expectReject('BAD_INCREMENT', (a) => a.place('horn', 500), { increment: 400 })
      .expectReject('BELOW_MIN', (a) => a.place('ce', 100), { min: 200 })
      .expectReject('BAD_INCREMENT', (a) => a.place('world', 600), { increment: 500 })
      .expectReject('BELOW_MIN', (a) => a.place('hornHigh12', 400), { min: 500 })
      .place('horn', 400)
      .place('ce', 200)
      .place('hornHigh12', 500)
      .roll(6, 6)
      .expectSettled({ typeId: 'horn' }, { ratioLabel: '27:4', winExact: '2700', winPaid: 2_700 })
      .expectSettled({ typeId: 'ce' }, { winExact: '600', winPaid: 600 })
      .expectSettled({ typeId: 'hornHigh12' }, { winExact: '5700', winPaid: 5_700 })
      .expectBankroll(59_000)
  })

  it('horn high aces: $5 nets +$57 on a 2 and +$11 on an 11', () => {
    scenario('traditionalLive345')
      .place('hornHigh2', 500)
      .roll(1, 1)
      .expectSettled({ typeId: 'hornHigh2' }, { ratioLabel: '57:5', winPaid: 5_700 })
      .place('hornHigh2', 500)
      .roll(5, 6)
      .expectSettled({ typeId: 'hornHigh2' }, { ratioLabel: '11:5', winPaid: 1_100 })
      .expectBankroll(56_800)
  })
})

describe('a composite is placed, changed and limited as one bet (plan §0 #15)', () => {
  it('pressed, reduced and taken down as one spot, with limits on its whole stake', () => {
    scenario('craplessBubble')
      .place('horn', 400)
      .place('horn', 400)
      .expectEvents(['betAdjusted'])
      .expectBets([['horn', null, 800]])
      .setAmount({ typeId: 'horn' }, 500)
      .takeDown({ typeId: 'horn' })
      .expectBets([])
      .expectBankroll(50_000)
      .expectReject('BAD_INCREMENT', (a) => a.place('horn', 450), { increment: 100 })
      .expectReject('ABOVE_MAX', (a) => a.place('horn', 50_100), { max: 50_000 })
      .expectReject('BAD_PARAMS', (a) => a.place('ce', 200, { number: 6 }), { field: 'number' })
      // A $1 horn is a legal bet: the minimum applies to the whole stake, not to 25¢ parts.
      .place('horn', 100)
      .expectBet({ typeId: 'horn' }, { amount: 100, working: true, number: null })
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'horn' }, false))
  })

  it('per-type limits on a composite apply to the whole bet: a horn in $4 steps from $4', () => {
    scenario(hornInFours())
      .expectReject('BELOW_MIN', (a) => a.place('horn', 100), { min: 400 })
      .expectReject('BAD_INCREMENT', (a) => a.place('horn', 500), { increment: 400 })
      .place('horn', 800)
      .place('pass', 500)
      .roll(2, 1)
      .expectSettled({ typeId: 'horn' }, { winPaid: 2_400 })
  })

  it('Set bets Off leaves a composite working', () => {
    scenario('craplessBubble')
      .place('pass', 500)
      .roll(4, 4)
      .setGlobalWorking(true)
      .place('ce', 200)
      .expectBet({ typeId: 'ce' }, { working: true })
      .roll(6, 6)
      .expectSettled({ typeId: 'ce' }, { winPaid: 600 })
  })
})

// A quick, seeded run of random actions on every machine, betting pass, hardways, one-roll bets
// and composites through the reducer. `applyAction` checks the table invariants after each action,
// the families' own included (a one-roll bet or composite whose winners come back never outlives
// its roll); this adds the ledger identity, clean refusals, and one settlement per spot bet per roll.
describe('seeded random sessions with hardways, one-roll bets and composites (quick subset)', () => {
  type Intent =
    | { kind: 'place'; group: number; pick: number; units: number; half: boolean }
    | { kind: 'amount'; pick: number; units: number }
    | { kind: 'working'; pick: number; value: boolean | null }
    | { kind: 'global'; value: boolean | null }
    | { kind: 'roll'; d1: DieFace; d2: DieFace }

  const face = fc.constantFrom<DieFace>(1, 2, 3, 4, 5, 6)
  const setting = fc.constantFrom(true, false, null)
  const intent: fc.Arbitrary<Intent> = fc.oneof(
    {
      weight: 5,
      arbitrary: fc.record({
        kind: fc.constant('place' as const),
        group: fc.nat({ max: 3 }),
        pick: fc.nat(),
        units: fc.integer({ min: 0, max: 20 }),
        // An off-grid amount now and then, to be refused.
        half: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('amount' as const),
        pick: fc.nat(),
        units: fc.integer({ min: 0, max: 20 }),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('working' as const),
        pick: fc.nat(),
        value: setting,
      }),
    },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('global' as const), value: setting }) },
    { weight: 6, arbitrary: fc.record({ kind: fc.constant('roll' as const), d1: face, d2: face }) },
  )

  type Family = 'hardway' | 'oneRoll' | 'composite' | 'other'

  function familyOf(cfg: MachineConfig, typeId: string): Family {
    if (cfg.composites.has(typeId)) return 'composite'
    const family = cfg.catalog.get(typeId)?.family
    return family === 'hardway' || family === 'oneRoll' ? family : 'other'
  }

  /** The spots to bet on: the pass line (for the minimum total), hardways, one-roll bets, composites. */
  function spots(cfg: MachineConfig): readonly { typeId: string; number?: PointNumber }[][] {
    const oneRoll = [...cfg.catalog.values()].filter((type) => type.family === 'oneRoll')
    return [
      [{ typeId: 'pass' }],
      // 5 is no hardway, so it is refused.
      ([4, 5, 6, 8, 10] as const).map((number) => ({ typeId: 'hard', number })),
      oneRoll.map((type) => ({ typeId: type.typeId })),
      [...cfg.composites.keys()].map((typeId) => ({ typeId })),
    ]
  }

  function toAction(intent: Intent, state: TableState, cfg: MachineConfig): Action {
    const pick = <T>(list: readonly T[], n: number): T | undefined => list[n % list.length]
    const money = (units: number, half = false): Cents => cents(units * 100 + (half ? 50 : 0))
    switch (intent.kind) {
      case 'place': {
        const spot = pick(spots(cfg)[intent.group] ?? [], intent.pick) ?? { typeId: 'pass' }
        return { type: 'place', ...spot, amount: money(intent.units, intent.half) }
      }
      case 'amount': {
        const betId = pick(state.bets, intent.pick)?.id ?? ('b999' as BetId)
        return { type: 'setAmount', betId, amount: money(intent.units) }
      }
      case 'working': {
        const betId = pick(state.bets, intent.pick)?.id ?? ('b999' as BetId)
        return { type: 'setWorking', betId, working: intent.value }
      }
      case 'global':
        return { type: 'setGlobalWorking', off: intent.value }
      case 'roll':
        return { type: 'roll', dice: { d1: intent.d1, d2: intent.d2 } }
    }
  }

  it('keep the ledger, refuse cleanly, and settle each spot bet once on every roll', () => {
    const settled: Record<Family, number> = { hardway: 0, oneRoll: 0, composite: 0, other: 0 }
    fc.assert(
      fc.property(
        fc.constantFrom<PresetId>(...PRESET_IDS),
        fc.array(intent, { minLength: 30, maxLength: 80, size: 'max' }),
        (id, intents) => {
          const cfg = compileConfig(PRESETS[id])
          let state = newTable(cfg, `spots-${id}`)
          for (const next of intents) {
            const action = toAction(next, state, cfg)
            const before = structuredClone(state)
            const result = applyAction(state, action, cfg)
            if (!result.ok) {
              expect(state).toEqual(before)
              continue
            }
            const traces = result.events.flatMap((e) => (e.type === 'betResolved' ? [e.trace] : []))
            if (action.type === 'roll') {
              // Every roll decides every one-roll bet and composite on the table, once.
              for (const bet of state.bets) {
                const family = familyOf(cfg, bet.typeId)
                if (family !== 'oneRoll' && family !== 'composite') continue
                expect(traces.filter((t) => t.betId === bet.id).length, bet.typeId).toBe(1)
              }
              for (const trace of traces) settled[familyOf(cfg, trace.typeId)] += 1
            }
            state = result.state
            const { deposits, bankroll, houseNet } = state.ledger
            const staked = state.bets.reduce((sum, bet) => sum + bet.amount, 0)
            expect(bankroll + staked + houseNet).toBe(deposits)
            expect(bankroll).toBeGreaterThanOrEqual(0)
          }
          expect(JSON.parse(JSON.stringify(state))).toEqual(state)
        },
      ),
      { seed: 20261028, numRuns: 120 },
    )
    // The sessions must actually play these bets, not just collect refusals. With this seed they
    // settle 218 hardways, 385 one-roll bets and 365 composites; the floors leave room for engine
    // changes such as the minimum-total check refusing some rolls.
    expect(settled.hardway).toBeGreaterThan(80)
    expect(settled.oneRoll).toBeGreaterThan(150)
    expect(settled.composite).toBeGreaterThan(150)
  })
})
