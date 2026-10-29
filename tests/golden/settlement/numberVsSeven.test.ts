import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { MachineConfigInput, RoundingRule } from '../../../src/engine/config/schema.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import type { BetInstance, Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The number-bet settlement table, written from docs/rules/rules-spec.md §3.2 (pays), §4.1 (one
// rounding per settlement: winExact = stake × num/den, winPaid rounds it), §4.2 (machines floor
// fractional pays to the cent, Shoot To Win rounds place 6/8 up to the cent, live tables floor to
// the dollar; the breakage table) and §8.4 ("$5 on the 6": $5.83–$5.84 on a machine, $5 live).
// Amounts are cents. Pays and rounding are this file's own constants and bigint arithmetic.

type Mode = RoundingRule['mode']

/** §3.2 pays, net to 1. */
const PLACE: Readonly<Record<number, readonly [bigint, bigint]>> = {
  2: [11n, 2n],
  3: [11n, 4n],
  4: [9n, 5n],
  5: [7n, 5n],
  6: [7n, 6n],
  8: [7n, 6n],
  9: [7n, 5n],
  10: [9n, 5n],
  11: [11n, 4n],
  12: [11n, 2n],
}
const PLACE_TO_LOSE: Readonly<Record<number, readonly [bigint, bigint]>> = {
  4: [5n, 11n],
  5: [5n, 8n],
  6: [4n, 5n],
  8: [4n, 5n],
  9: [5n, 8n],
  10: [5n, 11n],
}
const BIG: readonly [bigint, bigint] = [1n, 1n]

/** stake × num/den rounded to whole `unit`s by `mode`, in this file's own bigint arithmetic. */
function rounded(stake: number, [num, den]: readonly [bigint, bigint], mode: Mode, unit: bigint) {
  const exact = BigInt(stake) * num
  const step = den * unit
  const whole = exact / step
  const rest = exact % step
  const up =
    mode === 'ceil'
      ? rest > 0n
      : mode === 'floor'
        ? false
        : 2n * rest > step || (2n * rest === step && (mode === 'halfUp' || whole % 2n === 1n))
  return Number((whole + (up ? 1n : 0n)) * unit)
}

/** A winning bet of `stake` cents on `n`, decided through its family as a roll would. */
function winning(cfg: MachineConfig, typeId: string, n: PointNumber, stake: number) {
  const subject: BetInstance = bet(typeId, n, { amount: stake })
  const winsOnSeven = typeId === 'lay' || typeId === 'placeToLose'
  const roll: Dice = winsOnSeven ? { d1: 3, d2: 4 } : splitTotal(n)
  const decision = decide(cfg, subject, rollContext(cfg, roundAt(null), roll))
  if (decision.kind !== 'win') throw new Error(`${typeId} on ${n} did not win: ${decision.kind}`)
  return { subject, decision }
}

/** Crapless bubble with place bets rounded `mode` to the cent: the §4.2 breakage table's columns. */
function placeRounded(mode: Mode): MachineConfig {
  const input = structuredClone(PRESETS.craplessBubble) as MachineConfigInput
  const place = input.catalog.place
  if (place?.family !== 'numberVsSeven') throw new Error('no place bets')
  place.payoutRounding = { mode, increment: 1 }
  input.id = `craplessPlace-${mode}`
  input.provenance['/catalog/place/payoutRounding'] = {
    status: 'assumed',
    note: 'A test machine for the breakage table (rules spec §4.2).',
  }
  return machine(input)
}

describe('the acceptance case: $5 on place 6 (plan §10 M4b, rules spec §4.2, §8.4)', () => {
  const cases: readonly (readonly [PresetId, number, string])[] = [
    // [machine, win paid, what the rounding kept]
    ['craplessBubble', 583, '1/3'],
    ['strictBubble', 583, '1/3'],
    ['traditionalBubble', 584, '-2/3'],
    ['traditionalLive345', 500, '250/3'],
  ]
  it.each(cases)('%s pays %i¢', (id, paid, breakage) => {
    const cfg = machine(id)
    const { subject, decision } = winning(cfg, 'place', 6, 500)
    expect(settle(subject, decision, cfg)).toMatchObject({
      outcome: 'win',
      ratioLabel: id === 'craplessBubble' || id === 'strictBubble' ? '7:6' : '7 to 6',
      winExact: '1750/3',
      winPaid: paid,
      breakage,
      vigOnWin: 0,
      vigRearm: 0,
      credited: paid,
      stakeDisposition: 'stays',
    })
  })
})

