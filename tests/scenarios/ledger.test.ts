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
import { rollDice, type DieFace } from '../../src/engine/core/dice.ts'
import { hashJson } from '../../src/engine/core/hash.ts'
import { cents, type Cents } from '../../src/engine/core/money.ts'
import { seedRng } from '../../src/engine/core/rng.ts'
import { resolveType } from '../../src/engine/bets/registry.ts'
import type { BetId } from '../../src/engine/bets/types.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import { applyAction, validateAction } from '../../src/engine/table/reducer.ts'
import { newTable, type TableState } from '../../src/engine/table/state.ts'
import { scenario, withoutMinimum } from './dsl.ts'

// The ledger and the reducer's guarantees (plan §4.6, §4.7, §4.9): every action keeps
// deposits = bankroll + Σ bets + house net (the DSL rechecks it after every step), a rejected
// action changes nothing, a batch is all or nothing, and the table state is plain JSON.

/** A copy of the default machine with some of its input changed, under a new id. */
function craplessWith(id: string, change: (input: MachineConfigInput) => void): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  input.id = id
  change(input)
  return input
}

describe('the ledger', () => {
  it('deposits add credit, and every stake, win and loss moves between bankroll, bets and house', () => {
    scenario('craplessBubble')
      .deposit(10_000)
      .expectEvents(['deposited'])
      .expectLedger({ deposits: 60_000, bankroll: 60_000, houseNet: 0 })
      .place('pass', 1_000)
      .expectEvents(['betPlaced'])
      .place('pass', 500)
      .expectEvents(['betAdjusted'])
      .expectLedger({ deposits: 60_000, bankroll: 58_500 })
      .roll(4, 4)
      .place('passOdds', 3_000)
      .roll(2, 5)
      .expectBets([])
      .expectLedger({ deposits: 60_000, bankroll: 55_500, houseNet: 4_500, wagered: 4_500 })
  })

  it('wagered counts the stake of every decision, again each time a winner stays up', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(3, 4)
      .expectLedger({ wagered: 1_000 })
      .roll(4, 3)
      .expectLedger({ wagered: 2_000, houseNet: -2_000 })
      .roll(2, 2)
      .expectLedger({ wagered: 2_000 })
      .roll(6, 1)
      .expectLedger({ wagered: 3_000, houseNet: -1_000, bankroll: 51_000, vigPaid: 0 })
  })

  it('a push is a decision, so its stake counts as wagered too (rules spec §0.1, "ties counted")', () => {
    scenario('strictBubble')
      .place('dontPass', 1_000)
      .roll(6, 6)
      .expectSettled(
        { typeId: 'dontPass' },
        { outcome: 'push', pushReason: 'bar', credited: 0, stakeDisposition: 'stays' },
      )
      .expectLedger({ wagered: 1_000, bankroll: 49_000, houseNet: 0 })
      .expectBets([['dontPass', null, 1_000]])
  })

  it('setting a bet to the amount it already has changes nothing', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .setAmount({ typeId: 'pass' }, 1_000)
      .expectEvents([])
      .expectBankroll(49_000)
  })
})

