import { describe, expect, it } from 'vitest'
import { PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import { describeCoverage } from '../properties/actions.ts'
import { checkSessions } from '../properties/session.ts'

// The full M4d engine properties (plan §9 item 6): 1,000 seeded sessions of up to 200 actions per
// machine, checked after every action (tests/properties/session.ts): rejected actions change
// nothing and the dry run agrees, money is conserved event by event with the bankroll never below
// 0, contract bets refuse every change the rules spec forbids and only those, odds stay within the
// engine's and the oracle's caps, the table round-trips through JSON, unscripted rolls follow the
// seed's dice stream, and a replay gives the same table. Then legalBets against validateAction on
// the tables of more sessions. The quick subsets are tests/properties/*.prop.test.ts.

describe.each(PRESET_IDS)('engine properties on %s (slow)', (id) => {
  it('hold over 1,000 sessions of up to 200 actions', () => {
    const report = checkSessions(id, 1_000, 200)
    expect(report.actions).toBeGreaterThan(80_000)
    expect(report.accepted).toBeGreaterThan(report.actions / 2)
    expect(report.contractRefusals).toBeGreaterThan(5_000)
    expect(report.oddsChecked).toBeGreaterThan(2_000)
    expect(report.unscripted).toBeGreaterThan(5_000)
    const { decisions, accepted, rejected } = describeCoverage(report.coverage)
    console.log(
      `${id}: ${report.actions} actions (${report.accepted} accepted), ${report.contractRefusals} ` +
        `contract refusals, ${report.oddsChecked} odds caps, ${report.unscripted} unscripted rolls\n` +
        `  decisions ${JSON.stringify(decisions)}\n  accepted ${JSON.stringify(accepted)}\n` +
        `  rejected ${JSON.stringify(rejected)}`,
    )
  }, 240_000)

  it('legalBets agrees with validateAction on the tables of 150 more sessions', () => {
    const report = checkSessions(id, 150, 200, { legalEvery: 4 })
    expect(report.legalTables).toBeGreaterThan(3_000)
    console.log(
      `${id}: legalBets checked on ${report.legalTables} tables, ${report.legalSpots} spots`,
    )
  }, 240_000)
})
