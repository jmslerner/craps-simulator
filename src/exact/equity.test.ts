import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { pruneProvenance } from '../engine/config/provenance.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { cents } from '../engine/core/money.ts'
import { makeRoll } from '../engine/core/dice.ts'
import { Fraction } from '../engine/core/rational.ts'
import { betId, type BetInstance } from '../engine/bets/types.ts'
import type { Action } from '../engine/table/actions.ts'
import { applyAction } from '../engine/table/reducer.ts'
import { heldOffOf, newTable, type TableState } from '../engine/table/state.ts'
import { pointRunProgress } from '../engine/bets/families/pointRun.ts'
import { analyzeExisting, startOfBet, takeDownValue } from './equity.ts'
import { distribution } from './price.ts'

/** Plays `actions` from a new table, failing on any refusal. */
function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  let state = newTable(cfg, 'equity')
  for (const action of actions) {
    const result = applyAction(state, action, cfg)
    if (!result.ok) throw new Error(`${action.type}: ${result.rejection.code}`)
    state = result.state
  }
  return state
}

const crapless = compileConfig(PRESETS.craplessBubble)

describe('analyzeExisting', () => {
  it('values a $10 crapless pass on point 2 at $20/7, and its odds at their stake', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(1_000) },
      { type: 'roll', dice: makeRoll(1, 1) },
      { type: 'place', typeId: 'passOdds', parentId: betId(1), amount: cents(2_000) },
    ])
    const pass = analyzeExisting(betId(1), state, crapless)
    expect(pass.resolves).toBe(true)
    expect(pass.equity.toString()).toBe('2000/7')
    expect(pass.expectedLossFromNow.toString()).toBe('5000/7')
    const odds = analyzeExisting(betId(2), state, crapless)
    // True odds: 6:1 with P = 1/7 returns the stake on average.
    expect(odds.equity.toString()).toBe('2000')
    expect(odds.expectedLossFromNow.toString()).toBe('0')
    expect(odds.lifetimeLossFromNow?.toString()).toBe('0')
  })

  it('values a place bet as its decision: a $6 place 6 wins $7 with P = 5/11', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
    ])
    const place = analyzeExisting(betId(1), state, crapless)
    expect(place.equity.toString()).toBe('6500/11')
    expect(place.expectedLossFromNow.toString()).toBe('100/11')
  })

  it("is the take-down value of a bet that is never decided: Interblock's post-seven-out OFF", () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'roll', dice: makeRoll(2, 2) },
      { type: 'roll', dice: makeRoll(3, 4) },
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
    ])
    const place = state.bets.find((bet) => bet.typeId === 'place')
    expect(heldOffOf(state)).toContain(place?.id)
    const analysis = analyzeExisting(place?.id ?? betId(99), state, crapless)
    expect(analysis.resolves).toBe(false)
    expect(analysis.equity.toString()).toBe('600')
    expect(analysis.lifetimeLossFromNow).toBeNull()
  })

  it('refuses a bet that is not on the table', () => {
    expect(() => analyzeExisting(betId(7), newTable(crapless, 'x'), crapless)).toThrow(RangeError)
  })

  it('reads whether the bet was carried from an earlier window: Shoot To Win values them apart', () => {
    // A variant where only CARRIED come odds go OFF on the come-out (newly placed ones play), and
    // the odds on 4 are short-paid at 9:5: the new bet plays the come-out at a loss, the carried
    // one is handed back, so their equities must differ and startOfBet must tell them apart.
    const input = structuredClone(PRESETS.traditionalBubble) as MachineConfigInput
    const comeOdds = input.catalog.comeOdds
    if (comeOdds?.family !== 'odds' || input.comeOut.autoOff === null) throw new Error('no odds')
    comeOdds.comeOutDefault = 'on'
    comeOdds.pays = { ...comeOdds.pays, '4': '9:5' }
    input.comeOut.autoOff = { ...input.comeOut.autoOff, newlyPlaced: [] }
    input.provenance = pruneProvenance(input)
    const cfg = compileConfig(input)
    const bets = (placedAtRoll: number): BetInstance[] => [
      {
        id: betId(1),
        typeId: 'come',
        number: 4,
        parentId: null,
        amount: cents(1_000),
        vigHeld: cents(0),
        working: null,
        progress: 0,
        placedAtRoll: 0,
      },
      {
        id: betId(2),
        typeId: 'comeOdds',
        number: 4,
        parentId: betId(1),
        amount: cents(1_000),
        vigHeld: cents(0),
        working: null,
        progress: 0,
        placedAtRoll,
      },
    ]
    const base = newTable(cfg, 'equity-carried')
    const tableWith = (placedAtRoll: number): TableState => ({
      ...base,
      round: {
        phase: { kind: 'comeOut' },
        rollIndex: 1,
        hand: { index: 0, rolls: 1, pointsMadeMask: 0 },
        sinceSeven: { rolls: 1, totalsMask: 0 },
      },
      bets: bets(placedAtRoll),
      nextBetSeq: 3,
    })
    const fresh = tableWith(1)
    const carried = tableWith(0)
    expect(startOfBet(bets(1)[1] as BetInstance, fresh).carried).toBe(false)
    expect(startOfBet(bets(0)[1] as BetInstance, carried).carried).toBe(true)
    const newOdds = analyzeExisting(betId(2), fresh, cfg)
    const carriedOdds = analyzeExisting(betId(2), carried, cfg)
    expect(newOdds.equity.toString()).toBe('2655050/2817')
    expect(carriedOdds.equity.toString()).toBe('2702000/2817')
    expect(newOdds.equity.equals(carriedOdds.equity)).toBe(false)
  })
})

