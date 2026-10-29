import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../config/compile.ts'
import { PRESETS, PRESET_IDS, craplessBubble } from '../config/presets/index.ts'
import type { PointNumber } from '../config/rulesets.ts'
import type { MachineConfigInput } from '../config/schema.ts'
import { cents } from '../core/money.ts'
import { initialRound } from '../round/round.ts'
import { newTable, type TableState } from '../table/state.ts'
import { lineFamily } from './families/line.ts'
import { oddsFamily } from './families/odds.ts'
import { maxOdds, oddsCap, typeLimits } from './limits.ts'
import {
  FAMILY_ORDER,
  betTypeOf,
  familyRank,
  requireType,
  resolveType,
  settlementOrder,
} from './registry.ts'
import { betId, betSeq, isRejection, roundingPointer, type BetInstance } from './types.ts'
import { canToggle, effectiveWorking } from './working.ts'

const crapless = compileConfig(PRESETS.craplessBubble)
const live = compileConfig(PRESETS.traditionalLive345)

/** The default machine with some of its input edited, under a new id. */
function craplessWith(id: string, edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(craplessBubble)
  input.id = id
  edit(input)
  return compileConfig(input)
}

function bet(
  typeId: string,
  number: PointNumber | null,
  seq: number,
  more: Partial<BetInstance> = {},
): BetInstance {
  return {
    id: betId(seq),
    typeId,
    number,
    parentId: null,
    amount: cents(1_000),
    vigHeld: cents(0),
    working: null,
    progress: 0,
    placedAtRoll: 0,
    ...more,
  }
}

function tableWith(cfg: MachineConfig, bets: BetInstance[], point: PointNumber | null): TableState {
  const round = initialRound()
  return {
    ...newTable(cfg, 'unit'),
    bets,
    nextBetSeq: bets.length + 1,
    round: point === null ? round : { ...round, phase: { kind: 'point', point } },
  }
}

function paths(cfg: MachineConfig, typeId: string, n: PointNumber | null): readonly string[] {
  const { family, type } = requireType(cfg, typeId)
  return family.configPaths(type, n, cfg)
}

describe('bet ids', () => {
  it('are b1, b2, … and parse back to their sequence', () => {
    expect(betId(1)).toBe('b1')
    expect(betSeq(betId(42))).toBe(42)
    expect(betSeq('b0')).toBeNaN()
    expect(betSeq('x7')).toBeNaN()
    expect(() => betId(0)).toThrow(RangeError)
    expect(() => betId(1.5)).toThrow(RangeError)
  })

  it('tell a rejection from a result', () => {
    expect(isRejection({ code: 'BAD_PARAMS', details: {} })).toBe(true)
    expect(isRejection({ existing: null, number: null, parentId: null })).toBe(false)
  })
})

describe('the registry', () => {
  it('runs families in the plan §4.8 order', () => {
    expect(FAMILY_ORDER.slice(0, 6)).toEqual([
      'line',
      'odds',
      'numberVsSeven',
      'hardway',
      'oneRoll',
      'composite',
    ])
    expect(familyRank('line')).toBeLessThan(familyRank('odds'))
  })

  it('resolves implemented types only', () => {
    expect(resolveType(crapless, 'pass')?.family).toBe(lineFamily)
    expect(resolveType(crapless, 'comeOdds')?.family).toBe(oddsFamily)
    expect(resolveType(crapless, 'nope')).toBeNull()
    expect(betTypeOf(crapless, 'nope')).toBeNull()
    expect(() => requireType(crapless, 'nope')).toThrow(/No implemented bet type "nope"/)
  })

  it('orders bets by family, then by placement number (b10 after b9)', () => {
    const bets = [bet('passOdds', 6, 2), bet('come', 6, 10), bet('pass', 6, 9)]
    const order = settlementOrder(bets, crapless).map(({ bet: b }) => b.id)
    expect(order).toEqual(['b9', 'b10', 'b2'])
  })
})

