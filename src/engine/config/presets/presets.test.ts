import { describe, expect, it } from 'vitest'
import { cents, formatCents, type Rounding } from '../../core/money.ts'
import { typeLimits } from '../../bets/limits.ts'
import { payoutRoundingFor } from '../../bets/types.ts'
import {
  compileConfig,
  configHashOf,
  validateConfig,
  type CommissionRule,
  type CompiledBetType,
  type CompiledSideBet,
  type MachineConfig,
} from '../compile.ts'
import {
  governingEntry,
  leafPointers,
  listAssumptions,
  provenanceIssues,
  statusAt,
  uncoveredPointers,
} from '../provenance.ts'
import type { Ratio } from '../ratio.ts'
import { DEFAULT_PRESET_ID, PRESETS, PRESET_IDS, isPresetId, type PresetId } from './index.ts'

const compiled = (id: PresetId) => compileConfig(PRESETS[id])

/** The net pay of `typeId` on `key` (a number or an outcome) as "num:den". */
function net(cfg: MachineConfig, typeId: string, key: string | number): string | undefined {
  const type = cfg.catalog.get(typeId)
  if (type === undefined) return undefined
  let ratio: Ratio | undefined
  switch (type.family) {
    case 'line':
      ratio = type.pays
      break
    case 'odds':
    case 'numberVsSeven':
      ratio = type.pays.get(Number(key) as never)
      break
    case 'hardway':
      ratio = type.pays.get(Number(key) as never)
      break
    case 'oneRoll':
      ratio = type.pays.get(String(key))
      break
  }
  return ratio === undefined ? undefined : `${ratio.num}:${ratio.den}`
}

function commission(cfg: MachineConfig, typeId: string, n: number): CommissionRule | undefined {
  const type = cfg.catalog.get(typeId)
  return type?.family === 'numberVsSeven' ? type.commission?.get(n as never) : undefined
}

describe('the preset list', () => {
  it('has the five researched machines, crapless first and the default', () => {
    expect(PRESET_IDS).toEqual([
      'craplessBubble',
      'craplessBubbleHighLimit',
      'traditionalBubble',
      'strictBubble',
      'traditionalLive345',
    ])
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_IDS].sort())
    expect(DEFAULT_PRESET_ID).toBe('craplessBubble')
    expect(isPresetId('strictBubble')).toBe(true)
    expect(isPresetId('crapless-bubble')).toBe(false)
  })

  it('compiles every preset, each under its own id', () => {
    for (const id of PRESET_IDS) {
      expect(validateConfig(PRESETS[id]), id).toEqual([])
      expect(compiled(id).id).toBe(id)
    }
  })

  it('freezes every preset all the way down', () => {
    for (const id of PRESET_IDS) {
      expect(Object.isFrozen(PRESETS[id].catalog.place)).toBe(true)
      expect(Object.isFrozen(PRESETS[id].provenance)).toBe(true)
      expect(Object.isFrozen(PRESETS[id].rules.points)).toBe(true)
    }
  })
})

describe('provenance of the presets', () => {
  it('covers every value of every preset, and every entry names a value', () => {
    for (const id of PRESET_IDS) {
      expect(uncoveredPointers(PRESETS[id]), id).toEqual([])
      expect(provenanceIssues(PRESETS[id]), id).toEqual([])
    }
  })

  it('explains every entry with a note, and sources every entry that is not assumed', () => {
    for (const id of PRESET_IDS) {
      const entries = Object.entries(PRESETS[id].provenance)
      expect(
        entries.filter(([, entry]) => !entry.note).map(([pointer]) => pointer),
        id,
      ).toEqual([])
      const unsourced = entries.filter(([, e]) => e.status !== 'assumed' && !e.source)
      expect(unsourced, id).toEqual([])
    }
  })

  it('covers every value of every bet type and side bet at the type level or deeper, never with a blanket entry', () => {
    const loose: string[] = []
    for (const id of PRESET_IDS) {
      const { provenance } = PRESETS[id]
      for (const pointer of leafPointers(PRESETS[id])) {
        const [, block, typeId] = pointer.split('/')
        if (block !== 'catalog' && block !== 'sideBets') continue
        const type = `/${block}/${typeId}`
        const owner = governingEntry(provenance, pointer)?.pointer ?? ''
        if (owner !== type && !owner.startsWith(`${type}/`)) loose.push(`${id}${pointer}`)
      }
    }
    expect(loose).toEqual([])
  })

  it('cites the research’s sources for machine rounding', () => {
    const source = (id: PresetId, pointer: string) =>
      governingEntry(PRESETS[id].provenance, pointer)?.entry.source
    // Only the 2018 report of $2 paying $2.34 tells rounding up from rounding to the nearest cent.
    for (const n of [6, 8]) {
      expect(source('traditionalBubble', `/catalog/place/payoutRoundingByNumber/${n}`)).toBe(
        'WOV-30281; WOV-11344; WOV-32511',
      )
    }
    expect(source('traditionalLive345', '/money/payoutRounding')).toBe('LVA-RND; HAR-PA')
  })
})

