import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import type { PresetId } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import type { BetInstance, Decision, Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The odds settlement table, written from docs/rules/rules-spec.md §3.1 (odds pays), §4.1 (one
// rounding per settlement: winExact = stake × num/den, winPaid rounds it) and §4.2 (rounding per
// machine: floor to the cent on bubble machines, floor to $1 live), with exact cents. Pays and
// rounding units are this file's own constants.

/** True odds net to 1 (§3.1), and the lay odds that mirror them. */
const TAKE: Readonly<Record<PointNumber, readonly [bigint, bigint]>> = {
  2: [6n, 1n],
  3: [3n, 1n],
  4: [2n, 1n],
  5: [3n, 2n],
  6: [6n, 5n],
  8: [6n, 5n],
  9: [3n, 2n],
  10: [2n, 1n],
  11: [3n, 1n],
  12: [6n, 1n],
}
const LAY: Readonly<Partial<Record<PointNumber, readonly [bigint, bigint]>>> = {
  4: [1n, 2n],
  5: [2n, 3n],
  6: [5n, 6n],
  8: [5n, 6n],
  9: [2n, 3n],
  10: [1n, 2n],
}

/** Each machine's payout rounding unit in cents, floored (§4.2, §5.2). */
const UNIT: Readonly<Record<PresetId, bigint>> = {
  craplessBubble: 1n,
  craplessBubbleHighLimit: 1n,
  traditionalBubble: 1n,
  strictBubble: 1n,
  traditionalLive345: 100n,
}

const PARENT: Readonly<Record<string, string>> = {
  passOdds: 'pass',
  comeOdds: 'come',
  dontPassOdds: 'dontPass',
  dontComeOdds: 'dontCome',
}
const LAYS = new Set(['dontPassOdds', 'dontComeOdds'])

/** A winning odds bet of `stake` cents on `n`, decided through its family as a roll would. */
function oddsWin(
  cfg: MachineConfig,
  oddsType: string,
  n: PointNumber,
  stake: number,
): { odds: BetInstance; decision: Settled } {
  const parent = bet(PARENT[oddsType]!, n, { seq: 1 })
  const odds = bet(oddsType, n, { seq: 2, parent, amount: stake })
  const parentWin: Decision = { kind: 'win', payKey: 'flat', stake: 'return' }
  const roll: Dice = { d1: 3, d2: 4 }
  const before = roundAt(PARENT[oddsType] === 'pass' || PARENT[oddsType] === 'dontPass' ? n : null)
  const decision = decide(cfg, odds, rollContext(cfg, before, roll, { parentDecision: parentWin }))
  if (decision.kind !== 'win') throw new Error(`${oddsType} on ${n} did not win: ${decision.kind}`)
  return { odds, decision }
}

/** ⌊stake × num/den ÷ unit⌋ × unit, in this file's own bigint arithmetic. */
function floored(stake: number, [num, den]: readonly [bigint, bigint], unit: bigint): number {
  return Number(((BigInt(stake) * num) / (den * unit)) * unit)
}

/** What the rounding kept back, as the trace writes it: "a/b" in lowest terms, or "a". */
function kept(stake: number, [num, den]: readonly [bigint, bigint], paid: number): string {
  return Fraction.of(BigInt(stake) * num - BigInt(paid) * den, den).toString()
}

/** [machine, odds type, number, stake ¢, win paid ¢] (§4.1, §4.2, §4.4). */
const TABLE: readonly (readonly [PresetId, string, PointNumber, number, number])[] = [
  // Crapless odds on 2/12 pay 6:1 and on 3/11 pay 3:1, to the penny.
  ['craplessBubble', 'passOdds', 2, 1_000, 6_000],
  ['craplessBubble', 'passOdds', 12, 700, 4_200],
  ['craplessBubble', 'comeOdds', 2, 2_300, 13_800],
  ['craplessBubble', 'comeOdds', 3, 500, 1_500],
  ['craplessBubble', 'passOdds', 11, 100, 300],
  ['craplessBubble', 'passOdds', 4, 500, 1_000],
  // 3:2 on 5 and 6:5 on 6: whole dollars always pay whole cents; odd cents are floored.
  ['craplessBubble', 'passOdds', 5, 500, 750],
  ['craplessBubble', 'passOdds', 9, 300, 450],
  ['craplessBubble', 'passOdds', 6, 500, 600],
  ['craplessBubble', 'passOdds', 8, 100, 120],
  ['craplessBubble', 'passOdds', 6, 300, 360],
  ['craplessBubble', 'passOdds', 5, 101, 151],
  ['craplessBubble', 'passOdds', 6, 101, 121],
  ['traditionalBubble', 'passOdds', 9, 700, 1_050],
  // Lay odds pay 1:2, 2:3 and 5:6, floored to the cent: $1 on 5 pays $0.66, on 6 $0.83 (§4.2).
  ['strictBubble', 'dontPassOdds', 4, 100, 50],
  ['strictBubble', 'dontPassOdds', 4, 300, 150],
  ['strictBubble', 'dontPassOdds', 5, 100, 66],
  ['strictBubble', 'dontPassOdds', 6, 100, 83],
  ['strictBubble', 'dontPassOdds', 6, 600, 500],
  ['strictBubble', 'dontPassOdds', 8, 1_200, 1_000],
  ['traditionalBubble', 'dontComeOdds', 9, 300, 200],
  ['traditionalBubble', 'dontComeOdds', 5, 700, 466],
  ['traditionalBubble', 'dontPassOdds', 10, 1_000, 500],
  // A live table floors every pay to the dollar: $5 at 3:2 pays $7, $3 at 6:5 pays $3.
  ['traditionalLive345', 'passOdds', 5, 500, 700],
  ['traditionalLive345', 'passOdds', 6, 300, 300],
  ['traditionalLive345', 'passOdds', 6, 500, 600],
  ['traditionalLive345', 'comeOdds', 4, 1_000, 2_000],
  ['traditionalLive345', 'dontPassOdds', 6, 1_000, 800],
  ['traditionalLive345', 'dontComeOdds', 4, 300, 100],
  ['traditionalLive345', 'dontPassOdds', 9, 600, 400],
]

describe('odds pay their ratio, rounded once by the machine (§4.1, §4.2)', () => {
  it.each(TABLE)('%s: %s on %i, %i¢ wins %i¢', (id, oddsType, n, stake, paid) => {
    const cfg = machine(id)
    const { odds, decision } = oddsWin(cfg, oddsType, n, stake)
    const ratio = (LAYS.has(oddsType) ? LAY : TAKE)[n]!
    const trace = settle(odds, decision, cfg)
    expect(trace).toMatchObject({
      outcome: 'win',
      stake,
      winPaid: paid,
      credited: stake + paid,
      stakeDisposition: 'returned',
      vigOnWin: 0,
      vigRearm: 0,
      breakage: kept(stake, ratio, paid),
      winExact: Fraction.of(BigInt(stake) * ratio[0], ratio[1]).toString(),
      rounding: { mode: 'floor', increment: Number(UNIT[id]) },
    })
    expect(trace.winPaid).toBe(floored(stake, ratio, UNIT[id]))
  })
})

describe('odd-cent sweep: every stake from 1¢ to $12 is floored to the unit, never rounded up', () => {
  const sweeps: readonly (readonly [PresetId, string, readonly PointNumber[]])[] = [
    ['craplessBubble', 'passOdds', [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]],
    ['strictBubble', 'dontPassOdds', [4, 5, 6, 8, 9, 10]],
    ['traditionalBubble', 'dontComeOdds', [4, 5, 6, 8, 9, 10]],
    ['traditionalLive345', 'passOdds', [4, 5, 6, 8, 9, 10]],
    ['traditionalLive345', 'dontComeOdds', [4, 5, 6, 8, 9, 10]],
  ]
  it.each(sweeps)('%s: %s', (id, oddsType, points) => {
    const cfg = machine(id)
    const wrong: string[] = []
    for (const n of points) {
      const ratio = (LAYS.has(oddsType) ? LAY : TAKE)[n]!
      for (let stake = 1; stake <= 1_200; stake++) {
        const { odds, decision } = oddsWin(cfg, oddsType, n, stake)
        const trace = settle(odds, decision, cfg)
        const want = floored(stake, ratio, UNIT[id])
        if (trace.winPaid !== want || trace.credited !== stake + want) {
          wrong.push(`${stake}¢ on ${n}: paid ${trace.winPaid}, want ${want}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('losses and returned odds', () => {
  const cfg = machine('craplessBubble')
  const parent = bet('come', 8, { seq: 1 })
  const odds = bet('comeOdds', 8, { seq: 2, parent, amount: 2_500 })

  it('a loss credits nothing and the stake goes to the house', () => {
    expect(settle(odds, { kind: 'lose' }, cfg)).toMatchObject({
      outcome: 'lose',
      winPaid: 0,
      credited: 0,
      stakeDisposition: 'lost',
      payKey: null,
      ratioLabel: '',
    })
  })

  it('odds returned while OFF credit their stake and win nothing', () => {
    expect(settle(odds, { kind: 'push', reason: 'offReturned' }, cfg)).toMatchObject({
      outcome: 'push',
      pushReason: 'offReturned',
      winPaid: 0,
      credited: 2_500,
      stakeDisposition: 'returned',
    })
  })
})

describe('exact mode skips the rounding (§4.7, nominal edge)', () => {
  it('$1 of lay odds on 6 wins exactly 250/3¢ and credits 550/3¢', () => {
    const cfg = machine('strictBubble')
    const { odds, decision } = oddsWin(cfg, 'dontPassOdds', 6, 100)
    const trace = settle(odds, decision, cfg, 'exact')
    expect(trace.winPaid.equals(Fraction.of(250, 3))).toBe(true)
    expect(trace.credited.equals(Fraction.of(550, 3))).toBe(true)
    expect(trace).toMatchObject({ winExact: '250/3', breakage: '0', rounding: null })
  })

  it('$5 of odds on 5 at a live table: exact $7.50 against $7 paid', () => {
    const cfg = machine('traditionalLive345')
    const { odds, decision } = oddsWin(cfg, 'passOdds', 5, 500)
    expect(settle(odds, decision, cfg, 'exact').winPaid.equals(Fraction.of(750))).toBe(true)
    expect(settle(odds, decision, cfg)).toMatchObject({ winPaid: 700, breakage: '50' })
  })
})
