import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { craplessBubble, type PresetId } from '../../../src/engine/config/presets/index.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import { isSettled, type BetInstance, type Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The one-roll settlement table, written from docs/rules/rules-spec.md §3.4 (pays to 1), §0.1
// ("x for 1" nets (x−1):1), §4.1 (winExact = stake × num/den, rounded once; credited = the stake
// if it comes back + winPaid) and §4.2 (floor to the cent on machines, to $1 live), with exact
// cents. Pays, units and the rounding are this file's own.

type Pay = readonly [bigint, bigint]

/** One winning roll per bet and what it nets to 1 (§3.4), by machine family. */
interface Win {
  readonly typeId: string
  readonly dice: Dice
  readonly pays: Pay
}

const roll = (d1: Dice['d1'], d2: Dice['d2']): Dice => ({ d1, d2 })

const SHARED: readonly Win[] = [
  { typeId: 'field', dice: roll(1, 1), pays: [2n, 1n] },
  { typeId: 'field', dice: roll(1, 2), pays: [1n, 1n] },
  { typeId: 'field', dice: roll(4, 5), pays: [1n, 1n] },
  { typeId: 'any7', dice: roll(2, 5), pays: [4n, 1n] },
  { typeId: 'anyCraps', dice: roll(6, 6), pays: [7n, 1n] },
  { typeId: 'c', dice: roll(2, 1), pays: [7n, 1n] },
  { typeId: 'e', dice: roll(6, 5), pays: [15n, 1n] },
  { typeId: 'hop25', dice: roll(5, 2), pays: [15n, 1n] },
  { typeId: 'hop33', dice: roll(3, 3), pays: [30n, 1n] },
]

const MACHINES: readonly {
  readonly name: PresetId
  readonly unit: bigint
  readonly stake: 'stays' | 'returned'
  readonly wins: readonly Win[]
}[] = [
  {
    name: 'craplessBubble',
    unit: 1n,
    stake: 'returned',
    wins: [
      ...SHARED,
      { typeId: 'field', dice: roll(6, 6), pays: [2n, 1n] },
      { typeId: 'snakeEyes', dice: roll(1, 1), pays: [30n, 1n] },
      { typeId: 'aceDeuce', dice: roll(2, 1), pays: [15n, 1n] },
      { typeId: 'yo', dice: roll(5, 6), pays: [15n, 1n] },
      { typeId: 'boxcars', dice: roll(6, 6), pays: [30n, 1n] },
    ],
  },
  {
    name: 'traditionalBubble',
    unit: 1n,
    stake: 'stays',
    wins: [
      ...SHARED,
      { typeId: 'field', dice: roll(6, 6), pays: [2n, 1n] },
      { typeId: 'horn2', dice: roll(1, 1), pays: [30n, 1n] },
      { typeId: 'horn3', dice: roll(1, 2), pays: [15n, 1n] },
      { typeId: 'horn11', dice: roll(6, 5), pays: [15n, 1n] },
      { typeId: 'horn12', dice: roll(6, 6), pays: [30n, 1n] },
      { typeId: 'hop12', dice: roll(2, 1), pays: [15n, 1n] },
      { typeId: 'hop66', dice: roll(6, 6), pays: [30n, 1n] },
    ],
  },
  {
    name: 'strictBubble',
    unit: 1n,
    stake: 'returned',
    wins: [...SHARED, { typeId: 'field', dice: roll(6, 6), pays: [2n, 1n] }],
  },
  {
    name: 'traditionalLive345',
    unit: 100n,
    stake: 'returned',
    wins: [
      ...SHARED,
      { typeId: 'field', dice: roll(6, 6), pays: [3n, 1n] },
      { typeId: 'aces', dice: roll(1, 1), pays: [30n, 1n] },
      { typeId: 'boxcars', dice: roll(6, 6), pays: [30n, 1n] },
      { typeId: 'hop56', dice: roll(6, 5), pays: [15n, 1n] },
    ],
  },
]

function decided(
  cfg: MachineConfig,
  typeId: string,
  stake: number,
  dice: Dice,
): { subject: BetInstance; decision: Settled } {
  const subject = bet(typeId, null, { amount: stake })
  const decision = decide(cfg, subject, rollContext(cfg, roundAt(null), dice))
  if (!isSettled(decision)) throw new Error(`${typeId} was not decided by ${dice.d1}-${dice.d2}`)
  return { subject, decision }
}

/** ⌊stake × num/den ÷ unit⌋ × unit, in this file's own bigint arithmetic. */
function floored(stake: number, [num, den]: Pay, unit: bigint): number {
  return Number(((BigInt(stake) * num) / (den * unit)) * unit)
}

