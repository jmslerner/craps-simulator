import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { pruneProvenance } from '../../src/engine/config/provenance.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { cents } from '../../src/engine/core/money.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { betId } from '../../src/engine/bets/types.ts'
import type { TableState } from '../../src/engine/table/state.ts'
import { newTable } from '../../src/engine/table/state.ts'
import {
  analyzeBet,
  analyzeExisting,
  checkBet,
  combinedEdge,
  distribution,
  roundStats,
  standingCost,
  startAt,
  typicalStart,
  type BetSpec,
} from '../../src/exact/index.ts'

// Published exact values (plan §9 item 5), every one through the exact solver and compared with
// exact rational equality. The expected fractions are this file's own constants, from the plan's
// table and docs/rules/rules-spec.md (§1.3, §3, §4.2, §4.3, §4.4, §6.2–§6.4, §6.6, §8.3) and
// docs/rules/glossary.md. The side bets (M11) follow docs/rules/research/sidebets.md: where the
// research gives a fraction it is matched exactly; where it gives only a decimal, the solver's
// exact fraction must print to every published digit.
//
// Stakes are ones the machine pays exactly, unless the row is about rounding: a published edge is
// the nominal one (rules spec §4.2 lists what breakage does at other stakes).

/** The fraction `num/den` as a string, so a failure shows both sides exactly. */
const exact = (num: number, den = 1) => Fraction.of(num, den).toString()

function preset(id: PresetId): MachineConfig {
  return compileConfig(PRESETS[id])
}

/** A preset with `edit` applied to a copy, its provenance pruned to the values left. */
function variant(id: PresetId, edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  input.provenance = pruneProvenance(input)
  return compileConfig(input)
}

function edge(cfg: MachineConfig, typeId: string, number: PointNumber | null, amount: number) {
  return analyzeBet({ typeId, number }, cents(amount), 'typical', cfg).edge.toString()
}

const FIVE_PERCENT = {
  rate: '1:20',
  rounding: { mode: 'ceil', increment: 1 },
  minimum: 0,
} as const

describe('line bets (rules spec §1.3)', () => {
  it('crapless pass and come: 373/6930, 9613/2310 rolls a decision, 373/28839 a roll', () => {
    const cfg = preset('craplessBubble')
    for (const typeId of ['pass', 'come']) {
      const pass = analyzeBet({ typeId, number: null }, cents(1_000), 'typical', cfg)
      expect(pass.edge.toString(), typeId).toBe(exact(373, 6930))
      expect(pass.nominalEdge.toString(), typeId).toBe(exact(373, 6930))
      expect(pass.expectedRolls.toString(), typeId).toBe(exact(9613, 2310))
      expect(pass.edgePerWorkingRoll.toString(), typeId).toBe(exact(373, 28839))
      expect(pass.pWin.toString(), typeId).toBe(exact(6557, 13860))
    }
  })

  it('crapless round: π(comeOut) 2310/9613 and 57678/7303 rolls a hand (shooter)', () => {
    const stats = roundStats(preset('craplessBubble'))
    expect(stats.comeOutShare.toString()).toBe(exact(2310, 9613))
    expect(stats.pointShare.toString()).toBe(exact(7303, 9613))
    expect(stats.rollsPerDecision.toString()).toBe(exact(9613, 2310))
    expect(stats.rollsPerHand.toString()).toBe(exact(57678, 7303))
  })

  it('traditional pass: 7/495, 557/165 rolls, 7/1671 a roll, π 165/557, 1671/196 a hand', () => {
    for (const id of ['traditionalBubble', 'strictBubble', 'traditionalLive345'] as const) {
      const cfg = preset(id)
      const pass = analyzeBet({ typeId: 'pass', number: null }, cents(1_000), 'typical', cfg)
      expect(pass.edge.toString(), id).toBe(exact(7, 495))
      expect(pass.expectedRolls.toString(), id).toBe(exact(557, 165))
      expect(pass.edgePerWorkingRoll.toString(), id).toBe(exact(7, 1671))
      expect(pass.pWin.toString(), id).toBe(exact(244, 495))
      const stats = roundStats(cfg)
      expect(stats.comeOutShare.toString(), id).toBe(exact(165, 557))
      expect(stats.rollsPerHand.toString(), id).toBe(exact(1671, 196))
    }
  })

  it('traditional pass with 3-4-5x odds: combined 7/1870; crapless with 2x: 373/18480', () => {
    const live = combinedEdge(
      { typeId: 'pass', number: null },
      cents(1_000),
      preset('traditionalLive345'),
    )
    expect(live.edge.toString()).toBe(exact(7, 1870))
    expect(live.oddsLoss.toString()).toBe('0')
    const crapless = combinedEdge(
      { typeId: 'pass', number: null },
      cents(1_000),
      preset('craplessBubble'),
    )
    expect(crapless.edge.toString()).toBe(exact(373, 18480))
    // Odds never change the flat bet's dollar loss: 373/6930 × $10.
    expect(crapless.flatLoss.toString()).toBe(exact(373_000, 6930))
  })

  it("don't pass and don't come, bar 12: 3/220 (ties counted)", () => {
    for (const id of ['traditionalBubble', 'strictBubble', 'traditionalLive345'] as const) {
      const cfg = preset(id)
      for (const typeId of ['dontPass', 'dontCome']) {
        expect(edge(cfg, typeId, null, 1_000), `${id} ${typeId}`).toBe(exact(3, 220))
      }
      const dontPass = analyzeBet(
        { typeId: 'dontPass', number: null },
        cents(1_000),
        'typical',
        cfg,
      )
      expect(dontPass.pPush.toString(), id).toBe(exact(1, 36))
      expect(dontPass.edgePerWorkingRoll.toString(), id).toBe(exact(9, 2228))
    }
  })
})

