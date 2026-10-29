import { describe, it } from 'vitest'
import { scenario } from './dsl.ts'

// Researched machine facts (rules spec §2.4, §3, §4, §5.2) that the per-family scenario files left
// uncovered when M4 was integrated, one block per preset, each with the provenance of the config
// value it rests on. The M4 rows of plan §13 say which file covers every other fact. Amounts are
// cents; every machine starts with $500.

describe('craplessBubble (Interblock heads-up crapless)', () => {
  it('BETS ARE NOT VALID YET until the bets add up to $5 [V IB §3.2; $5 A]', () => {
    scenario('craplessBubble')
      .expectProvenance('/limits/minTotal', 'verified')
      .expectProvenance('/limits/minTotal/amount', 'assumed')
      .expectReject('BELOW_MIN_TOTAL', (a) => a.roll(3, 4), {
        scope: 'totalRound',
        min: 500,
        total: 0,
        short: 500,
      })
      .place('pass', 300)
      .expectReject('BELOW_MIN_TOTAL', (a) => a.roll(3, 4), { total: 300, short: 200 })
      .place('field', 200)
      .roll(3, 4)
      .expectBankroll(49_800)
      .expectBets([['pass', null, 300]])
      // The field is gone after its roll, so the table is short again.
      .expectReject('BELOW_MIN_TOTAL', (a) => a.roll(3, 4), { total: 300, short: 200 })
  })

  it('a bet is $1 to $500, in whole dollars [A]', () => {
    scenario('craplessBubble')
      .expectProvenance('/limits/min', 'assumed')
      .expectProvenance('/limits/max', 'assumed')
      .expectProvenance('/money/betIncrement', 'assumed')
      .expectReject('BELOW_MIN', (a) => a.place('field', 50), { min: 100 })
      .expectReject('BAD_INCREMENT', (a) => a.place('field', 150), { increment: 100 })
      .expectReject('ABOVE_MAX', (a) => a.place('pass', 50_100), { max: 50_000 })
      .place('pass', 50_000)
      .expectBankroll(0)
  })

  it('come is bet only with a point on [A §9 #26], and a winning come bet comes back [A]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/come/window', 'assumed')
      .expectProvenance('/catalog/come/afterWin', 'assumed')
      .place('pass', 500)
      .expectReject('WRONG_PHASE', (a) => a.place('come', 500), { window: 'point' })
      .roll(2, 2)
      .place('come', 500)
      .roll(3, 3)
      .expectBet({ typeId: 'come' }, { number: 6, amount: 500 })
      .roll(5, 1)
      .expectSettled(
        { typeId: 'come', number: 6 },
        { winPaid: 500, credited: 1_000, stakeDisposition: 'returned' },
      )
      .expectNoBet({ typeId: 'come' })
      .expectBankroll(50_000)
  })

  it('place 4 and 10 pay 9:5, place 5 and 9 pay 7:5 [A CW §17, WOO-B], and stay up', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/place/pays/4', 'assumed')
      .expectProvenance('/catalog/place/pays/9', 'assumed')
      .place('pass', 500)
      .roll(4, 4)
      .place('place', 500, { number: 4 })
      .place('place', 500, { number: 5 })
      .place('place', 500, { number: 9 })
      .place('place', 500, { number: 10 })
      .roll(3, 1)
      .expectSettled(
        { typeId: 'place', number: 4 },
        { ratioLabel: '9:5', winPaid: 900, stakeDisposition: 'stays' },
      )
      .roll(4, 1)
      .expectSettled({ typeId: 'place', number: 5 }, { ratioLabel: '7:5', winPaid: 700 })
      .roll(5, 4)
      .expectSettled({ typeId: 'place', number: 9 }, { ratioLabel: '7:5', winPaid: 700 })
      .roll(6, 4)
      .expectSettled({ typeId: 'place', number: 10 }, { ratioLabel: '9:5', winPaid: 900 })
      .expectBankroll(50_700)
  })

  it('a winning buy stays up, its up-front vig taken again from the win [A §5.2, §9 #3]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/buy/afterWin', 'assumed')
      .place('pass', 500)
      .roll(4, 4)
      .place('buy', 2_000, { number: 10 })
      .expectBankroll(47_400)
      .roll(6, 4)
      .expectSettled(
        { typeId: 'buy', number: 10 },
        { winPaid: 4_000, vigRearm: 100, credited: 3_900, stakeDisposition: 'stays' },
      )
      .expectBet({ typeId: 'buy' }, { number: 10, amount: 2_000 })
      .expectBankroll(51_300)
  })
})

