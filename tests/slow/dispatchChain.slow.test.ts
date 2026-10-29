import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import { machineBets } from '../oracle/closedFormOf.ts'
import { checkAgainstClosedForm, dispatchVariant } from '../oracle/dispatchChain.ts'
import { factsFrom } from '../oracle/machineFacts.ts'
import { edited, editArb } from '../oracle/randomMachine.ts'

// The reducer against the closed form (plan §9 items 3 and 4): every offered bet of every preset,
// through `applyAction` and the dense solver, against closed forms written from the rules spec.
// The quick subset is in tests/oracle/dispatchChain.test.ts. The bar is 0 mismatches.

const SEED = 20261028
/** Plan §9 item 4's stakes, then odd cents and a large stake, where rounding and minimums show. */
const STAKES = [101, 500, 600, 1_000, 2_500, 1, 2, 3, 7, 13, 99, 199, 333, 4_999]

describe.each(PRESET_IDS)('every offered bet of %s at every stake (slow)', (id) => {
  it('agrees with the closed form', () => {
    const { mismatches, checked } = checkAgainstClosedForm(PRESETS[id], STAKES)
    expect(mismatches.slice(0, 10)).toEqual([])
    console.log(`${id}: ${checked} bets checked at ${STAKES.length} stakes`)
  }, 300_000)
})

describe('random machines (fast-check, slow)', () => {
  it('agree with the closed form on a random bet at a random stake', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESET_IDS),
        editArb,
        fc.nat(),
        fc.integer({ min: 1, max: 5_000 }),
        (id, edit, pick, stake) => {
          const input = edited(PRESETS[id], edit)
          const bets = machineBets(factsFrom(dispatchVariant(input)), stake)
          const bet = bets[pick % bets.length]
          if (bet === undefined) return
          const isBet = (b: { typeId: string; number: number | null }) =>
            b.typeId === bet.typeId && b.number === bet.number
          expect(checkAgainstClosedForm(input, [stake], isBet).mismatches).toEqual([])
        },
      ),
      { seed: SEED, numRuns: 400 },
    )
  }, 300_000)
})
