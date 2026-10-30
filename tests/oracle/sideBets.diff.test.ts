import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  describeSideBetMismatch,
  diceFor,
  diceSequenceArb,
  mergeCounts,
  PRESET_SIDE_BET_MACHINES,
  runSideBetSession,
  sideBetCases,
  VARIANT_SIDE_BET_MACHINES,
  type DicePair,
  type SideBetDiffMachine,
} from '../properties/sideBetDriver.ts'

// The side-bet differential, quick subset (M11; plan §9 item 2 for the side bets): the real
// reducer against the oracle's walker (tests/oracle/sideBets.ts) over seeded random dice sequences
// and the rules spec's scripted scenarios, on every preset's side bets and on the variants that
// turn on the knobs no preset uses (tests/properties/sideBetDriver.ts). Compared on every roll:
// the placement window, the lock, the settlement (outcome, cash, whether the bet comes down), the
// progress and the round. The full run is tests/slow/sideBets.slow.test.ts. The bar is 0
// mismatches.

const SEED = 20261028
const STAKES = [100, 500, 101, 2_500]

function machine(id: string): SideBetDiffMachine {
  const found = [...PRESET_SIDE_BET_MACHINES, ...VARIANT_SIDE_BET_MACHINES].find((m) => m.id === id)
  if (found === undefined) throw new Error(`no machine ${id}`)
  return found
}

/** A session on scripted totals, which must match on every roll; returns its coverage. */
function scripted(id: string, typeId: string, totals: number[], stake = 100) {
  const report = runSideBetSession(machine(id), typeId, stake, totals.map(diceFor))
  expect(report.mismatches.map(describeSideBetMismatch)).toEqual([])
  return report
}

/** A traditional hand of exactly `rolls` rolls: a point of 4, fillers of 5, then the seven-out. */
function handOf(rolls: number): number[] {
  return [4, ...Array.from({ length: rolls - 2 }, () => 5), 7]
}

describe.each(sideBetCases(PRESET_SIDE_BET_MACHINES))(
  'random dice on %s (quick)',
  (_, dm, typeId) => {
    it('matches the reference on every roll, window, lock and progress', () => {
      const settled: Record<string, number> = {}
      let placed = 0
      fc.assert(
        fc.property(fc.constantFrom(...STAKES), diceSequenceArb(40), (stake, dice) => {
          const report = runSideBetSession(dm, typeId, stake, dice)
          expect(report.mismatches.map(describeSideBetMismatch)).toEqual([])
          mergeCounts(settled, report.settled)
          placed += report.placed
        }),
        { seed: SEED, numRuns: 30 },
      )
      expect(placed).toBeGreaterThan(30)
      expect(Object.keys(settled).length).toBeGreaterThan(0)
    })
  },
)

describe.each(sideBetCases(VARIANT_SIDE_BET_MACHINES))(
  'random dice on the variant %s (quick)',
  (_, dm, typeId) => {
    it('matches the reference on every roll, window, lock and progress', () => {
      fc.assert(
        fc.property(fc.constantFrom(...STAKES), diceSequenceArb(40, true), (stake, dice) => {
          const report = runSideBetSession(dm, typeId, stake, dice)
          expect(report.mismatches.map(describeSideBetMismatch)).toEqual([])
        }),
        { seed: SEED, numRuns: 15 },
      )
    })
  },
)

describe('the M11 acceptance scenarios through the reducer and the reference', () => {
  it('the Fire Bet pays 24:1 at the seven-out after 4 unique points and ignores repeated points', () => {
    const report = scripted(
      'traditionalLive345',
      'fire',
      [4, 4, 4, 4, 6, 6, 9, 9, 10, 10, 4, 4, 5, 7],
      500,
    )
    expect(report.settled).toEqual({ 'win:4pts': 1 })
    // Its window closes after the first roll: placed once, refused on every roll until the new hand.
    expect(report.placed).toBe(1)
    expect(report.refused).toBe(0)
    const next = scripted('traditionalLive345', 'fire', [4, 7, 6, 6, 6, 7], 100)
    expect(next.placed).toBe(2)
    expect(next.settled).toEqual({ 'lose:0pts': 1, 'lose:1pts': 1 })
  })

  it('a come-out 7 loses All Small; completing the set pays at once and closes the Interblock window until a 7', () => {
    expect(scripted('craplessBubble', 'luckyRollerLow', [7]).settled).toEqual({ lose: 1 })
    const report = scripted('craplessBubble', 'luckyRollerLow', [6, 6, 2, 5, 3, 3, 4, 9, 7, 5])
    // Placed before roll 1 and again before roll 10 (after the 7); refused before rolls 8 and 9.
    expect(report.settled).toEqual({ win: 1 })
    expect(report.placed).toBe(2)
    expect(report.refused).toBe(2)
  })

  it.each([
    [2, 'lose:x0'],
    [7, 'lose:x0'],
    [8, 'push:x1'],
    [15, 'push:x1'],
    [16, 'win:x3'],
    [24, 'win:x5'],
    [32, 'win:x7'],
    [40, 'win:x12'],
    [45, 'win:x30'],
    [49, 'win:x30'],
    [50, 'win:x100'],
    [53, 'win:x100'],
  ])('the Hot Shooter on a hand of %i rolls: %s', (rolls, key) => {
    const report = scripted('traditionalBubble', 'hotShooter', handOf(rolls))
    expect(report.settled).toEqual({ [key]: 1 })
    expect(scripted('traditionalBubble+grand51', 'hotShooter', handOf(50)).settled).toEqual({
      'win:x30': 1,
    })
  })

  it('the Lucky Shooter: PA examples, the come-out pushes, the top award and the lock before the point', () => {
    expect(scripted('strictBubble', 'luckyShooter', [9, 10, 4, 6, 10]).settled).toEqual({
      'win:3hits': 1,
    })
    expect(scripted('strictBubble', 'luckyShooter', [6, 9, 6]).settled).toEqual({ 'lose:1hits': 1 })
    expect(scripted('strictBubble', 'luckyShooter', [7, 11, 8, 4, 5, 6, 9, 10, 8]).settled).toEqual(
      {
        'push:comeOut': 2,
        'win:top': 1,
      },
    )
    expect(scripted('strictBubble', 'luckyShooter', [8, 4, 5, 6, 9, 10, 3]).settled).toEqual({
      'win:5hits': 1,
    })
    expect(
      scripted('strictBubble+repeatsContinue', 'luckyShooter', [4, 5, 5, 6, 6, 8, 9, 10, 5])
        .settled,
    ).toEqual({
      'win:5hits': 1,
    })
  })

  it('a crapless hand: the round, the hand counter and the set bets agree on every roll', () => {
    const totals = [2, 2, 11, 11, 7, 12, 12, 3, 3, 4, 7, 8, 7, 5, 6, 6, 9, 9, 10, 10, 8, 7]
    for (const typeId of ['luckyRollerLow', 'luckyRollerHigh', 'luckyRollerAll']) {
      scripted('craplessBubble', typeId, totals, 300)
      scripted('craplessBubble+sevenOutOnly', typeId, totals, 300)
      scripted('craplessBubble+newHand', typeId, totals, 300)
    }
  })

  it('a long biased sequence on every machine and side bet', () => {
    const dice: DicePair[] =
      fc.sample(diceSequenceArb(120, true), { seed: SEED, numRuns: 1 })[0] ?? []
    for (const [name, dm, typeId] of sideBetCases()) {
      const report = runSideBetSession(dm, typeId, 100, dice)
      expect(report.mismatches.map(describeSideBetMismatch), name).toEqual([])
    }
  })
})
