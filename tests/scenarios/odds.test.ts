import { describe, expect, it } from 'vitest'
import { craplessBubble, traditionalLive345 } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { cents } from '../../src/engine/core/money.ts'
import { legalBets } from '../../src/engine/bets/legal.ts'
import { maxOdds } from '../../src/engine/bets/limits.ts'
import { betId } from '../../src/engine/bets/types.ts'
import { scenario } from './dsl.ts'

// Odds machine facts (rules spec §2.2–§2.4, §3.1, §4.1–§4.4), played through the table reducer.
// Amounts are cents; every machine starts with $500.

/** Crapless bubble with a winning pass returned instead of kept up, like M8's e2e test preset. */
function passReturned(): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  const pass = input.catalog.pass
  if (pass?.family !== 'line') throw new Error('craplessBubble has no pass line')
  pass.afterWin = 'return'
  input.id = 'craplessPassReturned'
  input.provenance['/catalog/pass/afterWin'] = {
    status: 'assumed',
    note: 'A test machine whose winning pass is returned, as the e2e preset pins it (plan §13 M2).',
  }
  return input
}

/** Crapless bubble with pass odds bet in $5 steps, to show the cap rounding down to them. */
function oddsInFives(): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  input.id = 'craplessOddsInFives'
  input.limits.perType = { passOdds: { min: 500, increment: 500 } }
  return input
}

describe('odds pay true odds, to the penny', () => {
  it('6:1 on a crapless 2: the pass stays up on Interblock [A IB par sheet; V IB §2.1]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/passOdds/pays', 'assumed')
      .expectProvenance('/catalog/pass/afterWin', 'verified')
      .expectProvenance('/money/payoutRounding', 'assumed')
      .place('pass', 1_000)
      .roll(1, 1)
      .place('passOdds', 2_000)
      .expectBankroll(47_000)
      .roll(1, 1)
      .expect({ transition: 'pointMade', point: null })
      .expectSettled(
        { typeId: 'passOdds' },
        {
          outcome: 'win',
          ratioLabel: '6:1',
          winExact: '12000',
          winPaid: 12_000,
          credited: 14_000,
          stakeDisposition: 'returned',
        },
      )
      .expectSettled(
        { typeId: 'pass' },
        { outcome: 'win', winPaid: 1_000, credited: 1_000, stakeDisposition: 'stays' },
      )
      .expectBets([['pass', null, 1_000]])
      .expectBankroll(62_000)
  })

  it('the same roll on a machine that returns a winning pass ends $10 higher with no pass up', () => {
    scenario(passReturned())
      .expectProvenance('/catalog/pass/afterWin', 'assumed')
      .place('pass', 1_000)
      .roll(1, 1)
      .place('passOdds', 2_000)
      .roll(1, 1)
      .expectSettled({ typeId: 'pass' }, { credited: 2_000, stakeDisposition: 'returned' })
      .expectBets([])
      .expectBankroll(63_000)
  })

  it('3:1 on a crapless 11, behind a come bet', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(4, 4)
      .place('come', 500)
      .roll(5, 6)
      .place('comeOdds', 1_000, { number: 11 })
      .expectBankroll(47_500)
      .roll(6, 5)
      .expectSettled({ typeId: 'come', number: 11 }, { outcome: 'win', credited: 1_000 })
      .expectSettled(
        { typeId: 'comeOdds' },
        { outcome: 'win', ratioLabel: '3:1', winPaid: 3_000, credited: 4_000 },
      )
      .expectBets([['pass', 8, 1_000]])
      .expectBankroll(52_500)
  })

  it('lay odds of $5 on 6 win $4.16: 5:6 floored to the cent [A §4.2]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/money/payoutRounding', 'assumed')
      .place('dontPass', 500)
      .roll(3, 3)
      .place('dontPassOdds', 500)
      .roll(3, 4)
      .expectSettled(
        { typeId: 'dontPassOdds' },
        { winExact: '1250/3', winPaid: 416, breakage: '2/3', credited: 916 },
      )
      .expectSettled({ typeId: 'dontPass' }, { credited: 1_000, stakeDisposition: 'returned' })
      .expectBankroll(50_916)
  })
})

