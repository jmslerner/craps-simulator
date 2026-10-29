import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import {
  COME_OUT_RULES,
  DICE_PAIRS,
  factsFrom,
  incrementOf,
  parseNet,
  payoutRoundingOf,
  typeFacts,
  type CompositeFacts,
  type MachineFacts,
} from './machineFacts.ts'

const frac = (num: number, den = 1) => Fraction.of(num, den)
const same = (actual: Fraction | undefined, expected: Fraction) =>
  expect(actual?.toString()).toBe(expected.toString())

/** A deep, mutable copy of a preset, for configs the presets do not cover. */
function edited(id: keyof typeof PRESETS, edit: (input: MachineConfigInput) => void) {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  return input
}

function composite(facts: MachineFacts, id: string): CompositeFacts {
  const type = typeFacts(facts, id)
  if (type.family !== 'composite') throw new Error(`${id} is not a composite`)
  return type
}

/** Net per unit of a composite on every total, for composites whose parts match totals. */
function netByTotal(type: CompositeFacts): string[] {
  return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((total) => {
    const [lo, hi] = DICE_PAIRS.find(([a, b]) => a + b === total && a !== b) ?? [
      total / 2,
      total / 2,
    ]
    return type.netByDice.get(`${lo}-${hi}`)?.toString() ?? 'missing'
  })
}

describe('parseNet (rules spec §0.1, §5.3)', () => {
  it('reads "to 1" ratios as written and "for 1" as one less', () => {
    same(parseNet('7:6'), frac(7, 6))
    same(parseNet('9 to 5'), frac(9, 5))
    same(parseNet('11:2'), frac(11, 2))
    same(parseNet('31 for 1'), frac(30))
    same(parseNet('30 for 1'), frac(29))
    same(parseNet('16 for 1'), frac(15))
    same(parseNet('5 for 1'), frac(4))
    same(parseNet('7 for 5'), frac(2, 5))
    same(parseNet('1:20'), frac(1, 20))
  })

  it('rejects text that is not a paying ratio', () => {
    for (const text of ['1 for 1', '0:1', '3:0', 'x', '6-5', '7:6:5', '-1:2', '1.5:1']) {
      expect(() => parseNet(text), text).toThrow(RangeError)
    }
  })
})

describe('factsFrom: the come-out partition (rules spec §2.1, §5.3)', () => {
  it('reads every preset, with the spec own come-out lists', () => {
    for (const id of PRESET_IDS) {
      const facts = factsFrom(PRESETS[id])
      expect(facts.id).toBe(id)
      const own = COME_OUT_RULES[facts.variant]
      expect([facts.naturals, facts.craps, facts.points]).toEqual([
        own.naturals,
        own.craps,
        own.points,
      ])
    }
    expect(factsFrom(PRESETS.craplessBubble).dontBar).toBeNull()
    expect(factsFrom(PRESETS.traditionalBubble).dontBar).toBe(12)
  })

  it('throws when a config disagrees with the spec', () => {
    const crapsInCrapless = edited('craplessBubble', (input) => {
      input.rules.craps = [2, 3, 12]
      input.rules.points = [4, 5, 6, 8, 9, 10]
    })
    expect(() => factsFrom(crapsInCrapless)).toThrow(/rules\/craps/)
    const elevenAPoint = edited('traditionalBubble', (input) => {
      input.rules.naturals = [7]
      input.rules.points = [4, 5, 6, 8, 9, 10, 11]
    })
    expect(() => factsFrom(elevenAPoint)).toThrow(/rules\/naturals/)
    const barredCrapless = edited('craplessBubble', (input) => {
      input.rules.dontBar = 12
    })
    expect(() => factsFrom(barredCrapless)).toThrow(/dontBar/)
    const noBar = edited('traditionalBubble', (input) => {
      input.rules.dontBar = null
    })
    expect(() => factsFrom(noBar)).toThrow(/dontBar/)
    const reno = edited('traditionalBubble', (input) => {
      input.rules.dontBar = 2
    })
    expect(factsFrom(reno).dontBar).toBe(2)
  })
})

