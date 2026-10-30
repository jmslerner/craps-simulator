import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../engine/config/presets/index.ts'
import { pruneProvenance } from '../engine/config/provenance.ts'
import type { MachineConfigInput, RoundingRule } from '../engine/config/schema.ts'
import { distribution } from './price.ts'
import { HIGH_EDGE, PLAYER_ADVANTAGE, PLAYER_EVEN, sanityCheck, sweepAmounts } from './sanity.ts'
import { typicalStart } from './start.ts'

function variant(id: PresetId, edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  input.provenance = pruneProvenance(input)
  return compileConfig(input)
}

/** Shoot To Win with its don't odds rounded by `rounding` (rules spec §4.2's warning). */
function wrongWay(typeId: 'dontPassOdds' | 'dontComeOdds', rounding: RoundingRule): MachineConfig {
  return variant('traditionalBubble', (input) => {
    const odds = input.catalog[typeId]
    if (odds?.family !== 'odds') throw new Error(`no ${typeId}`)
    odds.payoutRounding = rounding
  })
}

const summary = (cfg: MachineConfig) =>
  sanityCheck(cfg).map(({ severity, code, spec, amount, edge }) =>
    [severity, code, spec.typeId, spec.number, amount, edge?.toString() ?? '']
      .map(String)
      .join(' '),
  )

describe('sanityCheck', () => {
  it.each(PRESET_IDS)('finds nothing implausible on %s', (id) => {
    expect(summary(compileConfig(PRESETS[id]))).toEqual([])
  })

  it('rejects rounding a wrong-way payout up: lay odds at 5:6 and 2:3 favour the player', () => {
    // $1 lay odds on 6 rounded up to 84¢: player +0.364% (1/275); on 5, 67¢: +0.2% (1/500).
    expect(summary(wrongWay('dontPassOdds', { mode: 'ceil', increment: 1 }))).toEqual([
      'error playerAdvantage dontPassOdds 5 100 -1/500',
      'error playerAdvantage dontPassOdds 6 100 -1/275',
      'error playerAdvantage dontPassOdds 8 100 -1/275',
      'error playerAdvantage dontPassOdds 9 100 -1/500',
    ])
    // Half up: 2:3 at $1 pays 67¢, and 5:6 at $2 pays $1.67.
    expect(summary(wrongWay('dontComeOdds', { mode: 'halfUp', increment: 1 }))).toEqual([
      'error playerAdvantage dontComeOdds 5 100 -1/500',
      'error playerAdvantage dontComeOdds 6 200 -1/1100',
      'error playerAdvantage dontComeOdds 8 200 -1/1100',
      'error playerAdvantage dontComeOdds 9 100 -1/500',
    ])
    expect(sanityCheck(wrongWay('dontPassOdds', { mode: 'floor', increment: 1 }))).toEqual([])
  })

  it('rejects "place 6 pays 7:5" with the player-advantage message and the paths to fix', () => {
    const cfg = variant('craplessBubble', (input) => {
      const place = input.catalog.place
      if (place?.family !== 'numberVsSeven') throw new Error('no place')
      place.pays = { ...place.pays, '6': '7:5' }
    })
    const [issue, ...rest] = sanityCheck(cfg)
    expect(rest).toEqual([])
    expect(issue?.message).toBe(PLAYER_ADVANTAGE)
    expect(issue?.edge?.toString()).toBe('-1/11')
    expect(issue?.paths).toContain('/catalog/place/pays/6')
  })

  it('catches a decision that favours the player inside a lifecycle that does not', () => {
    // A buy paying 21:10 with its vig paid once: the lifecycle breaks even (so it is also flagged
    // player-even), but every decision after the first is player-favoured.
    const cfg = variant('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
      buy.pays = { ...buy.pays, '4': '21:10' }
      buy.commission = { ...buy.commission, rearm: 'none' }
    })
    expect(summary(cfg)).toEqual([
      'error playerAdvantage buy 4 100 -1/30',
      'error playerEven buy 4 100 0',
    ])
  })

  it("rejects a 'for 1' pay typed as 'to 1': Interblock's Any 7 at 5:1 is dead even (plan §0 #10)", () => {
    // craplessBubble writes Any 7 "5 for 1" (4:1). Typed "5 to 1" its edge is exactly 0, which no
    // real bet has, and which neither the below-zero nor the above-40% check sees.
    const cfg = variant('craplessBubble', (input) => {
      const seven = input.catalog.any7
      if (seven?.family !== 'oneRoll') throw new Error('no any 7')
      seven.pays = { '7': '5 to 1' }
    })
    const issues = sanityCheck(cfg)
    expect(
      issues.map(({ severity, code, spec, edge }) => [severity, code, spec.typeId, edge?.toString()]),
    ).toEqual([['error', 'playerEven', 'any7', '0']])
    expect(issues[0]?.message).toBe(PLAYER_EVEN)
    expect(issues[0]?.paths).toContain('/catalog/any7/pays/7')
  })

  it('exempts free odds, which are even by design: every preset still passes', () => {
    // Zero-edge odds must not be flagged (the it.each above already proves each preset is clean;
    // this pins the reason: strict pass odds at true odds have an edge of exactly 0).
    const strict = compileConfig(PRESETS.strictBubble)
    const odds = sanityCheck(strict).filter(({ spec }) => spec.typeId.endsWith('Odds'))
    expect(odds).toEqual([])
  })

  it('sweeps from where the commission minimum stops binding: an overpay the minimum masks', () => {
    // Buy 4 at 43:20 breaks even at an exact 5% vig. With a $5 minimum and the vig FLOORED to $1,
    // the minimum masks the overpay below $100 (vig $5 > 5%), the $500 maximum pays the vig
    // exactly ($25), and only stakes just above $100 — the minimum-free sweep — show the player
    // advantage: at $119 the vig floors to $5 against $5.95, an edge of −95/12400 = −19/2480.
    const cfg = variant('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
      buy.pays = { ...buy.pays, '4': '43:20' }
      buy.commission = {
        ...buy.commission,
        minimum: 500,
        rounding: { mode: 'floor', increment: 100 },
      }
    })
    expect(summary(cfg)).toEqual([
      'error playerAdvantage buy 4 11900 -19/2480',
      'error playerEven buy 4 10000 0',
    ])
  })

  it('warns about an edge above 40%', () => {
    const cfg = variant('craplessBubble', (input) => {
      const seven = input.catalog.any7
      if (seven?.family !== 'oneRoll') throw new Error('no any 7')
      seven.pays = { '7': '2 for 1' }
    })
    const issues = sanityCheck(cfg)
    expect(issues.map(({ severity, code, spec }) => [severity, code, spec.typeId])).toEqual([
      ['warning', 'highEdge', 'any7'],
    ])
    expect(issues[0]?.edge?.compare(HIGH_EDGE)).toBe(1)
  })
})

describe('sweepAmounts', () => {
  it('covers a rounding period from the minimum, from where a minimum vig stops binding, and the maximum', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    const lay4 = { typeId: 'lay', number: 4 } as const
    const labels = distribution(lay4, typicalStart(lay4, live), 'decision', live).labels
    const amounts = sweepAmounts(lay4, labels, live)
    expect(amounts[0]).toBe(100)
    expect(amounts).toContain(4_000)
    expect(amounts.at(-1)).toBe(500_000)
  })
})