describe('craplessBubble: the Interblock heads-up crapless machine', () => {
  const cfg = compiled('craplessBubble')
  const status = (pointer: string) => statusAt(cfg.provenance, pointer)

  it('is crapless with no don’t bets, put bets or lay', () => {
    expect(cfg.ruleset).toMatchObject({
      variant: 'crapless',
      naturals: [7],
      craps: [],
      dontBar: null,
    })
    expect(cfg.input.rules.allowPutBets).toBe(false)
    const kinds = [...cfg.catalog.values()].map((t) =>
      t.family === 'numberVsSeven' ? t.kind : t.family,
    )
    expect(kinds).not.toContain('lay')
    expect(kinds).not.toContain('placeToLose')
    expect(kinds).not.toContain('big')
    expect([...cfg.catalog.values()].some((t) => t.family === 'line' && t.side === 'dont')).toBe(
      false,
    )
    expect(status('/variant')).toBe('verified')
  })

  it('takes Come only in the point phase [A]', () => {
    expect(cfg.catalog.get('come')).toMatchObject({ window: 'point' })
    expect(status('/catalog/come')).toBe('verified')
    expect(status('/catalog/come/window')).toBe('assumed')
  })

  it('works place and buy bets on the come-out [V]', () => {
    for (const typeId of ['place', 'buy']) {
      expect(cfg.catalog.get(typeId)).toMatchObject({ comeOutDefault: 'on' })
      expect(status(`/catalog/${typeId}/comeOutDefault`)).toBe('verified')
    }
    expect(cfg.working.comeOutAutoOff).toBeNull()
  })

  it('starts place and buy placed after a seven-out OFF until the player sets bets ON [V; trigger and until A]', () => {
    expect(cfg.working.afterSevenOut).toEqual({
      types: ['place', 'buy'],
      trigger: 'sevenOut',
      until: 'playerOn',
    })
    expect(status('/afterSevenOut/newPlacedOff/types')).toBe('verified')
    expect(status('/afterSevenOut/newPlacedOff/trigger')).toBe('assumed')
    expect(status('/afterSevenOut/newPlacedOff/until')).toBe('assumed')
  })

  it('charges buy vig of 5% of the stake up front, not refunded, re-collected from wins', () => {
    for (const n of cfg.ruleset.points) {
      const vig = commission(cfg, 'buy', n)
      expect(vig?.rate.toWire()).toEqual(['1', '20'])
      expect(vig).toMatchObject({
        basis: 'stake',
        timing: 'upfront',
        refundOnTakeDown: false,
        rearm: 'recollectFromWin',
        minimum: 0,
        rounding: { mode: 'ceil', increment: 1 },
      })
    }
    expect(status('/catalog/buy/commission/rate')).toBe('reported')
    expect(status('/catalog/buy/commission/timing')).toBe('verified')
    expect(status('/catalog/buy/commission/refundOnTakeDown')).toBe('assumed')
    expect(status('/catalog/buy/commission/rearm')).toBe('assumed')
    expect(status('/catalog/buy/commission/rounding')).toBe('assumed')
  })

  it('takes 2x odds [R] on all ten points at true odds [A]', () => {
    for (const typeId of ['passOdds', 'comeOdds']) {
      const odds = cfg.catalog.get(typeId)
      expect(odds?.family).toBe('odds')
      if (odds?.family !== 'odds') continue
      expect([...odds.limit.multiple.keys()].sort((a, b) => a - b)).toEqual([...cfg.ruleset.points])
      expect([...odds.limit.multiple.values()].every((m) => m === 2)).toBe(true)
      expect(odds.limit.basis).toBe('stake')
      expect(net(cfg, typeId, 2)).toBe('6:1')
      expect(net(cfg, typeId, 11)).toBe('3:1')
      expect(net(cfg, typeId, 6)).toBe('6:5')
      expect(status(`/catalog/${typeId}/limit`)).toBe('reported')
      // Live crapless tables report these pays; Interblock's par sheet is not public.
      for (const n of cfg.ruleset.points) {
        expect(status(`/catalog/${typeId}/pays/${n}`)).toBe('assumed')
      }
    }
    expect(cfg.catalog.get('comeOdds')).toMatchObject({ comeOutDefault: 'off' })
  })

  it('places 2/12 at 11:2, 3/11 at 11:4 and the rest at 9:5, 7:5 and 7:6, all [A]', () => {
    expect([2, 12].map((n) => net(cfg, 'place', n))).toEqual(['11:2', '11:2'])
    expect([3, 11].map((n) => net(cfg, 'place', n))).toEqual(['11:4', '11:4'])
    expect([4, 5, 6, 8, 9, 10].map((n) => net(cfg, 'place', n))).toEqual([
      '9:5',
      '7:5',
      '7:6',
      '7:6',
      '7:5',
      '9:5',
    ])
    // Interblock v2.5.1 removed its pay tables, so even the standard pays on 4 to 10 are assumed.
    for (const n of cfg.ruleset.points) expect(status(`/catalog/place/pays/${n}`)).toBe('assumed')
    expect(status('/catalog/place')).toBe('verified')
  })

  it('floors payouts to the cent and rounds commission up to the cent [A]', () => {
    expect(cfg.payoutRounding).toEqual({ mode: 'floor', increment: 1 })
    expect([...cfg.catalog.values()].every((t) => t.payoutRounding.mode === 'floor')).toBe(true)
    expect(status('/money/payoutRounding')).toBe('assumed')
  })

  it('takes $1 per bet with a $5 minimum total of active bets; OFF bets use credit', () => {
    expect(cfg.limits.min).toBe(100)
    expect(cfg.betIncrement).toBe(100)
    expect(cfg.limits.minTotal).toEqual({
      amount: 500,
      scope: 'totalRound',
      countOff: false,
      countSideBets: false,
    })
    expect(cfg.working.offBetsConsumeCredit).toBe(true)
    expect(status('/limits/minTotal/countOff')).toBe('verified')
    expect(status('/limits/minTotal/amount')).toBe('assumed')
    expect(status('/offBets/consumeCredit')).toBe('verified')
  })

  it('has one Set bets On/Off button covering place, buy, odds and hard ways [V]', () => {
    expect(cfg.working.toggle).toEqual({
      global: true,
      perBet: false,
      scope: 'untilChanged',
      types: ['place', 'buy', 'passOdds', 'comeOdds', 'hard'],
    })
    expect(status('/workingToggle/types')).toBe('verified')
    expect(status('/workingToggle/perBet')).toBe('assumed')
    expect(cfg.working.oddsOffReturnedAtPointMade).toBe(true)
    expect(status('/oddsOffReturnedAtPointMade')).toBe('assumed')
  })

  it('pays the field 2:1 on 2 and 12 [R]', () => {
    expect(['2', '3', '4', '9', '10', '11', '12'].map((t) => net(cfg, 'field', t))).toEqual([
      '2:1',
      '1:1',
      '1:1',
      '1:1',
      '1:1',
      '1:1',
      '2:1',
    ])
    expect(net(cfg, 'field', '7')).toBeUndefined()
    expect(status('/catalog/field/pays/12')).toBe('reported')
  })

  it('pays props as the screen shows them, "for 1" [R]', () => {
    expect(net(cfg, 'any7', 7)).toBe('4:1')
    expect(['c', 'anyCraps'].map((id) => [2, 3, 12].map((t) => net(cfg, id, t)))).toEqual([
      ['7:1', '7:1', '7:1'],
      ['7:1', '7:1', '7:1'],
    ])
    expect(net(cfg, 'e', 11)).toBe('15:1')
    expect(
      ['snakeEyes', 'aceDeuce', 'yo', 'boxcars'].map((id, i) => net(cfg, id, [2, 3, 11, 12][i]!)),
    ).toEqual(['30:1', '15:1', '15:1', '30:1'])
    const any7 = cfg.catalog.get('any7')
    expect(any7?.family === 'oneRoll' && any7.pays.get('7')?.label).toBe('5 for 1')
    expect(status('/catalog/any7/pays')).toBe('reported')
    expect(cfg.composites.get('horn')?.parts.map((p) => p.typeId)).toEqual([
      'snakeEyes',
      'aceDeuce',
      'yo',
      'boxcars',
    ])
    expect(cfg.composites.get('ce')?.parts.map((p) => p.typeId)).toEqual(['c', 'e'])
  })

  it('offers 13 easy hops at 15:1 and the hard hops 2-2 to 5-5 at 30:1, none of 1-1, 1-2, 5-6, 6-6', () => {
    const hops = [...cfg.catalog.values()].filter((t) => t.typeId.startsWith('hop'))
    const byPay = (pay: string) =>
      hops.filter(
        (t) =>
          t.family === 'oneRoll' && [...t.pays.values()].every((r) => `${r.num}:${r.den}` === pay),
      )
    expect(hops).toHaveLength(17)
    expect(byPay('15:1')).toHaveLength(13)
    expect(byPay('30:1').map((t) => t.typeId)).toEqual(['hop22', 'hop33', 'hop44', 'hop55'])
    for (const missing of ['hop11', 'hop12', 'hop56', 'hop66'])
      expect(cfg.catalog.has(missing)).toBe(false)
  })

  it('offers Lucky Roller at 30, 30 and 155 to 1 [R]', () => {
    const pays = ['luckyRollerLow', 'luckyRollerHigh', 'luckyRollerAll'].map((id) => {
      const bet = cfg.sideBets.get(id)
      return bet?.family === 'collectSet'
        ? [bet.targets.length, `${bet.pays.num}:${bet.pays.den}`, bet.endsOn]
        : null
    })
    expect(pays).toEqual([
      [5, '30:1', 'anySeven'],
      [5, '30:1', 'anySeven'],
      [10, '155:1', 'anySeven'],
    ])
    for (const id of ['luckyRollerLow', 'luckyRollerHigh', 'luckyRollerAll']) {
      expect(status(`/sideBets/${id}/targets`)).toBe('verified')
      expect(status(`/sideBets/${id}/pays`)).toBe('reported')
      expect(status(`/sideBets/${id}/placement`)).toBe('verified')
    }
  })

  it('plays at a self-paced 120 rolls per hour [A], the player always shooting', () => {
    expect(cfg.pace).toEqual({ rollsPerHour: 120, betWindowSec: null, shooterWindowSec: null })
    expect(status('/pace/rollsPerHour')).toBe('assumed')
    expect(cfg.flow.shooter.mode).toBe('single')
    expect(cfg.flow.groupButtons.buttons).toEqual(['press', 'across'])
    expect(cfg.flow.macros).toEqual(['repeatLastBet', 'double'])
  })
})

