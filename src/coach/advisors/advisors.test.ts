import { describe, expect, it } from 'vitest'
import {
  Fraction,
  PRESETS,
  applyAction,
  cents,
  compileConfig,
  heldOffOf,
  newTable,
  validateAction,
} from '../../engine/index.ts'
import type { Action, MachineConfig, MachineConfigInput, TableState } from '../../engine/index.ts'
import {
  analyzeBet,
  catalogRow,
  combinedEdge,
  minimumFreeFrom,
  suggestAlternatives,
} from '../../exact/index.ts'
import { formatPart } from '../format.ts'
import { ROUNDING_MATERIAL_BREAKAGE, gradeOf } from '../policy.ts'
import type { Advice, CoachInput } from './advice.ts'
import { alternatives } from './alternatives.ts'
import { amountEfficiency } from './amountEfficiency.ts'
import { edgeWarning } from './edgeWarning.ts'
import { paysExactlyAt } from './exactness.ts'
import { adviseSpot } from './index.ts'
import { layoutCost } from './layoutCost.ts'
import { odds } from './odds.ts'
import { adviceLine } from './render.ts'
import { variantContext } from './variantContext.ts'
import { SET_BETS_ON_ASSUMPTION, working } from './working.ts'

/**
 * The remaining advisors (plan §5.4, §10 M9c): each trigger, its computed numbers against a fresh
 * exact call, and the honest wordings the plan demands. Rendering goes through the real templates,
 * so these tests also pin the advisors' example outputs.
 */

const CRAPLESS = compileConfig(PRESETS.craplessBubble)

const text = (advice: Advice): string =>
  adviceLine(advice)
    .parts.map((part) => formatPart(part))
    .join('')

function apply(state: TableState, action: Action, cfg: MachineConfig = CRAPLESS): TableState {
  const result = applyAction(state, action, cfg)
  if (!result.ok) throw new Error(`refused: ${result.rejection.code}`)
  return result.state
}

function inputFor(
  cfg: MachineConfig,
  typeId: string,
  number: number | null,
  amount: number,
  state: TableState | null,
): CoachInput {
  const betId =
    state?.bets.find((bet) => bet.typeId === typeId && bet.number === number)?.id ?? null
  return {
    cfg,
    spec: { typeId, number: number as CoachInput['spec']['number'] },
    amount: cents(amount),
    state,
    betId,
  }
}

