import { describe, expect, it } from 'vitest'
import { craplessBubble, traditionalBubble } from '../../src/engine/config/presets/index.ts'
import type { CommissionInput, MachineConfigInput } from '../../src/engine/config/schema.ts'
import { withoutPostedMinimums } from '../properties/machineVariants.ts'
import { scenario } from './dsl.ts'
import { numberPlay } from './numberPlay.ts'

// Commission machine facts (rules spec §4.2, §4.3, §4.5, §9 #3), played through the table
// reducer: when buy and lay commission is charged, from what, how it is rounded, refunded and
// re-collected, and what it costs in credit. Amounts are cents; every machine starts with $500.

/** Crapless bubble whose buy commission is changed, under a new id. */
function craplessBuy(id: string, change: Partial<CommissionInput>): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  const buy = input.catalog.buy
  if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
  buy.commission = { ...buy.commission, ...change }
  input.id = id
  return input
}

describe('Shoot To Win: commission comes off the win (§4.3)', () => {
  it('$25 buy 4, 5% of the bet off the win, credits $48.75 and stays up [V CW §18d] (plan §10 M4b)', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/buy/commission/timing', 'verified')
      .expectProvenance('/catalog/buy/commission/basis', 'verified')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('buy', 2_500, { number: 4 })
      .expectEvents(['betPlaced'])
      .expectLedger({ vigPaid: 0 })
      .roll(2, 2)
      .expectEvents(['diceRolled', 'betResolved'])
      .expectSettled(
        { typeId: 'buy', number: 4 },
        {
          winPaid: 5_000,
          vigOnWin: 125,
          vigRearm: 0,
          credited: 4_875,
          stakeDisposition: 'stays',
        },
      )
      .expectLedger({ bankroll: 51_375, vigPaid: 125 })
  })

  it('a lay pays 5% of its win, off the win [V CW §20d]; a sub-cent vig rounds up [A §9 #2]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/lay/commission/basis', 'verified')
      .expectProvenance('/catalog/lay/commission/rounding', 'assumed')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('lay', 2_000, { number: 4 })
      .place('lay', 100, { number: 10 })
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectSettled(
        { typeId: 'lay', number: 4 },
        { winPaid: 1_000, vigOnWin: 50, credited: 950, stakeDisposition: 'stays' },
      )
      .expectSettled({ typeId: 'lay', number: 10 }, { winPaid: 50, vigOnWin: 3, credited: 47 })
      .expectBets([
        ['lay', 4, 2_000],
        ['lay', 10, 100],
      ])
  })
})

describe('Interblock: commission paid up front (§4.3) [V IB §3.3]', () => {
  it('buy vig is charged on placement and on each increase, straight to the house', () => {
    const s = scenario('craplessBubble')
      .expectProvenance('/catalog/buy/commission/timing', 'verified')
      .expectProvenance('/catalog/buy/commission', 'reported')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('buy', 2_000, { number: 4 })
      .expectEvents(['betPlaced', 'vigCharged'])
      .expectLedger({ bankroll: 46_900, houseNet: 100, vigPaid: 100 })
    const buy = s.find({ typeId: 'buy' }).id
    expect(s.events[1]).toEqual({
      type: 'vigCharged',
      betId: buy,
      amount: 100,
      reason: 'placement',
    })
    s.place('buy', 1_000, { number: 4 })
      .expectEvents(['betAdjusted', 'vigCharged'])
      .expectLedger({ bankroll: 45_850, houseNet: 150, vigPaid: 150 })
    expect(s.events[1]).toEqual({ type: 'vigCharged', betId: buy, amount: 50, reason: 'increase' })
    s.setAmount({ typeId: 'buy' }, 4_000)
      .expectEvents(['betAdjusted', 'vigCharged'])
      .expectLedger({ vigPaid: 200 })
  })

  it('it is not refunded when the buy is cut or taken down [A §9 #3]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/buy/commission/refundOnTakeDown', 'assumed')
      .place('buy', 4_000, { number: 4 })
      .setAmount({ typeId: 'buy' }, 2_000)
      .expectEvents(['betAdjusted'])
      .takeDown({ typeId: 'buy' })
      .expectEvents(['betRemoved'])
      .expectLedger({ bankroll: 49_800, houseNet: 200, vigPaid: 200 })
  })

  it('stake and vig must both fit the credit: declining the vig removes the bet [V IB §3.3]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/buy/commission/timing', 'verified')
      .place('pass', 48_000)
      .expectReject('INSUFFICIENT_CREDIT', (a) => a.place('buy', 2_000, { number: 4 }), {
        needed: 2_100,
        available: 2_000,
      })
      .place('buy', 1_900, { number: 4 })
      .expectBankroll(5)
  })

  it('a lay pays 5% of what it would win: "$0.05 commission" on a $2 lay on 4 [R IB §3.3]', () => {
    const s = scenario('strictBubble')
      .expectProvenance('/catalog/lay/commission', 'reported')
      .place('lay', 200, { number: 4 })
      .expectEvents(['betPlaced', 'vigCharged'])
    expect(s.events[1]).toMatchObject({ amount: 5, reason: 'placement' })
  })
})