describe('takeDownValue', () => {
  it('returns the stake, plus held vig where the machine refunds it', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    const state = play(live, [{ type: 'place', typeId: 'buy', number: 5, amount: cents(2_000) }])
    const buy = state.bets[0]
    if (buy === undefined) throw new Error('no buy')
    expect(buy.vigHeld).toBe(100)
    expect(takeDownValue(buy, state, live).toString()).toBe('2100')
    const ib = play(crapless, [{ type: 'place', typeId: 'buy', number: 5, amount: cents(2_000) }])
    const noRefund = ib.bets[0]
    if (noRefund === undefined) throw new Error('no buy')
    expect(takeDownValue(noRefund, ib, crapless).toString()).toBe('2000')
  })
})

describe('side bets on the table (M11)', () => {
  /** A bet of `typeId` with `progress`, alone on a hand-built table in `phase`. */
  function tableWith(
    cfg: MachineConfig,
    typeId: string,
    progress: number,
    phase: TableState['round']['phase'],
    pointsMadeMask = 0,
  ): TableState {
    return {
      ...newTable(cfg, 'side'),
      round: {
        phase,
        rollIndex: 30,
        hand: { index: 0, rolls: 30, pointsMadeMask },
        sinceSeven: { rolls: 30, totalsMask: 0 },
      },
      bets: [
        {
          id: betId(1),
          typeId,
          number: null,
          parentId: null,
          amount: cents(100),
          vigHeld: cents(0),
          working: null,
          progress,
          placedAtRoll: 0,
        },
      ],
      nextBetSeq: 2,
    }
  }

  it('values a Lucky Roller from the targets it has rolled: one left, 31 for 1 × 5/11', () => {
    // $5 pass for the round minimum, $1 Low Rolls at the start of the cycle; then 2, 3, 4 and 5.
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'place', typeId: 'luckyRollerLow', amount: cents(100) },
      { type: 'roll', dice: { d1: 1, d2: 1 } },
      { type: 'roll', dice: { d1: 1, d2: 2 } },
      { type: 'roll', dice: { d1: 2, d2: 2 } },
      { type: 'roll', dice: { d1: 2, d2: 3 } },
    ])
    const low = state.bets.find((bet) => bet.typeId === 'luckyRollerLow')
    if (low === undefined) throw new Error('no Lucky Roller')
    expect(low.progress).toBe((1 << 2) | (1 << 3) | (1 << 4) | (1 << 5))
    expect(startOfBet(low, state).progress).toBe(low.progress)
    const ex = analyzeExisting(low.id, state, crapless)
    // The 6 (5 ways) before a 7 (6 ways) returns 31 × $1; the bet is worth more than its stake now.
    expect(ex.equity.toString()).toBe('15500/11')
    expect(ex.expectedLossFromNow.toString()).toBe('-14400/11')
    expect(ex.resolves).toBe(true)
    // A fresh Low Rolls is worth far less: the progress is what the chain starts from.
    const fresh = analyzeExisting(
      betId(1),
      tableWith(crapless, 'luckyRollerLow', 0, { kind: 'comeOut' }),
      crapless,
    )
    expect(fresh.equity.compare(ex.equity)).toBe(-1)
  })

  it('values a Lucky Shooter with every other box number hit: the point pays the top award', () => {
    const strict = compileConfig(PRESETS.strictBubble)
    const hits = (1 << 4) | (1 << 5) | (1 << 8) | (1 << 9) | (1 << 10)
    const state = tableWith(strict, 'luckyShooter', pointRunProgress(6, hits), {
      kind: 'point',
      point: 6,
    })
    const ex = analyzeExisting(betId(1), state, strict)
    // The next roll settles: 5 ways of 36 pay 500 for 1 ($500 back), 31 pay 100 for 1 ($100).
    expect(ex.equity.toString()).toBe('140000/9')
    expect(ex.expectedLossFromNow.toString()).toBe('-139100/9')
  })

  it('cannot lose a Fire Bet with four points made, nor a Hot Shooter past its first paying tier', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    const made = (1 << 4) | (1 << 5) | (1 << 8) | (1 << 9)
    const fire = tableWith(live, 'fire', made, { kind: 'point', point: 6 }, made)
    const fireNow = distribution(
      { typeId: 'fire', number: null },
      startOfBet(fire.bets[0]!, fire),
      'decision',
      live,
    )
    const lose = fireNow.labels.findIndex((label) => label.key === 'lose:-:lost')
    expect(lose === -1 || fireNow.counts[lose]?.isZero() === true).toBe(true)
    // At least the 24 to 1 pay plus the stake comes back.
    expect(analyzeExisting(betId(1), fire, live).equity.compare(Fraction.of(2_500))).not.toBe(-1)

    const stw = compileConfig(PRESETS.traditionalBubble)
    const hot = tableWith(stw, 'hotShooter', 20, { kind: 'point', point: 8 })
    const ex = analyzeExisting(betId(1), hot, stw)
    // 20 rolls counted: the 3 for 1 tier is assured, so $3 at least; the loss from now is negative.
    expect(ex.equity.compare(Fraction.of(300))).not.toBe(-1)
    expect(ex.expectedLossFromNow.isNegative()).toBe(true)
  })
})
