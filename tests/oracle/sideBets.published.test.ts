import { describe, expect, it } from 'vitest'
import { compileConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { cents } from '../../src/engine/core/money.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { analyzeBet, type BetAnalysis } from '../../src/exact/index.ts'
import { analyze, type CfAnalysis } from './closedForm.ts'
import { sideBetClosedForm } from './sideBetEdges.ts'
import { sideBetMachineFrom } from './sideBets.ts'

// The published side-bet values (rules spec §6.2–§6.4, §6.6) through both the oracle's closed forms
// (tests/oracle/sideBetEdges.ts, written from the spec) and the exact solver (`analyzeBet`), each
// held to the same constant with exact rational equality, and the two compared on every side bet
// of every preset at several stakes (plan §9 item 5 for M11). tests/oracle/sideBetEdges.test.ts
// pins the oracle's side on its own.
//
// The solver prices side bets only once the exact agent's M11 work lands; until then `analyzeBet`
// throws for a side-bet type id, and the solver half of this file is skipped with that reason
// printed, never papered over by a looser assertion.

const exact = (num: number, den = 1) => Fraction.of(num, den).toString()

/** The side bets of every preset, by preset. */
const CASES: readonly (readonly [PresetId, string])[] = (
  Object.keys(PRESETS) as PresetId[]
).flatMap((id) => Object.keys(PRESETS[id].sideBets).map((typeId) => [id, typeId] as const))

function oracle(id: PresetId, typeId: string, stake: number): CfAnalysis {
  const machine = sideBetMachineFrom(PRESETS[id])
  const rule = machine.rules.get(typeId)
  if (rule === undefined) throw new Error(`${id} has no ${typeId}`)
  const bet = sideBetClosedForm(rule, machine, stake)
  if (bet === null) throw new Error(`${typeId} is not modelled by the closed form`)
  return analyze(bet)
}

function solver(id: PresetId, typeId: string, stake: number): BetAnalysis {
  return analyzeBet({ typeId, number: null }, cents(stake), 'typical', compileConfig(PRESETS[id]))
}

/** Whether `analyzeBet` prices side bets yet, probed once on the default preset's Lucky Roller. */
const solverPricesSideBets = (() => {
  try {
    solver('craplessBubble', 'luckyRollerLow', 100)
    return true
  } catch (error) {
    console.log(
      `analyzeBet does not price side bets yet (${String(error)}); ` +
        'the solver half of tests/oracle/sideBets.published.test.ts is skipped',
    )
    return false
  }
})()

describe('the oracle side of the published side-bet values (rules spec §6)', () => {
  it('crapless Lucky Roller 30/30/155: 139241/760760 and 17.9798%', () => {
    for (const typeId of ['luckyRollerLow', 'luckyRollerHigh']) {
      expect(oracle('craplessBubble', typeId, 500).edge.toString()).toBe(exact(139241, 760760))
    }
    expect(oracle('craplessBubble', 'luckyRollerAll', 500).edge.formatPercent(4)).toBe('17.9798')
  })

  it('STW Hot Shooter 9.0740%; strictBubble Lucky Shooter D 159317/1469664; live Fire 20.7628%', () => {
    expect(oracle('traditionalBubble', 'hotShooter', 100).edge.formatPercent(4)).toBe('9.0740')
    expect(oracle('strictBubble', 'luckyShooter', 100).edgeExcludingTies.toString()).toBe(
      exact(159317, 1469664),
    )
    expect(oracle('traditionalLive345', 'fire', 100).edge.formatPercent(4)).toBe('20.7628')
  })
})

describe.skipIf(!solverPricesSideBets)(
  'the exact solver against the oracle on every side bet',
  () => {
    it.each(CASES)(
      '%s %s: edge, chances and rolls a decision agree at every stake',
      (id, typeId) => {
        for (const stake of [100, 500, 101, 2_500]) {
          const closed = oracle(id, typeId, stake)
          const exactSolver = solver(id, typeId, stake)
          const at = `${id} ${typeId} ${stake}¢`
          expect(exactSolver.edge.toString(), `${at} edge`).toBe(closed.edge.toString())
          expect(exactSolver.pWin.toString(), `${at} pWin`).toBe(closed.pWin.toString())
          expect(exactSolver.pLose.toString(), `${at} pLose`).toBe(closed.pLose.toString())
          expect(exactSolver.pPush.toString(), `${at} pPush`).toBe(closed.pPush.toString())
          expect(exactSolver.expectedRolls.toString(), `${at} rolls`).toBe(
            closed.workingRollsPerDecision.toString(),
          )
        }
      },
    )

    it('the published constants hold on the solver side too', () => {
      for (const typeId of ['luckyRollerLow', 'luckyRollerHigh']) {
        expect(solver('craplessBubble', typeId, 500).edge.toString()).toBe(exact(139241, 760760))
      }
      expect(solver('craplessBubble', 'luckyRollerAll', 500).edge.formatPercent(4)).toBe('17.9798')
      expect(solver('traditionalBubble', 'hotShooter', 100).edge.formatPercent(4)).toBe('9.0740')
      expect(solver('traditionalLive345', 'fire', 100).edge.formatPercent(4)).toBe('20.7628')
      // The Lucky Shooter's lifecycle edge counts the come-out pushes as decisions (8.431% a come-out
      // roll); 159317/1469664 is the edge per resolved wager.
      const ls = solver('strictBubble', 'luckyShooter', 100)
      expect(ls.edge.formatPercent(3)).toBe('8.431')
    })
  },
)
