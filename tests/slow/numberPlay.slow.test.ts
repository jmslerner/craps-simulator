import { describe, expect, it } from 'vitest'
import { numberPlay } from '../scenarios/numberPlay.ts'

// The long run of the seeded random play with number bets, commission and the machines' working
// rules (tests/scenarios/numberPlay.ts; the core project runs a quick subset).

describe('seeded random play with number bets (slow)', () => {
  it('keeps the ledger and the commission the events report, and replays exactly', () => {
    const counts = numberPlay(2_000, 200)
    // With seed 20261028: 76012 rolls, 6852 number bets, 9240 of their settlements, 4295
    // commission events and 172 machine switches, in about 4 s.
    expect(counts.numberBets).toBeGreaterThan(4_000)
    expect(counts.numberSettlements).toBeGreaterThan(5_000)
    expect(counts.vigEvents).toBeGreaterThan(2_500)
    expect(counts.machineSwitches).toBeGreaterThan(100)
  }, 120_000)
})