describe('number bets (rules spec §3.2, §4.3)', () => {
  it('place 4/10, 5/9, 6/8, crapless 2/12 at 11:2 and 3/11 at 11:4', () => {
    const cfg = preset('craplessBubble')
    const expected: [PointNumber, string, string][] = [
      [4, exact(1, 15), exact(1, 60)],
      [10, exact(1, 15), exact(1, 60)],
      [5, exact(1, 25), exact(1, 90)],
      [9, exact(1, 25), exact(1, 90)],
      [6, exact(1, 66), exact(1, 216)],
      [8, exact(1, 66), exact(1, 216)],
      [2, exact(1, 14), exact(1, 72)],
      [12, exact(1, 14), exact(1, 72)],
      [3, exact(1, 16), exact(1, 72)],
      [11, exact(1, 16), exact(1, 72)],
    ]
    for (const [n, he, perRoll] of expected) {
      const place = analyzeBet({ typeId: 'place', number: n }, cents(3_000), 'typical', cfg)
      expect(place.edge.toString(), `place ${n}`).toBe(he)
      expect(place.edgePerWorkingRoll.toString(), `place ${n}`).toBe(perRoll)
    }
  })

  it('place 6 floored to the penny: $5 pays $5.83 (17/1100), $1 pays $1.16 (1/55), 1/216 a roll', () => {
    const cfg = preset('craplessBubble')
    const five = analyzeBet({ typeId: 'place', number: 6 }, cents(500), 'typical', cfg)
    expect(five.winPaid).toBe(583)
    expect(five.edge.toString()).toBe(exact(17, 1100))
    expect(five.nominalEdge.toString()).toBe(exact(1, 66))
    // 17/1100 − 1/66: what flooring $5.8333… to $5.83 costs.
    expect(five.breakage.toString()).toBe(exact(1, 3300))
    const one = analyzeBet({ typeId: 'place', number: 6 }, cents(100), 'typical', cfg)
    expect(one.winPaid).toBe(116)
    expect(one.edge.toString()).toBe(exact(1, 55))
    const six = analyzeBet({ typeId: 'place', number: 6 }, cents(600), 'typical', cfg)
    expect(six.edgePerWorkingRoll.toString()).toBe(exact(1, 216))
    expect(six.breakage.toString()).toBe('0')
  })

  it('buy with 5% of the stake taken on a win: 1/140, 1/80, 1/60, 1/50, 1/44', () => {
    const cfg = variant('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family !== 'numberVsSeven') throw new Error('no buy')
      buy.commission = {
        ...FIVE_PERCENT,
        basis: 'stake',
        timing: 'onWin',
        refundOnTakeDown: false,
        rearm: 'none',
      }
    })
    const expected: [PointNumber, string, string][] = [
      [2, exact(1, 140), exact(1, 720)],
      [12, exact(1, 140), exact(1, 720)],
      [3, exact(1, 80), exact(1, 360)],
      [11, exact(1, 80), exact(1, 360)],
      [4, exact(1, 60), exact(1, 240)],
      [10, exact(1, 60), exact(1, 240)],
      [5, exact(1, 50), exact(1, 180)],
      [9, exact(1, 50), exact(1, 180)],
      [6, exact(1, 44), exact(1, 144)],
      [8, exact(1, 44), exact(1, 144)],
    ]
    for (const [n, he, perRoll] of expected) {
      const buy = analyzeBet({ typeId: 'buy', number: n }, cents(2_000), 'typical', cfg)
      expect(buy.edge.toString(), `buy ${n}`).toBe(he)
      expect(buy.edgePerWorkingRoll.toString(), `buy ${n}`).toBe(perRoll)
    }
    // Shoot To Win's buy is the same commission (CW §18).
    const stw = preset('traditionalBubble')
    expect(edge(stw, 'buy', 4, 2_000)).toBe(exact(1, 60))
    expect(edge(stw, 'buy', 5, 2_000)).toBe(exact(1, 50))
    expect(edge(stw, 'buy', 6, 2_000)).toBe(exact(1, 44))
  })

  it('buy with 5% up front: 1/21 re-collected; 1/31, 3/103, 3/113 (3/73, 3/83) when not', () => {
    const recollect = preset('craplessBubble')
    for (const n of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const) {
      expect(edge(recollect, 'buy', n, 2_000), `buy ${n}`).toBe(exact(1, 21))
    }
    const once = variant('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
      buy.commission = { ...buy.commission, rearm: 'none' }
    })
    const expected: [PointNumber, string][] = [
      [4, exact(1, 31)],
      [10, exact(1, 31)],
      [5, exact(3, 103)],
      [9, exact(3, 103)],
      [6, exact(3, 113)],
      [8, exact(3, 113)],
      [2, exact(3, 73)],
      [12, exact(3, 73)],
      [3, exact(3, 83)],
      [11, exact(3, 83)],
    ]
    for (const [n, he] of expected) expect(edge(once, 'buy', n, 2_000), `buy ${n}`).toBe(he)
  })

  it('lay: on the win 1/60, 1/50, 1/44; up front re-collected 1/41, 1/31, 1/25; once 1/121, 1/76, 5/269', () => {
    const onWin = preset('traditionalBubble')
    const upfront = preset('strictBubble')
    const once = variant('strictBubble', (input) => {
      const lay = input.catalog.lay
      if (lay?.family !== 'numberVsSeven' || lay.commission === undefined) throw new Error('no lay')
      lay.commission = { ...lay.commission, rearm: 'none' }
    })
    const expected: [PointNumber, string, string, string][] = [
      [4, exact(1, 60), exact(1, 41), exact(1, 121)],
      [10, exact(1, 60), exact(1, 41), exact(1, 121)],
      [5, exact(1, 50), exact(1, 31), exact(1, 76)],
      [9, exact(1, 50), exact(1, 31), exact(1, 76)],
      [6, exact(1, 44), exact(1, 25), exact(5, 269)],
      [8, exact(1, 44), exact(1, 25), exact(5, 269)],
    ]
    for (const [n, win, again, single] of expected) {
      expect(edge(onWin, 'lay', n, 6_000), `lay ${n} on win`).toBe(win)
      expect(edge(upfront, 'lay', n, 6_000), `lay ${n} up front`).toBe(again)
      expect(edge(once, 'lay', n, 6_000), `lay ${n} once`).toBe(single)
    }
  })

  it('place to lose 5:11, 5:8, 4:5: 1/33, 1/40, 1/55', () => {
    const cfg = preset('traditionalBubble')
    const expected: [PointNumber, number, string][] = [
      [4, 1_100, exact(1, 33)],
      [10, 1_100, exact(1, 33)],
      [5, 800, exact(1, 40)],
      [9, 800, exact(1, 40)],
      [6, 500, exact(1, 55)],
      [8, 500, exact(1, 55)],
    ]
    for (const [n, amount, he] of expected) {
      expect(edge(cfg, 'placeToLose', n, amount), `PTL ${n}`).toBe(he)
    }
  })

  it('big 6/8 at even money: 1/11', () => {
    for (const id of ['traditionalBubble', 'strictBubble', 'traditionalLive345'] as const) {
      for (const n of [6, 8] as const)
        expect(edge(preset(id), 'big', n, 600), id).toBe(exact(1, 11))
    }
  })
})

