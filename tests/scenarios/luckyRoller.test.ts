import { describe, expect, it } from 'vitest'
import { legalBets } from '../../src/engine/bets/legal.ts'
import type { BetId } from '../../src/engine/bets/types.ts'
import { cents } from '../../src/engine/core/money.ts'
import { scenario } from './dsl.ts'

// Lucky Roller machine facts (Low Rolls / All Small, High Rolls / All Tall, Roll 'Em All; rules
// spec §2.6, §6.4, §5.2), played through the table reducer. Amounts are cents; every machine starts
// with $500, and a roll on an Interblock machine keeps at least $5 of main-game bets working.

const bit = (total: number) => 1 << total
const SMALL = bit(2) | bit(3) | bit(4) | bit(5) | bit(6)

describe('Interblock Lucky Roller on the crapless machine [V IB §6.2]', () => {
  it('a come-out 7 loses Low Rolls while the pass line wins (plan §10 M11)', () => {
    scenario('craplessBubble')
      .expectProvenance('/sideBets/luckyRollerLow', 'verified')
      .expectProvenance('/sideBets/luckyRollerLow/endsOn', 'verified')
      .place('pass', 500)
      .place('luckyRollerLow', 100)
      .expectBankroll(49_400)
      .roll(3, 4)
      .expect({ transition: 'natural' })
      .expectEvents(['diceRolled', 'natural', 'betResolved', 'betResolved'])
      .expectSettled({ typeId: 'pass' }, { outcome: 'win', credited: 500 })
      .expectSettled(
        { typeId: 'luckyRollerLow' },
        { outcome: 'lose', credited: 0, stakeDisposition: 'lost' },
      )
      .expectBets([['pass', null, 500]])
      .expectBankroll(49_900)
  })

  it('completing the set pays 30 to 1 at once, repeats ignored, the bet coming down (plan §10 M11) [R]', () => {
    scenario('craplessBubble')
      .expectProvenance('/sideBets/luckyRollerLow/pays', 'reported')
      .place('pass', 500)
      .place('luckyRollerLow', 100)
      .roll(1, 1)
      .expect({ transition: 'pointEstablished', point: 2 })
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled', 'betProgress'])
      .expectBet({ typeId: 'luckyRollerLow' }, { progress: bit(2) })
      .roll(1, 2)
      .expectEvents(['diceRolled', 'betProgress'])
      .roll(2, 2)
      .roll(1, 4)
      .expectBet({ typeId: 'luckyRollerLow' }, { progress: bit(2) | bit(3) | bit(4) | bit(5) })
      // The point repeats: the pass line wins, and the 2 adds nothing to the set.
      .roll(1, 1)
      .expect({ transition: 'pointMade' })
      .expectEvents(['diceRolled', 'pointMade', 'betResolved'])
      .expectSettled(
        { typeId: 'pass' },
        { outcome: 'win', credited: 500, stakeDisposition: 'stays' },
      )
      .expectBankroll(49_900)
      // The 6 completes the set on the come-out roll that sets the new point.
      .roll(3, 3)
      .expect({ transition: 'pointEstablished', point: 6 })
      .expectSettled(
        { typeId: 'luckyRollerLow' },
        {
          outcome: 'win',
          payKey: 'set',
          ratioLabel: '31 for 1',
          winExact: '3000',
          winPaid: 3_000,
          credited: 3_100,
          stakeDisposition: 'returned',
        },
      )
      .expectBets([['pass', 6, 500]])
      .expectBankroll(53_000)
      // No new bet of the type after a win until a 7 [V IB §6.2.1].
      .expectReject('WINDOW_CLOSED', (a) => a.place('luckyRollerLow', 100), {
        typeId: 'luckyRollerLow',
        reason: 'afterSevenOrStart',
        until: 'nextSeven',
      })
  })

  it('is bet only right after a 7 of any kind, or before the first roll of the cycle [V IB §6.2]', () => {
    scenario('craplessBubble')
      .expectProvenance('/sideBets/luckyRollerHigh/placement', 'verified')
      .place('pass', 500)
      .place('luckyRollerHigh', 100)
      .roll(2, 2)
      .expectReject('WINDOW_CLOSED', (a) => a.place('luckyRollerLow', 100), {
        typeId: 'luckyRollerLow',
        reason: 'afterSevenOrStart',
        until: 'nextSeven',
      })
      .roll(3, 4)
      .expect({ transition: 'sevenOut', rollsSinceSeven: 0 })
      .expectSettled({ typeId: 'luckyRollerHigh' }, { outcome: 'lose' })
      .expectBets([])
      .place('luckyRollerLow', 100)
      .place('pass', 500)
      .roll(3, 4)
      .expect({ transition: 'natural', rollsSinceSeven: 0 })
      .expectSettled({ typeId: 'luckyRollerLow' }, { outcome: 'lose' })
      .place('luckyRollerAll', 100)
      .expectBets([
        ['pass', null, 500],
        ['luckyRollerAll', null, 100],
      ])
  })

  it('is free until its first roll, then locked until it wins or a 7 rolls [A]', () => {
    scenario('craplessBubble')
      .place('pass', 500)
      .place('luckyRollerLow', 100)
      .place('luckyRollerLow', 100)
      .expectEvents(['betAdjusted'])
      .expectBet({ typeId: 'luckyRollerLow' }, { amount: 200 })
      .setAmount({ typeId: 'luckyRollerLow' }, 100)
      .takeDown({ typeId: 'luckyRollerLow' })
      .expectNoBet({ typeId: 'luckyRollerLow' })
      .place('luckyRollerLow', 300)
      .expectBankroll(49_200)
      .roll(2, 2)
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'luckyRollerLow' }, 400), {
        change: 'increase',
      })
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'luckyRollerLow' }, 200), {
        change: 'decrease',
      })
      .expectReject('CONTRACT_BET', (a) => a.takeDown({ typeId: 'luckyRollerLow' }), {
        change: 'remove',
      })
      .expectReject('CONTRACT_BET', (a) => a.place('luckyRollerLow', 100), {
        typeId: 'luckyRollerLow',
        betId: 'b3',
        change: 'increase',
      })
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'luckyRollerLow' }, false))
      .setGlobalWorking(true)
      .expectBet({ typeId: 'luckyRollerLow' }, { working: true, amount: 300 })
  })

  it('does not count toward the $5 minimum [A §9 #11]; takes no number, parent, odd amount', () => {
    scenario('craplessBubble')
      .expectProvenance('/limits/minTotal/countSideBets', 'assumed')
      .place('luckyRollerLow', 500)
      .expectReject('BELOW_MIN_TOTAL', (a) => a.roll(2, 2), { total: 0, short: 500 })
      .expectReject('BAD_PARAMS', (a) => a.place('luckyRollerHigh', 100, { number: 8 }), {
        field: 'number',
      })
      .expectReject(
        'BAD_PARAMS',
        {
          type: 'place',
          typeId: 'luckyRollerHigh',
          parentId: 'b1' as BetId,
          amount: cents(100),
        },
        { field: 'parentId' },
      )
      .expectReject('BELOW_MIN', (a) => a.place('luckyRollerHigh', 50), { min: 100 })
      .expectReject('BAD_INCREMENT', (a) => a.place('luckyRollerHigh', 150))
      .expectReject('ABOVE_MAX', (a) => a.place('luckyRollerHigh', 50_100), { max: 50_000 })
  })

  it('legalBets lists the side-bet spots only when asked, with the window and the lock', () => {
    const s = scenario('craplessBubble')
    const main = legalBets(s.state, s.cfg)
    expect(main.some((spot) => s.cfg.sideBets.has(spot.typeId))).toBe(false)
    const all = legalBets(s.state, s.cfg, { sideBets: true })
    expect(all.slice(0, main.length)).toEqual(main)
    expect(all.slice(main.length).map((spot) => spot.typeId)).toEqual([
      'luckyRollerLow',
      'luckyRollerHigh',
      'luckyRollerAll',
    ])
    expect(all.find((spot) => spot.typeId === 'luckyRollerLow')).toEqual({
      typeId: 'luckyRollerLow',
      number: null,
      parentId: null,
      betId: null,
      amount: 0,
      canAdd: null,
      minAdd: 100,
      maxAdd: 50_000,
      canRemove: { code: 'BET_NOT_FOUND', details: { typeId: 'luckyRollerLow' } },
    })
    s.place('pass', 500).place('luckyRollerLow', 100)
    const placed = legalBets(s.state, s.cfg, { sideBets: true })
    expect(placed.find((spot) => spot.typeId === 'luckyRollerLow')).toMatchObject({
      betId: 'b2',
      amount: 100,
      canAdd: null,
      minAdd: 100,
      maxAdd: 49_400,
      canRemove: null,
    })
    s.roll(2, 2)
    const later = legalBets(s.state, s.cfg, { sideBets: true })
    expect(later.find((spot) => spot.typeId === 'luckyRollerLow')).toMatchObject({
      betId: 'b2',
      amount: 100,
      canAdd: { code: 'CONTRACT_BET' },
      minAdd: 0,
      maxAdd: 0,
      canRemove: { code: 'CONTRACT_BET' },
    })
    expect(later.find((spot) => spot.typeId === 'luckyRollerHigh')).toMatchObject({
      betId: null,
      canAdd: { code: 'WINDOW_CLOSED' },
      minAdd: 0,
      maxAdd: 0,
    })
  })
})