describe('craplessBubbleHighLimit: the same machine at high-limit stakes', () => {
  const cfg = compiled('craplessBubbleHighLimit')
  const base = PRESETS.craplessBubble
  const high = PRESETS.craplessBubbleHighLimit
  const status = (pointer: string) => statusAt(cfg.provenance, pointer)

  it('shares every RULE with craplessBubble by identity: only money differs', () => {
    // The spread keeps the identical frozen objects, so the rules cannot drift apart.
    expect(high.rules).toBe(base.rules)
    expect(high.catalog).toBe(base.catalog)
    expect(high.composites).toBe(base.composites)
    expect(high.sideBets).toBe(base.sideBets)
    expect(high.workingToggle).toBe(base.workingToggle)
    expect(high.comeOut).toBe(base.comeOut)
    expect(high.afterSevenOut).toBe(base.afterSevenOut)
    expect(high.offBets).toBe(base.offBets)
    expect(high.flow).toBe(base.flow)
    expect(high.money.payoutRounding).toBe(base.money.payoutRounding)
    expect(cfg.ruleset.variant).toBe('crapless')
  })

  it('adding the preset leaves craplessBubble untouched: its config hash still pins the fixture', () => {
    expect(configHashOf(base)).toBe('4537b96ffb0ea61c')
    expect(configHashOf(high)).not.toBe(configHashOf(base))
  })

  it('takes $5 to $5,000 a bet at a $5 denomination, $25 total to roll, $20,000 on the layout', () => {
    expect(cfg.limits.min).toBe(500)
    expect(cfg.limits.max).toBe(500_000)
    expect(cfg.limits.tableMax).toBe(2_000_000)
    expect(cfg.betIncrement).toBe(500)
    expect(cfg.limits.minTotal).toEqual({
      amount: 2_500,
      scope: 'totalRound',
      countOff: false,
      countSideBets: false,
    })
    expect(cfg.startingBankroll).toBe(500_000)
    expect(cfg.chips).toEqual([2_500, 5_000, 10_000, 25_000, 50_000, 100_000])
    // The one reported number is the $20,000 layout maximum (WOV-35576); the rest are assumed.
    expect(status('/limits/tableMax')).toBe('reported')
    for (const pointer of ['/limits/min', '/limits/max', '/limits/minTotal/amount', '/chips']) {
      expect(status(pointer), pointer).toBe('assumed')
    }
  })

  it('caps per-type maximums by the reported structure: odds and place 2x the line, props by pay tier', () => {
    expect(typeLimits(cfg, 'pass')).toEqual({ min: 500, max: 500_000, increment: 500 })
    for (const typeId of ['passOdds', 'comeOdds', 'place', 'buy']) {
      expect(typeLimits(cfg, typeId).max, typeId).toBe(1_000_000)
    }
    expect(typeLimits(cfg, 'hard', 8).max).toBe(300_000)
    // One-roll props by their "for 1" pay: 8-for-1 $3,800, 16-for-1 $1,800, 31-for-1 $900.
    expect(typeLimits(cfg, 'anyCraps').max).toBe(380_000)
    expect(typeLimits(cfg, 'yo').max).toBe(180_000)
    expect(typeLimits(cfg, 'hop34').max).toBe(180_000)
    expect(typeLimits(cfg, 'boxcars').max).toBe(90_000)
    expect(typeLimits(cfg, 'hop44').max).toBe(90_000)
    // Composites: parts x the part's tier, so a max horn still respects its 31-for-1 corners.
    expect(typeLimits(cfg, 'ce').max).toBe(360_000)
    expect(typeLimits(cfg, 'horn').max).toBe(360_000)
    // The 5-for-1 seven and the field inherit the $5,000 wager maximum.
    expect(typeLimits(cfg, 'any7').max).toBe(500_000)
    expect(typeLimits(cfg, 'field').max).toBe(500_000)
    expect(status('/limits/perType')).toBe('assumed')
  })
})