describe('hardways and one-roll bets (rules spec §3.3, §3.4)', () => {
  it('hard 4/10 at 7:1 is 1/9, hard 6/8 at 9:1 is 1/11', () => {
    for (const id of [
      'craplessBubble',
      'traditionalBubble',
      'strictBubble',
      'traditionalLive345',
    ] as const) {
      const cfg = preset(id)
      expect(edge(cfg, 'hard', 4, 500), id).toBe(exact(1, 9))
      expect(edge(cfg, 'hard', 10, 500), id).toBe(exact(1, 9))
      expect(edge(cfg, 'hard', 6, 500), id).toBe(exact(1, 11))
      expect(edge(cfg, 'hard', 8, 500), id).toBe(exact(1, 11))
    }
  })

  it('field: 2:1 on 2 and 12 is 1/18; 3:1 on 12 is 1/36', () => {
    for (const id of ['craplessBubble', 'traditionalBubble', 'strictBubble'] as const) {
      expect(edge(preset(id), 'field', null, 500), id).toBe(exact(1, 18))
    }
    expect(edge(preset('traditionalLive345'), 'field', null, 500)).toBe(exact(1, 36))
  })

  it('any 7 1/6, any craps 1/9, yo at 15:1 1/9, 2 at 30:1 5/36, horn 1/8, C&E 1/9', () => {
    const stw = preset('traditionalBubble')
    expect(edge(stw, 'any7', null, 100)).toBe(exact(1, 6))
    expect(edge(stw, 'anyCraps', null, 100)).toBe(exact(1, 9))
    expect(edge(stw, 'horn11', null, 100)).toBe(exact(1, 9))
    expect(edge(stw, 'e', null, 100)).toBe(exact(1, 9))
    expect(edge(stw, 'horn2', null, 100)).toBe(exact(5, 36))
    expect(edge(stw, 'horn', null, 400)).toBe(exact(1, 8))
    expect(edge(stw, 'ce', null, 200)).toBe(exact(1, 9))
    // Interblock writes them "for 1": 5, 8, 16 and 31 for 1 pay 4, 7, 15 and 30 to 1.
    const ib = preset('craplessBubble')
    expect(edge(ib, 'any7', null, 100)).toBe(exact(1, 6))
    expect(edge(ib, 'anyCraps', null, 100)).toBe(exact(1, 9))
    expect(edge(ib, 'yo', null, 100)).toBe(exact(1, 9))
    expect(edge(ib, 'snakeEyes', null, 100)).toBe(exact(5, 36))
    expect(edge(ib, 'horn', null, 400)).toBe(exact(1, 8))
  })

  it('"for 1" props are worse: yo "15 for 1" and 2 at "30 for 1" are both 1/6', () => {
    const cfg = variant('traditionalBubble', (input) => {
      const yo = input.catalog.horn11
      const two = input.catalog.horn2
      if (yo?.family !== 'oneRoll' || two?.family !== 'oneRoll') throw new Error('no horn')
      yo.pays = { '11': '15 for 1' }
      two.pays = { '2': '30 for 1' }
    })
    expect(edge(cfg, 'horn11', null, 100)).toBe(exact(1, 6))
    expect(edge(cfg, 'horn2', null, 100)).toBe(exact(1, 6))
  })

  it('horn high X: 23/180 on 2 or 12, 11/90 on 3 or 11; world 2/15', () => {
    const live = preset('traditionalLive345')
    expect(edge(live, 'hornHigh2', null, 500)).toBe(exact(23, 180))
    expect(edge(live, 'hornHigh12', null, 500)).toBe(exact(23, 180))
    expect(edge(live, 'hornHigh3', null, 500)).toBe(exact(11, 90))
    expect(edge(live, 'hornHigh11', null, 500)).toBe(exact(11, 90))
    expect(edge(live, 'world', null, 500)).toBe(exact(2, 15))
  })
})