describe('Shoot To Win Lucky Roller: before any roll, with none of the type active [V STWO §7.3]', () => {
  it('goes up mid-hand, one bet of each type at a time, and any 7 ends it', () => {
    scenario('traditionalBubble')
      .expectProvenance('/sideBets/luckyRollerLow/placement', 'verified')
      .expectProvenance('/sideBets/luckyRollerLow/pays', 'assumed')
      .place('pass', 300)
      .roll(2, 2)
      .place('luckyRollerLow', 100)
      .roll(3, 3)
      .expectBet({ typeId: 'luckyRollerLow' }, { progress: bit(6) })
      .expectReject('CONTRACT_BET', (a) => a.place('luckyRollerLow', 100), { change: 'increase' })
      .place('luckyRollerHigh', 100)
      .roll(5, 2)
      .expect({ transition: 'sevenOut' })
      .expectSettled({ typeId: 'luckyRollerLow' }, { outcome: 'lose' })
      .expectSettled({ typeId: 'luckyRollerHigh' }, { outcome: 'lose' })
      .expectBets([])
      .place('luckyRollerLow', 100)
      .expectBets([['luckyRollerLow', null, 100]])
  })
})

describe('the strict machine pays Roll ’Em All 150 to 1 [A GALAXY-WA; WOO-BONUS]', () => {
  it('all ten numbers before a 7, on a $1 bet, pay $150', () => {
    scenario('strictBubble')
      .expectProvenance('/sideBets/luckyRollerAll/pays', 'assumed')
      .place('place', 600, { number: 6 })
      .place('luckyRollerAll', 100)
      .roll(1, 1)
      .roll(1, 2)
      .roll(2, 2)
      .roll(1, 4)
      .roll(3, 3)
      .roll(4, 4)
      .roll(4, 5)
      .roll(5, 5)
      .roll(5, 6)
      .expectBet(
        { typeId: 'luckyRollerAll' },
        { amount: 100, progress: SMALL | bit(8) | bit(9) | bit(10) | bit(11) },
      )
      .roll(6, 6)
      .expectSettled(
        { typeId: 'luckyRollerAll' },
        { outcome: 'win', ratioLabel: '151 for 1', winPaid: 15_000, credited: 15_100 },
      )
      .expectBankroll(65_100)
  })
})
