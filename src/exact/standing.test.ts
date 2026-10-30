import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS, type PresetId } from '../engine/config/presets/index.ts'
import { pruneProvenance } from '../engine/config/provenance.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import type { BetSpec } from './chain.ts'
import { arrivalRate, renewalCost, standingCost, workingShare } from './standing.ts'

// The expected-loss-per-hour table of rules spec §8.3, in this file's own arithmetic. The table
// rounds to the cent; the values here are exact.

const cfgOf = (id: PresetId) => compileConfig(PRESETS[id])

function variant(id: PresetId, edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  input.provenance = pruneProvenance(input)
  return compileConfig(input)
}

/** Cents per roll of `specs` at `amount` each, per hour at `rolls` rolls an hour, in dollars. */
function perHour(cfg: MachineConfig, specs: BetSpec[], amount: number, rolls: number): Fraction {
  const perRoll = Fraction.sum(specs.map((spec) => standingCost(spec, cents(amount), cfg).perRoll))
  return perRoll.mul(Fraction.of(rolls, 100))
}

/** A dollar amount to the cent, as rules spec §8.3 prints it. */
const dollars = (value: Fraction) => value.div(Fraction.of(100)).formatPercent(2)

const six8 = (typeId: string): BetSpec[] => [
  { typeId, number: 6 },
  { typeId, number: 8 },
]

describe('standingCost', () => {
  it('matches the per-hour table of rules spec §8.3 at 100 rolls an hour', () => {
    const crapless = cfgOf('craplessBubble')
    const traditional = cfgOf('traditionalBubble')
    const pass: BetSpec[] = [{ typeId: 'pass', number: null }]
    // T: $10 pass, 7/1671 a roll.
    expect(perHour(traditional, pass, 1_000, 100).toString()).toBe(
      Fraction.of(7 * 1_000, 1671).toString(),
    )
    expect(dollars(perHour(traditional, pass, 1_000, 100))).toBe('4.19')
    // C: $10 pass (odds add nothing): 12.93.
    expect(dollars(perHour(crapless, pass, 1_000, 100))).toBe('12.93')
    // $6 + $6 place 6 and 8: 5.56 always ON (Interblock); 3.91 OFF on the come-out (STW).
    expect(dollars(perHour(crapless, six8('place'), 600, 100))).toBe('5.56')
    expect(dollars(perHour(traditional, six8('place'), 600, 100))).toBe('3.91')
    // C: the same OFF on the come-out: 4.22.
    const offOnComeOut = variant('craplessBubble', (input) => {
      const place = input.catalog.place
      if (place?.family !== 'numberVsSeven') throw new Error('no place')
      place.comeOutDefault = 'off'
    })
    expect(dollars(perHour(offOnComeOut, six8('place'), 600, 100))).toBe('4.22')
    // C: $5 + $5 place 4 and 10: 16.67; buy them with vig up front, re-collected: 12.50.
    const four10 = (typeId: string): BetSpec[] => [
      { typeId, number: 4 },
      { typeId, number: 10 },
    ]
    expect(dollars(perHour(crapless, four10('place'), 500, 100))).toBe('16.67')
    expect(dollars(perHour(crapless, four10('buy'), 500, 100))).toBe('12.50')
    // ... with 5% of the stake taken on the win: 4.17.
    const onWin = variant('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
      buy.commission = { ...buy.commission, timing: 'onWin', rearm: 'none' }
    })
    expect(dollars(perHour(onWin, four10('buy'), 500, 100))).toBe('4.17')
    // $5 field every roll: 27.78 at 2:1/2:1, 13.89 at 2:1/3:1; $1 any 7: 16.67.
    const field: BetSpec[] = [{ typeId: 'field', number: null }]
    expect(dollars(perHour(crapless, field, 500, 100))).toBe('27.78')
    expect(dollars(perHour(cfgOf('traditionalLive345'), field, 500, 100))).toBe('13.89')
    expect(dollars(perHour(crapless, [{ typeId: 'any7', number: null }], 100, 100))).toBe('16.67')
  })

  it('names how the loss is spread', () => {
    const cfg = cfgOf('craplessBubble')
    const policy = (typeId: string, number: BetSpec['number']) =>
      standingCost({ typeId, number }, cents(1_000), cfg).policy
    expect(policy('pass', null)).toBe('comeOutDecisions')
    expect(policy('come', null)).toBe('pointRollDecisions')
    expect(policy('passOdds', 4)).toBe('arrivals')
    expect(policy('place', 6)).toBe('workingRolls')
    expect(policy('field', null)).toBe('workingRolls')
  })

  it('costs nothing for a bet that never works, and π(point) for one OFF on the come-out', () => {
    const cfg = cfgOf('craplessBubble')
    const place6: BetSpec = { typeId: 'place', number: 6 }
    expect(standingCost(place6, cents(600), cfg, { working: false }).perRoll.isZero()).toBe(true)
    expect(workingShare(place6, cfg).toString()).toBe('1')
    expect(workingShare(place6, cfgOf('traditionalBubble')).toString()).toBe('392/557')
  })

  it('spreads odds over the arrivals of their parent on the number', () => {
    const cfg = cfgOf('craplessBubble')
    // A pass decision starts on each come-out roll (π = 2310/9613) and goes to 4 with P = 3/36.
    expect(arrivalRate('pass', 4, cfg).toString()).toBe(
      Fraction.of(2310, 9613).mul(Fraction.of(3, 36)).toString(),
    )
    // A come bet starts on each point-phase roll and travels to 4 with P = 3/36.
    expect(arrivalRate('come', 4, cfg).toString()).toBe(
      Fraction.of(7303, 9613).mul(Fraction.of(3, 36)).toString(),
    )
  })
})