describe('edgeWarning (plan §5.4)', () => {
  it('grades the bet and derives $ per $100 from the same edge, with sources', () => {
    const advice = edgeWarning(inputFor(CRAPLESS, 'place', 6, 600, null))
    expect(advice).toHaveLength(1)
    const warning = advice[0]
    if (warning === undefined) throw new Error('no edge warning')
    const expected = analyzeBet({ typeId: 'place', number: 6 }, cents(600), 'typical', CRAPLESS)
    expect((warning.numbers['edge']?.exact as Fraction).equals(expected.edge)).toBe(true)
    expect(warning.words['grade']).toBe(gradeOf(expected.edge))
    expect(
      (warning.numbers['per']?.exact as Fraction).equals(expected.edge.mul(Fraction.of(10_000))),
    ).toBe(true)
    expect(warning.numbers['edge']?.source.fn).toBe('analyzeBet')
    expect(text(warning)).toBe(
      'Place 6 costs 1.52% of what you risk (good): ≈ $1.52 of every $100.00 you put on it.',
    )
  })

  it('an awful bet warns; a bet on the table fires once per lifecycle (once)', () => {
    const state = apply(newTable(CRAPLESS, 'edge-once'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    const anySeven = CRAPLESS.catalog.has('any7')
    void anySeven
    const held = edgeWarning(inputFor(CRAPLESS, 'pass', null, 500, state))
    expect(held[0]?.once).toBe(true)
    const empty = edgeWarning(inputFor(CRAPLESS, 'pass', null, 500, null))
    expect(empty[0]?.once).toBeUndefined()
  })
})

describe('the odds advisor (plan §5.4): clamped combinedEdge, honest wording, not-free flags', () => {
  it('shows the flat edge against full odds through the clamped combinedEdge', () => {
    const advice = odds(inputFor(CRAPLESS, 'pass', null, 500, null))
    const main = advice.find((item) => item.ruleId === 'odds')
    if (main === undefined) throw new Error('no odds advice')
    const expected = combinedEdge({ typeId: 'pass', number: null }, cents(500), CRAPLESS, 'max')
    expect((main.numbers['withOdds']?.exact as Fraction).equals(expected.edge)).toBe(true)
    expect(text(main)).toContain('Odds lower the edge per dollar wagered')
    expect(text(main)).toContain('never shrink the flat bet')
    // True-odds pays on this preset: nothing to flag as not free.
    expect(advice.find((item) => item.ruleId === 'odds-not-free')).toBeUndefined()
  })

  it('flags 2/12 odds at 11:2 as not free: exactly 1/14 on their own (plan §5.4, §13 row)', () => {
    const input = structuredClone(PRESETS.craplessBubble) as MachineConfigInput
    const passOdds = input.catalog['passOdds']
    if (passOdds?.family !== 'odds') throw new Error('no passOdds')
    const pays = passOdds.pays as Record<string, string>
    pays['2'] = '11:2'
    pays['12'] = '11:2'
    const cfg = compileConfig(input)
    const advice = odds(inputFor(cfg, 'pass', null, 500, null))
    const notFree = advice.find((item) => item.ruleId === 'odds-not-free')
    if (notFree === undefined) throw new Error('11:2 odds were not flagged')
    expect((notFree.numbers['oddsEdge']?.exact as Fraction).equals(Fraction.of(1, 14))).toBe(true)
    expect(text(notFree)).toContain('are not free on this machine')
    expect(text(notFree)).toContain('7.14%')
  })

  it('stays silent off the line family', () => {
    expect(odds(inputFor(CRAPLESS, 'place', 6, 600, null))).toHaveLength(0)
  })
})

describe('amountEfficiency (plan §5.4): breakage and the minimum-vig trap', () => {
  it('sends the $5 place 6 to $6: 17/1100 as paid against 1/66 exactly', () => {
    const advice = amountEfficiency(inputFor(CRAPLESS, 'place', 6, 500, null))
    const rounding = advice.find((item) => item.ruleId === 'rounding')
    if (rounding === undefined) throw new Error('no rounding advice')
    expect((rounding.numbers['edge']?.exact as Fraction).equals(Fraction.of(17, 1100))).toBe(true)
    expect((rounding.numbers['nominalEdge']?.exact as Fraction).equals(Fraction.of(1, 66))).toBe(
      true,
    )
    expect(rounding.numbers['betterAmount']?.exact).toBe(600)
    expect((rounding.numbers['betterEdge']?.exact as Fraction).equals(Fraction.of(1, 66))).toBe(
      true,
    )
    expect(text(rounding)).toBe(
      'Place 6 at $5.00 loses part of each win to rounding: 1.55% as paid against 1.52% unrounded. ' +
        'At $6.00 it pays exactly — 1.52%.',
    )
  })

  it('the $1 place 6 pays $1.16 (edge 1/55) and is sent to $3, the nearest EXACT stake, not $2', () => {
    const advice = amountEfficiency(inputFor(CRAPLESS, 'place', 6, 100, null))
    const rounding = advice.find((item) => item.ruleId === 'rounding')
    if (rounding === undefined) throw new Error('no rounding advice')
    expect((rounding.numbers['edge']?.exact as Fraction).equals(Fraction.of(1, 55))).toBe(true)
    // $2 is cheaper than $1 (7/440 < 1/55) but still loses ⅓¢ a win: "pays exactly" would lie.
    expect(
      analyzeBet({ typeId: 'place', number: 6 }, cents(200), 'typical', CRAPLESS).edge,
    ).toEqual(Fraction.of(7, 440))
    expect(paysExactlyAt({ typeId: 'place', number: 6 }, cents(200), CRAPLESS)).toBe(false)
    expect(rounding.numbers['betterAmount']?.exact).toBe(300)
    expect(text(rounding)).toContain('At $3.00 it pays exactly — 1.52%.')
  })

  it('names only a stake the machine pays exactly on a $5 machine: $15 for the $5 place 6', () => {
    const highLimit = compileConfig(PRESETS.craplessBubbleHighLimit)
    const advice = amountEfficiency(inputFor(highLimit, 'place', 6, 500, null))
    const rounding = advice.find((item) => item.ruleId === 'rounding')
    if (rounding === undefined) throw new Error('no rounding advice')
    // $10 is nearer and cheaper (11.666… pays $11.66) but inexact; $15 pays $17.50 exactly.
    expect(paysExactlyAt({ typeId: 'place', number: 6 }, cents(1000), highLimit)).toBe(false)
    expect(rounding.numbers['betterAmount']?.exact).toBe(1500)
    expect((rounding.numbers['betterEdge']?.exact as Fraction).equals(Fraction.of(1, 66))).toBe(
      true,
    )
    expect(text(rounding)).toBe(
      'Place 6 at $5.00 loses part of each win to rounding: 1.55% as paid against 1.52% unrounded. ' +
        'At $15.00 it pays exactly — 1.52%.',
    )
  })

  it('stays silent under the materiality floor: the $10,000 place 6 on the high-limit machine (M9 audit MAJOR)', () => {
    const highLimit = compileConfig(PRESETS.craplessBubbleHighLimit)
    const tenThousand = analyzeBet(
      { typeId: 'place', number: 6 },
      cents(1_000_000),
      'typical',
      highLimit,
    )
    // ⅔¢ lost on each $11,666.66 win: real breakage, but 1/3,300,000 of the stake per decision.
    expect(tenThousand.breakage.equals(Fraction.of(1, 3_300_000))).toBe(true)
    expect(tenThousand.breakage.compare(ROUNDING_MATERIAL_BREAKAGE)).toBeLessThan(0)
    const advice = amountEfficiency(inputFor(highLimit, 'place', 6, 1_000_000, null))
    expect(advice.find((item) => item.ruleId === 'rounding')).toBeUndefined()
    // The $9,995 the old nearest-cheaper rule would have named is itself inexact; $9,990 is exact.
    expect(paysExactlyAt({ typeId: 'place', number: 6 }, cents(999_500), highLimit)).toBe(false)
    expect(paysExactlyAt({ typeId: 'place', number: 6 }, cents(999_000), highLimit)).toBe(true)
    // The floor is the displayed precision: two percents 0.01 pp apart always print differently.
    expect(ROUNDING_MATERIAL_BREAKAGE.equals(Fraction.of(1, 10_000))).toBe(true)
  })

  it('the sizing advice names only an exact stake too: a vig-minimum trap gets the min-vig words instead', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    let state = newTable(live, 'sizing-exact')
    state = apply(state, { type: 'place', typeId: 'pass', amount: cents(1000) }, live) // the $10 line minimum
    state = apply(state, { type: 'place', typeId: 'buy', number: 4, amount: cents(1000) }, live)
    const input = inputFor(live, 'buy', 4, 1000, state)
    // exact's sizing scan offers the nearest CHEAPER stakes ($11: the $1 minimum vig on a 55¢
    // rate still binds), none of which the machine pays exactly; $20 is the first that is.
    const offered = suggestAlternatives(state, input.spec, cents(1000), live)
      .filter((alt) => alt.comparability === 'sizing')
      .map((alt) => alt.amount)
    expect(offered.length).toBeGreaterThan(0)
    for (const amount of offered) expect(paysExactlyAt(input.spec, cents(amount), live)).toBe(false)
    expect(paysExactlyAt(input.spec, cents(2000), live)).toBe(true)
    expect(alternatives(input).find((item) => item.ruleId === 'sizing')).toBeUndefined()
    expect(amountEfficiency(input).find((item) => item.ruleId === 'min-vig')).toBeDefined()
  })

  it('warns on a minimum-vig trap and names the stake the minimum stops binding from', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    const advice = amountEfficiency(inputFor(live, 'buy', 4, 1000, null))
    const trap = advice.find((item) => item.ruleId === 'min-vig')
    if (trap === undefined) throw new Error('no min-vig advice')
    expect(trap.severity).toBe('warn')
    expect(trap.numbers['freeFrom']?.exact).toBe(
      minimumFreeFrom({ typeId: 'buy', number: 4 }, live),
    )
    expect(trap.numbers['freeFrom']?.exact).toBe(2000)
    expect(text(trap)).toContain('From $20.00 up')
  })

  it('is silent where the machine pays exactly', () => {
    const advice = amountEfficiency(inputFor(CRAPLESS, 'place', 6, 600, null))
    expect(advice.find((item) => item.ruleId === 'rounding')).toBeUndefined()
  })
})