describe('the field, to the cent', () => {
  it('$5 pays $10 on 2 and 12, $5 on 3, 4, 9, 10 and 11, and loses on 5 to 8 (2:1/2:1)', () => {
    const cfg = machine('craplessBubble')
    const paid = (d1: Dice['d1'], d2: Dice['d2']) => {
      const { subject, decision } = decided(cfg, 'field', 500, roll(d1, d2))
      const trace = settle(subject, decision, cfg)
      return trace.outcome === 'win' ? trace.winPaid : -trace.stake
    }
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((t) => paid(...split(t)))).toEqual([
      1_000, 500, 500, -500, -500, -500, -500, 500, 500, 500, 1_000,
    ])
  })

  it('a live table pays 3:1 on 12: $5 wins $15', () => {
    const cfg = machine('traditionalLive345')
    const { subject, decision } = decided(cfg, 'field', 500, roll(6, 6))
    expect(settle(subject, decision, cfg)).toMatchObject({
      ratioLabel: '3 to 1',
      winPaid: 1_500,
      credited: 2_000,
      stakeDisposition: 'returned',
    })
  })
})

describe('"for 1" pays', () => {
  it('Interblock pays $1 at 5, 8, 16 and 31 for 1 as $4, $7, $15 and $30, and returns the $1', () => {
    const cfg = machine('craplessBubble')
    const at = (typeId: string, dice: Dice) => {
      const { subject, decision } = decided(cfg, typeId, 100, dice)
      const { ratioLabel, winPaid, credited } = settle(subject, decision, cfg)
      return [ratioLabel, winPaid, credited]
    }
    expect([
      at('any7', roll(1, 6)),
      at('c', roll(1, 1)),
      at('e', roll(5, 6)),
      at('hop14', roll(4, 1)),
      at('boxcars', roll(6, 6)),
      at('hop22', roll(2, 2)),
    ]).toEqual([
      ['5 for 1', 400, 500],
      ['8 for 1', 700, 800],
      ['16 for 1', 1_500, 1_600],
      ['16 for 1', 1_500, 1_600],
      ['31 for 1', 3_000, 3_100],
      ['31 for 1', 3_000, 3_100],
    ])
  })

  it('"15 for 1" pays 14:1 net and "30 for 1" 29:1: $1 wins $14 and $29', () => {
    const input = structuredClone(craplessBubble)
    input.id = 'craplessForOne'
    const yo = input.catalog.yo
    const snakeEyes = input.catalog.snakeEyes
    if (yo?.family !== 'oneRoll' || snakeEyes?.family !== 'oneRoll') throw new Error('no props')
    yo.pays = { '11': '15 for 1' }
    snakeEyes.pays = { '2': '30 for 1' }
    const cfg = machine(input)
    const eleven = decided(cfg, 'yo', 100, roll(5, 6))
    expect(settle(eleven.subject, eleven.decision, cfg)).toMatchObject({
      ratioLabel: '15 for 1',
      winExact: '1400',
      winPaid: 1_400,
      credited: 1_500,
    })
    const aces = decided(cfg, 'snakeEyes', 100, roll(1, 1))
    expect(settle(aces.subject, aces.decision, cfg)).toMatchObject({
      ratioLabel: '30 for 1',
      winPaid: 2_900,
      credited: 3_000,
    })
  })
})

describe('after a win', () => {
  it('Shoot To Win leaves the stake up to ride the next roll; the others return it', () => {
    for (const { name, stake } of MACHINES) {
      const cfg = machine(name)
      const { subject, decision } = decided(cfg, 'any7', 500, roll(3, 4))
      expect(settle(subject, decision, cfg), name).toMatchObject({
        winPaid: 2_000,
        credited: stake === 'stays' ? 2_000 : 2_500,
        stakeDisposition: stake,
      })
    }
  })

  it('a losing one-roll bet is lost', () => {
    const cfg = machine('traditionalBubble')
    const { subject, decision } = decided(cfg, 'hop12', 500, roll(1, 1))
    expect(settle(subject, decision, cfg)).toMatchObject({
      outcome: 'lose',
      credited: 0,
      stakeDisposition: 'lost',
    })
  })
})

describe.each(MACHINES)('one-roll pays on $name, every stake from 1¢ to 1200¢', (m) => {
  const cfg = machine(m.name)

  it.each(m.wins.map((win) => [`${win.typeId} on ${win.dice.d1}-${win.dice.d2}`, win] as const))(
    '%s',
    (_, { typeId, dice, pays }) => {
      for (let stake = 1; stake <= 1_200; stake += 1) {
        const { subject, decision } = decided(cfg, typeId, stake, dice)
        const trace = settle(subject, decision, cfg)
        const paid = floored(stake, pays, m.unit)
        const back = m.stake === 'returned' ? stake : 0
        expect([trace.winPaid, trace.credited, trace.stakeDisposition], `${stake}¢`).toEqual([
          paid,
          back + paid,
          m.stake,
        ])
      }
    },
  )
})

describe('exact mode', () => {
  it('pays stake × ratio with no rounding', () => {
    const cfg = machine('traditionalLive345')
    const { subject, decision } = decided(cfg, 'e', 150, roll(5, 6))
    const exact = settle(subject, decision, cfg, 'exact')
    expect(exact.winPaid.equals(Fraction.of(2_250))).toBe(true)
    expect(settle(subject, decision, cfg)).toMatchObject({ winPaid: 2_200, breakage: '50' })
  })
})

/** Two dice that make `total`. */
function split(total: number): [Dice['d1'], Dice['d2']] {
  return (total <= 7 ? [1, total - 1] : [6, total - 6]) as [Dice['d1'], Dice['d2']]
}