describe('traditionalBubble (Shoot To Win)', () => {
  it('pass odds go up to 2x the bet and pay true odds [V CW §6]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/passOdds/limit', 'verified')
      .expectProvenance('/catalog/passOdds/pays', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .expectReject('ODDS_LIMIT', (a) => a.place('passOdds', 2_100), { max: 2_000 })
      .place('passOdds', 2_000)
      .roll(3, 1)
      .expectSettled(
        { typeId: 'passOdds' },
        { ratioLabel: '2 to 1', winPaid: 4_000, credited: 6_000, stakeDisposition: 'returned' },
      )
      .expectBankroll(54_000)
  })

  it('place 4 pays 9 to 5 and place 9 pays 7 to 5 [V CW §17]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/place/pays', 'verified')
      .place('pass', 500)
      .roll(4, 4)
      .place('place', 500, { number: 4 })
      .place('place', 500, { number: 9 })
      .roll(3, 1)
      .expectSettled(
        { typeId: 'place', number: 4 },
        { ratioLabel: '9 to 5', winPaid: 900, stakeDisposition: 'stays' },
      )
      .roll(5, 4)
      .expectSettled({ typeId: 'place', number: 9 }, { ratioLabel: '7 to 5', winPaid: 700 })
      .expectBankroll(50_100)
  })

  it('the bets must add up to $3 [V STWO; $3 A], each $1 to $500 [A]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/limits/minTotal/amount', 'assumed')
      .expectProvenance('/limits/max', 'assumed')
      .place('pass', 100)
      .expectReject('BELOW_MIN_TOTAL', (a) => a.roll(3, 4), { min: 300, total: 100, short: 200 })
      .expectReject('ABOVE_MAX', (a) => a.place('field', 50_100), { max: 50_000 })
      .place('field', 200)
      .roll(3, 4)
  })

  it("a don't come bet on a number may be cut or taken down, not raised, and bet again [A §9 #8]", () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/dontCome/onNumber', 'assumed')
      .expectProvenance('/catalog/dontCome/rebetAfterRemove', 'assumed')
      .place('pass', 500)
      .roll(2, 2)
      .place('dontCome', 600)
      .roll(3, 3)
      .expectBet({ typeId: 'dontCome' }, { number: 6, amount: 600 })
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'dontCome' }, 1_000), {
        change: 'increase',
      })
      .setAmount({ typeId: 'dontCome' }, 300)
      .takeDown({ typeId: 'dontCome' })
      .place('dontCome', 500)
      .expectBet({ typeId: 'dontCome' }, { number: null, amount: 500 })
  })

  it("come and don't come exclude each other, in the box or on a number [V CW §9f; global per rules spec §5.2]", () => {
    scenario('traditionalBubble')
      .expectProvenance('/exclusiveGroups/1', 'verified')
      .place('pass', 500)
      .roll(2, 2)
      .place('come', 500)
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('dontCome', 500), {
        conflictsWith: 'come',
        scope: 'global',
      })
      .roll(3, 3)
      .expectBet({ typeId: 'come' }, { number: 6 })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('dontCome', 500), {
        conflictsWith: 'come',
      })
  })

  it("don't come odds are not on the auto-OFF list: a come-out 7 wins them [A CW §4; §0.2 #2]", () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/dontComeOdds/comeOutDefault', 'assumed')
      .expectProvenance('/catalog/dontComeOdds/limit', 'verified')
      .place('pass', 500)
      .roll(3, 3)
      .place('dontCome', 500)
      .roll(2, 2)
      .expectReject(
        'ODDS_LIMIT',
        (a) => a.place('dontComeOdds', 2_100, { on: { typeId: 'dontCome', number: 4 } }),
        { max: 2_000 },
      )
      .place('dontComeOdds', 1_000, { on: { typeId: 'dontCome', number: 4 } })
      .roll(4, 2)
      .expect({ transition: 'pointMade', point: null })
      .roll(5, 2)
      .expect({ transition: 'natural' })
      .expectSettled(
        { typeId: 'dontCome', number: 4 },
        { winPaid: 500, stakeDisposition: 'returned' },
      )
      .expectSettled({ typeId: 'dontComeOdds' }, { winPaid: 500, credited: 1_500 })
      .expectBankroll(51_500)
  })
})