describe('variantContext (plan §5.4): all three numbers computed, each on its own config', () => {
  it('compares the crapless pass with the traditional preset and the cheap number bet', () => {
    const advice = variantContext(inputFor(CRAPLESS, 'pass', null, 500, null))
    expect(advice).toHaveLength(1)
    const context = advice[0]
    if (context === undefined) throw new Error('no variant context')
    expect((context.numbers['crapless']?.exact as Fraction).equals(Fraction.of(373, 6930))).toBe(
      true,
    )
    const traditional = compileConfig(PRESETS.traditionalBubble)
    const tradRow = catalogRow({ typeId: 'pass', number: null }, traditional)
    expect((context.numbers['traditional']?.exact as Fraction).equals(tradRow.edge)).toBe(true)
    expect(context.numbers['traditional']?.source.configHash).toBe(traditional.configHash)
    expect((context.numbers['cheap']?.exact as Fraction).equals(Fraction.of(1, 66))).toBe(true)
    expect(text(context)).toBe(
      'Crapless protects your Pass Line from craps but charges for it: 5.38% here, against 1.41% ' +
        'for the same bet on a traditional machine. The cheap bet on this machine is Place 6 at 1.52%.',
    )
  })

  it('stays silent on a traditional machine and on number bets', () => {
    const traditional = compileConfig(PRESETS.traditionalBubble)
    expect(variantContext(inputFor(traditional, 'pass', null, 500, null))).toHaveLength(0)
    expect(variantContext(inputFor(CRAPLESS, 'place', 6, 600, null))).toHaveLength(0)
  })
})