describe('a rejected action changes nothing (plan §4.6)', () => {
  it('bad parameters', () => {
    const s = scenario('craplessBubble')
    const bad = (action: unknown) => action as Action
    s.expectReject(
      'BAD_PARAMS',
      { type: 'place', typeId: 'pass', amount: cents(0) },
      { field: 'amount' },
    )
      .expectReject('BAD_PARAMS', { type: 'place', typeId: 'pass', amount: cents(-100) })
      .expectReject('BAD_PARAMS', bad({ type: 'place', typeId: 'pass', amount: 150.5 }))
      .expectReject(
        'BAD_PARAMS',
        { type: 'place', typeId: 'pass', number: 7 as PointNumber, amount: cents(1_000) },
        { field: 'number' },
      )
      .expectReject(
        'BAD_PARAMS',
        { type: 'place', typeId: 'pass', number: 6, amount: cents(1_000) },
        { field: 'number' },
      )
      .expectReject(
        'BAD_PARAMS',
        bad({ type: 'place', typeId: 'passOdds', parentId: 1, amount: 1_000 }),
        { field: 'parentId' },
      )
      .expectReject(
        'BAD_PARAMS',
        { type: 'place', typeId: 'pass', parentId: 'b1' as BetId, amount: cents(1_000) },
        { field: 'parentId' },
      )
      .expectReject('BAD_PARAMS', bad({ type: 'roll', dice: { d1: 7, d2: 1 } }), { field: 'dice' })
      .expectReject('BAD_PARAMS', bad({ type: 'shoot' }), { field: 'type' })
      .expectReject('BAD_PARAMS', bad(null))
      .expectReject('BAD_PARAMS', { type: 'deposit', amount: cents(0) })
      .expectReject('BAD_PARAMS', bad({ type: 'setGlobalWorking', off: 'yes' }), { field: 'off' })
      .expectReject('BAD_PARAMS', bad({ type: 'batch', actions: 'all' }), { field: 'actions' })
      .place('pass', 1_000)
    const pass = s.find({ typeId: 'pass' }).id
    s.expectReject('BAD_PARAMS', bad({ type: 'setWorking', betId: pass, working: 'on' }), {
      field: 'working',
    }).expectReject('BAD_PARAMS', { type: 'setAmount', betId: pass, amount: cents(-1) })
  })

  it('a missing bet, a type the machine does not offer, limits and credit', () => {
    scenario('craplessBubble')
      .expectReject('BET_NOT_FOUND', {
        type: 'setAmount',
        betId: 'b9' as BetId,
        amount: cents(100),
      })
      .expectReject('BET_NOT_FOUND', { type: 'setWorking', betId: 'b9' as BetId, working: false })
      .expectReject('NOT_OFFERED', (a) => a.place('dontPass', 1_000), { typeId: 'dontPass' })
      .expectReject('NOT_OFFERED', { type: 'place', typeId: 'lucky', amount: cents(100) })
      .expectReject('ABOVE_MAX', (a) => a.place('pass', 50_100), { max: 50_000 })
      .expectReject('BAD_INCREMENT', (a) => a.place('pass', 150), { increment: 100 })
      .place('pass', 50_000)
      .expectBankroll(0)
      .roll(2, 2)
      .expectReject('INSUFFICIENT_CREDIT', (a) => a.place('passOdds', 1_000), {
        needed: 1_000,
        available: 0,
      })
      .deposit(1_000)
      .place('passOdds', 1_000)
      .expectBankroll(0)
    scenario('traditionalLive345').expectReject('BELOW_MIN', (a) => a.place('pass', 500), {
      min: 1_000,
    })
  })

  it('the table maximum caps everything on the table at once', () => {
    const capped = craplessWith('craplessTableMax', (input) => {
      input.limits.tableMax = 50_000
    })
    scenario(capped)
      .deposit(10_000)
      .place('pass', 30_000)
      .roll(2, 2)
      .place('passOdds', 20_000)
      .expectReject('TABLE_MAX', (a) => a.place('come', 100), { total: 50_100, tableMax: 50_000 })
      .setAmount({ typeId: 'passOdds' }, 19_900)
      .place('come', 100)
  })

  it('every type a machine offers either works or is refused NOT_OFFERED until its family lands', () => {
    for (const id of PRESET_IDS) {
      const cfg = compileConfig(PRESETS[id])
      const state = newTable(cfg, 'offer')
      for (const typeId of cfg.catalog.keys()) {
        if (resolveType(cfg, typeId) !== null) continue
        const result = applyAction(state, { type: 'place', typeId, amount: cents(100) }, cfg)
        expect(result.ok ? 'accepted' : result.rejection.code, `${id} ${typeId}`).toBe(
          'NOT_OFFERED',
        )
      }
    }
  })
})

describe('a batch applies all of its actions or none', () => {
  it('one bad action refuses the whole batch, naming its index', () => {
    const s = scenario('craplessBubble').place('pass', 1_000).roll(4, 4)
    s.expectReject(
      'WRONG_PHASE',
      (a) => a.batch(a.place('passOdds', 2_000), a.place('pass', 1_000)),
      { batchIndex: 1 },
    )
      .expectBets([['pass', 8, 1_000]])
      .act(s.actions.batch(s.actions.place('passOdds', 2_000), s.actions.place('come', 500)))
      .expectEvents(['betPlaced', 'betPlaced'])
      .expectBets([
        ['pass', 8, 1_000],
        ['passOdds', 8, 2_000],
        ['come', null, 500],
      ])
      .act({ type: 'batch', actions: [] })
      .expectEvents([])
  })
})

