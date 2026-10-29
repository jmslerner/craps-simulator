import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/index.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { analyze } from './closedForm.ts'
import { closedFormOf, machineBets, type MachineBet } from './closedFormOf.ts'
import {
  buildChain,
  dispatchAnalysis,
  dispatchVariant,
  startTable,
  type DispatchBet,
} from './dispatchChain.ts'
import { factsFrom, typeFacts, type MachineFacts } from './machineFacts.ts'

const same = (actual: Fraction | undefined, expected: string) =>
  expect(actual?.toString()).toBe(expected)

/** A preset loosened for dispatch (1¢ steps, no minimum total), compiled, with its facts. */
function machine(id: PresetId, edit: (input: MachineConfigInput) => void = () => undefined) {
  const input = dispatchVariant(PRESETS[id])
  edit(input)
  return { cfg: compileConfig(input), facts: factsFrom(input) }
}

const crapless = machine('craplessBubble')
const stw = machine('traditionalBubble')
const strict = machine('strictBubble')
const live = machine('traditionalLive345')

const lifetime = (cfg: MachineConfig, bet: DispatchBet) => dispatchAnalysis(cfg, bet, 'lifetime')
const decision = (cfg: MachineConfig, bet: DispatchBet) => dispatchAnalysis(cfg, bet, 'decision')
const edgeOf = (cfg: MachineConfig, bet: DispatchBet) => lifetime(cfg, bet).edge.toString()

/** Where a bet of the machine goes on a dispatch table: its window and, for odds, its parent. */
function dispatchSpec(facts: MachineFacts, bet: MachineBet): DispatchBet {
  const type = typeFacts(facts, bet.typeId)
  const awayFrom = (n: number | null) => (n === 6 ? 8 : 6)
  if (type.family === 'line') {
    return type.window === 'point'
      ? { typeId: bet.typeId, amount: bet.amount, point: 6 }
      : { typeId: bet.typeId, amount: bet.amount }
  }
  if (type.family === 'odds') {
    const parent = typeFacts(facts, type.parent)
    const number = bet.number ?? 0
    return {
      typeId: bet.typeId,
      amount: bet.amount,
      parent: { typeId: parent.id, amount: bet.amount, number },
      point: parent.family === 'line' && parent.window === 'point' ? awayFrom(number) : null,
    }
  }
  return bet.number === null
    ? { typeId: bet.typeId, amount: bet.amount }
    : { typeId: bet.typeId, number: bet.number, amount: bet.amount }
}

describe('dispatchVariant (M4 → M6 hand-off)', () => {
  it('takes 1¢ steps, has no minimum total and a deep bankroll; it still compiles', () => {
    const input = dispatchVariant(PRESETS.traditionalLive345)
    expect(input.money.betIncrement).toBe(1)
    expect(input.limits.min).toBe(1)
    expect(input.limits.minTotal).toBeNull()
    expect(input.limits.perType?.pass).toEqual({})
    expect(input.limits.perType?.passOdds).toEqual({ max: 2_500_000 })
    expect(Object.keys(input.provenance).some((p) => p.startsWith('/limits/minTotal/'))).toBe(false)
    expect(() => compileConfig(input)).not.toThrow()
    expect(PRESETS.traditionalLive345.money.betIncrement).toBe(100) // the preset is untouched
  })

  it('places a 101¢ bet alone, or odds behind their parent, after the rolls its window needs', () => {
    const place = startTable(crapless.cfg, { typeId: 'place', number: 6, amount: 101 })
    expect(place.table.bets.map((b) => [b.typeId, b.amount])).toEqual([['place', 101]])
    expect(place.placementCost).toBe(101)
    const buy = startTable(crapless.cfg, { typeId: 'buy', number: 4, amount: 2_000 })
    expect([buy.placementCost, buy.placementVig]).toEqual([2_100, 100])
    const comeOdds = startTable(crapless.cfg, {
      typeId: 'comeOdds',
      amount: 2_000,
      point: 4,
      parent: { typeId: 'come', amount: 1_000, number: 6 },
    })
    expect(comeOdds.table.round.phase).toEqual({ kind: 'point', point: 4 })
    expect(comeOdds.table.bets.map((b) => `${b.typeId}@${b.number}`)).toEqual([
      'come@6',
      'comeOdds@6',
    ])
  })
})

