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
  combinedEdge,
  roundStats,
  standingCost,
  type BetSpec,
} from '../../src/exact/index.ts'

// Published exact values (plan §9 item 5), every one through the exact solver and compared with
// exact rational equality. The expected fractions are this file's own constants, from the plan's
// table and docs/rules/rules-spec.md (§1.3, §3, §4.2, §4.3, §4.4, §8.3) and docs/rules/glossary.md.
// Side bets (All Small/Tall, Make 'Em All, Fire) arrive with M11.
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
