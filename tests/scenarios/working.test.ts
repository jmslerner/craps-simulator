import { describe, expect, it } from 'vitest'
import { craplessBubble, traditionalBubble } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { workingStatus } from '../../src/engine/bets/working.ts'
import { scenario, type Scenario } from './dsl.ts'

// Working rules by machine (rules spec §2.3 step 8, §2.4, §4.5, §9 #5–#7), played through the
// table reducer: Interblock's come-out ON, Set bets On/Off, after-seven-out OFF, lay re-enable and
// OFF odds at the point; Shoot To Win's come-out auto-OFF and All On/All Off; live defaults; OFF
// bets and credit. Amounts are cents; every machine starts with $500.

/** Crapless bubble with its after-seven-out rule changed, under a new id. */
function craplessAfterSevenOut(
  id: string,
  change: { trigger?: 'sevenOut' | 'anySeven'; until?: 'playerOn' | 'pointEstablished' },
): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  const rule = input.afterSevenOut.newPlacedOff
  if (rule === null) throw new Error('craplessBubble has no after-seven-out rule')
  input.afterSevenOut.newPlacedOff = { ...rule, ...change }
  input.id = id
  return input
}

/** The machine-made working switches of the last action. */
function machineSwitches(s: Scenario) {
  return s.events.filter((event) => event.type === 'workingChanged' && event.scope === 'bet')
}

/** Crapless bubble with per-bet ON/OFF toggles and its toggle scope changed, under a new id. */
function craplessToggles(
  id: string,
  change: { scope?: 'untilChanged' | 'nextRollOnly'; until?: 'playerOn' | 'pointEstablished' },
): MachineConfigInput {
  const input = craplessAfterSevenOut(id, change.until === undefined ? {} : { until: change.until })
  input.workingToggle = {
    ...input.workingToggle,
    perBet: true,
    scope: change.scope ?? 'untilChanged',
  }
  return input
}

/**
 * Interblock crapless right after a seven-out, with a new pass bet, a place 6 held OFF by the
 * machine, and a come bet on 8 carrying $20 of odds into the come-out after the point of 10 is made.
 */
function heldAndComeOdds(): Scenario {
  return scenario('craplessBubble')
    .place('pass', 1_000)
    .roll(2, 2)
    .roll(3, 4)
    .expect({ transition: 'sevenOut' })
    .place('pass', 1_000)
    .place('place', 600, { number: 6 })
    .expectBet({ typeId: 'place' }, { working: false })
    .roll(5, 5)
    .place('come', 1_000)
    .roll(4, 4)
    .place('comeOdds', 2_000, { number: 8 })
    .roll(6, 4)
    .expect({ transition: 'pointMade', point: null })
    .expectBet({ typeId: 'place' }, { working: false })
    .expectBet({ typeId: 'comeOdds' }, { working: false })
    .expectBankroll(45_400)
}

describe('Interblock: place and buy bets work on the come-out [V IB §2.6, §3.2; §0.2 #4]', () => {
  it('a bet made for the come-out wins when its number sets the point, and stays up', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/place/comeOutDefault', 'verified')
      .expectProvenance('/catalog/buy/comeOutDefault', 'verified')
      .expectProvenance('/comeOut', 'verified')
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .place('buy', 2_000, { number: 4 })
      .expectBet({ typeId: 'place' }, { working: true })
      .expectBet({ typeId: 'buy' }, { working: true })
      .roll(3, 3)
      .expect({ transition: 'pointEstablished', point: 6 })
      .expectSettled(
        { typeId: 'place', number: 6 },
        { outcome: 'win', winPaid: 700, stakeDisposition: 'stays' },
      )
      .roll(2, 2)
      .expectSettled({ typeId: 'buy', number: 4 }, { winPaid: 4_000, credited: 3_900 })
      .expectBets([
        ['pass', 6, 1_000],
        ['place', 6, 600],
        ['buy', 4, 2_000],
      ])
  })

  it('so a come-out 7 takes them', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .place('buy', 2_000, { number: 4 })
      .roll(3, 4)
      .expect({ transition: 'natural' })
      .expectSettled({ typeId: 'place', number: 6 }, { outcome: 'lose' })
      .expectSettled({ typeId: 'buy', number: 4 }, { outcome: 'lose' })
      .expectBets([['pass', null, 1_000]])
      .expectBankroll(47_300)
  })
})