describe('published values through the reducer (plan §9 item 5)', () => {
  it('crapless pass: 373/6930, 6557/13860 to win, 9613/2310 rolls, 373/28839 per roll', () => {
    const pass = { typeId: 'pass', amount: 1_000 }
    same(lifetime(crapless.cfg, pass).edge, '373/6930')
    const once = decision(crapless.cfg, pass)
    same(once.outcomes.get('win'), '6557/13860')
    same(once.outcomes.get('lose'), '7303/13860')
    same(once.expectedRolls, '9613/2310')
    same(once.edge, '373/6930')
    same(once.edgePerWorkingRoll, '373/28839')
    // A pass bet left up loses only at a seven-out: it lasts a hand.
    same(lifetime(crapless.cfg, pass).expectedRolls, '57678/7303')
    same(edgeOf(crapless.cfg, { typeId: 'come', amount: 1_000, point: 4 }) as never, '373/6930')
  })

  it("traditional pass 7/495 in 557/165 rolls; don't pass bar 12 3/220", () => {
    const pass = decision(stw.cfg, { typeId: 'pass', amount: 1_000 })
    same(pass.edge, '7/495')
    same(pass.expectedRolls, '557/165')
    same(pass.edgePerWorkingRoll, '7/1671')
    expect(edgeOf(stw.cfg, { typeId: 'pass', amount: 1_000 })).toBe('7/495')
    expect(edgeOf(stw.cfg, { typeId: 'come', amount: 1_000, point: 6 })).toBe('7/495')
    for (const m of [stw, strict, live]) {
      expect(edgeOf(m.cfg, { typeId: 'dontPass', amount: 1_000 })).toBe('3/220')
      same(decision(m.cfg, { typeId: 'dontPass', amount: 1_000 }).outcomes.get('push'), '1/36')
    }
    expect(edgeOf(stw.cfg, { typeId: 'dontCome', amount: 1_000, point: 6 })).toBe('3/220')
  })

  it('place bets: 1/15, 1/25, 1/66 and crapless 1/14, 1/16; place 6 is 1/216 per roll', () => {
    const place = (number: number, amount: number) => ({ typeId: 'place', number, amount })
    expect(
      [
        place(4, 500),
        place(10, 500),
        place(5, 500),
        place(9, 500),
        place(6, 600),
        place(8, 600),
        place(2, 200),
        place(12, 200),
        place(3, 400),
        place(11, 400),
      ].map((bet) => edgeOf(crapless.cfg, bet)),
    ).toEqual(['1/15', '1/15', '1/25', '1/25', '1/66', '1/66', '1/14', '1/14', '1/16', '1/16'])
    const six = decision(crapless.cfg, place(6, 600))
    same(six.outcomes.get('win'), '5/11')
    same(six.expectedWorkingRolls, '36/11')
    same(lifetime(crapless.cfg, place(6, 600)).edgePerWorkingRoll, '1/216')
    // At the penny floor: $5 pays $5.83 (17/1100), $1 pays $1.16 (1/55).
    expect([edgeOf(crapless.cfg, place(6, 500)), edgeOf(crapless.cfg, place(6, 100))]).toEqual([
      '17/1100',
      '1/55',
    ])
    // Shoot To Win place: OFF on the come-out, the same price per decision.
    expect(edgeOf(stw.cfg, place(6, 600))).toBe('1/66')
    same(lifetime(stw.cfg, place(6, 600)).expectedWorkingRolls, '6')
  })

  it('buy: 5% of the stake on the win 1/60, 1/50, 1/44; upfront 1/21, or 1/31 if never again', () => {
    const buy = (number: number) => ({ typeId: 'buy', number, amount: 2_000 })
    expect([4, 5, 6].map((n) => edgeOf(stw.cfg, buy(n)))).toEqual(['1/60', '1/50', '1/44'])
    expect([4, 5, 6, 2, 3].map((n) => edgeOf(crapless.cfg, buy(n)))).toEqual([
      '1/21',
      '1/21',
      '1/21',
      '1/21',
      '1/21',
    ])
    const once = machine('craplessBubble', (input) => {
      const type = input.catalog.buy
      if (type?.family === 'numberVsSeven' && type.commission) type.commission.rearm = 'none'
    })
    expect([4, 5, 6].map((n) => edgeOf(once.cfg, buy(n)))).toEqual(['1/31', '3/103', '3/113'])
    const fromCredit = machine('craplessBubble', (input) => {
      const type = input.catalog.buy
      if (type?.family === 'numberVsSeven' && type.commission) {
        type.commission.rearm = 'recollectFromCredit'
      }
    })
    expect(edgeOf(fromCredit.cfg, buy(4))).toBe('1/21')
    // The re-collection belongs to the next decision: the first one alone is also 1/21.
    same(decision(crapless.cfg, buy(4)).edge, '1/21')
  })

  it('lay: 5% of the win on the win 1/60, 1/50, 1/44; up front and re-collected 1/41, 1/31, 1/25', () => {
    const lays: [number, number][] = [
      [4, 4_000],
      [5, 3_000],
      [6, 2_400],
    ]
    expect(lays.map(([n, amount]) => edgeOf(stw.cfg, { typeId: 'lay', number: n, amount }))).toEqual(
      ['1/60', '1/50', '1/44'],
    )
    expect(
      lays.map(([n, amount]) => edgeOf(strict.cfg, { typeId: 'lay', number: n, amount })),
    ).toEqual(['1/41', '1/31', '1/25'])
  })

  it('field, hardways, big 6/8 and props', () => {
    const one = (typeId: string, amount = 500) => ({ typeId, amount })
    expect(edgeOf(crapless.cfg, one('field'))).toBe('1/18')
    expect(edgeOf(live.cfg, one('field'))).toBe('1/36')
    const hard = (number: number) => ({ typeId: 'hard', number, amount: 500 })
    expect([4, 10, 6, 8].map((n) => edgeOf(crapless.cfg, hard(n)))).toEqual([
      '1/9',
      '1/9',
      '1/11',
      '1/11',
    ])
    expect(edgeOf(stw.cfg, { typeId: 'big', number: 6, amount: 500 })).toBe('1/11')
    expect(
      ['any7', 'anyCraps', 'yo', 'snakeEyes'].map((id) => edgeOf(crapless.cfg, one(id))),
    ).toEqual(['1/6', '1/9', '1/9', '5/36'])
    expect(edgeOf(crapless.cfg, one('horn', 400))).toBe('1/8')
    // "15 for 1" on the yo and "30 for 1" on the 2 are 1/6.
    const forOne = machine('craplessBubble', (input) => {
      const yo = input.catalog.yo
      const two = input.catalog.snakeEyes
      if (yo?.family === 'oneRoll') yo.pays = { '11': '15 for 1' }
      if (two?.family === 'oneRoll') two.pays = { '2': '30 for 1' }
    })
    expect(['yo', 'snakeEyes'].map((id) => edgeOf(forOne.cfg, one(id)))).toEqual(['1/6', '1/6'])
  })

  it('odds: free at true odds, 1/14 on 2/12 short-paid at 11:2; OFF come odds come back', () => {
    const passOdds = (number: number, amount = 600) => ({
      typeId: 'passOdds',
      amount,
      parent: { typeId: 'pass', amount, number },
    })
    expect([2, 3, 4, 5, 6].map((n) => edgeOf(crapless.cfg, passOdds(n)))).toEqual([
      '0',
      '0',
      '0',
      '0',
      '0',
    ])
    const short = machine('craplessBubble', (input) => {
      const odds = input.catalog.passOdds
      if (odds?.family === 'odds') odds.pays = { ...odds.pays, '2': '11:2', '12': '11:2' }
    })
    expect(edgeOf(short.cfg, passOdds(2, 200))).toBe('1/14')
    const comeOdds = decision(crapless.cfg, {
      typeId: 'comeOdds',
      amount: 2_000,
      point: 4,
      parent: { typeId: 'come', amount: 1_000, number: 6 },
    })
    same(comeOdds.edge, '0')
    expect(comeOdds.outcomes.get('push')?.isZero()).toBe(false)
    same(
      [...comeOdds.outcomes.values()].reduce((sum, p) => sum.add(p), Fraction.ZERO),
      '1',
    )
  })
})

