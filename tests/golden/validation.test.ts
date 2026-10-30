import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import type { DieFace } from '../../src/engine/core/dice.ts'
import { cents, type Cents } from '../../src/engine/core/money.ts'
import { legalBets, type LegalBet } from '../../src/engine/bets/legal.ts'
import { checkMinTotal } from '../../src/engine/bets/limits.ts'
import {
  REJECTION_CODES,
  betId,
  type BetId,
  type BetInstance,
  type RejectionCode,
} from '../../src/engine/bets/types.ts'
import type { Action } from '../../src/engine/table/actions.ts'
import { applyAction } from '../../src/engine/table/reducer.ts'
import type { TableState } from '../../src/engine/table/state.ts'
import { scenario, type Scenario } from '../scenarios/dsl.ts'

// The validation matrix (plan §4.6, §10 M4d): every rejection code has a triggering case, and
// wherever two checks could both fire, the earlier one in §4.6's order wins (each order case also
// shows the later check firing on its own). Then the checks a roll makes (rules spec §2.3 step 9):
// the minimum total, credit and limits. Then legalBets on known tables. `expectReject` also checks
// that a refused action leaves the table exactly as it was.

/** A preset with its input edited, under its own id. */
function variant(id: PresetId, edit: (input: MachineConfigInput) => void): MachineConfig {
  const input = structuredClone(PRESETS[id])
  input.id = `${id}Variant`
  edit(input)
  return compileConfig(input)
}

/** Interblock crapless with a $1,000 table maximum. */
const capped = variant('craplessBubble', (input) => {
  input.limits.tableMax = 100_000
})

const place = (typeId: string, amount: number, more: Partial<Record<string, unknown>> = {}) =>
  ({ type: 'place', typeId, amount: amount as Cents, ...more }) as Action
const setAmount = (id: string, amount: number): Action => ({
  type: 'setAmount',
  betId: id as BetId,
  amount: amount as Cents,
})
const roll = (d1: number, d2: number): Action =>
  ({ type: 'roll', dice: { d1: d1 as DieFace, d2: d2 as DieFace } }) as Action

/** Interblock crapless with a $10 pass bet on point 4. */
const passOnFour = () => scenario('craplessBubble').place('pass', 1_000).roll(2, 2)

/** Strict Interblock with a don't come bet taken down from 6, so don't come waits a cycle. */
const dontComeRemoved = () =>
  scenario('strictBubble')
    .place('pass', 500)
    .roll(5, 5)
    .place('dontCome', 500)
    .roll(4, 2)
    .takeDown({ typeId: 'dontCome', number: 6 })

interface TriggerCase {
  readonly code: RejectionCode
  readonly title: string
  readonly run: () => void
}

