import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import {
  PRESET_IDS,
  traditionalLive345,
  type PresetId,
} from '../../../src/engine/config/presets/index.ts'
import { ALL_ROLLS, type Dice } from '../../../src/engine/core/dice.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import { isSettled, type BetInstance, type Settled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The composite settlement table, written from docs/rules/rules-spec.md §3.4 (the whole-bet net
// table: C&E +3/+7, horn +27/+12/−4 per 4 units, world +26/+11/0/−5 per 5 units; Interblock's
// horn formula, $100 on 6-6 → +$675), §4.1 (one settlement, one rounding: winExact = stake × net,
// rounded once) and §4.2 (floor to the cent on machines, to $1 live), and plan §0 amendment 15
// (a net of 0 is a push). Nets, units and the rounding are this file's own.

type Net = readonly [bigint, bigint]

const roll = (d1: Dice['d1'], d2: Dice['d2']): Dice => ({ d1, d2 })

const PRESETS_WITH_HORN: readonly { name: PresetId; unit: bigint; stays: boolean }[] = [
  { name: 'craplessBubble', unit: 1n, stays: false },
  { name: 'traditionalBubble', unit: 1n, stays: true },
  { name: 'strictBubble', unit: 1n, stays: false },
  { name: 'traditionalLive345', unit: 100n, stays: false },
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

/** What the roll did to the player's money: winnings, or minus the stake lost; 0 for a push. */
function net(cfg: MachineConfig, typeId: string, stake: number, dice: Dice): number {
  const { subject, decision } = decided(cfg, typeId, stake, dice)
  const trace = settle(subject, decision, cfg)
  const back = trace.stakeDisposition === 'returned' ? trace.stake : 0
  return trace.stakeDisposition === 'lost' ? -trace.stake : trace.credited - back
}

/** ⌊stake × num/den ÷ unit⌋ × unit, in this file's own bigint arithmetic. */
function floored(stake: number, [num, den]: Net, unit: bigint): number {
  return Number(((BigInt(stake) * num) / (den * unit)) * unit)
}

describe('the acceptance cases (plan §10 M4c)', () => {
  it('a $4 horn is 4 units: on a 2 it nets +$27, on a 3 +$12, on a 7 −$4, on every machine', () => {
    for (const { name } of PRESETS_WITH_HORN) {
      const cfg = machine(name)
      expect(
        [roll(1, 1), roll(2, 1), roll(3, 4), roll(5, 6), roll(6, 6), roll(4, 4)].map((dice) =>
          net(cfg, 'horn', 400, dice),
        ),
        name,
      ).toEqual([2_700, 1_200, -400, 1_200, 2_700, -400])
    }
  })

  it('$100 on the horn and 6-6 nets +$675: (bet/4) × 30 − 3·bet/4, as Interblock pays it', () => {
    const cfg = machine('craplessBubble')
    const { subject, decision } = decided(cfg, 'horn', 10_000, roll(6, 6))
    expect(settle(subject, decision, cfg)).toMatchObject({
      outcome: 'win',
      typeId: 'horn',
      number: null,
      payKey: '12',
      ratioLabel: '27:4',
      winExact: '67500',
      winPaid: 67_500,
      breakage: '0',
      credited: 77_500,
      stakeDisposition: 'returned',
    })
  })

  it('the C&E net table: $2 nets +$6 on 2, 3 and 12, +$14 on 11, and −$2 otherwise', () => {
    for (const { name } of PRESETS_WITH_HORN) {
      const cfg = machine(name)
      const nets = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((t) => net(cfg, 'ce', 200, split(t)))
      expect(nets, name).toEqual([600, 600, -200, -200, -200, -200, -200, -200, -200, 1_400, 600])
    }
  })

  it('world on 7 pushes: the live table hands back the $5 and pays nothing', () => {
    const cfg = machine('traditionalLive345')
    for (const dice of [roll(1, 6), roll(5, 2), roll(4, 3)]) {
      const { subject, decision } = decided(cfg, 'world', 500, dice)
      expect(settle(subject, decision, cfg)).toMatchObject({
        outcome: 'push',
        pushReason: 'zeroNet',
        payKey: null,
        winPaid: 0,
        vigOnWin: 0,
        credited: 500,
        stakeDisposition: 'returned',
      })
    }
  })

  it('on a machine whose parts ride, the pushed world bet stays up and credits nothing', () => {
    const input = structuredClone(traditionalLive345)
    input.id = 'liveRiders'
    for (const type of Object.values(input.catalog)) {
      if (type.family === 'oneRoll') type.afterWin = 'stay'
    }
    const cfg = machine(input)
    const { subject, decision } = decided(cfg, 'world', 500, roll(6, 1))
    expect(settle(subject, decision, cfg)).toMatchObject({
      outcome: 'push',
      credited: 0,
      stakeDisposition: 'stays',
    })
  })
})

describe('one bet, one rounding (§4.1)', () => {
  it('a $5 world wins $26 on 2 and $11 on 3; a $1 world on 2 is paid $5 on a live table', () => {
    const cfg = machine('traditionalLive345')
    expect(net(cfg, 'world', 500, roll(1, 1))).toBe(2_600)
    expect(net(cfg, 'world', 500, roll(2, 1))).toBe(1_100)
    const { subject, decision } = decided(cfg, 'world', 100, roll(1, 1))
    expect(settle(subject, decision, cfg)).toMatchObject({
      ratioLabel: '26:5',
      winExact: '520',
      winPaid: 500,
      breakage: '20',
    })
  })

  it('a $1 horn on 12 is paid $6.75 on a machine and $6 on a live table', () => {
    expect(net(machine('craplessBubble'), 'horn', 100, roll(6, 6))).toBe(675)
    expect(net(machine('traditionalLive345'), 'horn', 100, roll(6, 6))).toBe(600)
  })

  it('horn high: $5 on horn high aces nets +$57 on 2, +$26 on 12 and +$11 on 3 or 11', () => {
    const cfg = machine('traditionalLive345')
    expect(
      [roll(1, 1), roll(6, 6), roll(1, 2), roll(5, 6), roll(3, 4)].map((dice) =>
        net(cfg, 'hornHigh2', 500, dice),
      ),
    ).toEqual([5_700, 2_600, 1_100, 1_100, -500])
  })

  it('an odd-cent stake is rounded once on the whole bet: 101¢ on the horn and 12 pays 681¢', () => {
    const cfg = machine('craplessBubble')
    const { subject, decision } = decided(cfg, 'horn', 101, roll(6, 6))
    expect(settle(subject, decision, cfg)).toMatchObject({
      winExact: '2727/4',
      winPaid: 681,
      breakage: '3/4',
      credited: 782,
    })
  })
})

describe.each(PRESETS_WITH_HORN)('composite pays on $name, every stake from 1¢ to 1200¢', (m) => {
  const cfg = machine(m.name)
  const cases: readonly (readonly [string, Dice, Net])[] = [
    ['horn', roll(1, 1), [27n, 4n]],
    ['horn', roll(2, 1), [3n, 1n]],
    ['horn', roll(6, 5), [3n, 1n]],
    ['horn', roll(6, 6), [27n, 4n]],
    ['ce', roll(1, 2), [3n, 1n]],
    ['ce', roll(5, 6), [7n, 1n]],
    ...(m.name === 'traditionalLive345'
      ? ([
          ['world', roll(1, 1), [26n, 5n]],
          ['world', roll(2, 1), [11n, 5n]],
          ['hornHigh3', roll(1, 2), [27n, 5n]],
          ['hornHigh12', roll(6, 6), [57n, 5n]],
        ] as const)
      : []),
  ]

  it.each(cases.map((c) => [`${c[0]} on ${c[1].d1}-${c[1].d2}`, ...c] as const))(
    '%s',
    (_, typeId, dice, pays) => {
      for (let stake = 1; stake <= 1_200; stake += 1) {
        const { subject, decision } = decided(cfg, typeId, stake, dice)
        const trace = settle(subject, decision, cfg)
        const paid = floored(stake, pays, m.unit)
        const exact = Fraction.of(BigInt(stake) * pays[0], pays[1])
        expect(
          [trace.winExact, trace.winPaid, trace.breakage, trace.credited],
          `${stake}¢`,
        ).toEqual([
          exact.toString(),
          paid,
          exact.sub(Fraction.of(paid)).toString(),
          (m.stays ? 0 : stake) + paid,
        ])
      }
    },
  )
})

describe('exact mode', () => {
  it('pays stake × net with no rounding', () => {
    const cfg = machine('traditionalLive345')
    const { subject, decision } = decided(cfg, 'world', 100, roll(6, 6))
    const exact = settle(subject, decision, cfg, 'exact')
    expect(exact.winPaid.equals(Fraction.of(520))).toBe(true)
    expect(exact.credited.equals(Fraction.of(620))).toBe(true)
  })
})

describe('the whole bet and its parts move the same money (§4.1)', () => {
  /** What a settlement did to the player: what reached credit, less a stake that left the table. */
  const moved = (credited: Fraction, stake: number, disposition: string) =>
    credited.sub(Fraction.of(disposition === 'stays' ? 0 : stake))

  /**
   * The composite of `stake` cents and its parts, each staked its share (units × stake ÷ total
   * units) as a one-roll bet of its own, settled on the same roll: [whole, Σ parts], rounded or
   * exact.
   */
  function both(cfg: MachineConfig, id: string, stake: number, dice: Dice, exact: boolean) {
    const composite = cfg.composites.get(id)
    if (composite === undefined) throw new Error(`no composite ${id}`)
    const run = (typeId: string, amount: number): Fraction => {
      const { subject, decision } = decided(cfg, typeId, amount, dice)
      if (exact) {
        const trace = settle(subject, decision, cfg, 'exact')
        return moved(trace.credited, amount, trace.stakeDisposition)
      }
      const trace = settle(subject, decision, cfg)
      return moved(Fraction.of(trace.credited), amount, trace.stakeDisposition)
    }
    const parts = composite.parts.map(({ typeId, units }) =>
      run(typeId, (stake * units) / composite.units),
    )
    return [run(id, stake), Fraction.sum(parts)] as const
  }

  it('for whole-dollar bets on penny machines, and exactly everywhere (seeded)', () => {
    let checked = 0
    fc.assert(
      fc.property(
        fc.constantFrom<PresetId>(...PRESET_IDS),
        fc.nat(),
        fc.integer({ min: 1, max: 100 }),
        fc.constantFrom(...ALL_ROLLS),
        (id, pick, dollars, dice) => {
          const cfg = machine(id)
          const ids = [...cfg.composites.keys()]
          const composite = ids[pick % ids.length] ?? 'horn'
          const [whole, parts] = both(cfg, composite, dollars * 100, dice, true)
          expect(whole.equals(parts), `${id} ${composite} $${dollars} ${dice.d1}-${dice.d2}`).toBe(
            true,
          )
          if (cfg.payoutRounding.increment === 1) {
            const [paidWhole, paidParts] = both(cfg, composite, dollars * 100, dice, false)
            expect(paidWhole.equals(paidParts)).toBe(true)
          }
          checked += 1
        },
      ),
      { seed: 20261028, numRuns: 400 },
    )
    expect(checked).toBe(400)
  })

  it('but a live table rounds the parts of a $1 horn more harshly than the whole bet', () => {
    // The whole $1 horn on 12 pays 675¢ → $6; a lone 25¢ part on 12 would win 750¢ → $7.
    const cfg = machine('traditionalLive345')
    const [whole, parts] = both(cfg, 'horn', 100, roll(6, 6), false)
    expect([whole.toString(), parts.toString()]).toEqual(['600', '625'])
  })
})

/** Two dice that make `total`. */
function split(total: number): Dice {
  return (total <= 7 ? { d1: 1, d2: total - 1 } : { d1: 6, d2: total - 6 }) as Dice
}