describe('the §4.2 breakage table: place 6 under floor, half-up and ceil', () => {
  /** [stake, floor, half-up, ceil] win paid, and the exact edge of each (§4.2). */
  const TABLE: readonly (readonly [
    number,
    readonly [number, number, number],
    readonly Fraction[],
  ])[] = [
    [100, [116, 117, 117], [Fraction.of(1, 55), Fraction.of(3, 220), Fraction.of(3, 220)]],
    [200, [233, 233, 234], [Fraction.of(7, 440), Fraction.of(7, 440), Fraction.of(3, 220)]],
    [500, [583, 583, 584], [Fraction.of(17, 1100), Fraction.of(17, 1100), Fraction.of(4, 275)]],
  ]
  const MODES: readonly Mode[] = ['floor', 'halfUp', 'ceil']

  it.each(TABLE)('%i¢ on place 6 pays %j (floor, half-up, ceil)', (stake, paid, edges) => {
    MODES.forEach((mode, column) => {
      const cfg = placeRounded(mode)
      const { subject, decision } = winning(cfg, 'place', 6, stake)
      const trace = settle(subject, decision, cfg)
      expect(trace.winPaid, `${mode}`).toBe(paid[column])
      expect(trace.winPaid, `${mode}`).toBe(rounded(stake, PLACE[6]!, mode, 1n))
      // Edge per decision: 6 ways to lose the stake, 5 ways to win what is paid (§1.2).
      const edge = Fraction.of(6 * stake - 5 * trace.winPaid, 11 * stake)
      expect(edge.equals(edges[column]!), `${mode}: ${edge.toString()}`).toBe(true)
    })
  })

  it('exactly: 1/66 at any stake; a live table paying $5 for $5 has 1/11', () => {
    const cfg = machine('craplessBubble')
    for (const stake of [100, 200, 500]) {
      const { subject, decision } = winning(cfg, 'place', 6, stake)
      const win = settle(subject, decision, cfg, 'exact').winPaid
      const edge = Fraction.of(6 * stake)
        .sub(win.mul(Fraction.of(5)))
        .div(Fraction.of(11 * stake))
      expect(edge.equals(Fraction.of(1, 66)), `${stake}`).toBe(true)
    }
    const live = machine('traditionalLive345')
    const { subject, decision } = winning(live, 'place', 6, 500)
    const paid = settle(subject, decision, live).winPaid
    expect(Fraction.of(6 * 500 - 5 * paid, 11 * 500).equals(Fraction.of(1, 11))).toBe(true)
  })
})