const TRIGGERS: readonly TriggerCase[] = [
  {
    code: 'NOT_OFFERED',
    title: 'a type the machine lacks, an unknown one, and a side bet the machine lacks (M11)',
    run: () =>
      scenario('craplessBubble')
        .expectReject('NOT_OFFERED', place('dontPass', 500), { typeId: 'dontPass' })
        .expectReject('NOT_OFFERED', place('nope', 500))
        .expectReject('NOT_OFFERED', place('fire', 500), { typeId: 'fire' })
        .expectReject('NOT_OFFERED', place('hotShooter', 500), { typeId: 'hotShooter' }),
  },
  {
    code: 'BAD_PARAMS',
    title: 'bad amounts, numbers, parents, dice, settings and action shapes; a roll in a batch',
    run: () =>
      passOnFour()
        .place('field', 100)
        .expectReject('BAD_PARAMS', place('pass', 0), { field: 'amount' })
        .expectReject('BAD_PARAMS', place('field', 150.5), { field: 'amount' })
        .expectReject('BAD_PARAMS', place('place', 600, { number: 7 }), { field: 'number' })
        .expectReject('BAD_PARAMS', place('come', 500, { number: 6 }), { field: 'number' })
        .expectReject('BAD_PARAMS', place('field', 100, { parentId: 'b1' }), {
          field: 'parentId',
        })
        .expectReject('BAD_PARAMS', place('passOdds', 1_000, { parentId: 'b1', number: 6 }), {
          field: 'number',
        })
        .expectReject('BAD_PARAMS', setAmount('b1', -100), { field: 'amount' })
        .expectReject('BAD_PARAMS', { type: 'setWorking', betId: 'b2', working: 'yes' } as never, {
          field: 'working',
        })
        .expectReject('BAD_PARAMS', { type: 'setGlobalWorking', off: 'x' } as never, {
          field: 'off',
        })
        .expectReject('BAD_PARAMS', { type: 'deposit', amount: 0 } as never, { field: 'amount' })
        .expectReject('BAD_PARAMS', roll(7, 1), { field: 'dice' })
        // Malformed dice are refused, never thrown (plan §4.6).
        .expectReject('BAD_PARAMS', { type: 'roll', dice: null } as never, { field: 'dice' })
        .expectReject('BAD_PARAMS', { type: 'roll', dice: 8 } as never, { field: 'dice' })
        .expectReject('BAD_PARAMS', { type: 'roll', dice: [3, 4] } as never, { field: 'dice' })
        .expectReject('BAD_PARAMS', roll(2.5, 3), { field: 'dice' })
        .expectReject('BAD_PARAMS', { type: 'batch', actions: 'x' } as never, { field: 'actions' })
        // A batch places and switches bets; a roll in one, at any depth, is refused (plan §4.9).
        .expectReject(
          'BAD_PARAMS',
          { type: 'batch', actions: [place('field', 100), roll(3, 4)] },
          { field: 'actions', reason: 'roll', batchIndex: 1 },
        )
        .expectReject('BAD_PARAMS', { type: 'teleport' } as never, { field: 'type' })
        .expectReject('BAD_PARAMS', null as never),
  },
  {
    code: 'WRONG_PHASE',
    title: 'come on the come-out; pass with the point on where there are no put bets (§3.1)',
    run: () =>
      scenario('craplessBubble')
        .place('pass', 1_000)
        .expectReject('WRONG_PHASE', place('come', 500), { window: 'point', phase: 'comeOut' })
        .roll(2, 2)
        .expectReject('WRONG_PHASE', place('pass', 500), { window: 'comeOut', phase: 'point' }),
  },
  {
    code: 'WINDOW_CLOSED',
    title:
      'a don’t come bet after one was taken down from its number, until the come-out (§0.2 #5)',
    run: () =>
      dontComeRemoved().expectReject('WINDOW_CLOSED', place('dontCome', 500), {
        typeId: 'dontCome',
        reason: 'rebetAfterRemove',
        until: 'nextComeOut',
      }),
  },
  {
    code: 'BELOW_MIN',
    title: 'a $5 pass bet at a live table with a $10 line minimum; a cut below it',
    run: () =>
      scenario('traditionalLive345')
        .expectReject('BELOW_MIN', place('pass', 500), { typeId: 'pass', min: 1_000 })
        .place('dontPass', 1_000)
        .roll(2, 2)
        .expectReject('BELOW_MIN', setAmount('b1', 500), { min: 1_000 }),
  },
  {
    code: 'ABOVE_MAX',
    title:
      'more than $500 on one bet, placed or pressed, however large; more money than safe cents hold (plan §4.6)',
    run: () =>
      scenario('craplessBubble')
        .expectReject('ABOVE_MAX', place('place', 50_100, { number: 6 }), { max: 50_000 })
        .place('place', 600, { number: 6 })
        .expectReject('ABOVE_MAX', setAmount('b1', 50_100), { max: 50_000 })
        .expectReject('ABOVE_MAX', setAmount('b1', Number.MAX_SAFE_INTEGER), { max: 50_000 })
        // Adding 2^53 − 1 to the $6 bet would leave safe cents: refused before it is summed.
        .expectReject('ABOVE_MAX', place('place', Number.MAX_SAFE_INTEGER, { number: 6 }), {
          held: 600,
          added: Number.MAX_SAFE_INTEGER,
          max: 50_000,
        })
        .expectReject('ABOVE_MAX', place('place', Number.MAX_SAFE_INTEGER - 600, { number: 6 }), {
          amount: Number.MAX_SAFE_INTEGER,
          max: 50_000,
        })
        // A deposit may not carry the ledger past whole, safe cents: $500 is in already. A table
        // that holds that much cannot roll either, as a win could pass it: refused, not thrown.
        .expectReject(
          'ABOVE_MAX',
          { type: 'deposit', amount: cents(Number.MAX_SAFE_INTEGER) },
          {
            scope: 'ledger',
            field: 'amount',
            max: Number.MAX_SAFE_INTEGER - 50_000,
          },
        )
        .deposit(Number.MAX_SAFE_INTEGER - 50_000)
        .expectReject('ABOVE_MAX', { type: 'deposit', amount: cents(1) }, { max: 0 })
        .expectReject('ABOVE_MAX', roll(3, 3), { scope: 'ledger', max: Number.MAX_SAFE_INTEGER }),
  },
  {
    code: 'BAD_INCREMENT',
    title: 'a bet off the $1 grid',
    run: () =>
      scenario('craplessBubble').expectReject('BAD_INCREMENT', place('place', 550, { number: 6 }), {
        increment: 100,
      }),
  },
  {
    code: 'TABLE_MAX',
    title: 'more on the layout than /limits/tableMax; a press counts only what it adds',
    run: () => {
      scenario(capped)
        .deposit(100_000)
        .place('pass', 50_000)
        .place('place', 50_000, { number: 6 })
        .expectReject('TABLE_MAX', place('field', 100), { total: 100_100, tableMax: 100_000 })
      // $500 + $400 on a $1,000 table: pressing the $400 to $500 adds $100 and fits exactly.
      scenario(capped)
        .deposit(50_000)
        .place('pass', 50_000)
        .place('place', 40_000, { number: 6 })
        .setAmount({ typeId: 'place' }, 50_000)
        .expectBets([
          ['pass', null, 50_000],
          ['place', 6, 50_000],
        ])
        .setAmount({ typeId: 'place' }, 40_000)
        .place('field', 10_000)
        .expectReject('TABLE_MAX', (a) => a.setAmount({ typeId: 'place' }, 50_000), {
          total: 110_000,
          tableMax: 100_000,
        })
    },
  },
  {
    code: 'INSUFFICIENT_CREDIT',
    title: 'a stake above the credit; and a buy whose up-front vig does not fit (§4.5)',
    run: () => {
      scenario('craplessBubble').expectReject(
        'INSUFFICIENT_CREDIT',
        place('buy', 50_000, { number: 4 }),
        {
          needed: 52_500,
          available: 50_000,
        },
      )
      scenario('craplessBubble')
        .place('pass', 50_000)
        .expectReject('INSUFFICIENT_CREDIT', place('field', 100), { needed: 100, available: 0 })
    },
  },
  {
    code: 'CONTRACT_BET',
    title: 'pass on its point; Shoot To Win’s locked don’t pass; an increase of a don’t bet (§3.1)',
    run: () => {
      passOnFour()
        .expectReject('CONTRACT_BET', setAmount('b1', 2_000), { change: 'increase' })
        .expectReject('CONTRACT_BET', setAmount('b1', 500), { change: 'decrease' })
        .expectReject('CONTRACT_BET', setAmount('b1', 0), { change: 'remove' })
      scenario('traditionalBubble')
        .place('dontPass', 1_000)
        .roll(2, 2)
        .expectReject('CONTRACT_BET', setAmount('b1', 500), { change: 'decrease' })
        .expectReject('CONTRACT_BET', setAmount('b1', 0), { change: 'remove' })
      scenario('strictBubble')
        .place('dontPass', 1_000)
        .roll(2, 2)
        .expectReject('CONTRACT_BET', setAmount('b1', 2_000), { change: 'increase' })
        .setAmount('b1' as BetId, 500)
    },
  },
  {
    code: 'NO_PARENT',
    title: 'odds with no line bet, or behind a bet of the wrong type',
    run: () =>
      scenario('craplessBubble')
        .expectReject('NO_PARENT', place('passOdds', 1_000), { parent: 'pass', parentId: '' })
        .place('pass', 1_000)
        .roll(2, 2)
        .expectReject('NO_PARENT', place('comeOdds', 1_000, { parentId: 'b1' }), {
          parent: 'come',
          parentId: 'b1',
        }),
  },
  {
    code: 'PARENT_NOT_ON_POINT',
    title: 'come odds behind a come bet still in the box',
    run: () =>
      passOnFour()
        .place('come', 1_000)
        .expectReject('PARENT_NOT_ON_POINT', place('comeOdds', 1_000, { parentId: 'b2' }), {
          parentId: 'b2',
        }),
  },
  {
    code: 'ODDS_LIMIT',
    title: 'odds over 2× the flat; a don’t pass cut below what its lay odds need (§4.4)',
    run: () => {
      passOnFour()
        .expectReject('ODDS_LIMIT', place('passOdds', 2_100, { parentId: 'b1' }), {
          amount: 2_100,
          max: 2_000,
        })
        .place('passOdds', 2_000, { on: { typeId: 'pass' } })
        .expectReject('ODDS_LIMIT', setAmount('b2', 2_100), { max: 2_000 })
      scenario('strictBubble')
        .place('dontPass', 1_000)
        .roll(2, 2)
        .place('dontPassOdds', 2_000, { on: { typeId: 'dontPass' } })
        .expectReject('ODDS_LIMIT', setAmount('b1', 500), { betId: 'b2', max: 1_000 })
    },
  },
  {
    code: 'EXCLUSIVE_CONFLICT',
    title: 'pass with don’t pass; place with lay on a number; Interblock’s pass against a lay',
    run: () => {
      scenario('traditionalBubble')
        .place('pass', 1_000)
        .expectReject('EXCLUSIVE_CONFLICT', place('dontPass', 1_000), {
          conflictsWith: 'pass',
          scope: 'global',
        })
        .place('place', 600, { number: 6 })
        .expectReject('EXCLUSIVE_CONFLICT', place('lay', 1_200, { number: 6 }), {
          conflictsWith: 'place',
          scope: 'sameNumber',
        })
      scenario('strictBubble')
        .place('pass', 1_000)
        .roll(3, 3)
        .expectReject('EXCLUSIVE_CONFLICT', place('lay', 1_200, { number: 6 }), {
          conflictsWith: 'pass',
          scope: 'lineVsLayBuy',
        })
    },
  },
  {
    code: 'BET_NOT_FOUND',
    title: 'changing or switching a bet that is not on the table',
    run: () =>
      scenario('traditionalBubble')
        .expectReject('BET_NOT_FOUND', setAmount('b9', 500), { betId: 'b9' })
        .expectReject('BET_NOT_FOUND', {
          type: 'setWorking',
          betId: 'b9' as BetId,
          working: false,
        }),
  },
  {
    code: 'NOT_TOGGLEABLE',
    title: 'per-bet toggles where the machine has none; bets that always work; no global button',
    run: () => {
      scenario('craplessBubble')
        .place('place', 600, { number: 6 })
        .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'place' }, false), {
          scope: 'bet',
        })
      scenario('traditionalBubble')
        .place('pass', 1_000)
        .place('field', 100)
        .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'pass' }, false))
        .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'field' }, false))
      scenario('traditionalLive345').expectReject(
        'NOT_TOGGLEABLE',
        (a) => a.setGlobalWorking(true),
        {
          scope: 'global',
        },
      )
    },
  },
  {
    code: 'BELOW_MIN_TOTAL',
    title:
      'a roll short of the round’s minimum: "BETS ARE NOT VALID YET! – Must bet N credits more!"',
    run: () =>
      scenario('craplessBubble')
        .expectReject('BELOW_MIN_TOTAL', roll(3, 4), {
          scope: 'totalRound',
          min: 500,
          total: 0,
          short: 500,
        })
        .place('pass', 300)
        // "Must bet 2 credits more!" at $1 credits.
        .expectReject('BELOW_MIN_TOTAL', roll(3, 4), { total: 300, short: 200 })
        .place('pass', 200)
        .roll(3, 4),
  },
]

