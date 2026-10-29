import { describe, it } from 'vitest'
import { craplessBubble, traditionalBubble } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { scenario } from './dsl.ts'

// Number-bet machine facts (rules spec §2.2, §3.2, §3.5, §4.1–§4.2, §5.1–§5.2), played through
// the table reducer. Amounts are cents; every machine starts with $500.

/** Crapless bubble where place and buy cannot share a number, as a config may say (§5.1). */
function placeOrBuy(): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  input.id = 'craplessPlaceOrBuy'
  input.exclusiveGroups = [{ types: ['place', 'buy'], scope: 'sameNumber' }]
  input.provenance['/exclusiveGroups/0'] = {
    status: 'assumed',
    note: 'A test machine whose layout takes place or buy on a number, not both (plan §10 M4b).',
  }
  return input
}

/**
 * Shoot To Win taking bets to the cent, so a stake can make a sub-cent place pay on every number;
 * its rounding is the preset's own.
 */
function pennyShootToWin(): MachineConfigInput {
  const input = structuredClone(traditionalBubble)
  input.id = 'traditionalBubblePenny'
  input.money.betIncrement = 1
  input.provenance['/money/betIncrement'] = {
    status: 'assumed',
    note: 'A test machine that takes bets to the cent, so place 4/5/9/10 can need rounding (§4.2).',
  }
  return input
}

describe('$5 on place 6 (plan §10 M4b)', () => {
  it('Interblock crapless pays $5.83, floored to the cent [A §4.2], and the bet stays up [A]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/place/pays/6', 'assumed')
      .expectProvenance('/money/payoutRounding', 'assumed')
      .expectProvenance('/catalog/place/afterWin', 'assumed')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 500, { number: 6 })
      .expectBankroll(48_500)
      .roll(3, 3)
      .expectSettled(
        { typeId: 'place', number: 6 },
        {
          outcome: 'win',
          ratioLabel: '7:6',
          winExact: '1750/3',
          winPaid: 583,
          breakage: '1/3',
          credited: 583,
          stakeDisposition: 'stays',
        },
      )
      .expectBet({ typeId: 'place' }, { number: 6, amount: 500, working: true })
      .expectBankroll(49_083)
  })

  it('a live table pays $5, keeping the change [V LVA-RND, HAR-PA]', () => {
    scenario('traditionalLive345')
      .expectProvenance('/money/payoutRounding', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 500, { number: 6 })
      .roll(3, 3)
      .expectSettled({ typeId: 'place', number: 6 }, { winPaid: 500, breakage: '250/3' })
      .expectBankroll(49_000)
  })

  it('Shoot To Win rounds place 6/8 up: $5 pays $5.84, $2 pays $2.34, $1 pays $1.17 [R WOV-30281]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/place/payoutRoundingByNumber/6', 'reported')
      .expectProvenance('/catalog/place/payoutRoundingByNumber/8', 'reported')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 500, { number: 6 })
      .place('place', 200, { number: 8 })
      .roll(3, 3)
      .expectSettled({ typeId: 'place', number: 6 }, { winPaid: 584, breakage: '-2/3' })
      .roll(4, 4)
      .expectSettled({ typeId: 'place', number: 8 }, { winPaid: 234 })
      .setAmount({ typeId: 'place', number: 8 }, 100)
      .roll(6, 2)
      .expectSettled({ typeId: 'place', number: 8 }, { winPaid: 117 })
  })

  it('and only 6/8: place 4/5/9/10 round down [A §0.2 #3]; $1.01 on 5 pays $1.41, on 6 $1.18', () => {
    // On whole dollars 4/5/9/10 pay whole cents, so a machine taking cents shows the rounding.
    scenario(pennyShootToWin())
      .expectProvenance('/catalog/place/payoutRounding', 'assumed')
      .expectProvenance('/catalog/place/payoutRoundingByNumber/6', 'reported')
      .place('pass', 1_000)
      .roll(4, 4)
      .place('place', 101, { number: 5 })
      .place('place', 101, { number: 6 })
      .place('place', 101, { number: 4 })
      .roll(2, 3)
      .expectSettled({ typeId: 'place', number: 5 }, { winExact: '707/5', winPaid: 141 })
      .roll(4, 2)
      .expectSettled({ typeId: 'place', number: 6 }, { winExact: '707/6', winPaid: 118 })
      .roll(1, 3)
      .expectSettled({ typeId: 'place', number: 4 }, { winExact: '909/5', winPaid: 181 })
  })
})