describe('a come-out 7 does not touch place bets that are OFF (plan §10 M4b)', () => {
  it('Interblock, after Set bets Off [V IB §3.2]', () => {
    // OFF bets do not meet the minimum (§2.5), so a pass bet makes the roll valid; it wins.
    scenario('craplessBubble')
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .setGlobalWorking(true)
      .expectBet({ typeId: 'place' }, { working: false })
      .roll(3, 4)
      .expectEvents(['diceRolled', 'natural', 'betResolved'])
      .expectSettled({ typeId: 'pass' }, { outcome: 'win' })
      .expectBets([
        ['pass', null, 1_000],
        ['place', 6, 600],
      ])
      .expectBankroll(49_400)
  })

  it('Shoot To Win, whose carried chips go OFF for the come-out [V CW §4]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/comeOut/autoOff/carried', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 600, { number: 6 })
      .roll(1, 3)
      .expect({ transition: 'pointMade', point: null })
      .expectBet({ typeId: 'place' }, { working: false })
      .roll(3, 4)
      .expect({ transition: 'natural' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'win' })
      .expectBets([
        ['pass', null, 1_000],
        ['place', 6, 600],
      ])
  })

  it('a live table, where place bets are OFF on the come-out [V WOO-B, MD-C]', () => {
    scenario('traditionalLive345')
      .expectProvenance('/catalog/place/comeOutDefault', 'verified')
      .place('place', 600, { number: 6 })
      .expectBet({ typeId: 'place' }, { working: false })
      .roll(3, 4)
      .expectEvents(['diceRolled', 'natural'])
      .expectBets([['place', 6, 600]])
  })
})

describe('BETS OFF (plan §10 M4b)', () => {
  it('Interblock Set bets Off: place and buy neither win nor lose; Set bets On brings them back [V IB §3.2]', () => {
    scenario('craplessBubble')
      .expectProvenance('/workingToggle', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 600, { number: 6 })
      .place('buy', 2_000, { number: 10 })
      .setGlobalWorking(true)
      .expectBet({ typeId: 'place' }, { working: false })
      .expectBet({ typeId: 'buy' }, { working: false })
      .roll(3, 3)
      .expectEvents(['diceRolled'])
      .roll(5, 5)
      .expectEvents(['diceRolled'])
      .setGlobalWorking(false)
      .roll(3, 3)
      .expectSettled({ typeId: 'place', number: 6 }, { winPaid: 700 })
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectSettled({ typeId: 'buy', number: 10 }, { outcome: 'lose' })
      .expectBets([])
      .expectBankroll(47_000)
  })

  it('Shoot To Win: All On and All Off set every chip; one chip can then be set on its own [V STWO]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/workingToggle/perBet', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 600, { number: 6 })
      .place('place', 600, { number: 8 })
      .setWorking({ typeId: 'place', number: 6 }, false)
      .expectBet({ typeId: 'place', number: 6 }, { working: false })
      .setGlobalWorking(false)
      .expectBet({ typeId: 'place', number: 6 }, { working: true })
      .setGlobalWorking(true)
      .expectBet({ typeId: 'place', number: 6 }, { working: false })
      .expectBet({ typeId: 'place', number: 8 }, { working: false })
      .setWorking({ typeId: 'place', number: 8 }, true)
      .expectBet({ typeId: 'place', number: 8 }, { working: true })
      .roll(4, 4)
      .expectSettled({ typeId: 'place', number: 8 }, { winPaid: 700 })
      .roll(3, 3)
      .expectEvents(['diceRolled'])
  })
})

