import { describe, expect, it } from 'vitest'
import { compileConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { BetKey, Step } from '../properties/actions.ts'
import {
  Game,
  describeMismatch,
  engineSnapshot,
  expectExercised,
  runDifferential,
} from '../properties/differential.ts'
import { scenario } from '../scenarios/dsl.ts'
import { factsFrom } from './machineFacts.ts'
import { refSnapshot } from './referenceTable.ts'

// The reference differential (plan §9 item 2, §0 #17): seeded random sequences of 100 actions go
// through the engine and the independent reference table, compared after every action
// (tests/properties/differential.ts). The quick subset runs here; tests/slow/reference.slow.test.ts
// runs 2,000 sequences per machine. The bar is 0 mismatches.
//
// The cases below are the mismatches the differential found in M4d, each replayed through both
// models with the rules spec's answer: the side that broke the spec was fixed.

const QUICK_RUNS = 150

describe.each(PRESET_IDS)('the reference differential on %s (quick subset)', (id) => {
  it(`finds no mismatch in ${QUICK_RUNS} sequences of 100 actions, and exercises every bet`, () => {
    const report = runDifferential(id, QUICK_RUNS, 100)
    expect(report.mismatches.map(describeMismatch)).toEqual([])
    expect(report.actions).toBe(QUICK_RUNS * 100)
    expectExercised(report, compileConfig(PRESETS[id]))
  })
})

/** Plays `steps` through both models; every step must agree. Returns both tables at the end. */
function sideBySide(id: PresetId, steps: readonly Step[]) {
  const cfg = compileConfig(PRESETS[id])
  const facts = factsFrom(PRESETS[id])
  const game = new Game(cfg, facts)
  const refused: (string | null)[] = []
  for (const step of steps) {
    const turn = game.play(step)
    expect(turn.mismatch, JSON.stringify(step)).toBeNull()
    refused.push(turn.result.ok ? null : turn.result.rejection.code)
  }
  const engine = engineSnapshot(game.engine, cfg)
  expect(engine).toEqual(refSnapshot(facts, game.ref))
  return { engine, refused }
}

const place = (typeId: string, amount: number, number: number | null = null): Step => ({
  kind: 'place',
  typeId,
  number,
  parent: null,
  amount,
})
const roll = (d1: 1 | 2 | 3 | 4 | 5 | 6, d2: 1 | 2 | 3 | 4 | 5 | 6): Step => ({
  kind: 'roll',
  d1,
  d2,
})
const key = (typeId: string, number: number | null): BetKey => ({
  typeId,
  number: number as BetKey['number'],
  parent: null,
})
const setAmount = (typeId: string, number: number | null, amount: number): Step => ({
  kind: 'setAmount',
  bet: key(typeId, number),
  amount,
})
const button = (off: boolean | null): Step => ({ kind: 'setGlobalWorking', off })

describe('adjudicated mismatches (M4d)', () => {
  it('Interblock: a bet placed after a seven-out is OFF even if Set bets On was pressed before it (§0.2 #4, §2.4 [V], §9 #6) — the oracle was fixed', () => {
    // Found on craplessBubble, seed 20261028, run 0: the oracle let a button state from before the
    // seven-out end the OFF. The flag lasts "until the player taps Set bets On", after it.
    const steps = [
      place('pass', 2_500),
      button(false),
      roll(2, 3),
      roll(5, 2),
      place('buy', 1_400, 4),
    ]
    const before = sideBySide('craplessBubble', steps)
    expect(before.engine.bets).toMatchObject([{ typeId: 'buy', number: 4, working: false }])
    const after = sideBySide('craplessBubble', [...steps, button(false)])
    expect(after.engine.bets).toMatchObject([{ typeId: 'buy', number: 4, working: true }])
  })

  it('live: a $1 lay pays the $1 minimum vig although its win rounds to $0 (§4.3 LIVE minimums) — the engine was fixed', () => {
    // Found on traditionalLive345, seed 20261028, run 0: the engine charged no vig on a base of 0.
    // vig = max($1, floor$(5% × $0)) = $1.
    const { engine } = sideBySide('traditionalLive345', [place('lay', 100, 8)])
    expect(engine).toMatchObject({ bankroll: 49_800, houseNet: 100, vigPaid: 100 })
    expect(engine.bets).toMatchObject([{ typeId: 'lay', number: 8, amount: 100, vigHeld: 100 }])
  })

  it('live: vig is re-paid on every win; what the win cannot cover comes from credit (§4.3 HAR-PA) — the engine was fixed', () => {
    // The engine capped the re-collection at the win ($0 for a $1 lay), so the lay rode free.
    const { engine } = sideBySide('traditionalLive345', [place('lay', 100, 4), roll(3, 4)])
    expect(engine).toMatchObject({ bankroll: 49_700, houseNet: 200, vigPaid: 200 })
    expect(engine.bets).toMatchObject([{ typeId: 'lay', number: 4, amount: 100, vigHeld: 100 }])
  })

  it('live: a put adds to the pass bet on its point; the bet still cannot be cut (§3.1 PUT_N) — the oracle was fixed', () => {
    // Found on traditionalLive345, seed 20261028, run 1: the oracle refused every addition.
    const { engine, refused } = sideBySide('traditionalLive345', [
      place('pass', 1_000),
      roll(4, 5),
      setAmount('pass', 9, 1_200),
      place('pass', 300),
      setAmount('pass', 9, 1_000),
    ])
    expect(refused).toEqual([null, null, null, null, 'CONTRACT_BET'])
    expect(engine.bets).toMatchObject([{ typeId: 'pass', number: 9, amount: 1_500 }])
  })

  it('a don’t come bet reduced on its number blocks nothing; taken down, it blocks new don’t come money until the come-out (§0.2 #5, §5.1) — the engine was fixed', () => {
    // Found on strictBubble, seed 20261028, run 181: the engine blocked a re-bet after a reduction.
    const reduced = [
      place('pass', 500),
      roll(5, 5),
      place('dontCome', 1_600),
      roll(4, 2),
      setAmount('dontCome', 6, 600),
      place('dontCome', 1_100),
    ]
    expect(sideBySide('strictBubble', reduced).refused).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ])
    // Taken down: no new don't come bet, nor more on the one in the box, until the come-out.
    const removed = [
      ...reduced,
      setAmount('dontCome', 6, 0),
      place('dontCome', 500),
      setAmount('dontCome', null, 1_200),
      roll(6, 5),
      roll(5, 5),
      roll(3, 3),
      place('dontCome', 500),
    ]
    expect(sideBySide('strictBubble', removed).refused).toEqual([
      ...reduced.map(() => null),
      null,
      'WINDOW_CLOSED',
      'WINDOW_CLOSED',
      null,
      null,
      null,
      null,
    ])
  })

  it('when credit cannot pay a re-collection the bet comes down instead (§4.5, IB §3.3) — the oracle does not model this', () => {
    // The reference table lets the bankroll go below 0 here (M4b noted it). The engine follows
    // §4.5: declining the vig removes the bet; its stake comes back and nothing is re-collected.
    scenario('traditionalLive345')
      .place('lay', 100, { number: 4 })
      .place('place', 49_800, { number: 6 })
      .expectBankroll(0)
      .roll(3, 4)
      .expectEvents(['diceRolled', 'natural', 'betResolved', 'betRemoved'])
      .expectSettled({ typeId: 'lay' }, { winPaid: 0, vigRearm: 0, credited: 0 })
      .expectBets([['place', 6, 49_800]])
      .expectLedger({ bankroll: 100, houseNet: 100, vigPaid: 100 })
  })

  describe('a re-collection the win covers only in part (no preset: a $50 minimum vig)', () => {
    /** Interblock crapless whose buy vig is at least $50, up front and re-collected from the win. */
    function bigMinimum(bankroll: number) {
      const input = structuredClone(PRESETS.craplessBubble)
      const buy = input.catalog.buy
      if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('buy')
      buy.commission = { ...buy.commission, minimum: 5_000 }
      input.id = 'craplessBigMinimum'
      input.money.startingBankroll = bankroll
      return input
    }

    it('the win pays what it can and credit the rest', () => {
      // A $5 buy on 4 pays $50 up front, wins $10 on the 4 and stays: $10 from the win, $40 more.
      scenario(bigMinimum(10_000))
        .place('buy', 500, { number: 4 })
        .roll(2, 2)
        .expectEvents(['diceRolled', 'pointEstablished', 'betResolved', 'vigCharged', 'vigCharged'])
        .expectSettled({ typeId: 'buy' }, { winPaid: 1_000, vigRearm: 1_000, credited: 0 })
        .expectBet({ typeId: 'buy' }, { amount: 500 })
        .expectLedger({ bankroll: 500, vigPaid: 10_000 })
      expect(
        scenario(bigMinimum(10_000)).place('buy', 500, { number: 4 }).roll(2, 2).state.bets,
      ).toMatchObject([{ vigHeld: 5_000 }])
    })

    it('when credit cannot pay the rest, what the win paid is refunded and the bet comes down', () => {
      scenario(bigMinimum(5_500))
        .place('buy', 500, { number: 4 })
        .expectBankroll(0)
        .roll(2, 2)
        .expectEvents([
          'diceRolled',
          'pointEstablished',
          'betResolved',
          'vigRefunded',
          'betRemoved',
        ])
        .expectBets([])
        .expectLedger({ deposits: 5_500, bankroll: 1_500, houseNet: 4_000, vigPaid: 5_000 })
    })
  })
})