describe('factsFrom: bet types', () => {
  const crapless = factsFrom(PRESETS.craplessBubble)
  const stw = factsFrom(PRESETS.traditionalBubble)
  const strict = factsFrom(PRESETS.strictBubble)
  const live = factsFrom(PRESETS.traditionalLive345)

  it('parses pays per number, including crapless 2/3/11/12 (rules spec §3.2, §5.2)', () => {
    const place = typeFacts(crapless, 'place')
    if (place.family !== 'numberVsSeven') throw new Error('place')
    expect(place.numbers).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12])
    same(place.pays.get(2), frac(11, 2))
    same(place.pays.get(3), frac(11, 4))
    same(place.pays.get(6), frac(7, 6))
    same(place.pays.get(10), frac(9, 5))
    expect(place.winsOn).toBe('number')
    const lay = typeFacts(stw, 'lay')
    if (lay.family !== 'numberVsSeven') throw new Error('lay')
    expect(lay.winsOn).toBe('seven')
    same(lay.pays.get(6), frac(5, 6))
    const odds = typeFacts(crapless, 'passOdds')
    if (odds.family !== 'odds') throw new Error('odds')
    same(odds.pays.get(2), frac(6))
    same(odds.pays.get(11), frac(3))
    expect([odds.parent, odds.parentSide, odds.limitBasis, odds.limitMultiple.get(12)]).toEqual([
      'pass',
      'do',
      'stake',
      2,
    ])
    expect(odds.comeOutDefault).toBeNull()
    const comeOdds = typeFacts(crapless, 'comeOdds')
    expect(comeOdds.family === 'odds' && comeOdds.comeOutDefault).toBe('off')
    const pass = typeFacts(crapless, 'pass')
    expect(pass.family === 'line' && pass.oddsType).toBe('passOdds')
  })

  it('takes a type rounding, else the machine default (rules spec §4.1, §4.2)', () => {
    // Shoot To Win place 6/8 round up to the cent (rules spec §0.2 #3), by number or by type.
    const stwPlace = typeFacts(stw, 'place')
    expect(payoutRoundingOf(stwPlace, 6)).toEqual({ mode: 'ceil', increment: 1 })
    expect(payoutRoundingOf(stwPlace, 8)).toEqual({ mode: 'ceil', increment: 1 })
    expect(typeFacts(stw, 'buy').payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    expect(typeFacts(crapless, 'place').payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    expect(typeFacts(live, 'place').payoutRounding).toEqual({ mode: 'floor', increment: 100 })
    expect(composite(live, 'horn').payoutRounding).toEqual({ mode: 'floor', increment: 100 })
  })

  it('applies per-number commission overrides (rules spec §4.3, §5.2)', () => {
    const buy = typeFacts(live, 'buy')
    if (buy.family !== 'numberVsSeven') throw new Error('buy')
    expect(buy.commission.get(4)?.timing).toBe('onWin')
    expect(buy.commission.get(10)?.timing).toBe('onWin')
    expect(buy.commission.get(5)).toMatchObject({
      timing: 'upfront',
      basis: 'stake',
      minimum: 100,
      rounding: { mode: 'floor', increment: 100 },
      refundOnTakeDown: true,
      rearm: 'recollectFromWin',
    })
    same(buy.commission.get(5)?.rate, frac(1, 20))
    const craplessBuy = typeFacts(crapless, 'buy')
    if (craplessBuy.family !== 'numberVsSeven') throw new Error('buy')
    expect([...craplessBuy.commission.keys()]).toEqual(craplessBuy.numbers)
    expect(craplessBuy.commission.get(2)).toMatchObject({
      timing: 'upfront',
      refundOnTakeDown: false,
      rearm: 'recollectFromWin',
    })
    const place = typeFacts(crapless, 'place')
    expect(place.family === 'numberVsSeven' && place.commission.size).toBe(0)
    const strictLay = typeFacts(strict, 'lay')
    expect(strictLay.family === 'numberVsSeven' && strictLay.commission.get(4)?.basis).toBe('win')
  })

  it('applies limit defaults per type (rules spec §4.5)', () => {
    const none = new Map<number, number>()
    expect(typeFacts(crapless, 'place').limits).toEqual({
      min: 100,
      max: 50_000,
      increment: 100,
      incrementByNumber: none,
    })
    expect(typeFacts(live, 'pass').limits).toEqual({
      min: 1_000,
      max: 500_000,
      increment: 100,
      incrementByNumber: none,
    })
    expect(typeFacts(live, 'passOdds').limits.max).toBe(2_500_000)
    expect(typeFacts(live, 'dontComeOdds').limits.max).toBe(3_000_000)
    expect(composite(crapless, 'horn').limits).toEqual({
      min: 100,
      max: 50_000,
      increment: 100,
      incrementByNumber: none,
    })
  })

  it('reads per-number increments; odds take their parent point (rules spec §4.4, §4.5)', () => {
    const facts = factsFrom(
      edited('traditionalLive345', (input) => {
        const byNumber = { incrementByNumber: { '6': 600, '8': 600 } }
        input.limits.perType = {
          ...input.limits.perType,
          place: byNumber,
          dontComeOdds: {
            ...input.limits.perType?.dontComeOdds,
            incrementByNumber: { '4': 200, '5': 300, '6': 600 },
          },
        }
      }),
    )
    const place = typeFacts(facts, 'place')
    expect([6, 8, 5, null].map((n) => incrementOf(place, n))).toEqual([600, 600, 100, 100])
    const lay = typeFacts(facts, 'dontComeOdds')
    expect([4, 5, 6, 10].map((n) => incrementOf(lay, n))).toEqual([200, 300, 600, 100])
    expect(lay.limits.max).toBe(3_000_000) // the per-type maximum is kept
    const badKey = edited('craplessBubble', (input) => {
      input.limits.perType = { place: { incrementByNumber: { '7': 100 } } as never }
    })
    expect(() => factsFrom(badKey)).toThrow(/incrementByNumber\/7/)
    const badValue = edited('craplessBubble', (input) => {
      input.limits.perType = { place: { incrementByNumber: { '6': 0 } } as never }
    })
    expect(() => factsFrom(badValue)).toThrow(/whole cents/)
  })

  it('rounds number bets per number where the machine says so (rules spec §4.1, §4.2)', () => {
    // Shoot To Win place: 6 and 8 up to the cent, the other numbers down (rules spec §0.2 #3).
    const facts = factsFrom(
      edited('traditionalBubble', (input) => {
        const place = input.catalog.place
        if (place?.family !== 'numberVsSeven') throw new Error('place')
        delete place.payoutRounding
        Object.assign(place, {
          payoutRoundingByNumber: {
            '6': { mode: 'ceil', increment: 1 },
            '8': { mode: 'ceil', increment: 1 },
          },
        })
      }),
    )
    const place = typeFacts(facts, 'place')
    expect([6, 8, 5, 4].map((n) => payoutRoundingOf(place, n).mode)).toEqual([
      'ceil',
      'ceil',
      'floor',
      'floor',
    ])
    expect(payoutRoundingOf(typeFacts(facts, 'field'), null)).toEqual({
      mode: 'floor',
      increment: 1,
    })
    const offNumber = edited('traditionalBubble', (input) => {
      Object.assign(input.catalog.big ?? {}, {
        payoutRoundingByNumber: { '5': { mode: 'ceil', increment: 1 } },
      })
    })
    expect(() => factsFrom(offNumber)).toThrow(/payoutRoundingByNumber\/5 is not offered/)
    const notARule = edited('craplessBubble', (input) => {
      Object.assign(input.catalog.place ?? {}, {
        payoutRoundingByNumber: { '6': { mode: 'up', increment: 1 } },
      })
    })
    expect(() => factsFrom(notARule)).toThrow(/not a rounding rule/)
  })

  it('reads line mutability and after-win rules (rules spec §3.1, §5.1)', () => {
    expect(typeFacts(stw, 'dontPass')).toMatchObject({
      side: 'dont',
      window: 'comeOut',
      afterWin: 'stayIfFirstRoll',
      onNumber: 'locked',
      rebetAfterRemove: 'allowed',
    })
    expect(typeFacts(strict, 'dontCome')).toMatchObject({
      onNumber: 'reduceRemove',
      rebetAfterRemove: 'nextCycle',
    })
    expect(typeFacts(stw, 'come')).toMatchObject({ window: 'point', afterWin: 'stayIf11' })
    expect(typeFacts(crapless, 'pass')).toMatchObject({ onNumber: null, afterWin: 'stay' })
  })

  it('keys one-roll pays by total or by dice, low face first (rules spec §3.4)', () => {
    const any7 = typeFacts(crapless, 'any7')
    if (any7.family !== 'oneRoll') throw new Error('any7')
    same(any7.pays.get('7'), frac(4))
    const hop = typeFacts(crapless, 'hop13')
    if (hop.family !== 'oneRoll') throw new Error('hop13')
    expect(hop.match).toBe('dice')
    same(hop.pays.get('1-3'), frac(15))
    expect(crapless.types.has('hop12')).toBe(false) // IB: 1-2 is a horn single, not a hop
    expect(stw.types.has('hop12')).toBe(true)
  })
})