describe('Interblock: bets placed right after a seven-out start OFF until Set bets On [V IB §3.2]', () => {
  it('they stay OFF through the next come-out and point, and a 7 does not take them [until A, §9 #6]', () => {
    scenario('craplessBubble')
      .expectProvenance('/afterSevenOut/newPlacedOff', 'verified')
      .expectProvenance('/afterSevenOut/newPlacedOff/until', 'assumed')
      .expectProvenance('/afterSevenOut/newPlacedOff/trigger', 'assumed')
      .place('pass', 1_000)
      .roll(2, 2)
      .roll(3, 4)
      .expect({ transition: 'sevenOut', point: null })
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .place('buy', 2_000, { number: 8 })
      .expectBet({ typeId: 'place' }, { working: false })
      .expectBet({ typeId: 'buy' }, { working: false })
      .roll(3, 3)
      .expect({ transition: 'pointEstablished', point: 6 })
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled'])
      .expectBet({ typeId: 'place' }, { working: false })
      .roll(4, 4)
      .expectEvents(['diceRolled'])
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectBets([
        ['place', 6, 600],
        ['buy', 8, 2_000],
      ])
      .setGlobalWorking(false)
      .expectBet({ typeId: 'place' }, { working: true })
      .roll(3, 3)
      .expectSettled({ typeId: 'place', number: 6 }, { winPaid: 700 })
      .expectBankroll(46_000)
  })

  it('only new place and buy bets, and only in the window right after the seven-out', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(2, 2)
      .roll(3, 4)
      .place('pass', 1_000)
      .place('hard', 100, { number: 6 })
      .expectBet({ typeId: 'hard' }, { working: true })
      .expectBet({ typeId: 'pass' }, { working: true })
      .roll(2, 2)
      .place('place', 600, { number: 6 })
      .expectBet({ typeId: 'place' }, { working: true })
  })

  it('a come-out 7 is not a seven-out: bets placed after it work [A §9 #6]', () => {
    scenario('craplessBubble')
      .place('pass', 500)
      .roll(3, 4)
      .place('place', 600, { number: 6 })
      .expectBet({ typeId: 'place' }, { working: true })
  })

  it('trigger anySeven (the §9 #6 alternative): a come-out 7 starts the OFF too', () => {
    scenario(craplessAfterSevenOut('craplessAnySeven', { trigger: 'anySeven' }))
      .place('pass', 500)
      .roll(3, 4)
      .place('place', 600, { number: 6 })
      .expectBet({ typeId: 'place' }, { working: false })
  })

  it('until pointEstablished (the §9 #6 alternative): the OFF ends when the next point is set', () => {
    const s = scenario(craplessAfterSevenOut('craplessUntilPoint', { until: 'pointEstablished' }))
      .place('pass', 1_000)
      .roll(2, 2)
      .roll(3, 4)
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .expectBet({ typeId: 'place' }, { working: false })
      .roll(2, 2)
      .expect({ transition: 'pointEstablished', point: 4 })
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled', 'workingChanged'])
      .expectBet({ typeId: 'place' }, { working: true })
    expect(machineSwitches(s)).toEqual([
      {
        type: 'workingChanged',
        scope: 'bet',
        betId: s.find({ typeId: 'place' }).id,
        working: null,
        by: 'afterSevenOut',
      },
    ])
  })
})

describe('Interblock Set bets On is setGlobalWorking(null) [A plan §0 #21, rules spec §2.4, §9 #28]', () => {
  it('it ends the after-seven-out OFF and leaves come odds OFF on the come-out: a 7 returns them', () => {
    const s = heldAndComeOdds()
      .expectProvenance('/catalog/comeOdds/comeOutDefault', 'assumed')
      .setGlobalWorking(null)
    expect(workingStatus(s.find({ typeId: 'place' }), s.state, s.cfg)).toEqual({
      working: true,
      source: 'default',
    })
    expect(workingStatus(s.find({ typeId: 'comeOdds' }), s.state, s.cfg)).toEqual({
      working: false,
      source: 'default',
    })
    s.roll(3, 4)
      .expect({ transition: 'natural' })
      .expectSettled({ typeId: 'place', number: 6 }, { outcome: 'lose' })
      .expectSettled({ typeId: 'come', number: 8 }, { outcome: 'lose' })
      .expectSettled(
        { typeId: 'comeOdds' },
        { outcome: 'push', pushReason: 'offReturned', credited: 2_000 },
      )
      .expectBets([['pass', null, 1_000]])
      .expectBankroll(48_400)
  })

  it('whereas setGlobalWorking(false) would make the come odds work, and a come-out 7 take them', () => {
    heldAndComeOdds()
      .setGlobalWorking(false)
      .expectBet({ typeId: 'place' }, { working: true })
      .expectBet({ typeId: 'comeOdds' }, { working: true })
      .roll(3, 4)
      .expectSettled({ typeId: 'comeOdds' }, { outcome: 'lose' })
      .expectBets([['pass', null, 1_000]])
      .expectBankroll(46_400)
  })

  it('Set bets Off leaves the hold; the next Set bets On ends it', () => {
    const s = heldAndComeOdds().setGlobalWorking(true)
    expect(workingStatus(s.find({ typeId: 'place' }), s.state, s.cfg).source).toBe('afterSevenOut')
    s.setGlobalWorking(null).expectBet({ typeId: 'place' }, { working: true })
    expect(s.state.heldOff).toEqual([])
  })
})

