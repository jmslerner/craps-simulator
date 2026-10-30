import { describe, expect, it } from 'vitest'
import { compileConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { pruneProvenance } from '../../src/engine/config/provenance.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import type { CommissionInput, MachineConfigInput } from '../../src/engine/config/schema.ts'
import { cents } from '../../src/engine/core/money.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { analyzeBet, combinedEdge, roundStats } from '../../src/exact/index.ts'
import { analyze, handConstants, lineWithOdds } from './closedForm.ts'
import { closedFormOf } from './closedFormOf.ts'
import { dispatchAnalysis, dispatchVariant } from './dispatchChain.ts'
import { factsFrom, incrementOf, typeFacts } from './machineFacts.ts'

// Published exact values (plan §9 item 5), each through both the closed form (tests/oracle,
// written from the rules spec) and the exact solver (`analyzeBet`, `roundStats`, `combinedEdge`),
// both held to the same constant with exact rational equality. tests/golden/published.test.ts
// pins the solver's side and tests/oracle/closedForm.test.ts the closed form's; this file ties the
// two to one table. Side bets (All Small/Tall, Make 'Em All, Fire) have only the closed form until
// M11 (closedForm.test.ts).

const exact = (num: number, den = 1) => Fraction.of(num, den).toString()

/** A preset, or a copy of it with `edit` applied and its provenance pruned. */
function machine(
  id: PresetId,
  edit: (input: MachineConfigInput) => void = () => undefined,
): MachineConfigInput {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  return { ...input, provenance: pruneProvenance(input) }
}

function commission(input: MachineConfigInput, typeId: string, rule: Partial<CommissionInput>) {
  const type = input.catalog[typeId]
  if (type?.family !== 'numberVsSeven' || type.commission === undefined) {
    throw new Error(`${input.id} has no commission on ${typeId}`)
  }
  type.commission = { ...type.commission, ...rule }
}

/** The bet's lifecycle through both: the closed form (as paid) and `analyzeBet`. */
function both(input: MachineConfigInput, typeId: string, number: number | null, amount: number) {
  const form = closedFormOf(factsFrom(input), { typeId, number, amount })
  if (form === null) throw new Error(`the closed form does not model ${typeId}`)
  const spec = { typeId, number: number as PointNumber | null }
  return {
    closed: analyze(form),
    solver: analyzeBet(spec, cents(amount), 'typical', compileConfig(input)),
  }
}

/** Both edges of the bet, which must be `expected`. */
function expectEdge(
  input: MachineConfigInput,
  typeId: string,
  number: number | null,
  amount: number,
  expected: string,
) {
  const { closed, solver } = both(input, typeId, number, amount)
  const at = `${input.id} ${typeId} ${String(number)} ${amount}¢`
  expect(closed.edge.toString(), `${at} closed form`).toBe(expected)
  expect(solver.edge.toString(), `${at} analyzeBet`).toBe(expected)
  return { closed, solver }
}

describe('line bets and the round (rules spec §1.3)', () => {
  it('crapless pass and come: 373/6930, 9613/2310 rolls a decision, 373/28839 a roll', () => {
    for (const typeId of ['pass', 'come']) {
      const { closed, solver } = expectEdge(
        PRESETS.craplessBubble,
        typeId,
        null,
        1_000,
        exact(373, 6930),
      )
      expect(closed.workingRollsPerDecision.toString()).toBe(exact(9613, 2310))
      expect(solver.expectedRolls.toString()).toBe(exact(9613, 2310))
      expect(closed.edgePerWorkingRoll.toString()).toBe(exact(373, 28839))
      expect(solver.edgePerWorkingRoll.toString()).toBe(exact(373, 28839))
    }
  })

  it('π(comeOut) and rolls a hand: crapless 2310/9613 and 57678/7303, traditional 165/557', () => {
    const rows = [
      ['craplessBubble', 'crapless', exact(2310, 9613), exact(57678, 7303)],
      ['traditionalBubble', 'traditional', exact(165, 557), exact(1671, 196)],
    ] as const
    for (const [id, variant, comeOutShare, rollsPerHand] of rows) {
      const closed = handConstants(variant)
      const solver = roundStats(compileConfig(PRESETS[id]))
      expect(closed.comeOutShare.toString()).toBe(comeOutShare)
      expect(solver.comeOutShare.toString()).toBe(comeOutShare)
      expect(closed.rollsPerHand.toString()).toBe(rollsPerHand)
      expect(solver.rollsPerHand.toString()).toBe(rollsPerHand)
    }
  })

  it('traditional pass: 7/495, 557/165 rolls a decision, 7/1671 a roll', () => {
    for (const id of ['traditionalBubble', 'strictBubble', 'traditionalLive345'] as const) {
      const { closed, solver } = expectEdge(PRESETS[id], 'pass', null, 1_000, exact(7, 495))
      expect(closed.workingRollsPerDecision.toString()).toBe(exact(557, 165))
      expect(solver.expectedRolls.toString()).toBe(exact(557, 165))
      expect(closed.edgePerWorkingRoll.toString()).toBe(exact(7, 1671))
      expect(solver.edgePerWorkingRoll.toString()).toBe(exact(7, 1671))
    }
  })

  it('combined with full odds: 3-4-5x on a live table 7/1870, 2x on crapless 373/18480', () => {
    const rows = [
      ['traditionalLive345', 'traditional', exact(7, 1870)],
      ['craplessBubble', 'crapless', exact(373, 18480)],
    ] as const
    for (const [id, variant, expected] of rows) {
      const facts = factsFrom(PRESETS[id])
      const odds = typeFacts(facts, 'passOdds')
      if (odds.family !== 'odds') throw new Error('no pass odds')
      const closed = lineWithOdds({
        variant,
        side: 'do',
        stake: 1_000,
        rounding: odds.payoutRounding,
        afterWin: 'stay',
        odds: {
          multiple: (n) => odds.limitMultiple.get(n) ?? 0,
          basis: odds.limitBasis,
          pays: (n) => odds.pays.get(n) ?? Fraction.ZERO,
          rounding: odds.payoutRounding,
          increment: (n) => incrementOf(odds, n),
        },
      })
      const solver = combinedEdge(
        { typeId: 'pass', number: null },
        cents(1_000),
        compileConfig(PRESETS[id]),
      )
      expect(closed.edge.toString(), id).toBe(expected)
      expect(solver.edge.toString(), id).toBe(expected)
    }
  })

  it("don't pass and don't come, bar 12: 3/220", () => {
    for (const id of ['traditionalBubble', 'strictBubble', 'traditionalLive345'] as const) {
      for (const typeId of ['dontPass', 'dontCome']) {
        expectEdge(PRESETS[id], typeId, null, 1_000, exact(3, 220))
      }
    }
  })
})

describe('number bets (rules spec §3.2, §4.2, §4.3)', () => {
  it('place 4/10, 5/9, 6/8 and crapless 2/12 at 11:2, 3/11 at 11:4', () => {
    const rows: [number, string, string][] = [
      [4, exact(1, 15), exact(1, 60)],
      [5, exact(1, 25), exact(1, 90)],
      [6, exact(1, 66), exact(1, 216)],
      [8, exact(1, 66), exact(1, 216)],
      [9, exact(1, 25), exact(1, 90)],
      [10, exact(1, 15), exact(1, 60)],
      [2, exact(1, 14), exact(1, 72)],
      [12, exact(1, 14), exact(1, 72)],
      [3, exact(1, 16), exact(1, 72)],
      [11, exact(1, 16), exact(1, 72)],
    ]
    for (const [n, edge, perRoll] of rows) {
      const { closed, solver } = expectEdge(PRESETS.craplessBubble, 'place', n, 3_000, edge)
      expect(closed.edgePerWorkingRoll.toString(), `place ${n}`).toBe(perRoll)
      expect(solver.edgePerWorkingRoll.toString(), `place ${n}`).toBe(perRoll)
    }
  })

  it('place 6 floored to the penny: $5 is 17/1100, $1 is 1/55; $6 is 1/216 a working roll', () => {
    expectEdge(PRESETS.craplessBubble, 'place', 6, 500, exact(17, 1100))
    expectEdge(PRESETS.craplessBubble, 'place', 6, 100, exact(1, 55))
    const { closed, solver } = both(PRESETS.craplessBubble, 'place', 6, 600)
    expect(closed.edgePerWorkingRoll.toString()).toBe(exact(1, 216))
    expect(solver.edgePerWorkingRoll.toString()).toBe(exact(1, 216))
  })

  it('buy with 5% of the stake taken from the win: 1/140, 1/80, 1/60, 1/50, 1/44', () => {
    const onWin = machine('craplessBubble', (input) =>
      commission(input, 'buy', { timing: 'onWin', refundOnTakeDown: false, rearm: 'none' }),
    )
    const rows: [number, string][] = [
      [2, exact(1, 140)],
      [3, exact(1, 80)],
      [4, exact(1, 60)],
      [5, exact(1, 50)],
      [6, exact(1, 44)],
      [8, exact(1, 44)],
      [9, exact(1, 50)],
      [10, exact(1, 60)],
      [11, exact(1, 80)],
      [12, exact(1, 140)],
    ]
    for (const [n, edge] of rows) expectEdge(onWin, 'buy', n, 2_000, edge)
    for (const [n, edge] of rows.filter(([n]) => n >= 4 && n <= 10)) {
      expectEdge(PRESETS.traditionalBubble, 'buy', n, 2_000, edge)
    }
  })

  it('buy with 5% up front: 1/21 re-collected; 1/31, 3/103, 3/113 when it is not', () => {
    const once = machine('craplessBubble', (input) => commission(input, 'buy', { rearm: 'none' }))
    const rows: [number, string][] = [
      [4, exact(1, 31)],
      [5, exact(3, 103)],
      [6, exact(3, 113)],
      [8, exact(3, 113)],
      [9, exact(3, 103)],
      [10, exact(1, 31)],
    ]
    for (const [n, edge] of rows) {
      expectEdge(PRESETS.craplessBubble, 'buy', n, 2_000, exact(1, 21))
      expectEdge(once, 'buy', n, 2_000, edge)
    }
  })

  it('lay: on the win 1/60, 1/50, 1/44; up front re-collected 1/41, 1/31, 1/25', () => {
    const rows: [number, string, string][] = [
      [4, exact(1, 60), exact(1, 41)],
      [5, exact(1, 50), exact(1, 31)],
      [6, exact(1, 44), exact(1, 25)],
      [8, exact(1, 44), exact(1, 25)],
      [9, exact(1, 50), exact(1, 31)],
      [10, exact(1, 60), exact(1, 41)],
    ]
    for (const [n, onWin, upfront] of rows) {
      expectEdge(PRESETS.traditionalBubble, 'lay', n, 6_000, onWin)
      expectEdge(PRESETS.strictBubble, 'lay', n, 6_000, upfront)
    }
  })

  it('big 6/8 at even money: 1/11', () => {
    for (const id of ['traditionalBubble', 'strictBubble', 'traditionalLive345'] as const) {
      for (const n of [6, 8]) expectEdge(PRESETS[id], 'big', n, 600, exact(1, 11))
    }
  })
})

describe('hardways and one-roll bets (rules spec §3.3, §3.4)', () => {
  it('hard 4/10 at 7:1 is 1/9, hard 6/8 at 9:1 is 1/11', () => {
    for (const id of ['craplessBubble', 'traditionalBubble'] as const) {
      for (const n of [4, 10]) expectEdge(PRESETS[id], 'hard', n, 500, exact(1, 9))
      for (const n of [6, 8]) expectEdge(PRESETS[id], 'hard', n, 500, exact(1, 11))
    }
  })

  it('field: 2:1 on 2 and 12 is 1/18; 3:1 on 12 is 1/36', () => {
    expectEdge(PRESETS.craplessBubble, 'field', null, 500, exact(1, 18))
    expectEdge(PRESETS.traditionalLive345, 'field', null, 500, exact(1, 36))
  })

  it('any 7 1/6, any craps 1/9, yo at 15:1 1/9, 2 at 30:1 5/36, horn 1/8', () => {
    const stw = PRESETS.traditionalBubble
    expectEdge(stw, 'any7', null, 100, exact(1, 6))
    expectEdge(stw, 'anyCraps', null, 100, exact(1, 9))
    expectEdge(stw, 'horn11', null, 100, exact(1, 9))
    expectEdge(stw, 'horn2', null, 100, exact(5, 36))
    expectEdge(stw, 'horn', null, 400, exact(1, 8))
  })

  it('"for 1" props are worse: yo at "15 for 1" and 2 at "30 for 1" are both 1/6', () => {
    const forOne = machine('traditionalBubble', (input) => {
      const yo = input.catalog.horn11
      const two = input.catalog.horn2
      if (yo?.family !== 'oneRoll' || two?.family !== 'oneRoll') throw new Error('no horn')
      yo.pays = { '11': '15 for 1' }
      two.pays = { '2': '30 for 1' }
    })
    expectEdge(forOne, 'horn11', null, 100, exact(1, 6))
    expectEdge(forOne, 'horn2', null, 100, exact(1, 6))
  })
})

describe('odds (rules spec §3.1, §4.4)', () => {
  it('2/12 odds short-paid at 11:2 cost 1/14; true odds cost nothing', () => {
    const short = machine('craplessBubble', (input) => {
      const odds = input.catalog.passOdds
      if (odds?.family !== 'odds') throw new Error('no odds')
      odds.pays = { ...odds.pays, '2': '11:2', '12': '11:2' }
    })
    expectEdge(short, 'passOdds', 2, 200, exact(1, 14))
    expectEdge(short, 'passOdds', 12, 200, exact(1, 14))
    for (const n of [4, 5, 6, 8, 9, 10]) expectEdge(PRESETS.strictBubble, 'passOdds', n, 3_000, '0')
  })

  it('come odds short-paid at 11:2 cost 1/14 through the reducer too (rules spec §0.1)', () => {
    // The closed form does not model odds returned unplayed, so the dispatch chain (the real
    // reducer, solved densely) stands on the oracle side: both it and analyzeBet must give the
    // published 1/14, with the returns left out of the amount risked.
    const input = dispatchVariant(
      machine('craplessBubble', (edited) => {
        const odds = edited.catalog.comeOdds
        if (odds?.family !== 'odds') throw new Error('no odds')
        odds.pays = { ...odds.pays, '2': '11:2', '12': '11:2' }
      }),
    )
    const cfg = compileConfig(input)
    for (const n of [2, 12] as const) {
      const reducer = dispatchAnalysis(
        cfg,
        {
          typeId: 'comeOdds',
          amount: 200,
          parent: { typeId: 'come', amount: 200, number: n },
          point: 6,
        },
        'lifetime',
      )
      expect(reducer.edge.toString(), `reducer comeOdds ${n}`).toBe(exact(1, 14))
      const solver = analyzeBet({ typeId: 'comeOdds', number: n }, cents(200), 'typical', cfg)
      expect(solver.edge.toString(), `analyzeBet comeOdds ${n}`).toBe(exact(1, 14))
    }
  })

  it('odd-cent sweep: true odds are free exactly when the cents divide, and never favour the player', () => {
    const pays: Record<number, [number, number]> = { 2: [6, 1], 4: [2, 1], 5: [3, 2], 6: [6, 5] }
    for (const [key, [num, den]] of Object.entries(pays)) {
      for (let amount = 1; amount <= 60; amount++) {
        const { closed, solver } = both(PRESETS.craplessBubble, 'passOdds', Number(key), amount)
        expect(solver.edge.toString(), `odds on ${key} at ${amount}¢`).toBe(closed.edge.toString())
        expect(closed.edge.isZero(), `odds on ${key} at ${amount}¢`).toBe(
          (amount * num) % den === 0,
        )
        expect(closed.edge.isNegative(), `odds on ${key} at ${amount}¢`).toBe(false)
      }
    }
  })
})