describe('the chain itself', () => {
  it('tracks the phase, the point and the bet: 11 states for a crapless place bet', () => {
    const chain = buildChain(crapless.cfg, { typeId: 'place', number: 6, amount: 600 }, 'decision')
    expect(chain.tables.length).toBe(11)
    for (const out of chain.transitions) {
      same(
        out.reduce((sum, t) => sum.add(t.p), Fraction.ZERO),
        '1',
      )
      expect(out.length).toBe(36)
    }
  })
})

/**
 * The closed form and the reducer, bet by bet (plan §9 items 3 and 4): for each offered bet at
 * each stake, the lifecycle edge, loss, amount risked and edge per working roll, and the first
 * decision's chances and working rolls, must agree exactly. tests/slow runs every preset at every
 * stake of plan §9 item 4; this is the quick subset.
 */
export function crossCheck(id: PresetId, stakes: readonly number[], filter = (_: MachineBet) => true) {
  const { cfg, facts } = machine(id)
  const mismatches: string[] = []
  let checked = 0
  for (const stake of stakes) {
    for (const bet of machineBets(facts, stake).filter(filter)) {
      const cf = closedFormOf(facts, bet)
      if (cf === null) continue
      checked++
      const closed = analyze(cf)
      const spec = dispatchSpec(facts, bet)
      const life = dispatchAnalysis(cfg, spec, 'lifetime')
      const once = dispatchAnalysis(cfg, spec, 'decision')
      const pairs: [string, Fraction, Fraction][] = [
        ['edge', life.edge, closed.edge],
        ['loss', life.loss, closed.loss],
        ['risked', life.risked, closed.risked],
        ['edgePerWorkingRoll', life.edgePerWorkingRoll, closed.edgePerWorkingRoll],
        ['pWin', once.outcomes.get('win') ?? Fraction.ZERO, closed.pWin],
        ['pLose', once.outcomes.get('lose') ?? Fraction.ZERO, closed.pLose],
        ['pPush', once.outcomes.get('push') ?? Fraction.ZERO, closed.pPush],
        ['workingRolls', once.expectedWorkingRolls, closed.workingRollsPerDecision],
        ['decisionLoss', once.loss, closed.perDecision.loss],
      ]
      for (const [what, engine, oracle] of pairs) {
        if (!engine.equals(oracle)) {
          mismatches.push(`${id} ${bet.typeId}@${bet.number ?? '-'} ${stake}¢ ${what}: engine ${engine} closed ${oracle}`)
        }
      }
    }
  }
  return { mismatches, checked }
}

describe('the reducer against the closed form (quick subset)', () => {
  it.each(PRESET_IDS)('%s: every offered bet at 101¢ and 600¢', (id) => {
    const { mismatches, checked } = crossCheck(id, [101, 600])
    expect(mismatches).toEqual([])
    expect(checked).toBeGreaterThan(40)
  })
})