describe('re-collecting up-front vig from a winner that stays up (`rearm`, plan §10 M4b)', () => {
  it('Interblock re-collects it from the win, with a vigCharged event [A §9 #3]', () => {
    const s = scenario('craplessBubble')
      .expectProvenance('/catalog/buy/commission/rearm', 'assumed')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('buy', 2_000, { number: 4 })
      .roll(2, 2)
      .expectEvents(['diceRolled', 'betResolved', 'vigCharged'])
      .expectSettled(
        { typeId: 'buy', number: 4 },
        { winPaid: 4_000, vigRearm: 100, credited: 3_900, stakeDisposition: 'stays' },
      )
      .expectLedger({ bankroll: 50_800, houseNet: -3_800, vigPaid: 200 })
    expect(s.events[2]).toEqual({
      type: 'vigCharged',
      betId: s.find({ typeId: 'buy' }).id,
      amount: 100,
      reason: 'rearm',
      from: 'win',
    })
  })

  it('with rearm none the win is paid in full and nothing is charged again', () => {
    scenario(craplessBuy('craplessRearmNone', { rearm: 'none' }))
      .expectProvenance('/catalog/buy/commission/rearm', 'assumed')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('buy', 2_000, { number: 4 })
      .roll(2, 2)
      .expectEvents(['diceRolled', 'betResolved'])
      .expectSettled({ typeId: 'buy', number: 4 }, { vigRearm: 0, credited: 4_000 })
      .expectLedger({ bankroll: 50_900, vigPaid: 100 })
  })

  it('recollectFromCredit charges it to credit after the win is paid', () => {
    const s = scenario(craplessBuy('craplessRearmCredit', { rearm: 'recollectFromCredit' }))
      .place('pass', 1_000)
      .roll(3, 3)
      .place('buy', 2_000, { number: 4 })
      .roll(2, 2)
      .expectEvents(['diceRolled', 'betResolved', 'vigCharged'])
      .expectSettled({ typeId: 'buy', number: 4 }, { vigRearm: 0, credited: 4_000 })
      .expectLedger({ bankroll: 50_800, vigPaid: 200 })
    expect(s.events[2]).toMatchObject({ amount: 100, reason: 'rearm', from: 'credit' })
  })

  it('the re-collection is judged after the whole roll: the roll’s other payouts pay it (§4.5) [V HAR-PA]', () => {
    // A $1 lay on 4 wins 50¢, paid as $0 at a live table, and owes its $1 vig again. The credit is
    // $0 when the lay settles, but the Any 7 pays $25 on the same roll, so the vig comes out of
    // that and the lay stays up. (Since M12 the live preset posts "lay must win $20", so the $1 lay
    // plays on a copy without that minimum.)
    scenario(withoutPostedMinimums('traditionalLive345', ['lay']))
      .expectProvenance('/catalog/lay/commission/rearm', 'verified')
      .place('lay', 100, { number: 4 })
      .place('any7', 500)
      .place('place', 49_300, { number: 6 })
      .expectBankroll(0)
      .roll(3, 4)
      .expectEvents(['diceRolled', 'natural', 'betResolved', 'betResolved', 'vigCharged'])
      .expectSettled(
        { typeId: 'lay', number: 4 },
        { winPaid: 0, vigRearm: 0, credited: 0, stakeDisposition: 'stays' },
      )
      .expectSettled({ typeId: 'any7' }, { winPaid: 2_000, credited: 2_500 })
      .expectBets([
        ['lay', 4, 100],
        ['place', 6, 49_300],
      ])
      .expectLedger({ bankroll: 2_400, houseNet: -1_800, vigPaid: 200 })
  })

  it('credit that exactly covers the re-collection pays it, and the bet stays up [V HAR-PA]', () => {
    const s = scenario(withoutPostedMinimums('traditionalLive345', ['lay']))
      .place('lay', 100, { number: 4 })
      .place('place', 49_700, { number: 6 })
      .expectBankroll(100)
      .roll(3, 4)
      .expectEvents(['diceRolled', 'natural', 'betResolved', 'vigCharged'])
      .expectSettled({ typeId: 'lay', number: 4 }, { winPaid: 0, credited: 0 })
      .expectBets([
        ['lay', 4, 100],
        ['place', 6, 49_700],
      ])
      .expectLedger({ bankroll: 0, vigPaid: 200 })
    expect(s.events[3]).toEqual({
      type: 'vigCharged',
      betId: s.find({ typeId: 'lay' }).id,
      amount: 100,
      reason: 'rearm',
      from: 'credit',
    })
    expect(s.find({ typeId: 'lay' }).vigHeld).toBe(100)
  })

  it('a re-collection the credit cannot pay takes the bet down, as declining the vig does [IB §3.3]', () => {
    const input = craplessBuy('craplessRearmUnpaid', {
      rearm: 'recollectFromCredit',
      minimum: 5_000,
    })
    // A $5 buy, so the bet alone meets the machine's $5 minimum total and the dice may roll.
    input.money.startingBankroll = 5_500
    scenario(input)
      .place('buy', 500, { number: 4 })
      .expectBankroll(0)
      .roll(2, 2)
      .expectEvents(['diceRolled', 'pointEstablished', 'betResolved', 'betRemoved'])
      .expectSettled({ typeId: 'buy', number: 4 }, { winPaid: 1_000, credited: 1_000 })
      .expectBets([])
      .expectLedger({ deposits: 5_500, bankroll: 1_500, houseNet: 4_000, vigPaid: 5_000 })
  })
})