describe('odds (rules spec §3.1, §4.4)', () => {
  it('true odds cost nothing at every stake the machine pays exactly', () => {
    for (const id of [
      'craplessBubble',
      'traditionalBubble',
      'strictBubble',
      'traditionalLive345',
    ] as const) {
      const cfg = preset(id)
      for (const n of cfg.ruleset.points) {
        for (const typeId of ['passOdds', 'comeOdds', 'dontPassOdds', 'dontComeOdds']) {
          if (!cfg.catalog.has(typeId)) continue
          expect(edge(cfg, typeId, n, 3_000), `${id} ${typeId} ${n}`).toBe('0')
        }
      }
    }
  })

  it('2/12 odds short-paid at 11:2 cost 1/14', () => {
    const cfg = variant('craplessBubble', (input) => {
      const odds = input.catalog.passOdds
      if (odds?.family !== 'odds') throw new Error('no odds')
      odds.pays = { ...odds.pays, '2': '11:2', '12': '11:2' }
    })
    expect(edge(cfg, 'passOdds', 2, 200)).toBe(exact(1, 14))
    expect(edge(cfg, 'passOdds', 12, 200)).toBe(exact(1, 14))
    expect(edge(cfg, 'passOdds', 6, 500)).toBe('0')
  })

  it('come odds short-paid at 11:2 cost the same 1/14: returns unplayed are no decisions (§0.1)', () => {
    // Come odds are sometimes handed back unplayed (OFF on a come-out that decides the come bet,
    // or returned at a point made). Those returns never had action, so they are left out of the
    // amount risked, and every dollar that plays loses the same 1/14 as on pass odds.
    const cfg = variant('craplessBubble', (input) => {
      const odds = input.catalog.comeOdds
      if (odds?.family !== 'odds') throw new Error('no odds')
      odds.pays = { ...odds.pays, '2': '11:2', '12': '11:2' }
    })
    const odds12 = analyzeBet({ typeId: 'comeOdds', number: 12 }, cents(200), 'typical', cfg)
    expect(odds12.edge.toString()).toBe(exact(1, 14))
    expect(edge(cfg, 'comeOdds', 2, 200)).toBe(exact(1, 14))
    // The unplayed returns still show as pushes of the first decision — they are real outcomes.
    expect(odds12.pPush.isZero()).toBe(false)
    // At true odds they stay free.
    expect(edge(cfg, 'comeOdds', 6, 500)).toBe('0')
  })

  it('put bets (live, §3.1): 33.33% on 4/10, 20% on 5/9, 9.09% on 6/8, per decision', () => {
    const live = preset('traditionalLive345')
    const rows: [PointNumber, string, string][] = [
      [4, exact(1, 3), exact(1, 12)],
      [10, exact(1, 3), exact(1, 12)],
      [5, exact(1, 5), exact(1, 18)],
      [9, exact(1, 5), exact(1, 18)],
      [6, exact(1, 11), exact(1, 36)],
      [8, exact(1, 11), exact(1, 36)],
    ]
    for (const [n, he, perRoll] of rows) {
      const put = analyzeBet({ typeId: 'pass', number: n }, cents(1_000), 'typical', live)
      expect(put.edge.toString(), `put ${n}`).toBe(he)
      // (6 − w)/36 a working roll, §3.1's HE_roll column.
      expect(put.edgePerWorkingRoll.toString(), `put ${n}`).toBe(perRoll)
      // $10 on the 4: one decision losing $10/3 (the audit's 33.33%), not a blend with later
      // pass-line decisions.
      if (n === 4) expect(put.lossPerDecision.toString()).toBe(exact(1_000, 3))
    }
  })

  it('odd-cent sweep: true odds are free exactly when the cents divide; otherwise the floor costs', () => {
    // A penny machine that takes bets in cents, so odds can be any whole number of cents.
    const cfg = variant('craplessBubble', (input) => {
      input.money.betIncrement = 1
      input.limits.min = 1
      input.limits.minTotal = null
    })
    const pays: Record<number, [number, number]> = { 2: [6, 1], 4: [2, 1], 5: [3, 2], 6: [6, 5] }
    for (const [key, [num, den]] of Object.entries(pays)) {
      const n = Number(key) as PointNumber
      for (let amount = 1; amount <= 60; amount++) {
        const he = analyzeBet({ typeId: 'passOdds', number: n }, cents(amount), 'typical', cfg).edge
        const paysExactly = (amount * num) % den === 0
        expect(he.isZero(), `odds on ${n} at ${amount}¢`).toBe(paysExactly)
        expect(he.isNegative(), `odds on ${n} at ${amount}¢`).toBe(false)
      }
    }
  })
})

