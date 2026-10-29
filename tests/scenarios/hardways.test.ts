import { describe, it } from 'vitest'
import { craplessBubble } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { cents } from '../../src/engine/core/money.ts'
import type { BetId } from '../../src/engine/bets/types.ts'
import { scenario } from './dsl.ts'

// Hardway machine facts (rules spec §2.2, §2.4, §3.3, §5.2), played through the table reducer.
// Amounts are cents; every machine starts with $500. Each roll on a machine with a minimum total
// keeps at least that much working on the table.

/** Crapless bubble with its hardways OFF on the come-out, as in Atlantic City and Maryland. */
function hardOffOnComeOut(): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  const hard = input.catalog.hard
  if (hard?.family !== 'hardway') throw new Error('craplessBubble has no hardways')
  hard.comeOutDefault = 'off'
  input.id = 'craplessHardOff'
  input.provenance['/catalog/hard/comeOutDefault'] = {
    status: 'assumed',
    note: 'A test machine whose hardways are OFF on the come-out, as in Atlantic City (§2.4).',
  }
  return input
}

describe('hard 6 wins on its pair and loses the easy way or on any 7 (§3.3)', () => {
  it('Interblock: 3-3 pays $45 on $5 and the bet stays up; 5-1 and a seven-out lose it', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/hard', 'verified')
      .expectProvenance('/catalog/hard/pays', 'assumed')
      .expectProvenance('/catalog/hard/afterWin', 'assumed')
      .place('pass', 500)
      .roll(2, 3)
      .place('hard', 500, { number: 6 })
      .expectBankroll(49_000)
      .roll(3, 3)
      .expectSettled(
        { typeId: 'hard', number: 6 },
        {
          outcome: 'win',
          ratioLabel: '9:1',
          winPaid: 4_500,
          credited: 4_500,
          stakeDisposition: 'stays',
        },
      )
      .expectBets([
        ['pass', 5, 500],
        ['hard', 6, 500],
      ])
      .expectBankroll(53_500)
      .roll(5, 1)
      .expectSettled(
        { typeId: 'hard', number: 6 },
        { outcome: 'lose', credited: 0, stakeDisposition: 'lost' },
      )
      .expectBets([['pass', 5, 500]])
      .place('hard', 500, { number: 6 })
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectSettled({ typeId: 'hard', number: 6 }, { outcome: 'lose' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose' })
      .expectBets([])
      .expectBankroll(53_000)
  })

  it('Shoot To Win: 9 to 1 on the hard 6 and 7 to 1 on the hard 10, riding after the win', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/hard', 'verified')
      .expectProvenance('/catalog/hard/afterWin', 'verified')
      .place('pass', 500)
      .roll(4, 4)
      .place('hard', 200, { number: 6 })
      .place('hard', 100, { number: 10 })
      .roll(3, 3)
      .expectSettled({ typeId: 'hard', number: 6 }, { ratioLabel: '9 to 1', winPaid: 1_800 })
      .roll(5, 5)
      .expectSettled({ typeId: 'hard', number: 10 }, { ratioLabel: '7 to 1', winPaid: 700 })
      .expectBets([
        ['pass', 8, 500],
        ['hard', 6, 200],
        ['hard', 10, 100],
      ])
      .roll(6, 4)
      .expectSettled({ typeId: 'hard', number: 10 }, { outcome: 'lose' })
      .expectBets([
        ['pass', 8, 500],
        ['hard', 6, 200],
      ])
      .expectBankroll(51_700)
  })

  it('Interblock: a come-out 2-2 sets point 4 and wins the hard 4 on the same roll', () => {
    scenario('craplessBubble')
      .place('pass', 500)
      .place('hard', 100, { number: 4 })
      .roll(2, 2)
      .expect({ transition: 'pointEstablished', point: 4 })
      .expectSettled({ typeId: 'hard', number: 4 }, { outcome: 'win', winPaid: 700 })
      .expectBets([
        ['pass', 4, 500],
        ['hard', 4, 100],
      ])
  })
})