describe('every rejection code has a triggering case (plan §4.6)', () => {
  it('covers all of REJECTION_CODES', () => {
    expect(new Set(TRIGGERS.map((c) => c.code))).toEqual(new Set(REJECTION_CODES))
  })

  it.each(TRIGGERS)('$code: $title', ({ run }) => run())
})

interface OrderCase {
  readonly first: RejectionCode
  readonly then: RejectionCode
  readonly title: string
  readonly run: () => void
}

/**
 * Each case refuses one action that breaks two checks with the earlier code, and one that breaks
 * only the later check with the later code, so both checks really apply.
 */
const ORDER: readonly OrderCase[] = [
  {
    first: 'NOT_OFFERED',
    then: 'BAD_PARAMS',
    title: 'an unoffered type with a bad amount',
    run: () =>
      scenario('craplessBubble')
        .expectReject('NOT_OFFERED', place('dontPass', 0))
        .expectReject('BAD_PARAMS', place('pass', 0)),
  },
  {
    first: 'BAD_PARAMS',
    then: 'WRONG_PHASE',
    title: 'a come bet naming a number, on the come-out',
    run: () =>
      scenario('craplessBubble')
        .expectReject('BAD_PARAMS', place('come', 500, { number: 6 }))
        .expectReject('WRONG_PHASE', place('come', 500)),
  },
  {
    first: 'WRONG_PHASE',
    then: 'BELOW_MIN',
    title: 'a live come bet under the $10 minimum, on the come-out',
    run: () =>
      scenario('traditionalLive345')
        .expectReject('WRONG_PHASE', place('come', 500))
        .place('pass', 1_000)
        .roll(2, 2)
        .expectReject('BELOW_MIN', place('come', 500)),
  },
  {
    first: 'WINDOW_CLOSED',
    then: 'BELOW_MIN',
    title: 'a blocked don’t come bet under the minimum',
    run: () => {
      dontComeRemoved().expectReject('WINDOW_CLOSED', place('dontCome', 50))
      scenario('strictBubble')
        .place('pass', 500)
        .roll(5, 5)
        .expectReject('BELOW_MIN', place('dontCome', 50))
    },
  },
  {
    first: 'BELOW_MIN',
    then: 'BAD_INCREMENT',
    title: 'an amount under the minimum and off the grid',
    run: () =>
      scenario('craplessBubble')
        .expectReject('BELOW_MIN', place('place', 50, { number: 6 }))
        .expectReject('BAD_INCREMENT', place('place', 150, { number: 6 })),
  },
  {
    first: 'ABOVE_MAX',
    then: 'BAD_INCREMENT',
    title: 'an amount over the maximum and off the grid',
    run: () =>
      scenario('craplessBubble')
        .expectReject('ABOVE_MAX', place('place', 50_050, { number: 6 }))
        .expectReject('BAD_INCREMENT', place('place', 49_950, { number: 6 })),
  },
  {
    first: 'BAD_INCREMENT',
    then: 'TABLE_MAX',
    title: 'an off-grid amount that would also break the table maximum',
    run: () =>
      scenario(capped)
        .deposit(100_000)
        .place('pass', 50_000)
        .place('place', 50_000, { number: 6 })
        .expectReject('BAD_INCREMENT', place('field', 150))
        .expectReject('TABLE_MAX', place('field', 100)),
  },
  {
    first: 'TABLE_MAX',
    then: 'INSUFFICIENT_CREDIT',
    title: 'a bet over the table maximum that the credit cannot cover either',
    run: () => {
      scenario(capped)
        .deposit(60_000)
        .place('pass', 50_000)
        .place('place', 50_000, { number: 6 })
        .expectReject('TABLE_MAX', place('field', 20_000))
      scenario(capped)
        .place('pass', 40_000)
        .expectReject('INSUFFICIENT_CREDIT', place('field', 20_000))
    },
  },
  {
    first: 'BELOW_MIN',
    then: 'NO_PARENT',
    title: 'odds under the minimum with no line bet',
    run: () =>
      scenario('craplessBubble')
        .expectReject('BELOW_MIN', place('passOdds', 50))
        .expectReject('NO_PARENT', place('passOdds', 100)),
  },
  {
    first: 'ABOVE_MAX',
    then: 'ODDS_LIMIT',
    title: 'odds over both the type’s maximum and the 2× cap',
    run: () =>
      passOnFour()
        .expectReject('ABOVE_MAX', place('passOdds', 50_100, { parentId: 'b1' }))
        .expectReject('ODDS_LIMIT', place('passOdds', 2_100, { parentId: 'b1' })),
  },
  {
    first: 'NO_PARENT',
    then: 'PARENT_NOT_ON_POINT',
    title: 'come odds behind a pass bet, then behind a come bet in the box',
    run: () =>
      passOnFour()
        .place('come', 1_000)
        .expectReject('NO_PARENT', place('comeOdds', 1_000, { parentId: 'b1' }))
        .expectReject('PARENT_NOT_ON_POINT', place('comeOdds', 1_000, { parentId: 'b2' })),
  },
  {
    first: 'PARENT_NOT_ON_POINT',
    then: 'ODDS_LIMIT',
    title: 'too much odds behind a come bet still in the box',
    run: () =>
      passOnFour()
        .place('come', 1_000)
        .expectReject('PARENT_NOT_ON_POINT', place('comeOdds', 5_000, { parentId: 'b2' }))
        .expectReject('ODDS_LIMIT', place('passOdds', 5_000, { parentId: 'b1' })),
  },
  {
    first: 'ODDS_LIMIT',
    then: 'INSUFFICIENT_CREDIT',
    title: 'odds over the cap that the credit cannot cover either',
    run: () =>
      scenario('craplessBubble')
        .place('pass', 10_000)
        .roll(2, 2)
        .expectReject('ODDS_LIMIT', place('passOdds', 45_000, { parentId: 'b1' }))
        .place('place', 30_000, { number: 6 })
        .expectReject('INSUFFICIENT_CREDIT', place('passOdds', 15_000, { parentId: 'b1' })),
  },
  {
    first: 'INSUFFICIENT_CREDIT',
    then: 'EXCLUSIVE_CONFLICT',
    title: 'a don’t pass bet against a pass bet, beyond the credit',
    run: () =>
      scenario('traditionalBubble')
        .place('pass', 1_000)
        .expectReject('INSUFFICIENT_CREDIT', place('dontPass', 50_000))
        .expectReject('EXCLUSIVE_CONFLICT', place('dontPass', 1_000)),
  },
  {
    first: 'CONTRACT_BET',
    then: 'BELOW_MIN',
    title: 'a contract bet answers CONTRACT_BET to any change, whatever the amount (setAmount)',
    run: () => {
      passOnFour()
        .expectReject('CONTRACT_BET', setAmount('b1', 50))
        .expectReject('CONTRACT_BET', setAmount('b1', 50_100))
        .expectReject('CONTRACT_BET', setAmount('b1', 150))
      scenario('traditionalLive345')
        .place('dontPass', 1_000)
        .roll(2, 2)
        .expectReject('BELOW_MIN', setAmount('b1', 500))
    },
  },
  {
    first: 'BET_NOT_FOUND',
    then: 'BAD_PARAMS',
    title: 'a bad amount for a bet that is not there',
    run: () =>
      passOnFour()
        .expectReject('BET_NOT_FOUND', setAmount('b9', -1))
        .expectReject('BAD_PARAMS', setAmount('b1', -1)),
  },
  {
    first: 'BAD_PARAMS',
    then: 'CONTRACT_BET',
    title: 'a bad amount for a contract bet',
    run: () =>
      passOnFour()
        .expectReject('BAD_PARAMS', setAmount('b1', 1.5))
        .expectReject('CONTRACT_BET', setAmount('b1', 200)),
  },
  {
    first: 'CONTRACT_BET',
    then: 'WINDOW_CLOSED',
    title: 'pressing a don’t come bet on its number while don’t come waits a cycle',
    run: () =>
      scenario('strictBubble')
        .place('pass', 500)
        .roll(5, 5)
        .place('dontCome', 500)
        .roll(4, 2)
        .place('dontCome', 500)
        .roll(4, 4)
        .takeDown({ typeId: 'dontCome', number: 6 })
        .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'dontCome', number: 8 }, 1_000))
        .expectReject('WINDOW_CLOSED', place('dontCome', 500)),
  },
  {
    first: 'WINDOW_CLOSED',
    then: 'ABOVE_MAX',
    title: 'pressing a blocked don’t come bet in the box over the maximum',
    run: () =>
      scenario('strictBubble')
        .place('pass', 500)
        .roll(5, 5)
        .place('dontCome', 500)
        .roll(4, 2)
        .place('dontCome', 500)
        .takeDown({ typeId: 'dontCome', number: 6 })
        .expectReject('WINDOW_CLOSED', (a) => a.setAmount({ typeId: 'dontCome' }, 50_100))
        // The point is made (the box bet travels to 10), a new point is set, a new box bet.
        .roll(5, 5)
        .roll(3, 3)
        .place('dontCome', 500)
        .expectReject('ABOVE_MAX', (a) =>
          a.setAmount({ typeId: 'dontCome', number: null }, 50_100),
        ),
  },
  {
    first: 'BELOW_MIN',
    then: 'ODDS_LIMIT',
    title: 'cutting a don’t pass bet with lay odds below the minimum',
    run: () =>
      scenario('strictBubble')
        .place('dontPass', 1_000)
        .roll(2, 2)
        .place('dontPassOdds', 2_000, { on: { typeId: 'dontPass' } })
        .expectReject('BELOW_MIN', setAmount('b1', 50))
        .expectReject('ODDS_LIMIT', setAmount('b1', 500)),
  },
  {
    first: 'ODDS_LIMIT',
    then: 'INSUFFICIENT_CREDIT',
    title: 'pressing odds over the cap with no credit (setAmount)',
    run: () =>
      scenario('craplessBubble')
        .place('pass', 10_000)
        .roll(2, 2)
        .place('passOdds', 10_000, { on: { typeId: 'pass' } })
        .place('place', 30_000, { number: 6 })
        .expectReject('ODDS_LIMIT', setAmount('b2', 30_000))
        .expectReject('INSUFFICIENT_CREDIT', setAmount('b3', 40_100)),
  },
  {
    first: 'BET_NOT_FOUND',
    then: 'NOT_TOGGLEABLE',
    title: 'switching a bet that is not there, then a bet that always works',
    run: () =>
      scenario('traditionalBubble')
        .place('pass', 1_000)
        .expectReject('BET_NOT_FOUND', {
          type: 'setWorking',
          betId: 'b9' as BetId,
          working: 'x',
        } as never)
        .expectReject('BAD_PARAMS', {
          type: 'setWorking',
          betId: 'b1' as BetId,
          working: 'x',
        } as never)
        .expectReject('NOT_TOGGLEABLE', {
          type: 'setWorking',
          betId: 'b1' as BetId,
          working: false,
        }),
  },
  {
    first: 'BAD_PARAMS',
    then: 'NOT_TOGGLEABLE',
    title: 'a bad setting for a button the machine does not have',
    run: () =>
      scenario('traditionalLive345')
        .expectReject('BAD_PARAMS', { type: 'setGlobalWorking', off: 'x' } as never)
        .expectReject('NOT_TOGGLEABLE', { type: 'setGlobalWorking', off: null }),
  },
  {
    first: 'BAD_PARAMS',
    then: 'BELOW_MIN_TOTAL',
    title: 'bad dice on a table short of the minimum',
    run: () =>
      scenario('craplessBubble')
        .expectReject('BAD_PARAMS', roll(0, 3))
        .expectReject('BELOW_MIN_TOTAL', roll(1, 3)),
  },
]