describe('equity and standing cost (glossary)', () => {
  it('a $10 crapless pass on point 2 is worth 2 × $10 × 1/7 = $20/7', () => {
    const cfg = preset('craplessBubble')
    const table: TableState = {
      ...newTable(cfg, 'published'),
      round: {
        phase: { kind: 'point', point: 2 },
        rollIndex: 1,
        hand: { index: 0, rolls: 1, pointsMadeMask: 0 },
        sinceSeven: { rolls: 1, totalsMask: 1 << 2 },
      },
      bets: [
        {
          id: betId(1),
          typeId: 'pass',
          number: 2,
          parentId: null,
          amount: cents(1_000),
          vigHeld: cents(0),
          working: null,
          progress: 0,
          placedAtRoll: 0,
        },
      ],
      nextBetSeq: 2,
    }
    const pass = analyzeExisting(betId(1), table, cfg)
    expect(pass.equity.toString()).toBe(exact(2_000, 7))
    expect(pass.expectedLossFromNow.toString()).toBe(exact(5_000, 7))
  })

  it('standing cost: a $10 crapless pass costs 10 × 373/6930 × 2310/9613 dollars a roll', () => {
    const pass: BetSpec = { typeId: 'pass', number: null }
    const cost = standingCost(pass, cents(1_000), preset('craplessBubble'))
    expect(cost.perRoll.toString()).toBe(exact(373_000, 28839))
  })

  it('$6 place 6 and 8: 1/216 a roll each when always ON; × π(point) when OFF on the come-out', () => {
    const always = preset('craplessBubble')
    const offOnComeOut = preset('traditionalBubble')
    for (const n of [6, 8] as const) {
      const on = standingCost({ typeId: 'place', number: n }, cents(600), always)
      expect(on.perRoll.toString()).toBe(exact(600, 216))
      const off = standingCost({ typeId: 'place', number: n }, cents(600), offOnComeOut)
      expect(off.perRoll.toString()).toBe(
        Fraction.of(600, 216).mul(Fraction.of(392, 557)).toString(),
      )
    }
  })
})

// --- Side bets (M11; rules spec §6.2–§6.4, §6.6; docs/rules/research/sidebets.md §2–§5) ---

const side = (typeId: string): BetSpec => ({ typeId, number: null })

/** The chance of each settlement label of the first decision from the bet's typical start. */
function firstDecisionChances(cfg: MachineConfig, typeId: string): Map<string, Fraction> {
  const dist = distribution(side(typeId), typicalStart(side(typeId), cfg), 'decision', cfg)
  return new Map(
    dist.labels.map((label, index) => [label.key, dist.counts[index] ?? Fraction.ZERO]),
  )
}

/** A fraction printed to `digits` decimals, as the research prints its probabilities. */
const decimal = (value: Fraction, digits: number) => value.toNumber().toFixed(digits)

describe('Lucky Roller / All Small / All Tall / Make ’Em All (rules spec §6.4)', () => {
  it('P(Small) = P(Tall) = 20049/760760 and P(All) = 126538525259/24067258815600, on every machine', () => {
    for (const id of ['craplessBubble', 'traditionalBubble', 'strictBubble'] as const) {
      const cfg = preset(id)
      for (const typeId of ['luckyRollerLow', 'luckyRollerHigh']) {
        const bet = analyzeBet(side(typeId), cents(100), 'typical', cfg)
        expect(bet.pWin.toString(), `${id} ${typeId}`).toBe(exact(20049, 760760))
        // Any 7 loses, a come-out 7 included: no push, nothing else ends it.
        expect(bet.pLose.toString(), `${id} ${typeId}`).toBe(Fraction.ONE.sub(bet.pWin).toString())
        expect(bet.pPush.toString(), `${id} ${typeId}`).toBe('0')
      }
      const all = analyzeBet(side('luckyRollerAll'), cents(100), 'typical', cfg)
      expect(all.pWin.toString(), id).toBe(Fraction.of(126538525259n, 24067258815600n).toString())
    }
  })

  it('30 to 1 costs 139241/760760 (18.3029%), 34 to 1 59045/760760; All at 155 to 1 17.9798%, 150 to 1 20.6087%', () => {
    const ib = preset('craplessBubble')
    expect(edge(ib, 'luckyRollerLow', null, 100)).toBe(exact(139241, 760760))
    expect(edge(ib, 'luckyRollerHigh', null, 100)).toBe(exact(139241, 760760))
    expect(
      analyzeBet(side('luckyRollerLow'), cents(100), 'typical', ib).edge.formatPercent(4),
    ).toBe('18.3029')
    const pAll = Fraction.of(126538525259n, 24067258815600n)
    const allAt = (pay: number) => Fraction.ONE.sub(Fraction.of(pay + 1).mul(pAll))
    expect(edge(ib, 'luckyRollerAll', null, 100)).toBe(allAt(155).toString())
    expect(allAt(155).formatPercent(4)).toBe('17.9798')
    // Shoot To Win writes the same pays "to 1"; the strict machine pays 150 to 1 on All.
    const stw = preset('traditionalBubble')
    expect(edge(stw, 'luckyRollerLow', null, 100)).toBe(exact(139241, 760760))
    expect(edge(stw, 'luckyRollerAll', null, 100)).toBe(allAt(155).toString())
    const strict = preset('strictBubble')
    expect(edge(strict, 'luckyRollerAll', null, 100)).toBe(allAt(150).toString())
    expect(allAt(150).formatPercent(4)).toBe('20.6087')
    // The research's other paytables, as config edits.
    const smallAt = (pays: string) =>
      analyzeBet(
        side('luckyRollerLow'),
        cents(100),
        'typical',
        variant('craplessBubble', (input) => {
          const low = input.sideBets.luckyRollerLow
          if (low?.family !== 'collectSet') throw new Error('no Lucky Roller')
          low.pays = pays
        }),
      ).edge
    expect(smallAt('35 for 1').toString()).toBe(exact(59045, 760760))
    expect(smallAt('35 for 1').formatPercent(4)).toBe('7.7613')
    expect(smallAt('31:1').formatPercent(4)).toBe('15.6675')
    expect(smallAt('33:1').formatPercent(4)).toBe('10.3967')
    expect(smallAt('35:1').formatPercent(4)).toBe('5.1259')
    for (const [pay, he] of [
      [160, '15.3510'],
      [170, '10.0933'],
      [174, '7.9902'],
      [175, '7.4644'],
    ] as const) {
      expect(allAt(pay).formatPercent(4), `All at ${pay} to 1`).toBe(he)
    }
    // Break-even pays: 36.945 to 1 for Small or Tall, 189.197 to 1 for All.
    expect(decimal(Fraction.ONE.div(Fraction.of(20049, 760760)).sub(Fraction.ONE), 3)).toBe(
      '36.945',
    )
    expect(decimal(Fraction.ONE.div(pAll).sub(Fraction.ONE), 3)).toBe('189.197')
  })

  it('tracking starts fresh at placement, so when it is placed does not change the edge', () => {
    const ib = preset('craplessBubble')
    const typical = analyzeBet(side('luckyRollerLow'), cents(100), 'typical', ib)
    for (const point of ib.ruleset.points) {
      const later = analyzeBet(
        side('luckyRollerLow'),
        cents(100),
        startAt({ kind: 'point', point }),
        ib,
      )
      expect(later.edge.toString(), `point ${point}`).toBe(typical.edge.toString())
      expect(later.expectedRolls.toString(), `point ${point}`).toBe(
        typical.expectedRolls.toString(),
      )
    }
  })
})