describe('the after-seven-out OFF is a machine hold, not the bet’s own setting [reading, §2.4, §9 #29]', () => {
  it('with per-bet toggles, ON turns the bet ON and its default (null) leaves it held', () => {
    const s = scenario(craplessToggles('craplessPerBetToggles', {}))
      .expectProvenance('/workingToggle/perBet', 'assumed')
      .place('pass', 1_000)
      .roll(2, 2)
      .roll(3, 4)
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .setWorking({ typeId: 'place' }, null)
      .expectBet({ typeId: 'place' }, { working: false })
      .setWorking({ typeId: 'place' }, true)
      .expectBet({ typeId: 'place' }, { working: true })
      .setWorking({ typeId: 'place' }, null)
      .expectBet({ typeId: 'place' }, { working: false })
    expect(workingStatus(s.find({ typeId: 'place' }), s.state, s.cfg).source).toBe('afterSevenOut')
    s.setWorking({ typeId: 'place' }, true)
      .roll(3, 3)
      .expectSettled({ typeId: 'place', number: 6 }, { outcome: 'win', winPaid: 700 })
      // Set bets On ends the hold, so the bet's default is ON again.
      .setGlobalWorking(null)
      .setWorking({ typeId: 'place' }, null)
      .expectBet({ typeId: 'place' }, { working: true })
  })

  it('a toggle that lasts one roll resets the player’s settings, not the hold (M4 open item 5)', () => {
    scenario(craplessToggles('craplessNextRollOnly', { scope: 'nextRollOnly' }))
      .place('pass', 1_000)
      .roll(2, 2)
      .roll(3, 4)
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .roll(5, 5)
      .expect({ transition: 'pointEstablished', point: 10 })
      .expectBet({ typeId: 'place' }, { working: false })
      .roll(3, 3)
      .expectEvents(['diceRolled'])
      .setGlobalWorking(null)
      .expectBet({ typeId: 'place' }, { working: true })
  })

  it('ending at the point (until pointEstablished) releases the hold but keeps the player’s own OFF', () => {
    const s = scenario(craplessToggles('craplessUntilPointToggles', { until: 'pointEstablished' }))
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 600, { number: 8 })
      .setWorking({ typeId: 'place', number: 8 }, false)
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .expectBet({ typeId: 'place', number: 6 }, { working: false })
      .roll(2, 2)
      .expect({ transition: 'pointEstablished', point: 4 })
      .expectBet({ typeId: 'place', number: 6 }, { working: true })
      .expectBet({ typeId: 'place', number: 8 }, { working: false })
    expect(machineSwitches(s)).toEqual([
      {
        type: 'workingChanged',
        scope: 'bet',
        betId: s.find({ typeId: 'place', number: 6 }).id,
        working: null,
        by: 'afterSevenOut',
      },
    ])
  })

  it('a held bet taken down leaves the hold with it', () => {
    const s = scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(2, 2)
      .roll(3, 4)
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
    expect(s.state.heldOff).toEqual([s.find({ typeId: 'place' }).id])
    s.takeDown({ typeId: 'place' })
    expect(s.state.heldOff).toEqual([])
  })
})