describe('the §4.6 check order, wherever two checks could both fire', () => {
  it.each(ORDER)('$first before $then: $title', ({ run }) => run())

  it('a batch is refused with its first refusal, naming it, and applies nothing', () => {
    const s = scenario('craplessBubble')
    s.expectReject(
      'ABOVE_MAX',
      {
        type: 'batch',
        actions: [place('pass', 1_000), place('field', 60_000), place('place', 600, { number: 6 })],
      },
      { batchIndex: 1 },
    )
    s.expectReject(
      'WRONG_PHASE',
      { type: 'batch', actions: [place('pass', 500), place('come', 500)] },
      { batchIndex: 1 },
    )
    s.act({ type: 'batch', actions: [place('pass', 500), place('field', 100)] })
      .expectBets([
        ['pass', null, 500],
        ['field', null, 100],
      ])
      .roll(3, 4)
  })

  it('a batch with a roll is malformed: BAD_PARAMS before any of it applies, whatever comes first', () => {
    scenario('craplessBubble')
      .expectReject(
        'BAD_PARAMS',
        { type: 'batch', actions: [place('field', 60_000), roll(3, 4)] },
        { field: 'actions', reason: 'roll', batchIndex: 1 },
      )
      .expectReject(
        'BAD_PARAMS',
        { type: 'batch', actions: [roll(3, 4), place('pass', 500)] },
        { field: 'actions', reason: 'roll', batchIndex: 0 },
      )
      .expectReject(
        'BAD_PARAMS',
        {
          type: 'batch',
          actions: [place('pass', 500), { type: 'batch', actions: [roll(3, 4)] } as Action],
        },
        { field: 'actions', reason: 'roll', batchIndex: 1 },
      )
  })
})