describe('strictBubble (Interblock GV6.5 traditional)', () => {
  it('pass odds go up to 2x [R VA] and pay true odds [A]', () => {
    scenario('strictBubble')
      .expectProvenance('/catalog/passOdds/limit', 'reported')
      .expectProvenance('/catalog/passOdds/pays', 'assumed')
      .place('pass', 1_000)
      .roll(4, 1)
      .expectReject('ODDS_LIMIT', (a) => a.place('passOdds', 2_100), { max: 2_000 })
      .place('passOdds', 2_000)
      .roll(3, 2)
      .expectSettled({ typeId: 'passOdds' }, { ratioLabel: '3:2', winPaid: 3_000, credited: 5_000 })
      .expectBankroll(53_000)
  })

  it('buy vig is paid up front [V IB §3.3] and kept when the buy comes down [A §9 #3]', () => {
    scenario('strictBubble')
      .expectProvenance('/catalog/buy/commission/timing', 'verified')
      .expectProvenance('/catalog/buy/commission/refundOnTakeDown', 'assumed')
      .place('buy', 2_000, { number: 4 })
      .expectLedger({ bankroll: 47_900, vigPaid: 100 })
      .takeDown({ typeId: 'buy' })
      .expectLedger({ bankroll: 49_900, houseNet: 100, vigPaid: 100 })
  })

  it('the bets must add up to $5 [A]; big 6 pays even money [A] and stays up', () => {
    scenario('strictBubble')
      .expectProvenance('/limits/minTotal/amount', 'assumed')
      .expectProvenance('/catalog/big/pays', 'assumed')
      .place('pass', 300)
      .expectReject('BELOW_MIN_TOTAL', (a) => a.roll(2, 2), { min: 500, short: 200 })
      .place('pass', 200)
      .roll(2, 2)
      .place('big', 500, { number: 6 })
      .roll(5, 1)
      .expectSettled(
        { typeId: 'big', number: 6 },
        { ratioLabel: '1:1', winPaid: 500, stakeDisposition: 'stays' },
      )
  })

  it('place and buy each exclude a lay on the same number [V IB §2.6; same number A]', () => {
    scenario('strictBubble')
      .expectProvenance('/exclusiveGroups/2', 'verified')
      .expectProvenance('/exclusiveGroups/2/scope', 'assumed')
      .place('place', 600, { number: 6 })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('lay', 1_200, { number: 6 }), {
        conflictsWith: 'place',
        scope: 'sameNumber',
      })
      .place('lay', 1_200, { number: 8 })
      .place('buy', 2_000, { number: 4 })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('lay', 2_000, { number: 4 }), {
        conflictsWith: 'buy',
      })
  })
})

