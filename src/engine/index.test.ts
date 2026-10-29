import { describe, expect, it } from 'vitest'
import * as engine from './index.ts'

describe('the engine barrel', () => {
  it('exports the version and the table API', () => {
    expect(engine.ENGINE_VERSION).toBe(1)
    for (const name of [
      'compileConfig',
      'newTable',
      'applyAction',
      'validateAction',
      'effectiveWorking',
      'workingStatus',
      'settle',
      'upfrontVig',
      'maxOdds',
      'legalBets',
      'requireType',
      'advanceRound',
      'assertInvariants',
    ] as const) {
      expect(typeof engine[name], name).toBe('function')
    }
  })

  it('answers the UI and coach questions M4 left to the barrel: why a bet works, and its vig', () => {
    const cfg = engine.compileConfig(engine.PRESETS[engine.DEFAULT_PRESET_ID])
    let table = engine.newTable(cfg, 'barrel')
    for (const action of [
      { type: 'place', typeId: 'pass', amount: engine.cents(500) },
      { type: 'roll', dice: engine.makeRoll(2, 2) },
      { type: 'place', typeId: 'buy', number: 4, amount: engine.cents(2_500) },
      { type: 'setGlobalWorking', off: true },
    ] as const satisfies readonly engine.Action[]) {
      const result = engine.applyAction(table, action, cfg)
      if (!result.ok) throw new Error(result.rejection.code)
      table = result.state
    }
    const buy = table.bets.find((bet) => bet.typeId === 'buy')
    if (buy === undefined) throw new Error('no buy bet')
    expect(engine.workingStatus(buy, table, cfg)).toEqual({ working: false, source: 'button' })
    const type = engine.requireType(cfg, 'buy').type
    if (type.family !== 'numberVsSeven') throw new Error('buy is not a number bet')
    expect(engine.upfrontVig(type, 4, engine.cents(2_500))).toBe(125)
    expect(engine.commissionRule(type, 4)?.timing).toBe('upfront')
  })

  it('plays a roll end to end through its exports', () => {
    const cfg = engine.compileConfig(engine.PRESETS[engine.DEFAULT_PRESET_ID])
    const table = engine.newTable(cfg, 'barrel')
    const bet: engine.Action = { type: 'place', typeId: 'pass', amount: engine.cents(1_000) }
    const placed = engine.applyAction(table, bet, cfg)
    if (!placed.ok) throw new Error(placed.rejection.code)
    const rolled = engine.applyAction(
      placed.state,
      { type: 'roll', dice: engine.makeRoll(3, 4) },
      cfg,
    )
    expect(rolled.ok && rolled.state.ledger.bankroll).toBe(50_000)
  })
})