describe('the round’s minimum total (rules spec §2.3 step 9, §2.5; /limits/minTotal)', () => {
  it('counts only bets that work on the roll: OFF bets do not satisfy it (Interblock) [V IB]', () => {
    scenario('craplessBubble')
      .expectProvenance('/limits/minTotal/countOff', 'verified')
      .place('pass', 300)
      .place('place', 600, { number: 6 })
      .setGlobalWorking(true)
      .expectReject('BELOW_MIN_TOTAL', roll(3, 4), { total: 300, short: 200 })
      .setGlobalWorking(null)
      .roll(3, 4)
  })

  it('Shoot To Win: carried chips auto-OFF for the come-out do not count; with the point on they do [V STWO]', () => {
    scenario('traditionalBubble')
      .place('pass', 100)
      .place('place', 600, { number: 6 })
      .expectReject('BELOW_MIN_TOTAL', roll(2, 2), { min: 300, total: 100, short: 200 })
      .place('field', 200)
      .roll(2, 2)
      .expect({ point: 4 })
      .roll(2, 3)
  })

  it('countOff: true counts OFF bets too', () => {
    const countingOff = variant('craplessBubble', (input) => {
      if (input.limits.minTotal !== null) input.limits.minTotal.countOff = true
    })
    scenario(countingOff)
      .place('place', 600, { number: 6 })
      .setGlobalWorking(true)
      .roll(3, 4)
      .expectBets([['place', 6, 600]])
  })

  it('perBet: every counted bet must reach the amount; an empty table has none to fail', () => {
    const perBet = variant('craplessBubble', (input) => {
      if (input.limits.minTotal !== null) input.limits.minTotal.scope = 'perBet'
    })
    scenario(perBet)
      .roll(3, 4)
      .place('pass', 500)
      .place('field', 100)
      .expectReject('BELOW_MIN_TOTAL', roll(3, 4), {
        scope: 'perBet',
        betId: 'b2',
        typeId: 'field',
        amount: 100,
        short: 400,
      })
      .setAmount({ typeId: 'field' }, 500)
      .roll(3, 4)
  })

  it('side bets count only where /limits/minTotal/countSideBets (§9 #11: no [A])', () => {
    // Side bets arrive in M11, so the check is asked directly about a Lucky Roller bet.
    const cfg = compileConfig(PRESETS.craplessBubble)
    const side: BetInstance = {
      id: betId(1),
      typeId: 'luckyRollerLow',
      number: null,
      parentId: null,
      amount: cents(500),
      vigHeld: cents(0),
      working: null,
      progress: 0,
      placedAtRoll: 0,
    }
    const state = { ...scenario(cfg).state, bets: [side], nextBetSeq: 2 }
    expect(checkMinTotal(state, cfg, () => true)?.details).toMatchObject({ total: 0, short: 500 })
    const counting = variant('craplessBubble', (input) => {
      if (input.limits.minTotal !== null) input.limits.minTotal.countSideBets = true
    })
    expect(
      checkMinTotal({ ...state, configHash: counting.configHash }, counting, () => true),
    ).toBeNull()
  })

  it('a table with no minimum rolls with no bets at all (live)', () => {
    scenario('traditionalLive345').roll(3, 4).roll(2, 2)
  })
})