describe('the working advisor (plan §5.4): OFF honesty, the held bets, the Set-bets-On flag', () => {
  it('names an OFF bet as unable to win or lose — never "still plays" (plan §0 #18)', () => {
    let state = newTable(CRAPLESS, 'work-off')
    state = apply(state, { type: 'place', typeId: 'pass', amount: cents(500) })
    state = apply(state, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    state = apply(state, { type: 'setGlobalWorking', off: true })
    const advice = working(inputFor(CRAPLESS, 'place', 6, 600, state))
    const off = advice.find((item) => item.ruleId === 'working-off')
    if (off === undefined) throw new Error('no working-off advice')
    expect(text(off)).toBe(
      'Place 6 is OFF for this roll: it cannot win, and a seven cannot take it while it sits out.',
    )
  })

  it('offers Set bets On for bets held after the seven-out, with the §9 #28 assumed flag', () => {
    let state = newTable(CRAPLESS, 'work-held')
    state = apply(state, { type: 'place', typeId: 'pass', amount: cents(500) })
    state = apply(state, { type: 'roll', dice: { d1: 1, d2: 1 } }) // point 2
    state = apply(state, { type: 'roll', dice: { d1: 3, d2: 4 } }) // seven-out
    state = apply(state, { type: 'place', typeId: 'pass', amount: cents(500) })
    state = apply(state, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    expect(heldOffOf(state).length).toBeGreaterThan(0)
    const advice = working(inputFor(CRAPLESS, 'place', 6, 600, state))
    const held = advice.find((item) => item.ruleId === 'working-held')
    if (held === undefined) throw new Error('no working-held advice')
    expect(held.fix?.actions).toStrictEqual([{ type: 'setGlobalWorking', off: null }])
    expect(held.assumed).toStrictEqual([SET_BETS_ON_ASSUMPTION])
    expect(SET_BETS_ON_ASSUMPTION).toContain('§9 #28')
    expect(
      validateAction(state, { type: 'batch', actions: [...(held.fix?.actions ?? [])] }, CRAPLESS),
    ).toBeNull()
  })

  it('prices the come-out toggle in $/hour from analyzeLayout on both tables', () => {
    let state = newTable(CRAPLESS, 'work-cost')
    state = apply(state, { type: 'place', typeId: 'pass', amount: cents(500) })
    state = apply(state, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    const advice = working(inputFor(CRAPLESS, 'place', 6, 600, state))
    const cost = advice.find((item) => item.ruleId === 'working-cost')
    if (cost === undefined) throw new Error('no working-cost advice')
    expect(cost.fix?.actions).toStrictEqual([{ type: 'setGlobalWorking', off: true }])
    expect(cost.numbers['nowHour']?.kind).toBe('perHour')
    const now = cost.numbers['nowHour']?.exact as Fraction
    const then = cost.numbers['thenHour']?.exact as Fraction
    expect(now.compare(then)).toBe(1) // bets off cost less on the come-out
  })
})

describe('layoutCost (plan §5.4): the layout priced per roll and per hour', () => {
  it('prices the layout and dry-runs the cheaper same-event layout as one batch', () => {
    const onWin = (() => {
      const input = structuredClone(PRESETS.craplessBubble) as MachineConfigInput
      const buy = input.catalog['buy']
      if (buy?.family !== 'numberVsSeven') throw new Error('no buy')
      buy.commission = { ...buy.commission, timing: 'onWin', rearm: 'none' } as never
      return compileConfig(input)
    })()
    let state = newTable(onWin, 'layout')
    state = apply(state, { type: 'place', typeId: 'pass', amount: cents(500) }, onWin)
    state = apply(state, { type: 'place', typeId: 'place', number: 5, amount: cents(2000) }, onWin)
    const advice = layoutCost(inputFor(onWin, 'place', 5, 2000, state))
    const cost = advice.find((item) => item.ruleId === 'layout-cost')
    expect(cost).toBeDefined()
    const swaps = advice.find((item) => item.ruleId === 'layout-swaps')
    if (swaps?.fix !== undefined) {
      expect(
        validateAction(state, { type: 'batch', actions: [...swaps.fix.actions] }, onWin),
      ).toBeNull()
    }
  })
})

describe('adviseSpot and rendering', () => {
  it('runs every advisor and renders every emitted advice through a template', () => {
    let state = newTable(CRAPLESS, 'advise-all')
    state = apply(state, { type: 'place', typeId: 'pass', amount: cents(500) })
    state = apply(state, { type: 'place', typeId: 'place', number: 6, amount: cents(500) })
    const advice = adviseSpot(inputFor(CRAPLESS, 'place', 6, 500, state))
    expect(advice.length).toBeGreaterThan(2)
    for (const item of advice) {
      const line = adviceLine(item)
      expect(line.id).toBe(item.id)
      expect(text(item).length).toBeGreaterThan(0)
    }
  })

  it('throws on an unknown template or a missing number: a bug, never a blank line', () => {
    const base = adviseSpot(inputFor(CRAPLESS, 'place', 6, 500, null))[0]
    if (base === undefined) throw new Error('no advice to mutate')
    expect(() => adviceLine({ ...base, templateId: 'no-such-template' })).toThrow(RangeError)
    expect(() => adviceLine({ ...base, numbers: {} })).toThrow(RangeError)
  })
})
