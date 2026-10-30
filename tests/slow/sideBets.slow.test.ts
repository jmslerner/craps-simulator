import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  describeSideBetMismatch,
  diceSequenceArb,
  mergeCounts,
  runSideBetSession,
  sideBetCases,
  SIDE_BET_MACHINES,
  type DicePair,
} from '../properties/sideBetDriver.ts'

// The full side-bet differential (M11; plan §9 item 2 for the side bets): the real reducer against
// the oracle's walker (tests/oracle/sideBets.ts) on every side bet of every preset and of the
// variants that turn on the knobs no preset uses (tests/properties/sideBetDriver.ts), over seeded
// random dice sequences, fair and biased towards long hands, then one long biased marathon per side
// bet that must reach every pay tier the spec lists. Compared on every roll: the placement window,
// the lock, the settlement (outcome, cash, whether the bet comes down), the progress and the round.
// The quick subset is tests/oracle/sideBets.diff.test.ts. The bar is 0 mismatches.

const SEED = 20261028
const STAKES = [100, 500, 101, 2_500, 1, 50_000]
const RUNS = 400
const MARATHON_ROLLS = 30_000

/** The settlement keys every marathon must reach, by family (tests/properties/sideBetDriver.ts). */
function requiredCoverage(dm: (typeof SIDE_BET_MACHINES)[number], typeId: string): string[] {
  const rule = dm.machine.rules.get(typeId)
  if (rule === undefined) throw new Error(`no ${typeId}`)
  switch (rule.family) {
    case 'collectSet':
      return ['win', 'lose']
    case 'uniquePointsMade':
      return ['lose:0pts', 'lose:1pts', 'lose:2pts', 'lose:3pts', 'win:4pts', 'win:5pts']
    case 'handLength':
      return ['lose:x0', 'push:x1', 'win:x3', 'win:x5', 'win:x7', 'win:x12', 'win:x30', 'win:x100']
    case 'pointRun':
      return [
        'lose:comeOut',
        'push:comeOut',
        'lose:0hits',
        'lose:1hits',
        'win:2hits',
        'win:3hits',
        'win:4hits', // 5 hits and the top award (P 0.14% and 0.017% a wager) are scripted in the quick file
      ]
  }
}

describe.each(sideBetCases(SIDE_BET_MACHINES))('%s (slow)', (name, dm, typeId) => {
  it(`matches the reference over ${RUNS} fair and ${RUNS} long-hand sequences`, () => {
    const settled: Record<string, number> = {}
    let placed = 0
    let rolls = 0
    for (const longHands of [false, true]) {
      fc.assert(
        fc.property(fc.constantFrom(...STAKES), diceSequenceArb(200, longHands), (stake, dice) => {
          const report = runSideBetSession(dm, typeId, stake, dice)
          expect(report.mismatches.map(describeSideBetMismatch)).toEqual([])
          mergeCounts(settled, report.settled)
          placed += report.placed
          rolls += report.rolls
        }),
        { seed: SEED, numRuns: RUNS },
      )
    }
    expect(placed).toBeGreaterThan(RUNS)
    console.log(`${name}: ${rolls} rolls, ${placed} bets, settled ${JSON.stringify(settled)}`)
  }, 120_000)

  it(`reaches every pay tier in a ${MARATHON_ROLLS}-roll marathon of long hands`, () => {
    const dice: DicePair[] =
      fc.sample(diceSequenceArb(MARATHON_ROLLS, true), { seed: SEED + 1, numRuns: 1 })[0] ?? []
    // fc.array shrinks towards short arrays; pad to the full length from further samples.
    let extra = 2
    while (dice.length < MARATHON_ROLLS) {
      const more = fc.sample(diceSequenceArb(MARATHON_ROLLS, true), {
        seed: SEED + extra,
        numRuns: 1,
      })[0]
      dice.push(...(more ?? []))
      extra++
    }
    const report = runSideBetSession(dm, typeId, 100, dice.slice(0, MARATHON_ROLLS))
    expect(report.mismatches.map(describeSideBetMismatch)).toEqual([])
    const missing = requiredCoverage(dm, typeId).filter((key) => (report.settled[key] ?? 0) === 0)
    expect(missing, `${name} settled ${JSON.stringify(report.settled)}`).toEqual([])
    console.log(
      `${name} marathon: ${report.placed} bets, settled ${JSON.stringify(report.settled)}`,
    )
  }, 120_000)
})