describe('the other presets', () => {
  it('traditionalBubble is Shoot To Win as on the Clearwater card', () => {
    const cfg = compiled('traditionalBubble')
    const status = (pointer: string) => statusAt(cfg.provenance, pointer)
    // Place 6/8 round up to the cent [R]; 4/5/9/10 round down [A] (rules spec §0.2 #3, §4.2).
    const place = cfg.catalog.get('place')
    if (place?.family !== 'numberVsSeven') throw new Error('no place bets')
    expect(place.numbers.map((n) => [n, payoutRoundingFor(place, n).mode])).toEqual([
      [4, 'floor'],
      [5, 'floor'],
      [6, 'ceil'],
      [8, 'ceil'],
      [9, 'floor'],
      [10, 'floor'],
    ])
    expect(status('/catalog/place/payoutRounding')).toBe('assumed')
    expect(status('/catalog/place/payoutRoundingByNumber/6')).toBe('reported')
    expect(status('/catalog/place/payoutRoundingByNumber/8')).toBe('reported')
    // OFF chips use no credit on the machine [V STWO]; the trainer keeps their stake (plan §0 #23).
    expect(cfg.notModelled).toEqual(['/offBets/consumeCredit'])
    expect(status('/offBets/consumeCredit')).toBe('verified')
    expect(cfg.catalog.get('dontPassOdds')).toMatchObject({ limit: { basis: 'stake' } })
    expect(cfg.catalog.get('dontComeOdds')).toMatchObject({ limit: { basis: 'win' } })
    expect(cfg.catalog.get('dontPass')).toMatchObject({
      onNumber: 'locked',
      afterWin: 'stayIfFirstRoll',
    })
    expect(cfg.catalog.get('come')).toMatchObject({ afterWin: 'stayIf11' })
    expect(commission(cfg, 'buy', 4)).toMatchObject({
      basis: 'stake',
      timing: 'onWin',
      rearm: 'none',
    })
    expect(commission(cfg, 'lay', 4)).toMatchObject({ basis: 'win', timing: 'onWin' })
    expect(cfg.working.comeOutAutoOff?.carried).toEqual(['comeOdds', 'place', 'buy', 'hard', 'big'])
    expect(status('/comeOut/autoOff/carried')).toBe('verified')
    expect(status('/comeOut/autoOff/newlyPlaced')).toBe('assumed')
    // CW §21 bars these "for the same roll"; the same-number reading is assumed.
    expect(
      cfg.exclusiveGroups.map((g, i) => [g.scope, status(`/exclusiveGroups/${i}/scope`)]),
    ).toEqual([
      ['global', 'verified'],
      ['global', 'verified'],
      ['sameNumber', 'assumed'],
      ['sameNumber', 'assumed'],
      ['sameNumber', 'assumed'],
      ['sameNumber', 'assumed'],
    ])
    expect(cfg.working.toggle.types).toHaveLength(10)
    expect(cfg.working.offBetsConsumeCredit).toBe(false)
    expect(cfg.flow.historyLength).toBe(27)
    expect([...cfg.catalog.keys()].filter((id) => id.startsWith('hop'))).toHaveLength(21)
    const hotShooter = cfg.sideBets.get('hotShooter')
    expect(hotShooter?.family === 'handLength' && hotShooter.tiers.at(-1)?.minRolls).toBe(50)
    expect(status('/sideBets/hotShooter/countDefinition')).toBe('assumed')
  })

  it('strictBubble is Interblock traditional with up-front vig on buy and lay', () => {
    const cfg = compiled('strictBubble')
    const status = (pointer: string) => statusAt(cfg.provenance, pointer)
    // The Interblock readings it shares with the crapless machine.
    expect(cfg.working.afterSevenOut).toEqual({
      types: ['place', 'buy'],
      trigger: 'sevenOut',
      until: 'playerOn',
    })
    for (const pointer of [
      '/afterSevenOut/newPlacedOff/trigger',
      '/workingToggle/perBet',
      '/oddsOffReturnedAtPointMade',
      '/catalog/come/window',
      '/exclusiveGroups/2/scope',
      '/exclusiveGroups/3/scope',
    ]) {
      expect(status(pointer), pointer).toBe('assumed')
    }
    expect(status('/afterSevenOut/newPlacedOff/types')).toBe('verified')
    expect(commission(cfg, 'buy', 5)).toMatchObject({
      basis: 'stake',
      timing: 'upfront',
      rearm: 'recollectFromWin',
    })
    expect(commission(cfg, 'lay', 5)).toMatchObject({
      basis: 'win',
      timing: 'upfront',
      rearm: 'recollectFromWin',
    })
    expect(cfg.catalog.has('placeToLose')).toBe(false)
    expect(cfg.excludeLineVsLayBuy).toBe(true)
    expect(cfg.working.layAutoOn).toEqual({ afterPointMade: true, afterSeven: true })
    expect(cfg.catalog.get('dontPass')).toMatchObject({
      onNumber: 'reduceRemove',
      rebetAfterRemove: 'nextCycle',
    })
    // Lucky Shooter pay table D, Interblock's own screen (plan §0 #11; rules spec §6.3) [R].
    const shooter = cfg.sideBets.get('luckyShooter')
    expect(
      shooter?.family === 'pointRun' && `${shooter.topAward.num}:${shooter.topAward.den}`,
    ).toBe('499:1')
    expect(
      shooter?.family === 'pointRun' && [...shooter.payTable].map(([k, r]) => `${k}=${r.num}`),
    ).toEqual(['2=1', '3=4', '4=9', '5=99'])
    expect(status('/sideBets/luckyShooter/payTable')).toBe('reported')
    expect(status('/sideBets/luckyShooter/topAward')).toBe('reported')
  })

  it('models every value but Shoot To Win’s OFF chips that use no credit (plan §0 #23)', () => {
    expect(PRESET_IDS.map((id) => [id, compiled(id).notModelled])).toEqual([
      ['craplessBubble', []],
      ['craplessBubbleHighLimit', []],
      ['traditionalBubble', ['/offBets/consumeCredit']],
      ['strictBubble', []],
      ['traditionalLive345', []],
    ])
  })

  it('traditionalLive345 takes odds and composites only in units that pay whole dollars [A]', () => {
    const cfg = compiled('traditionalLive345')
    const status = (pointer: string) => statusAt(cfg.provenance, pointer)
    const units = (typeId: string) =>
      cfg.ruleset.points.map((n) => typeLimits(cfg, typeId, n).increment)
    for (const typeId of ['passOdds', 'comeOdds']) {
      expect(units(typeId)).toEqual([100, 200, 500, 500, 200, 100])
      expect(status(`/limits/perType/${typeId}/incrementByNumber`)).toBe('assumed')
    }
    for (const typeId of ['dontPassOdds', 'dontComeOdds']) {
      expect(units(typeId)).toEqual([200, 300, 600, 600, 300, 200])
      expect(status(`/limits/perType/${typeId}/incrementByNumber`)).toBe('assumed')
    }
    expect(typeLimits(cfg, 'passOdds').increment).toBe(100)
    const composites = [...cfg.composites.keys()].map((id) => [id, typeLimits(cfg, id)])
    expect(composites).toEqual([
      ['ce', { min: 200, max: 500_000, increment: 200 }],
      ['horn', { min: 400, max: 500_000, increment: 400 }],
      ['hornHigh2', { min: 500, max: 500_000, increment: 500 }],
      ['hornHigh3', { min: 500, max: 500_000, increment: 500 }],
      ['hornHigh11', { min: 500, max: 500_000, increment: 500 }],
      ['hornHigh12', { min: 500, max: 500_000, increment: 500 }],
      ['world', { min: 500, max: 500_000, increment: 500 }],
    ])
    for (const [id] of composites) expect(status(`/limits/perType/${String(id)}`)).toBe('assumed')
    // Each composite's unit is a whole dollar on each of its parts.
    for (const composite of cfg.composites.values()) {
      expect(typeLimits(cfg, composite.id).increment).toBe(composite.units * 100)
    }
  })

  it('traditionalLive345 pays whole dollars with 3-4-5x odds and a 3:1 field 12', () => {
    const cfg = compiled('traditionalLive345')
    expect(cfg.payoutRounding).toEqual({ mode: 'floor', increment: 100 })
    const odds = cfg.catalog.get('passOdds')
    expect(odds?.family === 'odds' && [...odds.limit.multiple.entries()]).toEqual([
      [4, 3],
      [5, 4],
      [6, 5],
      [8, 5],
      [9, 4],
      [10, 3],
    ])
    expect(net(cfg, 'field', '12')).toBe('3:1')
    expect(commission(cfg, 'buy', 10)).toMatchObject({ timing: 'onWin', minimum: 100 })
    expect(commission(cfg, 'buy', 6)).toMatchObject({ timing: 'upfront', refundOnTakeDown: true })
    expect(cfg.composites.get('world')?.parts.map((p) => p.units)).toEqual([1, 1, 1, 1, 1])
    const fire = cfg.sideBets.get('fire')
    expect(fire?.family === 'uniquePointsMade' && [...fire.payTable.keys()]).toEqual([4, 5, 6])
  })
})