describe('Hot Shooter Jackpot (rules spec §6.2)', () => {
  const stw = () => preset('traditionalBubble')

  it('definition A: 9.0740% per wager, 1.064% a roll, the tiers to every published digit', () => {
    const bet = analyzeBet(side('hotShooter'), cents(100), 'typical', stw())
    expect(bet.edge.formatPercent(4)).toBe('9.0740')
    // A hand is exactly 1671/196 rolls, every one of which the bet counts.
    expect(bet.expectedRolls.toString()).toBe(exact(1671, 196))
    expect(bet.lifecycle.rolls.toString()).toBe(exact(1671, 196))
    expect(bet.edgePerWorkingRoll.formatPercent(3)).toBe('1.064')
    const chances = firstDecisionChances(stw(), 'hotShooter')
    const expected: readonly [string, string][] = [
      ['lose:-:lost', '0.57095589'],
      ['push:zeroNet:returned', '0.29742455'],
      ['win:16:returned', '0.09130006'],
      ['win:24:returned', '0.02797297'],
      ['win:32:returned', '0.00856620'],
      ['win:40:returned', '0.00197622'],
      ['win:45:returned', '0.00094313'],
      ['win:50:returned', '0.00086098'],
    ]
    for (const [key, chance] of expected) {
      expect(decimal(chances.get(key) ?? Fraction.ZERO, 8), key).toBe(chance)
    }
    expect([...chances.keys()].sort()).toEqual(expected.map(([key]) => key).sort())
    expect(Fraction.sum([...chances.values()]).toString()).toBe('1')
  })

  it('the count definition decides the edge: B 21.5608%, C 32.3353%; the Grand at 51 rolls 9.9029%', () => {
    const under = (
      edit: (
        hot: Extract<MachineConfigInput['sideBets'][string], { family: 'handLength' }>,
      ) => void,
    ) =>
      analyzeBet(
        side('hotShooter'),
        cents(100),
        'typical',
        variant('traditionalBubble', (input) => {
          const hot = input.sideBets.hotShooter
          if (hot?.family !== 'handLength') throw new Error('no Hot Shooter')
          edit(hot)
        }),
      ).edge
    expect(under((hot) => (hot.countDefinition = 'exceptSevenOut')).formatPercent(4)).toBe(
      '21.5608',
    )
    expect(
      under((hot) => (hot.countDefinition = 'exceptComeOutAndSevenOut')).formatPercent(4),
    ).toBe('32.3353')
    expect(
      under((hot) => {
        hot.tiers = hot.tiers.map((tier) =>
          tier.minRolls === 50 ? { ...tier, minRolls: 51 } : tier,
        )
      }).formatPercent(4),
    ).toBe('9.9029')
    // Pennsylvania's window (any come-out) prices the same: every hand runs come-out to seven-out.
    expect(under((hot) => (hot.placement = 'anyComeOut')).toString()).toBe(
      analyzeBet(side('hotShooter'), cents(100), 'typical', stw()).edge.toString(),
    )
  })

  it('reading the "for 1" tiers as "to 1" makes it a player bet, which the sanity check rejects', () => {
    const toOne = variant('traditionalBubble', (input) => {
      const hot = input.sideBets.hotShooter
      if (hot?.family !== 'handLength') throw new Error('no Hot Shooter')
      hot.tiers = hot.tiers.map((tier) =>
        tier.pays === 'push' ? tier : { ...tier, pays: tier.pays.replace(' for 1', ':1') },
      )
    })
    const bet = analyzeBet(side('hotShooter'), cents(100), 'typical', toOne)
    expect(bet.edge.isNegative()).toBe(true)
    expect(checkBet(side('hotShooter'), toOne).map((issue) => issue.code)).toContain(
      'playerAdvantage',
    )
  })
})