describe('the table state', () => {
  it('is plain JSON: it survives a JSON round trip, a structured clone, and hashes', () => {
    const s = scenario('traditionalBubble')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('passOdds', 2_000)
      .place('come', 500)
      .roll(2, 2)
    expect(JSON.parse(JSON.stringify(s.state))).toEqual(s.state)
    expect(structuredClone(s.state)).toEqual(s.state)
    expect(hashJson(s.state)).toMatch(/^[0-9a-f]{16}$/)
  })

  it("draws unscripted dice from the table's seeded RNG; scripted dice leave it alone", () => {
    const rolls = (seed: string) => {
      const s = scenario(withoutMinimum('craplessBubble'), { seed })
      return Array.from({ length: 12 }, () => {
        const { dice, scripted } = s.rollFromRng().state.lastRoll!
        expect(scripted).toBe(false)
        return `${dice.d1}-${dice.d2}`
      })
    }
    expect(rolls('vegas')).toEqual(rolls('vegas'))
    expect(rolls('vegas')).not.toEqual(rolls('reno'))
    const [first] = rollDice(seedRng('vegas'))
    expect(rolls('vegas')[0]).toBe(`${first.d1}-${first.d2}`)

    const s = scenario(withoutMinimum('craplessBubble'), { seed: 'vegas' })
    const rng = s.state.rng
    s.roll(3, 4)
    expect(s.state.rng).toEqual(rng)
    expect(s.state.lastRoll).toEqual({ dice: { d1: 3, d2: 4 }, scripted: true })
  })

  it('keeps the last /flow/historyLength totals, oldest first', () => {
    const s = scenario(withoutMinimum('craplessBubble')).expectProvenance(
      '/flow/historyLength',
      'assumed',
    )
    const totals: number[] = []
    for (let i = 0; i < 25; i++) {
      const d1 = ((i % 6) + 1) as DieFace
      const d2 = (((i * 5) % 6) + 1) as DieFace
      s.roll(d1, d2)
      totals.push(d1 + d2)
    }
    expect(s.state.recentTotals).toEqual(totals.slice(-20))
  })

  it('runs only on its own config', () => {
    const cfg = compileConfig(PRESETS.craplessBubble)
    const state = newTable(compileConfig(PRESETS.strictBubble), 'mismatch')
    expect(() => applyAction(state, { type: 'roll' }, cfg)).toThrow(RangeError)
  })

  it('validateAction is a dry run', () => {
    const cfg = compileConfig(PRESETS.craplessBubble)
    const state = newTable(cfg, 'dry')
    const pass: Action = { type: 'place', typeId: 'pass', amount: cents(1_000) }
    expect(validateAction(state, pass, cfg)).toBeNull()
    expect(validateAction(state, { ...pass, typeId: 'come' }, cfg)).toMatchObject({
      code: 'WRONG_PHASE',
    })
    expect(state.bets).toEqual([])
  })
})