describe('Interblock: lay bets come back ON after a point is made or a 7 [V IB §3.2]', () => {
  it('after the point is made the lay is ON again, the rest stay OFF; Set bets Off switches it again', () => {
    const s = scenario('strictBubble')
      .expectProvenance('/layAutoOn', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('lay', 1_200, { number: 6 })
      .place('place', 600, { number: 8 })
      .setGlobalWorking(true)
      .expectBet({ typeId: 'lay' }, { working: false })
      .roll(1, 3)
      .expect({ transition: 'pointMade' })
      .expectBet({ typeId: 'lay' }, { working: true })
      .expectBet({ typeId: 'place' }, { working: false })
    expect(machineSwitches(s)).toEqual([
      {
        type: 'workingChanged',
        scope: 'bet',
        betId: s.find({ typeId: 'lay' }).id,
        working: true,
        by: 'layAutoOn',
      },
    ])
    s.roll(3, 4)
      .expectSettled(
        { typeId: 'lay', number: 6 },
        { outcome: 'win', winPaid: 1_000, vigRearm: 50, credited: 950 },
      )
      .expectBets([
        ['pass', null, 1_000],
        ['lay', 6, 1_200],
        ['place', 8, 600],
      ])
      .setGlobalWorking(true)
      .expectBet({ typeId: 'lay' }, { working: false })
  })

  it('a 7 leaves an OFF lay up, then turns it back ON', () => {
    const s = scenario('strictBubble')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('lay', 1_200, { number: 6 })
      .setGlobalWorking(true)
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectBet({ typeId: 'lay' }, { working: true })
      .expectBets([['lay', 6, 1_200]])
    expect(s.settlements.map((trace) => trace.typeId)).toEqual(['pass'])
  })
})

describe('Interblock: odds that are OFF come down when the point is made [A IB §3.2 reading]', () => {
  it('come odds set OFF are returned when the pass point is made, their come bet staying up', () => {
    scenario('craplessBubble')
      .expectProvenance('/oddsOffReturnedAtPointMade', 'assumed')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('come', 1_000)
      .roll(4, 4)
      .place('comeOdds', 2_000, { number: 8 })
      .setGlobalWorking(true)
      .roll(3, 3)
      .expect({ transition: 'pointMade' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'win' })
      .expectSettled(
        { typeId: 'comeOdds' },
        { outcome: 'push', pushReason: 'offReturned', credited: 2_000 },
      )
      .expectBets([
        ['pass', null, 1_000],
        ['come', 8, 1_000],
      ])
  })

  it('Shoot To Win keeps them up [A]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/oddsOffReturnedAtPointMade', 'assumed')
      .place('pass', 1_000)
      .roll(3, 3)
      .place('come', 1_000)
      .roll(4, 4)
      .place('comeOdds', 2_000, { number: 8 })
      .setGlobalWorking(true)
      .roll(3, 3)
      .expect({ transition: 'pointMade' })
      .expectBets([
        ['pass', null, 1_000],
        ['come', 8, 1_000],
        ['comeOdds', 8, 2_000],
      ])
  })
})