describe('Lucky Shooter (rules spec §6.3)', () => {
  const strict = () => preset('strictBubble')

  it('per resolved wager: the 7/11 push leaves the bet up and decides nothing; each outcome as published', () => {
    // Rules spec §6.3: per come-out roll the 7/11 pushes 2/9 and the bet stays; a resolved wager
    // is one of the other 7/9, so each outcome's chance per resolved wager is its chance per
    // come-out roll × 9/7 (§0.1: a push that leaves the bet up is no decision of it; M11 audit).
    const chances = firstDecisionChances(strict(), 'luckyShooter')
    const perWager = (num: number, den: number) =>
      Fraction.of(num, den).mul(Fraction.of(9, 7)).toString()
    expect(chances.has('push:bar:stays')).toBe(false)
    // 2/3/12 (1/9), then a point and no hit (97/324) or one hit (67/324): the losing outcomes.
    expect(chances.get('lose:-:lost')?.toString()).toBe(
      Fraction.of(1, 9)
        .add(Fraction.of(97, 324))
        .add(Fraction.of(67, 324))
        .mul(Fraction.of(9, 7))
        .toString(),
    )
    expect(chances.get('win:2:returned')?.toString()).toBe(perWager(7583, 69984))
    expect(chances.get('win:3:returned')?.toString()).toBe(perWager(8597, 209952))
    expect(chances.get('win:4:returned')?.toString()).toBe(perWager(175, 17496))
    expect(chances.get('win:5:returned')?.toString()).toBe(perWager(125, 118098))
    expect(chances.get('win:top:returned')?.toString()).toBe(perWager(125, 944784))
    // The research's per-resolved-wager column, to every printed digit.
    expect(decimal(chances.get('win:2:returned') ?? Fraction.ZERO, 6)).toBe('0.139311')
    expect(decimal(chances.get('win:3:returned') ?? Fraction.ZERO, 6)).toBe('0.052647')
    expect(decimal(chances.get('win:4:returned') ?? Fraction.ZERO, 6)).toBe('0.012860')
    expect(decimal(chances.get('win:5:returned') ?? Fraction.ZERO, 7)).toBe('0.0013609')
    expect(decimal(chances.get('win:top:returned') ?? Fraction.ZERO, 8)).toBe('0.00017011')
    expect(Fraction.sum([...chances.values()]).toString()).toBe('1')
  })

  it("table D: 159317/1469664 per resolved wager (10.840%), the trainer's edge; 474275/163296 rolls", () => {
    const bet = analyzeBet(side('luckyShooter'), cents(100), 'typical', strict())
    // One resolved wager is the bet's one decision (EXACT_VERSION 3): the edge is the research's
    // per-resolved-wager figure, §8.1 rank 24; per come-out roll it would be × 7/9, 8.4314%.
    expect(bet.edge.toString()).toBe(exact(159317, 1469664))
    expect(bet.edge.formatPercent(3)).toBe('10.840')
    expect(bet.edge.mul(Fraction.of(7, 9)).formatPercent(4)).toBe('8.4314')
    expect(bet.lifecycle.decisions.toString()).toBe('1')
    expect(bet.pPush.toString()).toBe('0')
    expect(bet.expectedRolls.toString()).toBe(exact(474275, 163296))
    expect(bet.lifecycle.rolls.toString()).toBe(exact(474275, 163296))
    expect(bet.lifecycle.loss.div(Fraction.of(100)).toString()).toBe(exact(159317, 1469664))
  })

  it('tables A, B and C: 249299/1469664, 118345/734832, 154799/1469664 per resolved wager', () => {
    const table = (payTable: Record<string, string>, topAward: string) =>
      analyzeBet(
        side('luckyShooter'),
        cents(100),
        'typical',
        variant('strictBubble', (input) => {
          const shooter = input.sideBets.luckyShooter
          if (shooter?.family !== 'pointRun') throw new Error('no Lucky Shooter')
          shooter.payTable = payTable
          shooter.topAward = topAward
        }),
      )
    const perResolved = (pays: Record<string, string>, top: string) => {
      const analysis = table(pays, top)
      // The trainer's edge is the loss per resolved wager itself (one decision, §0.1).
      expect(analysis.edge.toString()).toBe(
        analysis.lifecycle.loss.div(Fraction.of(100)).toString(),
      )
      return analysis.lifecycle.loss.div(Fraction.of(100))
    }
    const a = perResolved({ '3': '5 for 1', '4': '15 for 1', '5': '150 for 1' }, '1000 for 1')
    expect(a.toString()).toBe(exact(249299, 1469664))
    expect(a.mul(Fraction.of(7, 9)).formatPercent(4)).toBe('13.1934')
    const b = perResolved(
      { '2': '2 for 1', '3': '4 for 1', '4': '10 for 1', '5': '100 for 1' },
      '500 for 1',
    )
    expect(b.toString()).toBe(exact(118345, 734832))
    expect(b.mul(Fraction.of(7, 9)).formatPercent(4)).toBe('12.5261')
    const c = perResolved({ '3': '5 for 1', '4': '20 for 1', '5': '150 for 1' }, '1000 for 1')
    expect(c.toString()).toBe(exact(154799, 1469664))
    expect(c.mul(Fraction.of(7, 9)).formatPercent(4)).toBe('8.1923')
    // The coaching trap: table D read "to 1" is a player +9.79% bet per resolved wager.
    const trap = table(
      { '2': '2:1', '3': '5:1', '4': '10:1', '5': '100:1' },
      '500:1',
    ).lifecycle.loss.div(Fraction.of(100))
    expect(trap.formatPercent(2)).toBe('-9.79')
  })
})