describe('a roll also checks the credit and limits of the table it rolls (§2.3 step 9)', () => {
  // Play through the reducer never fails these (every placement checks them, and the table
  // invariants say so); a table restored from storage or an import is checked before it rolls.
  const cfg = compileConfig(PRESETS.craplessBubble)
  const base = scenario(cfg).place('pass', 1_000).state
  const restored = (change: (state: TableState) => TableState) => change(structuredClone(base))
  const rejection = (state: TableState, on = cfg) => {
    const result = applyAction(state, roll(3, 4), on)
    return result.ok ? 'accepted' : result.rejection
  }

  it('an overdrawn credit', () => {
    const state = restored((s) => ({
      ...s,
      ledger: { ...s.ledger, bankroll: cents(-100), houseNet: cents(s.ledger.houseNet + 50_100) },
    }))
    expect(rejection(state)).toEqual({
      code: 'INSUFFICIENT_CREDIT',
      details: { scope: 'roll', bankroll: -100 },
    })
  })

  it('a bet outside its type’s limits', () => {
    const state = restored((s) => ({
      ...s,
      bets: s.bets.map((bet) => ({ ...bet, amount: cents(60_000) })),
      ledger: { ...s.ledger, deposits: cents(s.ledger.deposits + 59_000) },
    }))
    expect(rejection(state)).toEqual({
      code: 'ABOVE_MAX',
      details: { typeId: 'pass', amount: 60_000, max: 50_000, betId: 'b1' },
    })
  })

  it('a layout over the table maximum', () => {
    const big = scenario(capped)
      .deposit(100_000)
      .place('pass', 50_000)
      .place('place', 50_000, { number: 6 }).state
    const over = {
      ...big,
      bets: [...big.bets, { ...big.bets[1]!, id: betId(3), number: 8 as PointNumber }],
    }
    expect(rejection({ ...over, nextBetSeq: 4 }, capped)).toMatchObject({
      code: 'TABLE_MAX',
      details: { scope: 'roll', total: 150_000, tableMax: 100_000 },
    })
  })

  it('the minimum comes first', () => {
    const state = restored((s) => ({
      ...s,
      bets: [],
      ledger: { ...s.ledger, bankroll: cents(-100) },
    }))
    expect(rejection(state)).toMatchObject({ code: 'BELOW_MIN_TOTAL' })
  })
})