describe('crapless: place and buy on all ten points (§3.5)', () => {
  it('place 2 pays 11:2 and place 11 11:4 [A WOO-CL, MD-CL]; buy 12 pays true odds 6:1 [V IB §2.6]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/place/pays/2', 'assumed')
      .expectProvenance('/catalog/place/pays/3', 'assumed')
      .expectProvenance('/catalog/buy/pays', 'verified')
      .place('pass', 1_000)
      .roll(4, 4)
      .place('place', 200, { number: 2 })
      .place('place', 400, { number: 11 })
      .place('buy', 1_000, { number: 12 })
      .expectBankroll(47_350)
      .roll(1, 1)
      .expectSettled({ typeId: 'place', number: 2 }, { ratioLabel: '11:2', winPaid: 1_100 })
      .roll(5, 6)
      .expectSettled({ typeId: 'place', number: 11 }, { ratioLabel: '11:4', winPaid: 1_100 })
      .roll(6, 6)
      .expectSettled(
        { typeId: 'buy', number: 12 },
        { ratioLabel: '6:1', winPaid: 6_000, vigRearm: 50, credited: 5_950 },
      )
      .expectBankroll(55_500)
  })

  it('lay, place to lose and big 6/8 are not offered on Interblock crapless [V IB §2.6]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/place', 'verified')
      .expectReject('NOT_OFFERED', (a) => a.place('lay', 2_000, { number: 4 }), { typeId: 'lay' })
      .expectReject('NOT_OFFERED', (a) => a.place('placeToLose', 1_100, { number: 4 }))
      .expectReject('NOT_OFFERED', (a) => a.place('big', 500, { number: 6 }))
  })

  it('a traditional machine has no place 2, and big bets only 6 and 8', () => {
    scenario('strictBubble')
      .expectReject('BAD_PARAMS', (a) => a.place('place', 200, { number: 2 }), { field: 'number' })
      .expectReject('BAD_PARAMS', (a) => a.place('big', 500, { number: 5 }), { field: 'number' })
      .expectReject('NOT_OFFERED', (a) => a.place('placeToLose', 1_100, { number: 4 }))
  })
})

describe('Shoot To Win: place to lose and big 6/8', () => {
  it('place to lose $3 on 6 pays $2.40 on a 7 [V CW §19; F WOV-36634], and stays up [V CW §32]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/placeToLose/pays', 'verified')
      .expectProvenance('/catalog/placeToLose/afterWin', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('placeToLose', 300, { number: 6 })
      .roll(3, 4)
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose' })
      .expectSettled(
        { typeId: 'placeToLose', number: 6 },
        { ratioLabel: '4 to 5', winPaid: 240, credited: 240, stakeDisposition: 'stays' },
      )
      .expectBets([['placeToLose', 6, 300]])
      // It works on the come-out (not on the auto-OFF list [A]), so a come-out 6 takes it.
      .expectProvenance('/catalog/placeToLose/comeOutDefault', 'assumed')
      .roll(3, 3)
      .expect({ point: 6 })
      .expectSettled({ typeId: 'placeToLose', number: 6 }, { outcome: 'lose' })
      .expectBets([])
  })

  it('big 6 and big 8 pay even money [V CW §7]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/big/pays', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('big', 500, { number: 6 })
      .place('big', 500, { number: 8 })
      .roll(3, 3)
      .expectSettled({ typeId: 'big', number: 6 }, { ratioLabel: '1 to 1', winPaid: 500 })
      .roll(5, 3)
      .expectSettled({ typeId: 'big', number: 8 }, { winPaid: 500 })
      .expectBankroll(49_000)
  })
})