describe('odds on the come-out', () => {
  it('come odds are OFF: a come-out 7 loses the come bet and returns its odds [A §9 #5]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/comeOdds/comeOutDefault', 'assumed')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('come', 1_000)
      .roll(4, 4)
      .place('comeOdds', 2_000, { number: 8 })
      .expectBet({ typeId: 'comeOdds' }, { working: true })
      .roll(5, 1)
      .expect({ transition: 'pointMade', point: null })
      .expectBet({ typeId: 'comeOdds' }, { working: false })
      .expectBankroll(47_000)
      .roll(3, 4)
      .expectSettled({ typeId: 'come', number: 8 }, { outcome: 'lose' })
      .expectSettled(
        { typeId: 'comeOdds' },
        {
          outcome: 'push',
          pushReason: 'offReturned',
          winPaid: 0,
          credited: 2_000,
          stakeDisposition: 'returned',
        },
      )
      .expectBets([['pass', null, 1_000]])
      .expectBankroll(50_000)
  })

  it('a come-out roll of their number wins the come bet and returns its OFF odds', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('come', 1_000)
      .roll(4, 4)
      .place('comeOdds', 2_000, { number: 8 })
      .roll(5, 1)
      .roll(5, 3)
      .expect({ transition: 'pointEstablished', point: 8 })
      .expectSettled({ typeId: 'come', number: 8 }, { outcome: 'win', credited: 2_000 })
      .expectSettled({ typeId: 'comeOdds' }, { outcome: 'push', pushReason: 'offReturned' })
      .expectBets([['pass', 8, 1_000]])
      .expectBankroll(51_000)
  })

  it('on a live table, come odds called ON work on the come-out and lose to a 7 [V WOO-B]', () => {
    scenario('traditionalLive345')
      .expectProvenance('/workingToggle', 'verified')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('come', 1_000)
      .roll(4, 4)
      .place('comeOdds', 5_000, { number: 8 })
      .setWorking({ typeId: 'comeOdds' }, true)
      .roll(5, 1)
      .expectBet({ typeId: 'comeOdds' }, { working: true })
      .roll(3, 4)
      .expectSettled({ typeId: 'comeOdds' }, { outcome: 'lose', credited: 0 })
      .expectBets([['pass', null, 1_000]])
      .expectBankroll(45_000)
  })

  it("don't come odds work on the come-out: a 7 wins them [V WOO-B]", () => {
    scenario('traditionalLive345')
      .expectProvenance('/catalog/dontComeOdds', 'verified')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('dontCome', 1_000)
      .roll(2, 2)
      .place('dontComeOdds', 2_000, { number: 4 })
      .roll(1, 5)
      .expectBet({ typeId: 'dontComeOdds' }, { working: true })
      .roll(3, 4)
      .expectSettled({ typeId: 'dontCome', number: 4 }, { outcome: 'win', credited: 2_000 })
      .expectSettled(
        { typeId: 'dontComeOdds' },
        { outcome: 'win', ratioLabel: '1 to 2', winPaid: 1_000, credited: 3_000 },
      )
      .expectBankroll(53_000)
  })
})