describe('Fire Bet (rules spec §6.6)', () => {
  const live = () => preset('traditionalLive345')
  const fireVariant = (
    edit: (
      fire: Extract<MachineConfigInput['sideBets'][string], { family: 'uniquePointsMade' }>,
    ) => void,
  ) =>
    variant('traditionalLive345', (input) => {
      const fire = input.sideBets.fire
      if (fire?.family !== 'uniquePointsMade') throw new Error('no Fire Bet')
      edit(fire)
    })

  it('P(0) = 98/165, P(1) = 78834/302335, then 0.101275, 0.033434, 0.008798, 0.001640, 0.000162', () => {
    // A paytable paying every count, so each count is its own label.
    const every = fireVariant((fire) => {
      fire.payTable = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [String(n), '1 to 1']))
    })
    const chances = firstDecisionChances(every, 'fire')
    expect(chances.get('lose:-:lost')?.toString()).toBe(exact(98, 165))
    expect(chances.get('win:1:returned')?.toString()).toBe(exact(78834, 302335))
    for (const [count, chance] of [
      [2, '0.101275'],
      [3, '0.033434'],
      [4, '0.008798'],
      [5, '0.001640'],
      [6, '0.000162'],
    ] as const) {
      expect(decimal(chances.get(`win:${count}:returned`) ?? Fraction.ZERO, 6), `${count}`).toBe(
        chance,
      )
    }
    expect(Fraction.sum([...chances.values()]).toString()).toBe('1')
  })

  it('table A (24/249/999 to 1): 20.7628%, P(4 or more) 0.0106005, a hand of 1671/196 rolls', () => {
    const bet = analyzeBet(side('fire'), cents(100), 'typical', live())
    expect(bet.edge.formatPercent(4)).toBe('20.7628')
    expect(decimal(bet.pWin, 7)).toBe('0.0106005')
    expect(bet.expectedRolls.toString()).toBe(exact(1671, 196))
    expect(bet.pPush.toString()).toBe('0')
  })

  it('tables B 24.8562%, C 20.7295%, MD B 23.8869%; paying the sixth point at once changes nothing', () => {
    const edgeOf = (cfg: MachineConfig) => analyzeBet(side('fire'), cents(100), 'typical', cfg).edge
    expect(
      edgeOf(
        fireVariant(
          (fire) => (fire.payTable = { '4': '10 to 1', '5': '200 to 1', '6': '2000 to 1' }),
        ),
      ).formatPercent(4),
    ).toBe('24.8562')
    expect(
      edgeOf(
        fireVariant(
          (fire) =>
            (fire.payTable = { '3': '6 to 1', '4': '29 to 1', '5': '149 to 1', '6': '299 to 1' }),
        ),
      ).formatPercent(4),
    ).toBe('20.7295')
    expect(
      edgeOf(
        fireVariant(
          (fire) => (fire.payTable = { '4': '39 to 1', '5': '199 to 1', '6': '499 to 1' }),
        ),
      ).formatPercent(4),
    ).toBe('23.8869')
    expect(edgeOf(fireVariant((fire) => (fire.payImmediatelyAt = 6))).toString()).toBe(
      edgeOf(live()).toString(),
    )
  })

  it('on a crapless machine: 13.4152% when all ten points count and six or more pay the top, 70.4488% when only 4–10 do', () => {
    // Rules spec §6.6's crapless figures [M]. With ten points counted a hand can make seven or
    // more; the spec's 13.4152% reads the top pay as "six or more", which the paytable states
    // outright here (the engine pays only counts the table lists). The same figure follows from
    // paying the sixth point at once. Paying nothing above six — table A as written — costs
    // 17.1059%. The independent side-bet oracle (tests/oracle/sideBetEdges.test.ts) reads both the
    // same way.
    const TOP = '999 to 1'
    const crapless = (
      countedPoints: readonly PointNumber[],
      payTable: Record<string, string>,
      payImmediatelyAt: number | null = null,
    ) =>
      variant('craplessBubble', (input) => {
        input.sideBets.fire = {
          family: 'uniquePointsMade',
          label: 'Fire Bet',
          countedPoints: [...countedPoints],
          payTable,
          payImmediatelyAt,
          placement: 'newHand',
        }
      })
    const edgeOn = (cfg: MachineConfig) =>
      analyzeBet(side('fire'), cents(100), 'typical', cfg).edge.formatPercent(4)
    const tableA = { '4': '24 to 1', '5': '249 to 1', '6': TOP }
    const ten: readonly PointNumber[] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
    expect(edgeOn(crapless(ten, { ...tableA, '7': TOP, '8': TOP, '9': TOP, '10': TOP }))).toBe(
      '13.4152',
    )
    expect(edgeOn(crapless(ten, tableA, 6))).toBe('13.4152')
    expect(edgeOn(crapless(ten, tableA))).toBe('17.1059')
    expect(edgeOn(crapless([4, 5, 6, 8, 9, 10], tableA))).toBe('70.4488')
    // Six chains of 1,024 masks × 11 phases: seconds under a loaded test run, not the default 5.
  }, 60_000)
})