describe('standingCost under the machine’s after-roll switches', () => {
  it("prices Interblock's lay under Set bets Off from the re-bet cycle: /layAutoOn re-enables it", () => {
    // The button holds the lay OFF, but the machine switches it back ON after any 7 or a point
    // made, so it still resolves and still costs money (M5/M6 audit: about 19.1¢ a roll on a $40
    // lay 4, not 0). The π formula must agree with the renewal identity exactly.
    const strict = cfgOf('strictBubble')
    const rows: [BetSpec['number'], number, string][] = [
      [4, 4_000, '3873375/202748'],
      [5, 3_000, '9061250/456183'],
      [6, 2_400, '11558525/561456'],
    ]
    for (const [number, amount, perRoll] of rows) {
      const spec: BetSpec = { typeId: 'lay', number }
      const cost = standingCost(spec, cents(amount), strict, { globalOff: true })
      expect(cost.perRoll.toString(), `lay ${String(number)}`).toBe(perRoll)
      expect(cost.rate.isZero()).toBe(false)
      expect(renewalCost(spec, cents(amount), strict, { globalOff: true }).toString()).toBe(perRoll)
    }
  })

  it('still costs nothing for a bet the toggles keep OFF for good, which is never placed again', () => {
    const cfg = cfgOf('craplessBubble')
    const place6: BetSpec = { typeId: 'place', number: 6 }
    const cost = standingCost(place6, cents(600), cfg, { working: false })
    expect(cost.perRoll.isZero()).toBe(true)
    expect(cost.rate.isZero()).toBe(true)
    // The renewal identity's other side: the cycle never regenerates.
    expect(() => renewalCost(place6, cents(600), cfg, { working: false })).toThrow(
      'never placed again',
    )
  })

  it('prices a put spec per decision, never as a stream', () => {
    const live = cfgOf('traditionalLive345')
    expect(() => standingCost({ typeId: 'pass', number: 4 }, cents(1_000), live)).toThrow(
      'per decision',
    )
  })
})

describe('renewalCost', () => {
  it('equals the π formula (the identity of plan §9 item 6) on a few bets', () => {
    const cfg = cfgOf('traditionalBubble')
    const specs: BetSpec[] = [
      { typeId: 'pass', number: null },
      { typeId: 'dontCome', number: null },
      { typeId: 'place', number: 6 },
      { typeId: 'lay', number: 4 },
      { typeId: 'hard', number: 8 },
      { typeId: 'field', number: null },
      { typeId: 'horn', number: null },
      { typeId: 'dontComeOdds', number: 5 },
    ]
    for (const spec of specs) {
      const pi = standingCost(spec, cents(1_200), cfg).perRoll
      expect(renewalCost(spec, cents(1_200), cfg).toString(), spec.typeId).toBe(pi.toString())
    }
  })
})