describe('odds limits (§4.4)', () => {
  it('crapless: 2x the flat bet on every point, the 2 included [R VA, LVA-CL]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/passOdds/limit', 'reported')
      .place('pass', 1_000)
      .roll(1, 1)
      .expectReject('ODDS_LIMIT', (a) => a.place('passOdds', 2_100), { max: 2_000 })
      .place('passOdds', 2_000)
      .expectReject('ODDS_LIMIT', (a) => a.place('passOdds', 100), { amount: 2_100, max: 2_000 })
  })

  it.each([
    [2, 2, 3_000, 100],
    [2, 3, 4_000, 200],
    [3, 3, 5_000, 500],
  ] as const)(
    'live 3-4-5x: a 1000¢ pass rolled %i-%i takes at most %i¢, in %i¢ units [V WOO-B]',
    (d1, d2, max, unit) => {
      scenario('traditionalLive345')
        .expectProvenance('/catalog/passOdds', 'verified')
        .place('pass', 1_000)
        .roll(d1, d2)
        .expectReject('ODDS_LIMIT', (a) => a.place('passOdds', max + unit), { max })
        .place('passOdds', max)
    },
  )

  it("live: lay up to 6x the don't pass bet [V WOO-B]", () => {
    scenario('traditionalLive345')
      .place('dontPass', 1_000)
      .roll(2, 2)
      .expectReject('ODDS_LIMIT', (a) => a.place('dontPassOdds', 6_200), { max: 6_000 })
      .place('dontPassOdds', 6_000)
  })

  it("Shoot To Win: don't pass lays up to 2x the bet (stake basis) [V CW §12]", () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/dontPassOdds', 'verified')
      .place('dontPass', 700)
      .roll(3, 3)
      .expectReject('ODDS_LIMIT', (a) => a.place('dontPassOdds', 1_500), { max: 1_400 })
      .place('dontPassOdds', 1_400)
  })

  it("Shoot To Win: don't come lays what wins 2x the bet, rounded down: $7 on 6 lays $16 [V CW §15]", () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/dontComeOdds', 'verified')
      .place('pass', 1_000)
      .roll(4, 4)
      .place('dontCome', 700)
      .roll(3, 3)
      .expectReject('ODDS_LIMIT', (a) => a.place('dontComeOdds', 1_700, { number: 6 }), {
        max: 1_600,
      })
      .place('dontComeOdds', 1_600, { number: 6 })
  })

  it('a live table takes odds only in units that pay whole dollars: $1/$2/$5 take, $2/$3/$6 lay [A §3.1]', () => {
    // So it never books odds that pay $0: a $1 lay on 4 would win 50¢, paid as nothing.
    scenario('traditionalLive345')
      .expectProvenance('/limits/perType/passOdds/incrementByNumber', 'assumed')
      .expectProvenance('/limits/perType/dontComeOdds/incrementByNumber', 'assumed')
      .place('pass', 1_000)
      .roll(3, 3)
      .expectReject('BAD_INCREMENT', (a) => a.place('passOdds', 300), { increment: 500 })
      .expectReject('BAD_INCREMENT', (a) => a.place('passOdds', 100), { increment: 500 })
      .place('passOdds', 500)
      .expectReject('BAD_INCREMENT', (a) => a.setAmount({ typeId: 'passOdds' }, 700), {
        increment: 500,
      })
      .setAmount({ typeId: 'passOdds' }, 1_000)
      .place('dontCome', 1_000)
      .roll(2, 2)
      .expectReject('BAD_INCREMENT', (a) => a.place('dontComeOdds', 100, { number: 4 }), {
        increment: 200,
      })
      .place('dontComeOdds', 200, { number: 4 })
      .roll(3, 3)
      .expect({ transition: 'pointMade' })
      .expectSettled({ typeId: 'passOdds' }, { winExact: '1200', winPaid: 1_200, breakage: '0' })
      .roll(3, 4)
      .expectSettled({ typeId: 'dontComeOdds' }, { winExact: '100', winPaid: 100 })
  })

  it('maxOdds and legalBets floor the cap to the unit on the parent’s number [A §4.4]', () => {
    // A live variant whose don't pass lays win at most 3x the flat bet: $11 on 6 may lay $39.60,
    // floored to the $6 unit: $36.
    const input = structuredClone(traditionalLive345)
    input.id = 'liveLayWinBasis'
    const lay = input.catalog.dontPassOdds
    if (lay?.family !== 'odds') throw new Error('no lay odds')
    lay.limit = { basis: 'win', multiple: { '4': 3, '5': 3, '6': 3, '8': 3, '9': 3, '10': 3 } }
    const s = scenario(input)
      .place('dontPass', 1_100)
      .roll(3, 3)
      .expectReject('ODDS_LIMIT', (a) => a.place('dontPassOdds', 4_200), { max: 3_600 })
    const parent = s.find({ typeId: 'dontPass' })
    expect(maxOdds(parent, s.cfg)).toBe(3_600)
    expect(legalBets(s.state, s.cfg).find((spot) => spot.typeId === 'dontPassOdds')).toMatchObject({
      number: 6,
      canAdd: null,
      minAdd: 600,
      maxAdd: 3_600,
    })
    s.place('dontPassOdds', 3_600)
  })

  it('the cap rounds down to the odds increment [A §4.4]', () => {
    scenario(oddsInFives())
      .place('pass', 700)
      .roll(4, 4)
      .expectReject('ODDS_LIMIT', (a) => a.place('passOdds', 1_500), { max: 1_000 })
      .expectReject('BAD_INCREMENT', (a) => a.place('passOdds', 1_200), { increment: 500 })
      .place('passOdds', 1_000)
  })

  it("cutting a don't pass is refused while its lay would break the cap; taking it down takes the lay too", () => {
    scenario('strictBubble')
      .expectProvenance('/catalog/dontPassOdds/limit', 'assumed')
      .place('dontPass', 1_000)
      .roll(2, 2)
      .place('dontPassOdds', 2_000)
      .expectReject('ODDS_LIMIT', (a) => a.setAmount({ typeId: 'dontPass' }, 500), { max: 1_000 })
      .takeDown({ typeId: 'dontPass' })
      .expectEvents(['betRemoved', 'betRemoved'])
      .expectBets([])
      .expectBankroll(50_000)
  })
})