describe('traditionalLive345 (a generous live table)', () => {
  it("lays up to 6x the don't pass bet at true odds [V WOO-B]", () => {
    scenario('traditionalLive345')
      .expectProvenance('/catalog/dontPassOdds/limit', 'verified')
      .place('dontPass', 1_000)
      .roll(5, 4)
      // Lay odds on 9 go in $3 units, so one unit over the cap is $63.
      .expectReject('ODDS_LIMIT', (a) => a.place('dontPassOdds', 6_300), { max: 6_000 })
      .place('dontPassOdds', 6_000)
      .roll(4, 3)
      .expect({ transition: 'sevenOut' })
      .expectSettled({ typeId: 'dontPassOdds' }, { winPaid: 4_000, credited: 10_000 })
      .expectBankroll(54_000)
  })

  it('a lay pays 5% of its win up front, in whole dollars, at least $1, refunded when it comes down [V HAR-PA]', () => {
    scenario('traditionalLive345')
      .expectProvenance('/catalog/lay/commission', 'verified')
      .place('lay', 4_000, { number: 4 })
      .place('lay', 2_000, { number: 10 })
      // $40 on 4 wins $20: $1. $20 on 10 wins $10: 50¢ rounds down to $0, so the $1 minimum.
      .expectLedger({ bankroll: 43_800, vigPaid: 200 })
      .takeDown({ typeId: 'lay', number: 10 })
      .expectLedger({ bankroll: 45_900, vigPaid: 100 })
      .roll(3, 4)
      .expectSettled(
        { typeId: 'lay', number: 4 },
        { winPaid: 2_000, vigRearm: 100, credited: 1_900, stakeDisposition: 'stays' },
      )
      .expectBankroll(47_800)
  })

  it("a don't come bet on a number may be cut or taken down, never raised or bet again until the next come-out [V MD-C]", () => {
    scenario('traditionalLive345')
      .expectProvenance('/catalog/dontCome/onNumber', 'verified')
      .expectProvenance('/catalog/dontCome/rebetAfterRemove', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('dontCome', 2_000)
      .roll(3, 3)
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'dontCome' }, 2_500), {
        change: 'increase',
      })
      .setAmount({ typeId: 'dontCome' }, 1_000)
      .takeDown({ typeId: 'dontCome' })
      .expectReject('WINDOW_CLOSED', (a) => a.place('dontCome', 1_000), {
        reason: 'rebetAfterRemove',
      })
      .roll(3, 1)
      .expect({ transition: 'pointMade' })
      .roll(5, 4)
      .place('dontCome', 1_000)
      .expectBet({ typeId: 'dontCome' }, { number: null, amount: 1_000 })
  })

  it("a player may bet both ways: pass and don't pass, come and don't come [A]", () => {
    scenario('traditionalLive345')
      .expectProvenance('/exclusiveGroups', 'assumed')
      .place('pass', 1_000)
      .place('dontPass', 1_000)
      .roll(3, 3)
      .place('come', 1_000)
      .place('dontCome', 1_000)
      .expectBets([
        ['pass', 6, 1_000],
        ['dontPass', 6, 1_000],
        ['come', null, 1_000],
        ['dontCome', null, 1_000],
      ])
  })

  it('on the come-out, lays, place to lose, hardways and big 6/8 work; place and buy are OFF [V WOO-B; R]', () => {
    scenario('traditionalLive345')
      .expectProvenance('/catalog/lay/comeOutDefault', 'verified')
      .expectProvenance('/catalog/placeToLose/comeOutDefault', 'reported')
      .expectProvenance('/catalog/hard/comeOutDefault', 'verified')
      .expectProvenance('/catalog/big/comeOutDefault', 'reported')
      .expectProvenance('/catalog/buy/comeOutDefault', 'verified')
      .place('lay', 4_000, { number: 4 })
      .place('placeToLose', 500, { number: 6 })
      .place('hard', 500, { number: 8 })
      .place('big', 500, { number: 6 })
      .place('buy', 2_000, { number: 5 })
      .place('place', 500, { number: 5 })
      .expectBankroll(41_800)
      .roll(3, 4)
      .expectSettled(
        { typeId: 'lay', number: 4 },
        { winPaid: 2_000, vigRearm: 100, credited: 1_900 },
      )
      .expectSettled(
        { typeId: 'placeToLose', number: 6 },
        { ratioLabel: '4 to 5', winPaid: 400, stakeDisposition: 'stays' },
      )
      .expectSettled({ typeId: 'hard', number: 8 }, { outcome: 'lose' })
      .expectSettled({ typeId: 'big', number: 6 }, { outcome: 'lose' })
      .expectBets([
        ['lay', 4, 4_000],
        ['placeToLose', 6, 500],
        ['buy', 5, 2_000],
        ['place', 5, 500],
      ])
      .expectBankroll(44_100)
  })

  it('the line minimum is $10, and odds may go past the $5,000 table maximum [A]', () => {
    scenario('traditionalLive345')
      .expectProvenance('/limits/perType/pass', 'assumed')
      .expectProvenance('/limits/perType/passOdds', 'assumed')
      .expectReject('BELOW_MIN', (a) => a.place('pass', 500), { min: 1_000 })
      .deposit(3_000_000)
      .place('pass', 500_000)
      .expectReject('ABOVE_MAX', (a) => a.place('pass', 100), { max: 500_000 })
      .roll(3, 3)
      .place('passOdds', 2_500_000)
      .expectBankroll(50_000)
  })
})