describe('Shoot To Win rounds place 6/8 up to the cent (§0.2 #3, §4.2) [R WOV-30281]', () => {
  it('$1 pays $1.17 and $2 pays $2.34, on 6 and on 8', () => {
    const cfg = machine('traditionalBubble')
    for (const n of [6, 8] as const) {
      expect(settle(...pair(winning(cfg, 'place', n, 100)), cfg).winPaid, `${n}`).toBe(117)
      expect(settle(...pair(winning(cfg, 'place', n, 200)), cfg).winPaid, `${n}`).toBe(234)
    }
  })

  it('every whole-dollar stake to $60 rounds up on 6/8; 4/5/9/10 pay whole cents', () => {
    const cfg = machine('traditionalBubble')
    const wrong: string[] = []
    for (const n of [4, 5, 6, 8, 9, 10] as const) {
      for (let stake = 100; stake <= 6_000; stake += 100) {
        const paid = settle(...pair(winning(cfg, 'place', n, stake)), cfg).winPaid
        const want = rounded(stake, PLACE[n]!, 'ceil', 1n)
        if (paid !== want) wrong.push(`place ${n} ${stake}¢: paid ${paid}, want ${want}`)
        if (n !== 6 && n !== 8 && want !== rounded(stake, PLACE[n]!, 'floor', 1n)) {
          wrong.push(`place ${n} ${stake}¢ needs rounding`)
        }
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('number bets pay their §3.2 ratio, rounded once by the machine', () => {
  /** [machine, type, number, stake ¢, win paid ¢]; none of these carries a commission. */
  const TABLE: readonly (readonly [PresetId, string, PointNumber, number, number])[] = [
    // Crapless 2/12 at 11:2 and 3/11 at 11:4 [A]; the rest standard.
    ['craplessBubble', 'place', 2, 100, 550],
    ['craplessBubble', 'place', 12, 200, 1_100],
    ['craplessBubble', 'place', 3, 100, 275],
    ['craplessBubble', 'place', 11, 400, 1_100],
    ['craplessBubble', 'place', 4, 500, 900],
    ['craplessBubble', 'place', 5, 500, 700],
    ['craplessBubble', 'place', 6, 600, 700],
    ['craplessBubble', 'place', 8, 100, 116],
    ['craplessBubble', 'place', 9, 100, 140],
    ['craplessBubble', 'place', 10, 100, 180],
    // Place to lose at 5:11, 5:8, 4:5: $3 on 6 pays $2.40 [F WOV-36634]; sub-cent floored.
    ['traditionalBubble', 'placeToLose', 6, 300, 240],
    ['traditionalBubble', 'placeToLose', 8, 500, 400],
    ['traditionalBubble', 'placeToLose', 4, 1_100, 500],
    ['traditionalBubble', 'placeToLose', 5, 800, 500],
    ['traditionalBubble', 'placeToLose', 4, 100, 45],
    ['traditionalBubble', 'placeToLose', 9, 100, 62],
    ['traditionalLive345', 'placeToLose', 10, 2_200, 1_000],
    ['traditionalLive345', 'placeToLose', 5, 1_000, 600],
    // Big 6/8 at even money.
    ['traditionalBubble', 'big', 6, 500, 500],
    ['strictBubble', 'big', 8, 2_500, 2_500],
    ['traditionalLive345', 'big', 6, 1_000, 1_000],
    // Live: whole dollars only. $5 on the 5 pays $7; $10 on the 6 pays $11.
    ['traditionalLive345', 'place', 5, 500, 700],
    ['traditionalLive345', 'place', 4, 500, 900],
    ['traditionalLive345', 'place', 6, 600, 700],
    ['traditionalLive345', 'place', 6, 1_000, 1_100],
  ]

  it.each(TABLE)('%s: %s %i, %i¢ wins %i¢', (id, typeId, n, stake, paid) => {
    const cfg = machine(id)
    const { subject, decision } = winning(cfg, typeId, n, stake)
    const ratio = typeId === 'place' ? PLACE[n]! : typeId === 'big' ? BIG : PLACE_TO_LOSE[n]!
    const unit = id === 'traditionalLive345' ? 100n : 1n
    const mode: Mode = id === 'traditionalBubble' && typeId === 'place' ? 'ceil' : 'floor'
    const trace = settle(subject, decision, cfg)
    expect(trace).toMatchObject({
      outcome: 'win',
      winPaid: paid,
      credited: paid,
      stakeDisposition: 'stays',
      winExact: Fraction.of(BigInt(stake) * ratio[0], ratio[1]).toString(),
    })
    expect(trace.winPaid).toBe(rounded(stake, ratio, mode, unit))
  })
})

describe('odd-cent sweep: every stake from 1¢ to $12, rounded as the machine rounds', () => {
  // Shoot To Win rounds place 6/8 up [R] and every other place number down [A] (§0.2 #3, §4.2).
  const sweeps: readonly (readonly [PresetId, string, readonly PointNumber[], Mode, bigint])[] = [
    ['craplessBubble', 'place', [2, 3, 4, 5, 6, 8, 9, 10, 11, 12], 'floor', 1n],
    ['traditionalBubble', 'place', [6, 8], 'ceil', 1n],
    ['traditionalBubble', 'place', [4, 5, 9, 10], 'floor', 1n],
    ['traditionalBubble', 'placeToLose', [4, 5, 6, 8, 9, 10], 'floor', 1n],
    ['strictBubble', 'place', [4, 5, 6, 8, 9, 10], 'floor', 1n],
    ['traditionalLive345', 'place', [4, 5, 6, 8, 9, 10], 'floor', 100n],
    ['traditionalLive345', 'placeToLose', [4, 5, 6, 8, 9, 10], 'floor', 100n],
  ]
  it.each(sweeps)('%s: %s on %j, %s', (id, typeId, numbers, mode, unit) => {
    const cfg = machine(id)
    const table = typeId === 'place' ? PLACE : PLACE_TO_LOSE
    const wrong: string[] = []
    for (const n of numbers) {
      for (let stake = 1; stake <= 1_200; stake++) {
        const trace = settle(...pair(winning(cfg, typeId, n, stake)), cfg)
        const want = rounded(stake, table[n]!, mode, unit)
        if (trace.winPaid !== want || trace.credited !== want) {
          wrong.push(`${stake}¢ on ${n}: paid ${trace.winPaid}, want ${want}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('losses', () => {
  it('a losing number bet credits nothing and its stake goes to the house', () => {
    const cfg = machine('traditionalBubble')
    for (const typeId of ['place', 'buy', 'lay', 'placeToLose', 'big']) {
      const loser = bet(typeId, 6, { amount: 1_200 })
      const roll: Dice =
        typeId === 'lay' || typeId === 'placeToLose' ? splitTotal(6) : { d1: 2, d2: 5 }
      const decision = decide(cfg, loser, rollContext(cfg, roundAt(8), roll))
      expect(decision.kind, typeId).toBe('lose')
      expect(settle(loser, decision as Settled, cfg), typeId).toMatchObject({
        outcome: 'lose',
        winPaid: 0,
        vigOnWin: 0,
        vigRearm: 0,
        credited: 0,
        stakeDisposition: 'lost',
      })
    }
  })
})

describe('exact mode skips the rounding (§4.7, nominal edge)', () => {
  it('$5 on place 6 wins exactly 1750/3¢ on every machine, whatever it pays', () => {
    for (const id of ['craplessBubble', 'traditionalBubble', 'traditionalLive345'] as const) {
      const cfg = machine(id)
      const trace = settle(...pair(winning(cfg, 'place', 6, 500)), cfg, 'exact')
      expect(trace.winPaid.equals(Fraction.of(1750, 3)), id).toBe(true)
      expect(trace.credited.equals(Fraction.of(1750, 3)), id).toBe(true)
      expect(trace, id).toMatchObject({ breakage: '0', rounding: null })
    }
  })
})

/** The bet and decision `winning` returns, as `settle`'s first two arguments. */
function pair(won: { subject: BetInstance; decision: Settled }): [BetInstance, Settled] {
  return [won.subject, won.decision]
}

/** Two dice that make `n`. */
function splitTotal(n: PointNumber): Dice {
  return (n <= 7 ? { d1: 1, d2: n - 1 } : { d1: 6, d2: n - 6 }) as Dice
}