describe('odds need a parent on a number, and are free to change until decided', () => {
  it('no parent, a parent of the wrong type, and a parent not yet on a number', () => {
    scenario('craplessBubble')
      .expectReject('NO_PARENT', { type: 'place', typeId: 'passOdds', amount: cents(1_000) })
      .place('pass', 1_000)
      .expectReject('PARENT_NOT_ON_POINT', (a) => a.place('passOdds', 1_000))
      .roll(2, 2)
      .place('come', 500)
      .expectReject('NO_PARENT', (a) => a.place('comeOdds', 1_000, { on: { typeId: 'pass' } }))
      .expectReject('PARENT_NOT_ON_POINT', (a) =>
        a.place('comeOdds', 1_000, { on: { typeId: 'come', number: null } }),
      )
      // An odds action may name the number too, but only its parent's.
      .expectReject(
        'BAD_PARAMS',
        { type: 'place', typeId: 'passOdds', number: 5, parentId: betId(1), amount: cents(1_000) },
        { field: 'number' },
      )
      .act({
        type: 'place',
        typeId: 'passOdds',
        number: 4,
        parentId: betId(1),
        amount: cents(1_000),
      })
      .expectBet({ typeId: 'passOdds' }, { number: 4, amount: 1_000 })
  })

  it('odds may be added, reduced and taken down at any time [V IB]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/passOdds', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('passOdds', 1_000)
      .place('passOdds', 1_000)
      .expectEvents(['betAdjusted'])
      .expectBet({ typeId: 'passOdds' }, { amount: 2_000, number: 4 })
      .expectBankroll(47_000)
      .setAmount({ typeId: 'passOdds' }, 500)
      .takeDown({ typeId: 'passOdds' })
      .expectNoBet({ typeId: 'passOdds' })
      .expectBankroll(49_000)
  })
})

describe("Interblock's Set bets Off (§2.4)", () => {
  it('odds set OFF are returned when the pass line is decided, by a seven-out or a point made [V IB §3.2]', () => {
    scenario('craplessBubble')
      .expectProvenance('/workingToggle', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('passOdds', 2_000)
      .setGlobalWorking(true)
      .expectEvents(['workingChanged'])
      .expectBet({ typeId: 'passOdds' }, { working: false })
      .roll(3, 4)
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose' })
      .expectSettled({ typeId: 'passOdds' }, { outcome: 'push', credited: 2_000 })
      .expectBankroll(49_000)
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('passOdds', 2_000)
      .setGlobalWorking(true)
      .roll(1, 3)
      .expectSettled({ typeId: 'pass' }, { outcome: 'win', credited: 1_000 })
      .expectSettled({ typeId: 'passOdds' }, { outcome: 'push', pushReason: 'offReturned' })
      .expectBankroll(50_000)
      .setGlobalWorking(null)
  })

  it('the machine has no per-bet toggle, and line bets can never be switched OFF', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('passOdds', 1_000)
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'passOdds' }, false))
    scenario('traditionalLive345')
      .place('pass', 1_000)
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'pass' }, false))
      .expectReject('NOT_TOGGLEABLE', (a) => a.setGlobalWorking(true), { scope: 'global' })
  })
})