describe('factsFrom: composites settle as one bet (plan §0 amendment 15, rules spec §3.4)', () => {
  const crapless = factsFrom(PRESETS.craplessBubble)
  const stw = factsFrom(PRESETS.traditionalBubble)
  const live = factsFrom(PRESETS.traditionalLive345)

  it('derives the horn, C&E and world nets per unit from the parts', () => {
    //                                 2       3    4   5   6   7   8   9  10   11      12
    expect(netByTotal(composite(crapless, 'horn'))).toEqual([
      '27/4',
      '3',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '3',
      '27/4',
    ])
    expect(netByTotal(composite(stw, 'horn'))).toEqual(netByTotal(composite(crapless, 'horn')))
    expect(netByTotal(composite(crapless, 'ce'))).toEqual([
      '3',
      '3',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '7',
      '3',
    ])
    // World: per 5 units +26 / +11 / −5 / 0 on a 7 (a push).
    expect(netByTotal(composite(live, 'world'))).toEqual([
      '26/5',
      '11/5',
      '-1',
      '-1',
      '-1',
      '0',
      '-1',
      '-1',
      '-1',
      '11/5',
      '26/5',
    ])
    // Horn high 2: an extra unit on 2, 5 units in all.
    expect(netByTotal(composite(live, 'hornHigh2'))).toEqual([
      '57/5',
      '11/5',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '11/5',
      '26/5',
    ])
  })

  it('is the same on either order of the dice and keeps the parts afterWin', () => {
    const horn = composite(crapless, 'horn')
    expect(horn.netByDice.size).toBe(21)
    expect(horn.totalUnits).toBe(4)
    expect(horn.afterWin).toBe('return')
    expect(composite(stw, 'horn').afterWin).toBe('stay')
  })

  it('rounds with its parts rounding, which the parts must share (rules spec §5.3 #8)', () => {
    // Parts rounded to the dollar on a penny machine: the composite rounds to the dollar too.
    const dollar = factsFrom(
      edited('craplessBubble', (input) => {
        for (const id of ['snakeEyes', 'aceDeuce', 'yo', 'boxcars']) {
          const part = input.catalog[id]
          if (part?.family === 'oneRoll') part.payoutRounding = { mode: 'floor', increment: 100 }
        }
      }),
    )
    expect(composite(dollar, 'horn').payoutRounding).toEqual({ mode: 'floor', increment: 100 })
    expect(composite(dollar, 'ce').payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    const mixed = edited('craplessBubble', (input) => {
      const yo = input.catalog.yo
      if (yo?.family === 'oneRoll') yo.payoutRounding = { mode: 'halfUp', increment: 1 }
    })
    expect(() => factsFrom(mixed)).toThrow(/horn: the parts round their payouts differently/)
    const riding = edited('craplessBubble', (input) => {
      const e = input.catalog.e
      if (e?.family === 'oneRoll') e.afterWin = 'stay'
    })
    expect(() => factsFrom(riding)).toThrow(/ce: the parts disagree on afterWin/)
  })

  it('rejects a composite that loses only part of the bet', () => {
    const partial = edited('craplessBubble', (input) => {
      input.composites.lopsided = {
        label: 'Lopsided',
        parts: [
          { typeId: 'c', units: 1 },
          { typeId: 'e', units: 9 },
        ],
      }
    })
    expect(() => factsFrom(partial)).toThrow(/loses part/)
  })
})

describe('factsFrom: the working policy (rules spec §2.4, §5.1)', () => {
  it('reads each machine family', () => {
    const crapless = factsFrom(PRESETS.craplessBubble).working
    expect(crapless.toggle).toEqual({
      global: true,
      perBet: false,
      scope: 'untilChanged',
      types: ['place', 'buy', 'passOdds', 'comeOdds', 'hard'],
    })
    expect(crapless.autoOff).toBeNull()
    expect(crapless.newPlacedOff).toEqual({
      types: ['place', 'buy'],
      trigger: 'sevenOut',
      until: 'playerOn',
    })
    expect(crapless.oddsOffReturnedAtPointMade).toBe(true)
    expect(crapless.offBetsConsumeCredit).toBe(true)
    const stw = factsFrom(PRESETS.traditionalBubble).working
    expect(stw.autoOff).toEqual({
      carried: ['comeOdds', 'place', 'buy', 'hard', 'big'],
      newlyPlaced: ['comeOdds', 'place', 'buy', 'hard', 'big'],
    })
    expect([stw.newPlacedOff, stw.layAutoOn, stw.offBetsConsumeCredit]).toEqual([null, null, false])
    expect(factsFrom(PRESETS.strictBubble).working.layAutoOn).toEqual({
      afterPointMade: true,
      afterSeven: true,
    })
    expect(factsFrom(PRESETS.strictBubble).excludeLineVsLayBuy).toBe(true)
  })

  it('defaults the post-seven-out trigger to a seven-out (rules spec §9 #6)', () => {
    const withoutTrigger = edited('craplessBubble', (input) => {
      const rule = input.afterSevenOut.newPlacedOff as { trigger?: string } | null
      if (rule !== null) delete rule.trigger
    })
    expect(factsFrom(withoutTrigger).working.newPlacedOff?.trigger).toBe('sevenOut')
    const anySeven = edited('craplessBubble', (input) => {
      const rule = input.afterSevenOut.newPlacedOff as { trigger?: string } | null
      if (rule !== null) rule.trigger = 'anySeven'
    })
    expect(factsFrom(anySeven).working.newPlacedOff?.trigger).toBe('anySeven')
  })
})