// ---------------------------------------------------------------------------------------------
// Fingerprints: one readable line per value, each tagged with its provenance (V, R, A), so any
// data change shows up in review as a snapshot diff.
// ---------------------------------------------------------------------------------------------

const money = (amount: number) => formatCents(cents(amount), { trimWholeDollars: true })
const yesNo = (value: boolean) => (value ? 'yes' : 'no')
const list = (values: readonly (string | number)[]) =>
  values.length === 0 ? '-' : values.join(' ')
const round = (rounding: Rounding) => `${rounding.mode}/${money(rounding.increment)}`
const pay = (ratio: Ratio) => {
  const exact = `${ratio.num}:${ratio.den}`
  return ratio.label === exact ? exact : `${ratio.label} (${exact})`
}

function fingerprint(id: PresetId): string {
  const cfg = compiled(id)
  const input = cfg.input
  const tag = (pointer: string) => `[${statusAt(cfg.provenance, pointer)[0]!.toUpperCase()}]`
  /** Entries of a pay table; one tag for the table when all agree, else one per entry. */
  const table = (pointer: string, entries: [string | number, string][]) => {
    const tags = entries.map(([key]) => tag(`${pointer}/${key}`))
    const same = tags.every((t) => t === tags[0])
    const items = entries.map(([key, text], i) => `${key}=${text}${same ? '' : ` ${tags[i]}`}`)
    return `${items.join(', ')}${same && tags[0] ? ` ${tags[0]}` : ''}`
  }
  /** A type's own rounding, or the config default it inherits, with the matching status. */
  const roundingTag = (typeId: string) =>
    input.catalog[typeId]?.payoutRounding === undefined
      ? `${tag('/money/payoutRounding')} (default)`
      : tag(`/catalog/${typeId}/payoutRounding`)
  const vig = (rule: CommissionRule, pointer: string) =>
    `${rule.rate.toWire().join('/')} of ${rule.basis} ${rule.timing} ${tag(`${pointer}/timing`)}, ` +
    `rounded ${round(rule.rounding)} ${tag(`${pointer}/rounding`)}, min ${money(rule.minimum)} ` +
    `${tag(`${pointer}/minimum`)}, refund ${yesNo(rule.refundOnTakeDown)} ` +
    `${tag(`${pointer}/refundOnTakeDown`)}, rearm ${rule.rearm} ${tag(`${pointer}/rearm`)}`

  const describe = (type: CompiledBetType): string[] => {
    const at = `/catalog/${type.typeId}`
    const head = `  ${type.typeId} ${tag(at)} "${type.label}"`
    const after = `after a win ${type.family === 'odds' ? 'with parent' : type.afterWin}`
    switch (type.family) {
      case 'line':
        return [
          `${head} line ${type.side}/${type.window} ${tag(`${at}/window`)}: pays ${pay(type.pays)} ${tag(`${at}/pays`)}; ` +
            `${after} ${tag(`${at}/afterWin`)}` +
            (type.side === 'dont'
              ? `; on a number ${type.onNumber} ${tag(`${at}/onNumber`)}, ` +
                `re-bet ${type.rebetAfterRemove} ${tag(`${at}/rebetAfterRemove`)}`
              : ''),
        ]
      case 'odds':
        return [
          `${head} odds on ${type.parent}, come-out ${type.comeOutDefault ?? 'n/a'}` +
            `${type.comeOutDefault === null ? '' : ` ${tag(`${at}/comeOutDefault`)}`}`,
          `    pays ${table(
            `${at}/pays`,
            [...type.pays].map(([n, r]) => [n, pay(r)]),
          )}`,
          `    limit ${type.limit.basis} ${table(
            `${at}/limit/multiple`,
            [...type.limit.multiple].map(([n, m]) => [n, `${m}x`]),
          )}`,
        ]
      case 'numberVsSeven': {
        const byNumber = [...type.payoutRoundingByNumber].map(
          ([n, rule]) => `, on ${n} ${round(rule)} ${tag(`${at}/payoutRoundingByNumber/${n}`)}`,
        )
        const lines = [
          `${head} ${type.kind}: payouts ${round(type.payoutRounding)} ${roundingTag(type.typeId)}${byNumber.join('')}; ` +
            `${after} ${tag(`${at}/afterWin`)}; come-out ${type.comeOutDefault} ${tag(`${at}/comeOutDefault`)}`,
          `    pays ${table(
            `${at}/pays`,
            [...type.pays].map(([n, r]) => [n, pay(r)]),
          )}`,
        ]
        const rules = new Map<string, number[]>()
        for (const [n, rule] of type.commission ?? []) {
          const own = input.catalog[type.typeId]
          const override =
            own?.family === 'numberVsSeven' && own.commissionByNumber?.[String(n) as '4']
          const pointer = override ? `${at}/commissionByNumber/${n}` : `${at}/commission`
          const text = vig(rule, pointer)
          rules.set(text, [...(rules.get(text) ?? []), n])
        }
        for (const [text, numbers] of rules) lines.push(`    vig on ${numbers.join(' ')}: ${text}`)
        return lines
      }
      case 'hardway':
        return [
          `${head} hardway: ${after} ${tag(`${at}/afterWin`)}; come-out ${type.comeOutDefault} ${tag(`${at}/comeOutDefault`)}`,
          `    pays ${table(
            `${at}/pays`,
            [...type.pays].map(([n, r]) => [n, pay(r)]),
          )}`,
        ]
      case 'oneRoll':
        return [
          `${head} one roll by ${type.match}: pays ${table(
            `${at}/pays`,
            [...type.pays].map(([k, r]) => [k, pay(r)]),
          )}; ` +
            `${after} ${tag(`${at}/afterWin`)}; payouts ${round(type.payoutRounding)} ${roundingTag(type.typeId)}`,
        ]
    }
  }

  const describeSide = (bet: CompiledSideBet): string => {
    const at = `/sideBets/${bet.typeId}`
    const head = `  ${bet.typeId} ${tag(at)} "${bet.label}"`
    switch (bet.family) {
      case 'collectSet':
        return `${head} all of ${list(bet.targets)} before ${bet.endsOn} ${tag(`${at}/endsOn`)}: pays ${pay(bet.pays)} ${tag(`${at}/pays`)}; placed ${bet.placement} ${tag(`${at}/placement`)}`
      case 'uniquePointsMade':
        return `${head} unique points of ${list(bet.countedPoints)}: ${table(
          `${at}/payTable`,
          [...bet.payTable].map(([k, r]) => [k, pay(r)]),
        )}; immediately at ${bet.payImmediatelyAt ?? 'never'}; placed ${bet.placement}`
      case 'handLength':
        return `${head} roll count ${bet.countDefinition} ${tag(`${at}/countDefinition`)}: ${bet.tiers.map((t) => `${t.minRolls}+=${t.pays === 'push' ? 'push' : pay(t.pays)}`).join(', ')}; placed ${bet.placement}; qualifier ${money(bet.qualifyingBet)} ${tag(`${at}/qualifyingBet`)}`
      case 'pointRun':
        return `${head} hits on ${list(bet.points)}: ${table(
          `${at}/payTable`,
          [...bet.payTable].map(([k, r]) => [k, pay(r)]),
        )}; all + point ${pay(bet.topAward)} ${tag(`${at}/topAward`)}; repeat ends ${yesNo(bet.repeatEndsBet)} ${tag(`${at}/repeatEndsBet`)}; placed ${bet.placement}; removable before point ${yesNo(bet.removableBeforePoint)} ${tag(`${at}/removableBeforePoint`)}`
    }
  }

  const { ruleset: r, limits, working: w, flow, pace } = cfg
  const assumptions = listAssumptions(cfg)
  return [
    `${cfg.id} "${cfg.name}" ${r.variant}, configHash ${cfg.configHash}`,
    `rules ${tag('/rules')}: naturals ${list(r.naturals)}; craps ${list(r.craps)}; points ${list(r.points)}; bar ${r.dontBar ?? '-'}; put bets ${yesNo(input.rules.allowPutBets)} ${tag('/rules/allowPutBets')}`,
    `money: payouts ${round(cfg.payoutRounding)} ${tag('/money/payoutRounding')}; bankroll ${money(cfg.startingBankroll)} ${tag('/money/startingBankroll')}; increment ${money(cfg.betIncrement)} ${tag('/money/betIncrement')}`,
    `limits: ${money(limits.min)} ${tag('/limits/min')} to ${money(limits.max)} ${tag('/limits/max')}; table ${limits.tableMax === null ? '-' : money(limits.tableMax)}; ` +
      `minimum total ${limits.minTotal === null ? '-' : `${money(limits.minTotal.amount)} ${tag('/limits/minTotal/amount')} ${limits.minTotal.scope}, OFF bets count ${yesNo(limits.minTotal.countOff)} ${tag('/limits/minTotal/countOff')}, side bets count ${yesNo(limits.minTotal.countSideBets)} ${tag('/limits/minTotal/countSideBets')}`}`,
    ...Object.entries(input.limits.perType ?? {}).map(([typeId, own]) =>
      `  ${typeId} ${tag(`/limits/perType/${typeId}`)}: ${own.min === undefined ? '' : `min ${money(own.min)} `}${own.max === undefined ? '' : `max ${money(own.max)} `}${own.increment === undefined ? '' : `step ${money(own.increment)} `}${
        own.incrementByNumber === undefined
          ? ''
          : `steps ${Object.entries(own.incrementByNumber)
              .map(([n, unit]) => `${n}=${money(unit ?? 0)}`)
              .join(' ')} ${tag(`/limits/perType/${typeId}/incrementByNumber`)}`
      }`.trimEnd(),
    ),
    `not modelled: ${list(cfg.notModelled)}`,
    `chips ${tag('/chips')}: ${cfg.chips.map(money).join(' ')}`,
    'catalog:',
    ...[...cfg.catalog.values()].flatMap(describe),
    'composites:',
    ...[...cfg.composites.values()].map(
      (c) =>
        `  ${c.id} ${tag(`/composites/${c.id}`)} "${c.label}" = ${c.parts.map((p) => `${p.units === 1 ? '' : `${p.units}x`}${p.typeId}`).join(' + ')}`,
    ),
    'side bets:',
    ...[...cfg.sideBets.values()].map(describeSide),
    `working: toggle ${tag('/workingToggle')} global ${yesNo(w.toggle.global)}, per bet ${yesNo(w.toggle.perBet)} ${tag('/workingToggle/perBet')}, ${w.toggle.scope}, covers ${list(w.toggle.types)}`,
    `  come-out auto-OFF ${tag('/comeOut/autoOff')}: ${w.comeOutAutoOff === null ? '-' : `carried ${list(w.comeOutAutoOff.carried)} ${tag('/comeOut/autoOff/carried')}; new ${list(w.comeOutAutoOff.newlyPlaced)} ${tag('/comeOut/autoOff/newlyPlaced')}; back ON at ${w.comeOutAutoOff.reOnAt}`}`,
    `  after a seven-out ${tag('/afterSevenOut/newPlacedOff')}: ${w.afterSevenOut === null ? '-' : `new ${list(w.afterSevenOut.types)} OFF after ${w.afterSevenOut.trigger} ${tag('/afterSevenOut/newPlacedOff/trigger')} until ${w.afterSevenOut.until} ${tag('/afterSevenOut/newPlacedOff/until')}`}`,
    `  lay auto-ON ${tag('/layAutoOn')}: ${w.layAutoOn === null ? '-' : `after point made ${yesNo(w.layAutoOn.afterPointMade)}, after a 7 ${yesNo(w.layAutoOn.afterSeven)}`}; OFF odds returned at point made ${yesNo(w.oddsOffReturnedAtPointMade)} ${tag('/oddsOffReturnedAtPointMade')}; OFF bets use credit ${yesNo(w.offBetsConsumeCredit)} ${tag('/offBets/consumeCredit')}`,
    `exclusive ${tag('/exclusiveGroups')}: ${cfg.exclusiveGroups.length === 0 ? '-' : cfg.exclusiveGroups.map((g, i) => `${g.types.join('|')} (${g.scope} ${tag(`/exclusiveGroups/${i}/scope`)})`).join(', ')}; line vs lay/buy ${yesNo(cfg.excludeLineVsLayBuy)} ${tag('/excludeLineVsLayBuy')}`,
    `flow: shooter ${flow.shooter.mode} ${tag('/flow/shooter')}; invalid roll ${flow.invalidRoll} ${tag('/flow/invalidRoll')}; puck reset ${flow.puckReset} ${tag('/flow/puckReset')}; buttons ${list(flow.groupButtons.buttons)} (${flow.groupButtons.condition}) ${tag('/flow/groupButtons')}; history ${flow.historyLength} ${tag('/flow/historyLength')}; macros ${list(flow.macros)} ${tag('/flow/macros')}; labels ${cfg.payLabelStyle}`,
    `pace: ${pace.rollsPerHour} rolls/hour ${tag('/pace/rollsPerHour')}; bet window ${pace.betWindowSec ?? '-'} ${tag('/pace/betWindowSec')}; shooter window ${pace.shooterWindowSec ?? '-'} ${tag('/pace/shooterWindowSec')}`,
    `assumed (${assumptions.length}): ${assumptions.map((a) => a.pointer).join(', ')}`,
  ].join('\n')
}

describe('preset fingerprints', () => {
  it.each(PRESET_IDS)('%s', (id) => {
    expect(fingerprint(id)).toMatchSnapshot()
  })
})