describe('limits', () => {
  it('fall back to the config limits for a type the config does not list', () => {
    expect(typeLimits(crapless, 'nope')).toEqual({ min: 100, max: 50_000, increment: 100 })
    expect(typeLimits(live, 'pass')).toEqual({ min: 1_000, max: 500_000, increment: 100 })
  })

  it('allow no odds behind a bet without a number, or a type without odds', () => {
    const { type } = requireType(crapless, 'passOdds')
    if (type.family !== 'odds') throw new Error('passOdds is not an odds type')
    expect(oddsCap(type, bet('pass', null, 1), crapless)).toBe(0)
    expect(maxOdds(bet('pass', 6, 1), crapless)).toBe(2_000)
    const noOdds = craplessWith('noOdds', (input) => {
      delete input.catalog.passOdds
      delete input.catalog.comeOdds
      input.workingToggle.types = ['place', 'buy', 'hard']
      for (const pointer of Object.keys(input.provenance)) {
        if (pointer.startsWith('/catalog/passOdds') || pointer.startsWith('/catalog/comeOdds')) {
          delete input.provenance[pointer]
        }
      }
    })
    expect(maxOdds(bet('pass', 6, 1), noOdds)).toBe(0)
  })
})

describe('config paths', () => {
  it('list what a line bet reads, with the money rounding when it has none of its own', () => {
    expect(paths(crapless, 'pass', null)).toEqual([
      '/rules/naturals',
      '/rules/craps',
      '/rules/points',
      '/catalog/pass/side',
      '/catalog/pass/window',
      '/catalog/pass/pays',
      '/catalog/pass/afterWin',
      '/money/payoutRounding',
    ])
    expect(paths(live, 'dontPass', null)).toContain('/rules/dontBar')
  })

  it("list the odds' own pay, cap and come-out default, and their own rounding when set", () => {
    const own = craplessWith('ownRounding', (input) => {
      const comeOdds = input.catalog.comeOdds
      if (comeOdds?.family !== 'odds') throw new Error('no come odds')
      comeOdds.payoutRounding = { mode: 'floor', increment: 5 }
    })
    expect(paths(own, 'comeOdds', 2)).toEqual([
      '/catalog/comeOdds/parent',
      '/catalog/comeOdds/pays/2',
      '/catalog/comeOdds/limit/basis',
      '/catalog/comeOdds/limit/multiple/2',
      '/catalog/comeOdds/comeOutDefault',
      '/comeOut/autoOff',
      '/oddsOffReturnedAtPointMade',
      '/catalog/comeOdds/payoutRounding',
      '/catalog/come/side',
    ])
    expect(roundingPointer(own, 'passOdds')).toBe('/money/payoutRounding')
    expect(paths(crapless, 'passOdds', null)).toContain('/catalog/passOdds/pays')
    expect(paths(crapless, 'passOdds', null)).not.toContain('/comeOut/autoOff')
  })

  it('name only values that exist in the config, for every type on every machine', () => {
    for (const id of PRESET_IDS) {
      const cfg = compileConfig(PRESETS[id])
      for (const typeId of [...cfg.catalog.keys(), ...cfg.composites.keys()]) {
        const type = resolveType(cfg, typeId)?.type
        if (type === undefined) continue
        const numbers =
          type.family === 'numberVsSeven' || type.family === 'hardway'
            ? type.numbers
            : type.family === 'line' || type.family === 'odds'
              ? cfg.ruleset.points
              : []
        for (const n of [null, ...numbers]) {
          for (const pointer of paths(cfg, typeId, n)) {
            const value = pointer
              .slice(1)
              .split('/')
              .reduce<unknown>(
                (at, key) => (at as Record<string, unknown> | null)?.[key],
                cfg.input,
              )
            expect(value, `${cfg.id} ${typeId} ${String(n)} ${pointer}`).not.toBeUndefined()
          }
        }
      }
    }
  })
})

describe('working status', () => {
  it('line bets always work, whatever the toggles say', () => {
    const state = {
      ...tableWith(live, [bet('pass', 6, 1, { working: false })], 6),
      globalOff: true,
    }
    expect(effectiveWorking(state.bets[0]!, state, live)).toBe(true)
    expect(canToggle(state.bets[0]!, state, live)).toBe(false)
  })

  it('a per-bet toggle beats the global button; the button covers only its own types', () => {
    const pass = bet('pass', 6, 1)
    const odds = bet('passOdds', 6, 2, { parentId: pass.id })
    const state = { ...tableWith(crapless, [pass, odds], 6), globalOff: true }
    expect(effectiveWorking(odds, state, crapless)).toBe(false)
    expect(effectiveWorking({ ...odds, working: true }, state, crapless)).toBe(true)
    const narrow = craplessWith('narrowToggle', (input) => {
      input.workingToggle.types = ['place']
    })
    expect(effectiveWorking(odds, { ...state, configHash: narrow.configHash }, narrow)).toBe(true)
  })
})