describe('hardways on the come-out, per machine (§2.4)', () => {
  it('Shoot To Win: OFF on the come-out, new [A §9 #7] or carried [V CW §4]; a 7 and their pair leave them', () => {
    // Placed for the first come-out, the hard 6 is a new chip; by the second it is carried.
    scenario('traditionalBubble')
      .expectProvenance('/catalog/hard/comeOutDefault', 'verified')
      .expectProvenance('/comeOut/autoOff/newlyPlaced', 'assumed')
      .expectProvenance('/comeOut/autoOff/carried', 'verified')
      .place('pass', 500)
      .place('hard', 500, { number: 6 })
      .expectBet({ typeId: 'hard' }, { working: false })
      .roll(3, 4)
      .expect({ transition: 'natural' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'win', stakeDisposition: 'stays' })
      .expectBets([
        ['pass', null, 500],
        ['hard', 6, 500],
      ])
      .roll(3, 3)
      .expect({ transition: 'pointEstablished', point: 6 })
      .expectBets([
        ['pass', 6, 500],
        ['hard', 6, 500],
      ])
      .expectBet({ typeId: 'hard' }, { working: true })
      .roll(3, 3)
      .expect({ transition: 'pointMade' })
      .expectSettled({ typeId: 'hard', number: 6 }, { outcome: 'win', winPaid: 4_500 })
      .expectBet({ typeId: 'hard' }, { working: false })
      .expectBankroll(54_500)
  })

  it('Interblock: ON on the come-out [A §9 #5], so a come-out 7 loses them', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/hard/comeOutDefault', 'assumed')
      .place('pass', 500)
      .place('hard', 100, { number: 8 })
      .expectBet({ typeId: 'hard' }, { working: true })
      .roll(5, 2)
      .expectSettled({ typeId: 'hard', number: 8 }, { outcome: 'lose' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'win', credited: 500 })
      .expectBets([['pass', null, 500]])
      .expectBankroll(49_900)
  })

  it('a machine with hardways OFF on the come-out keeps them through a come-out 7', () => {
    scenario(hardOffOnComeOut())
      .expectProvenance('/catalog/hard/comeOutDefault', 'assumed')
      .place('pass', 500)
      .place('hard', 500, { number: 6 })
      .expectBet({ typeId: 'hard' }, { working: false })
      .roll(6, 1)
      .expectBets([
        ['pass', null, 500],
        ['hard', 6, 500],
      ])
      .roll(5, 1)
      .expect({ point: 6 })
      .expectBet({ typeId: 'hard' }, { working: true })
      .roll(4, 2)
      .expect({ transition: 'pointMade' })
      .expectSettled({ typeId: 'hard', number: 6 }, { outcome: 'lose' })
  })
})

describe('switching hardways OFF (§2.4)', () => {
  it('Interblock "Set bets Off" covers hardways [V IB §3.2]: OFF, a pair and a 7 leave them', () => {
    scenario('craplessBubble')
      .expectProvenance('/workingToggle', 'verified')
      .place('pass', 500)
      .roll(4, 4)
      .place('hard', 500, { number: 4 })
      .setGlobalWorking(true)
      .expectBet({ typeId: 'hard' }, { working: false })
      .roll(2, 2)
      .expectBets([
        ['pass', 8, 500],
        ['hard', 4, 500],
      ])
      .roll(5, 2)
      .expect({ transition: 'sevenOut' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose' })
      .expectBets([['hard', 4, 500]])
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'hard' }, true))
      .setGlobalWorking(false)
      .expectBet({ typeId: 'hard' }, { working: true })
      .place('pass', 500)
      .roll(2, 2)
      .expectSettled({ typeId: 'hard', number: 4 }, { outcome: 'win', winPaid: 3_500 })
      .expectBankroll(52_000)
  })

  it('a live table calls one hardway off [V WOO-B]; it stays up through a seven-out', () => {
    scenario('traditionalLive345')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('hard', 500, { number: 10 })
      .setWorking({ typeId: 'hard' }, false)
      .expectBet({ typeId: 'hard' }, { working: false })
      .roll(5, 5)
      .expectBets([
        ['pass', 6, 1_000],
        ['hard', 10, 500],
      ])
      .roll(3, 4)
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose' })
      .expectBets([['hard', 10, 500]])
      .setWorking({ typeId: 'hard' }, null)
      .expectBet({ typeId: 'hard' }, { working: true })
  })
})

describe('placing and changing hardways', () => {
  it('name one of 4, 6, 8 and 10, on any roll; press, reduce and take down freely', () => {
    scenario('craplessBubble')
      .expectReject('BAD_PARAMS', (a) => a.place('hard', 500), { field: 'number' })
      .expectReject(
        'BAD_PARAMS',
        { type: 'place', typeId: 'hard', number: 6, parentId: 'b1' as BetId, amount: cents(500) },
        { field: 'parentId' },
      )
      .expectReject('BAD_PARAMS', (a) => a.place('hard', 500, { number: 5 }), { field: 'number' })
      .expectReject('BAD_PARAMS', (a) => a.place('hard', 500, { number: 12 }), {
        field: 'number',
      })
      .expectReject('BAD_INCREMENT', (a) => a.place('hard', 150, { number: 6 }))
      .place('hard', 500, { number: 6 })
      .place('hard', 500, { number: 6 })
      .expectEvents(['betAdjusted'])
      .expectBets([['hard', 6, 1_000]])
      .expectReject('ABOVE_MAX', (a) => a.place('hard', 49_100, { number: 6 }), { max: 50_000 })
      .setAmount({ typeId: 'hard', number: 6 }, 300)
      .place('hard', 200, { number: 8 })
      .place('pass', 500)
      .roll(4, 4)
      .expectSettled({ typeId: 'hard', number: 8 }, { outcome: 'win', winPaid: 1_800 })
      .setAmount({ typeId: 'hard', number: 8 }, 600)
      .takeDown({ typeId: 'hard', number: 6 })
      .expectBets([
        ['hard', 8, 600],
        ['pass', 8, 500],
      ])
  })
})