/** The spot for `typeId` (and `number` or the parent, where given). */
function spotOf(
  spots: readonly LegalBet[],
  typeId: string,
  where: { number?: PointNumber | null; parentId?: string } = {},
): LegalBet {
  const found = spots.filter(
    (spot) =>
      spot.typeId === typeId &&
      (where.number === undefined || spot.number === where.number) &&
      (where.parentId === undefined || spot.parentId === where.parentId),
  )
  expect(found, typeId).toHaveLength(1)
  return found[0]!
}

describe('legalBets (plan §4.6) on known tables', () => {
  const legal = (s: Scenario) => legalBets(s.state, s.cfg)

  it('at the start of an Interblock crapless session', () => {
    const spots = legal(scenario('craplessBubble'))
    expect(spotOf(spots, 'pass')).toMatchObject({
      number: null,
      betId: null,
      amount: 0,
      canAdd: null,
      minAdd: 100,
      maxAdd: 50_000,
      canRemove: { code: 'BET_NOT_FOUND' },
    })
    expect(spotOf(spots, 'come').canAdd?.code).toBe('WRONG_PHASE')
    expect(spotOf(spots, 'passOdds')).toMatchObject({
      parentId: null,
      canAdd: { code: 'NO_PARENT' },
    })
    expect(spotOf(spots, 'place', { number: 2 })).toMatchObject({ canAdd: null, maxAdd: 50_000 })
    // A buy pays 5% up front, rounded up: $476 + $23.80 fits in $500, $477 + $23.85 does not.
    expect(spotOf(spots, 'buy', { number: 4 })).toMatchObject({ canAdd: null, maxAdd: 47_600 })
    expect(spotOf(spots, 'horn')).toMatchObject({ canAdd: null, minAdd: 100, maxAdd: 50_000 })
    expect(spots.filter((spot) => spot.typeId === 'hard').map((spot) => spot.number)).toEqual([
      4, 6, 8, 10,
    ])
  })

  it('odds offered behind a $300 pass bet stop at the $500 bet maximum, not 2× (plan §0 #18)', () => {
    const s = scenario('craplessBubble').deposit(100_000).place('pass', 30_000).roll(2, 2)
    const spots = legal(s)
    expect(spotOf(spots, 'pass')).toMatchObject({
      number: null,
      betId: 'b1',
      amount: 30_000,
      canAdd: { code: 'CONTRACT_BET' },
      canRemove: { code: 'CONTRACT_BET' },
    })
    expect(spotOf(spots, 'passOdds', { parentId: 'b1' })).toMatchObject({
      number: 4,
      canAdd: null,
      minAdd: 100,
      maxAdd: 50_000,
    })
  })

  it('odds are limited by the credit too, and a bet that is up can be pressed by the increment', () => {
    const s = passOnFour().place('passOdds', 1_000, { on: { typeId: 'pass' } })
    const odds = spotOf(legal(s), 'passOdds', { parentId: 'b1' })
    expect(odds).toMatchObject({ betId: 'b2', amount: 1_000, minAdd: 100, maxAdd: 1_000 })
    expect(odds.canRemove).toBeNull()
  })

  it('each come bet on a number is a spot of its own, beside the box', () => {
    const s = passOnFour().place('come', 1_000).roll(3, 3).place('come', 500)
    const spots = legal(s).filter((spot) => spot.typeId === 'come')
    expect(spots.map((spot) => [spot.number, spot.betId, spot.canAdd?.code ?? null])).toEqual([
      [null, 'b3', null],
      [6, 'b2', 'CONTRACT_BET'],
    ])
    const odds = legal(s).filter((spot) => spot.typeId === 'comeOdds')
    expect(odds.map((spot) => [spot.parentId, spot.canAdd?.code ?? null])).toEqual([
      ['b2', null],
      ['b3', 'PARENT_NOT_ON_POINT'],
    ])
  })

  it('a bet already up grows by its increment, up to its type’s maximum', () => {
    const s = scenario('craplessBubble').place('pass', 300)
    expect(spotOf(legal(s), 'pass')).toMatchObject({ canAdd: null, minAdd: 100, maxAdd: 49_700 })
  })
})