describe('live tables: vig floored to the dollar, $1 minimum, refunded on take-down [V HAR-PA]', () => {
  it('a $40 buy on 5 pays $2 up front; cut to $20 it gets $1 back, taken down the rest', () => {
    const s = scenario('traditionalLive345')
      .expectProvenance('/catalog/buy/commission/refundOnTakeDown', 'verified')
      .expectProvenance('/catalog/buy/commission/minimum', 'verified')
      .place('buy', 4_000, { number: 5 })
      .expectEvents(['betPlaced', 'vigCharged'])
      .setAmount({ typeId: 'buy' }, 2_000)
      .expectEvents(['betAdjusted', 'vigRefunded'])
    expect(s.events[1]).toMatchObject({ amount: 100 })
    s.takeDown({ typeId: 'buy' })
      .expectEvents(['betRemoved', 'vigRefunded'])
      .expectLedger({ bankroll: 50_000, houseNet: 0, vigPaid: 0 })
  })

  it('buy 4 on the win [R WOO-B]: $25 nets $49; a $10 buy pays the $1 minimum up front', () => {
    // HAR-PA's minimum buy is $20 (M12), so the $10 buy plays on a copy without that minimum.
    scenario(withoutPostedMinimums('traditionalLive345', ['buy']))
      .expectProvenance('/catalog/buy/commissionByNumber', 'reported')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('buy', 2_500, { number: 4 })
      .expectEvents(['betPlaced'])
      .place('buy', 1_000, { number: 9 })
      .expectEvents(['betPlaced', 'vigCharged'])
      .roll(2, 2)
      .expectSettled(
        { typeId: 'buy', number: 4 },
        { winPaid: 5_000, vigOnWin: 100, credited: 4_900 },
      )
  })
})

describe('5% of the win on a buy: the Isle Pompano / Interblock settlement [V TCA]', () => {
  it('"a $20 bet paying 2:1 ($60 due) returned $58"', () => {
    const input = structuredClone(traditionalBubble)
    const buy = input.catalog.buy
    if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
    buy.commission = { ...buy.commission, basis: 'win' }
    buy.afterWin = 'return'
    input.id = 'isleBuy'
    scenario(input)
      .place('pass', 1_000)
      .roll(3, 3)
      .place('buy', 2_000, { number: 4 })
      .roll(2, 2)
      .expectSettled(
        { typeId: 'buy', number: 4 },
        { winPaid: 4_000, vigOnWin: 200, credited: 5_800, stakeDisposition: 'returned' },
      )
      .expectBets([['pass', 6, 1_000]])
  })
})

describe('seeded random play with number bets (quick subset; the slow suite runs more)', () => {
  it('keeps the ledger and the commission the events report, and replays exactly', () => {
    const counts = numberPlay(120, 120)
    // With seed 20261028: 2805 rolls, 244 number bets, 287 of their settlements, 145 commission
    // events and 3 machine switches. The floors leave room for engine changes.
    expect(counts.rolls).toBeGreaterThan(1_500)
    expect(counts.numberBets).toBeGreaterThan(150)
    expect(counts.numberSettlements).toBeGreaterThan(150)
    expect(counts.vigEvents).toBeGreaterThan(80)
    expect(counts.machineSwitches).toBeGreaterThan(0)
  })
})
