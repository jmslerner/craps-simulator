import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../engine/config/presets/index.ts'
import { pruneProvenance } from '../engine/config/provenance.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { cents, type Cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import type { Action } from '../engine/table/actions.ts'
import { applyAction, validateAction } from '../engine/table/reducer.ts'
import { newTable, type TableState } from '../engine/table/state.ts'
import { suggestAlternatives } from './alternatives.ts'
import { analyzeBet } from './analyze.ts'
import { catalogSpecs } from './catalog.ts'
import type { BetSpec } from './chain.ts'
import { sameEvents } from './events.ts'

const cfgOf = (id: PresetId) => compileConfig(PRESETS[id])

function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  let state = newTable(cfg, 'alternatives')
  for (const action of actions) {
    const result = applyAction(state, action, cfg)
    if (!result.ok) throw new Error(`${action.type}: ${result.rejection.code}`)
    state = result.state
  }
  return state
}

function suggest(id: PresetId, spec: BetSpec, amount: number, state?: TableState) {
  const cfg = cfgOf(id)
  return suggestAlternatives(state ?? newTable(cfg, 'alternatives'), spec, cents(amount), cfg)
}

describe('suggestAlternatives', () => {
  it('offers buy 4 for place 4 on Interblock, a switch the table accepts', () => {
    const cfg = cfgOf('craplessBubble')
    const place4: BetSpec = { typeId: 'place', number: 4 }
    const state = play(cfg, [{ type: 'place', typeId: 'place', number: 4, amount: cents(500) }])
    const [best] = suggestAlternatives(state, place4, cents(500), cfg)
    expect(best?.comparability).toBe('sameEvent')
    expect(best?.spec).toEqual({ typeId: 'buy', number: 4 })
    expect(best?.edge.toString()).toBe('1/21')
    expect(best?.saving.toString()).toBe('2/105')
    // The switch saves money per decision, not only rate: place loses 100/3¢, the buy 25¢.
    expect(best?.lossPerDecision?.toString()).toBe('25')
    expect(best?.savingPerDecision?.toString()).toBe(
      Fraction.of(100, 3).sub(Fraction.of(25)).toString(),
    )
    expect(best?.actions).toEqual([
      { type: 'setAmount', betId: state.bets[0]?.id, amount: 0 },
      { type: 'place', typeId: 'buy', number: 4, amount: 500 },
    ])
  })

  it("never calls an equal dollar loss a saving: the live '$1 vig, tie at $15' (rules spec §4.3)", () => {
    // A live table whose buy vig is charged up front on every number (the 4/10 on-win override
    // removed): at $15 the buy's edge is lower (6.250% against place 4's 6.667%) only because the
    // vig inflates the divisor — both lose exactly $1.00 a decision, so there is nothing to save
    // and no switch is offered. From $16 up the buy saves real money and is offered again.
    const cfg = compileConfig(
      (() => {
        const input = structuredClone(PRESETS.traditionalLive345) as MachineConfigInput
        const buy = input.catalog.buy
        if (buy?.family !== 'numberVsSeven') throw new Error('no buy')
        delete buy.commissionByNumber
        // HAR-PA's $20 minimum buy (M12) would refuse the $15 and $16 buys this tie needs.
        delete input.limits.perType?.['buy']
        input.provenance = pruneProvenance(input)
        return input
      })(),
    )
    const place4: BetSpec = { typeId: 'place', number: 4 }
    const state = newTable(cfg, 'tie')
    const at15 = suggestAlternatives(state, place4, cents(1_500), cfg)
    expect(at15.find(({ spec }) => spec.typeId === 'buy')).toBeUndefined()
    const place = analyzeBet(place4, cents(1_500), 'typical', cfg)
    const buy = analyzeBet({ typeId: 'buy', number: 4 }, cents(1_500), 'typical', cfg)
    expect(buy.edge.compare(place.edge)).toBe(-1)
    expect(buy.lossPerDecision.toString()).toBe('100')
    expect(place.lossPerDecision.toString()).toBe('100')
    // At $16 the switch saves real money (the $16 place even pays $28, floored from $28.80, so
    // the buy saves 400/3 − 100 = 100/3¢ a decision) and is offered again.
    const at16 = suggestAlternatives(state, place4, cents(1_600), cfg)
    const offered = at16.find(({ spec }) => spec.typeId === 'buy')
    expect(offered?.comparability).toBe('sameEvent')
    expect(offered?.savingPerDecision?.toString()).toBe(Fraction.of(100, 3).toString())
  })

  it('offers nothing cheaper with the same events for place 6, which beats buying it', () => {
    const offers = suggest('craplessBubble', { typeId: 'place', number: 6 }, 600)
    expect(offers.filter(({ comparability }) => comparability === 'sameEvent')).toEqual([])
  })

  it('sizes a penny-floored place 6 to the nearest stakes paid exactly: $3 and $6 for $5', () => {
    const sizing = suggest('craplessBubble', { typeId: 'place', number: 6 }, 500).filter(
      ({ comparability }) => comparability === 'sizing',
    )
    expect(sizing.map(({ amount }) => amount).sort((a, b) => a - b)).toEqual([300, 600])
    expect(sizing.every(({ edge }) => edge.toString() === '1/66')).toBe(true)
  })

  it('classes place 6 for big 6 by the working rules: same events on Shoot To Win, live not', () => {
    const big6: BetSpec = { typeId: 'big', number: 6 }
    const stw = suggest('traditionalBubble', big6, 600).find(({ spec }) => spec.typeId === 'place')
    expect(stw?.comparability).toBe('sameEvent')
    const live = suggest('traditionalLive345', big6, 600).find(
      ({ spec }) => spec.typeId === 'place',
    )
    expect(live?.comparability).toBe('restructure')
    expect(live?.actions).toEqual([])
  })

  it('suggests place 6 for hard 6 only as a restructure', () => {
    const offer = suggest('craplessBubble', { typeId: 'hard', number: 6 }, 600).find(
      ({ spec }) => spec.typeId === 'place',
    )
    expect(offer?.comparability).toBe('restructure')
  })

  it('suggests the smallest flat bet with full odds for a crapless pass', () => {
    const offer = suggest('craplessBubble', { typeId: 'pass', number: null }, 1_500).find(
      ({ comparability }) => comparability === 'restructure',
    )
    expect(offer?.amount).toBe(100)
    expect(offer?.edge.toString()).toBe('373/18480')
  })

  it.each(PRESET_IDS)(
    'only offers same-event bets that are strictly cheaper, sameEvents-verified and accepted on %s',
    (id) => {
      const cfg = cfgOf(id)
      const state = newTable(cfg, 'alternatives')
      for (const spec of catalogSpecs(cfg)) {
        const family = (cfg.catalog.get(spec.typeId) ?? cfg.composites.get(spec.typeId))?.family
        if (family === 'line' || family === 'odds') continue
        const amount: Cents = cents(600)
        let own
        try {
          own = analyzeBet(spec, amount, 'typical', cfg)
        } catch {
          continue
        }
        for (const offer of suggestAlternatives(state, spec, amount, cfg)) {
          expect(offer.edge.compare(own.edge), `${spec.typeId} → ${offer.spec.typeId}`).toBe(-1)
          if (offer.comparability !== 'sameEvent') continue
          expect(sameEvents(spec, offer.spec, 'typical', cfg)).toBe(true)
          expect(validateAction(state, { type: 'batch', actions: offer.actions }, cfg)).toBeNull()
        }
      }
    },
  )
})