describe('exclusive groups and Interblock exclusions (§5.1, §5.2)', () => {
  it('Shoot To Win: place and lay, place and place to lose, buy and lay, buy and place to lose do not share a number [V CW §21; same number A]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/exclusiveGroups', 'verified')
      .expectProvenance('/exclusiveGroups/2/scope', 'assumed')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 600, { number: 6 })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('lay', 1_200, { number: 6 }), {
        typeId: 'lay',
        conflictsWith: 'place',
        scope: 'sameNumber',
      })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('placeToLose', 500, { number: 6 }), {
        conflictsWith: 'place',
      })
      .place('lay', 1_200, { number: 8 })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('buy', 2_000, { number: 8 }), {
        conflictsWith: 'lay',
      })
      .place('placeToLose', 800, { number: 5 })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('buy', 2_000, { number: 5 }), {
        conflictsWith: 'placeToLose',
      })
      // Place and buy may share a number [A], as may a bet and its own type pressed.
      .place('buy', 2_000, { number: 6 })
      .place('place', 600, { number: 6 })
      .expectBet({ typeId: 'place', number: 6 }, { amount: 1_200 })
  })

  it('Interblock: place and buy may share a number "when available" [V IB §2.6]', () => {
    scenario('craplessBubble')
      .expectProvenance('/exclusiveGroups', 'verified')
      .place('place', 600, { number: 6 })
      .place('buy', 2_000, { number: 6 })
      .expectBets([
        ['place', 6, 600],
        ['buy', 6, 2_000],
      ])
  })

  it('place and buy on one number give EXCLUSIVE_CONFLICT where the machine says so (plan §10 M4b)', () => {
    scenario(placeOrBuy())
      .expectProvenance('/exclusiveGroups/0', 'assumed')
      .place('place', 600, { number: 6 })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('buy', 2_000, { number: 6 }), {
        typeId: 'buy',
        conflictsWith: 'place',
        scope: 'sameNumber',
      })
      .place('buy', 2_000, { number: 8 })
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('place', 600, { number: 8 }), {
        conflictsWith: 'buy',
      })
      .takeDown({ typeId: 'place', number: 6 })
      .place('buy', 2_000, { number: 6 })
  })

  it("Interblock: a pass bet blocks a lay on its point, a don't pass bet a buy [setting V IB221; ON A]", () => {
    scenario('strictBubble')
      .expectProvenance('/excludeLineVsLayBuy', 'assumed')
      .place('pass', 1_000)
      .roll(3, 3)
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('lay', 1_200, { number: 6 }), {
        typeId: 'lay',
        conflictsWith: 'pass',
        scope: 'lineVsLayBuy',
      })
      .place('lay', 1_200, { number: 8 })
      .place('buy', 2_000, { number: 6 })
    scenario('strictBubble')
      .place('dontPass', 1_000)
      .roll(3, 3)
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('buy', 2_000, { number: 6 }), {
        typeId: 'buy',
        conflictsWith: 'dontPass',
        scope: 'lineVsLayBuy',
      })
      .place('buy', 2_000, { number: 8 })
      .place('lay', 1_200, { number: 6 })
  })

  it("pass and don't pass exclude each other anywhere on the layout [V IB §2.3; CW §5f]", () => {
    scenario('strictBubble')
      .expectProvenance('/exclusiveGroups/0', 'verified')
      .place('pass', 1_000)
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('dontPass', 1_000), {
        conflictsWith: 'pass',
        scope: 'global',
      })
  })
})

describe('number bets change freely (§3.2) [V IB, WOO-B]', () => {
  it('pressed, reduced and taken down at any time, ON or OFF', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 600, { number: 6 })
      .setAmount({ typeId: 'place', number: 6 }, 1_800)
      .expectEvents(['betAdjusted'])
      .setGlobalWorking(true)
      .setAmount({ typeId: 'place', number: 6 }, 1_200)
      .takeDown({ typeId: 'place', number: 6 })
      .expectEvents(['betRemoved'])
      .expectBets([['pass', 4, 1_000]])
      .expectBankroll(49_000)
  })
})