describe('Shoot To Win: chips go OFF for the come-out and back ON at the point [V CW §4]', () => {
  it('carried place and big chips go OFF, lays keep working, and the player cannot turn them ON [A §9 #7]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/comeOut/autoOff/carried', 'verified')
      .expectProvenance('/catalog/lay/comeOutDefault', 'assumed')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 600, { number: 6 })
      .place('big', 500, { number: 8 })
      .place('lay', 2_000, { number: 10 })
      .roll(1, 3)
      .expect({ transition: 'pointMade', point: null })
      .expectBet({ typeId: 'place' }, { working: false })
      .expectBet({ typeId: 'big' }, { working: false })
      .expectBet({ typeId: 'lay' }, { working: true })
      .setWorking({ typeId: 'place', number: 6 }, true)
      .setGlobalWorking(false)
      .expectBet({ typeId: 'place' }, { working: false })
      .roll(3, 4)
      .expectSettled(
        { typeId: 'lay', number: 10 },
        { outcome: 'win', winPaid: 1_000, vigOnWin: 50, credited: 950 },
      )
      .expectBets([
        ['pass', null, 1_000],
        ['place', 6, 600],
        ['big', 8, 500],
        ['lay', 10, 2_000],
      ])
      .roll(3, 3)
      .expect({ transition: 'pointEstablished', point: 6 })
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled'])
      .expectBet({ typeId: 'place' }, { working: true })
      .expectBet({ typeId: 'big' }, { working: true })
      .roll(4, 4)
      .expectSettled({ typeId: 'big', number: 8 }, { winPaid: 500 })
  })

  it('so /catalog/<t>/comeOutDefault decides no chip of those types: the auto-OFF covers new and carried chips (item 10 of the M4 audits)', () => {
    // A place 6 made for the first come-out is new; after a come-out 7 it is carried. Both are OFF
    // by the machine rule, which outranks the type's come-out default, so the default's tag
    // (verified, CW §4) never stands in for the new chips' assumed OFF (§9 #7).
    const s = scenario('traditionalBubble')
      .expectProvenance('/catalog/place/comeOutDefault', 'verified')
      .expectProvenance('/comeOut/autoOff/newlyPlaced', 'assumed')
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
    expect(workingStatus(s.find({ typeId: 'place' }), s.state, s.cfg)).toEqual({
      working: false,
      source: 'machine',
    })
    s.roll(3, 4).expect({ transition: 'natural' })
    expect(workingStatus(s.find({ typeId: 'place' }), s.state, s.cfg)).toEqual({
      working: false,
      source: 'machine',
    })
    // Only a type out of both lists falls to its default.
    const input = structuredClone(traditionalBubble)
    input.id = 'traditionalBubbleNoAutoOffPlace'
    const autoOff = input.comeOut.autoOff
    if (autoOff === null) throw new Error('Shoot To Win has no come-out auto-OFF')
    autoOff.carried = autoOff.carried.filter((typeId) => typeId !== 'place')
    autoOff.newlyPlaced = autoOff.newlyPlaced.filter((typeId) => typeId !== 'place')
    const own = scenario(input).place('pass', 1_000).place('place', 600, { number: 6 })
    expect(workingStatus(own.find({ typeId: 'place' }), own.state, own.cfg)).toEqual({
      working: false,
      source: 'default',
    })
  })

  it('chips newly placed for the come-out are OFF too [A §9 #7]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/comeOut/autoOff/newlyPlaced', 'assumed')
      .place('pass', 1_000)
      .place('place', 600, { number: 6 })
      .expectBet({ typeId: 'place' }, { working: false })
      .roll(3, 3)
      .expect({ transition: 'pointEstablished', point: 6 })
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled'])
      .expectBet({ typeId: 'place' }, { working: true })
  })
})

describe('OFF bets and credit (§4.5)', () => {
  it('Interblock: OFF bets still use credit [V IB §3.2]', () => {
    scenario('craplessBubble')
      .expectProvenance('/offBets/consumeCredit', 'verified')
      .place('place', 24_000, { number: 6 })
      .place('place', 24_000, { number: 8 })
      .setGlobalWorking(true)
      .expectBankroll(2_000)
      .expectReject('INSUFFICIENT_CREDIT', (a) => a.place('pass', 2_500), {
        needed: 2_500,
        available: 2_000,
      })
  })

  it('Shoot To Win: OFF chips "do not consume a player\'s credit" [V STWO], but the trainer keeps their stake on the layout (M4b reading)', () => {
    scenario('traditionalBubble')
      .expectProvenance('/offBets/consumeCredit', 'verified')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('place', 24_000, { number: 6 })
      .place('place', 23_000, { number: 8 })
      .setGlobalWorking(true)
      .expectBet({ typeId: 'place', number: 6 }, { working: false })
      .expectBankroll(2_000)
      .expectReject('INSUFFICIENT_CREDIT', (a) => a.place('field', 2_500), {
        needed: 2_500,
        available: 2_000,
      })
  })
})

describe('why a bet works or not (workingStatus)', () => {
  const status = (s: Scenario, typeId: string) => workingStatus(s.find({ typeId }), s.state, s.cfg)

  it('names the step of the §2.4 precedence that decided', () => {
    const ib = scenario('craplessBubble').place('pass', 1_000).place('place', 600, { number: 6 })
    expect(status(ib, 'pass')).toEqual({ working: true, source: 'always' })
    expect(status(ib, 'place')).toEqual({ working: true, source: 'default' })
    ib.setGlobalWorking(true)
    expect(status(ib, 'place')).toEqual({ working: false, source: 'button' })

    const sevenOut = scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(2, 2)
      .roll(3, 4)
      .place('place', 600, { number: 8 })
    expect(status(sevenOut, 'place')).toEqual({ working: false, source: 'afterSevenOut' })

    const stw = scenario('traditionalBubble').place('place', 600, { number: 6 })
    expect(status(stw, 'place')).toEqual({ working: false, source: 'machine' })
  })
})