describe('the ON/OFF button', () => {
  it('lasts for the next roll only where /workingToggle/scope says so', () => {
    const oneRoll = craplessWith('craplessOneRollOff', (input) => {
      input.workingToggle.scope = 'nextRollOnly'
    })
    const s = scenario(oneRoll)
      .place('pass', 1_000)
      .roll(2, 2)
      .place('passOdds', 1_000)
      .setGlobalWorking(true)
      .expectBet({ typeId: 'passOdds' }, { working: false })
      .roll(5, 5)
      .expectBet({ typeId: 'passOdds' }, { working: true })
    expect(s.state.globalOff).toBeNull()
  })

  it('stays until changed on Interblock [V IB §3.2]', () => {
    const s = scenario('craplessBubble')
      .expectProvenance('/workingToggle', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('passOdds', 1_000)
      .setGlobalWorking(true)
      .roll(5, 5)
      .expectBet({ typeId: 'passOdds' }, { working: false })
      .setGlobalWorking(false)
      .expectBet({ typeId: 'passOdds' }, { working: true })
    expect(s.state.globalOff).toBe(false)
  })
})

// A quick, seeded subset of the M4d properties: random actions through the reducer on every
// machine. The slow suite runs the long version.
describe('seeded random sessions (quick subset)', () => {
  type Intent =
    | { kind: 'place'; pick: number; units: number; half: boolean; parent: number }
    | { kind: 'amount'; pick: number; units: number }
    | { kind: 'working'; pick: number; value: boolean | null }
    | { kind: 'global'; value: boolean | null }
    | { kind: 'deposit'; units: number }
    | { kind: 'roll'; d1: DieFace; d2: DieFace }
    | { kind: 'rngRoll' }

  const face = fc.constantFrom<DieFace>(1, 2, 3, 4, 5, 6)
  const setting = fc.constantFrom(true, false, null)
  const intent: fc.Arbitrary<Intent> = fc.oneof(
    {
      weight: 6,
      arbitrary: fc.record({
        kind: fc.constant('place' as const),
        pick: fc.nat(),
        units: fc.integer({ min: 0, max: 40 }),
        // An off-grid amount now and then, to be refused.
        half: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
        parent: fc.nat(),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('amount' as const),
        pick: fc.nat(),
        units: fc.integer({ min: 0, max: 30 }),
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
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('deposit' as const),
        units: fc.integer({ min: 0, max: 50 }),
      }),
    },
    { weight: 6, arbitrary: fc.record({ kind: fc.constant('roll' as const), d1: face, d2: face }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'rngRoll' as const }) },
  )

  /** The action an intent stands for on this table. */
  function toAction(intent: Intent, state: TableState, cfg: MachineConfig): Action {
    const pick = <T>(list: readonly T[], n: number): T | undefined => list[n % list.length]
    // Amounts ride the machine's own denomination (the high-limit preset bets in $5 steps), with
    // an off-grid half step now and then, to be refused.
    const money = (units: number, half = false): Cents =>
      cents(units * cfg.betIncrement + (half ? cfg.betIncrement / 2 : 0))
    switch (intent.kind) {
      case 'place': {
        const types = [...cfg.catalog.keys()].filter((id) => resolveType(cfg, id) !== null)
        const typeId = pick(types, intent.pick) ?? 'pass'
        const amount = money(intent.units, intent.half)
        const parent = pick(state.bets, intent.parent)
        return cfg.catalog.get(typeId)?.family === 'odds' && parent !== undefined
          ? { type: 'place', typeId, amount, parentId: parent.id }
          : { type: 'place', typeId, amount }
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
      case 'deposit':
        return { type: 'deposit', amount: money(intent.units) }
      case 'roll':
        return { type: 'roll', dice: { d1: intent.d1, d2: intent.d2 } }
      case 'rngRoll':
        return { type: 'roll' }
    }
  }

  it('keep the ledger identity, never change a table they reject, and replay exactly', () => {
    let rolls = 0
    let bets = 0
    let settled = 0
    fc.assert(
      fc.property(
        fc.constantFrom<PresetId>(...PRESET_IDS),
        fc.array(intent, { minLength: 30, maxLength: 80, size: 'max' }),
        (id, intents) => {
          const cfg = compileConfig(PRESETS[id])
          let state = newTable(cfg, `random-${id}`)
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
            if (action.type === 'roll') rolls++
            if (action.type === 'place') bets++
            settled += result.events.filter((event) => event.type === 'betResolved').length
            const { deposits, bankroll, houseNet } = state.ledger
            const staked = state.bets.reduce((sum, bet) => sum + bet.amount, 0)
            expect(bankroll + staked + houseNet).toBe(deposits)
            expect(bankroll).toBeGreaterThanOrEqual(0)
          }
          expect(JSON.parse(JSON.stringify(state))).toEqual(state)
          // The same actions on a fresh table reach the same state.
          let replay = newTable(cfg, `random-${id}`)
          for (const action of log) {
            const result = applyAction(replay, action, cfg)
            if (!result.ok) throw new Error(`replay rejected ${JSON.stringify(action)}`)
            replay = result.state
          }
          expect(hashJson(replay)).toBe(hashJson(state))
        },
      ),
      { seed: 20261028, numRuns: 120 },
    )
    // The sessions must actually play, not just collect rejections. With this seed over the five
    // presets they make 1162 rolls, 1141 bets and 1067 settlements (amounts ride each machine's
    // denomination since the high-limit preset joined); the floors leave room for engine changes.
    expect(rolls).toBeGreaterThan(600)
    expect(bets).toBeGreaterThan(550)
    expect(settled).toBeGreaterThan(500)
  })
})
