import { describe, it } from 'vitest'
import { traditionalBubble } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { scenario, type Scenario } from './dsl.ts'

// Hot Shooter Jackpot machine facts (rules spec §2.6, §6.2, §5.2), played through the table
// reducer on Shoot To Win, whose round needs $3 of main-game bets. Amounts are cents; the machine
// starts with $500.

type Definition = 'allRolls' | 'exceptSevenOut' | 'exceptComeOutAndSevenOut'

/** Shoot To Win with the Hot Shooter counting under `definition`, under its own id. */
function counting(definition: Definition): MachineConfigInput {
  const input = structuredClone(traditionalBubble)
  input.id = `stw-${definition}`
  const hot = input.sideBets.hotShooter
  if (hot?.family !== 'handLength') throw new Error('traditionalBubble has no Hot Shooter')
  hot.countDefinition = definition
  return input
}

/**
 * A hand of `1 + fillers + 1` rolls: $3 on the pass line and $1 on the Hot Shooter, the come-out
 * sets 4, `fillers` sixes, then the seven-out.
 */
function hand(s: Scenario, fillers: number): Scenario {
  s.place('pass', 300).place('hotShooter', 100).expectBankroll(49_600).roll(2, 2)
  for (let index = 0; index < fillers; index += 1) s.roll(3, 3)
  return s.roll(3, 4).expect({ transition: 'sevenOut' })
}

describe('Shoot To Win Hot Shooter Jackpot [V CW §33; STWO §7.2]', () => {
  it('needs 3 credits on the craps game to go up [A CW §33b], and takes $1 to $1,000 [V CW §33g]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/sideBets/hotShooter', 'verified')
      .expectProvenance('/sideBets/hotShooter/qualifyingBet', 'assumed')
      .expectProvenance('/limits/perType/hotShooter', 'verified')
      .expectReject('BELOW_MIN_TOTAL', (a) => a.place('hotShooter', 100), {
        scope: 'qualifyingBet',
        typeId: 'hotShooter',
        min: 300,
        total: 0,
        short: 300,
      })
      .place('pass', 200)
      .expectReject('BELOW_MIN_TOTAL', (a) => a.place('hotShooter', 100), {
        scope: 'qualifyingBet',
        total: 200,
        short: 100,
      })
      .place('pass', 100)
      .expectReject('ABOVE_MAX', (a) => a.place('hotShooter', 100_100), { max: 100_000 })
      .place('hotShooter', 100)
      .expectBets([
        ['pass', null, 300],
        ['hotShooter', null, 100],
      ])
  })

  it('is bet only in the come-out bet time of a new hand [V CW §33e]', () => {
    scenario('traditionalBubble')
      .place('pass', 300)
      .roll(2, 2)
      .expectReject('WINDOW_CLOSED', (a) => a.place('hotShooter', 100), {
        typeId: 'hotShooter',
        reason: 'comeOutAfterSevenOut',
        until: 'nextHand',
      })
      .roll(2, 2)
      .expect({ transition: 'pointMade', handRolls: 2 })
      .expectReject('WINDOW_CLOSED', (a) => a.place('hotShooter', 100), {
        reason: 'comeOutAfterSevenOut',
      })
      .roll(5, 5)
      .roll(3, 4)
      .expect({ transition: 'sevenOut', handRolls: 0 })
      .place('pass', 300)
      .place('hotShooter', 100)
      .expectBets([
        ['pass', null, 300],
        ['hotShooter', null, 100],
      ])
  })

  it('counts every roll: an 8-roll hand pushes, a 7-roll hand loses, 16 rolls pay 3 for 1 [V]', () => {
    hand(scenario('traditionalBubble'), 5)
      .expect({ endedHand: { index: 0, rolls: 7, pointsMade: [] } })
      .expectSettled({ typeId: 'hotShooter' }, { outcome: 'lose', credited: 0 })
      .expectBankroll(49_600)
    hand(scenario('traditionalBubble'), 6)
      .expect({ endedHand: { index: 0, rolls: 8, pointsMade: [] } })
      .expectSettled(
        { typeId: 'hotShooter' },
        {
          outcome: 'push',
          pushReason: 'zeroNet',
          winPaid: 0,
          credited: 100,
          stakeDisposition: 'returned',
        },
      )
      .expectBets([])
      .expectBankroll(49_700)
    hand(scenario('traditionalBubble'), 14)
      .expect({ endedHand: { index: 0, rolls: 16, pointsMade: [] } })
      .expectSettled(
        { typeId: 'hotShooter' },
        { outcome: 'win', payKey: '16', ratioLabel: '3 for 1', winPaid: 200, credited: 300 },
      )
      .expectBankroll(49_900)
  })

  it('shows its count as the hand goes: one more after every roll', () => {
    scenario('traditionalBubble')
      .place('pass', 300)
      .place('hotShooter', 100)
      .roll(2, 2)
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled', 'betProgress'])
      .expectBet({ typeId: 'hotShooter' }, { progress: 1 })
      .roll(3, 3)
      .expectEvents(['diceRolled', 'betProgress'])
      .roll(2, 2)
      .expect({ transition: 'pointMade' })
      .expectBet({ typeId: 'hotShooter' }, { progress: 3 })
      .roll(3, 4)
      .expect({ transition: 'natural' })
      .expectBet({ typeId: 'hotShooter' }, { progress: 4 })
  })

  it('50 rolls or more is the Grand tier, 100 for 1 [V STWO §7.2; §0.2 #7]', () => {
    hand(
      scenario('traditionalBubble').expectProvenance(
        '/sideBets/hotShooter/tiers/6/minRolls',
        'verified',
      ),
      48,
    )
      .expect({ endedHand: { index: 0, rolls: 50, pointsMade: [] } })
      .expectSettled(
        { typeId: 'hotShooter' },
        { outcome: 'win', payKey: '50', ratioLabel: '100 for 1', winPaid: 9_900, credited: 10_000 },
      )
      .expectBankroll(59_600)
  })

  it('counts under definitions B and C as configured [A §9 #10]', () => {
    hand(scenario(counting('exceptSevenOut')), 6).expectSettled(
      { typeId: 'hotShooter' },
      { outcome: 'lose' },
    )
    hand(scenario(counting('exceptSevenOut')), 7).expectSettled(
      { typeId: 'hotShooter' },
      { outcome: 'push' },
    )
    hand(
      scenario(counting('exceptComeOutAndSevenOut')).expectProvenance(
        '/sideBets/hotShooter/countDefinition',
        'assumed',
      ),
      7,
    ).expectSettled({ typeId: 'hotShooter' }, { outcome: 'lose' })
    hand(scenario(counting('exceptComeOutAndSevenOut')), 8).expectSettled(
      { typeId: 'hotShooter' },
      { outcome: 'push' },
    )
    // Under C the first come-out counts nothing.
    scenario(counting('exceptComeOutAndSevenOut'))
      .place('pass', 300)
      .place('hotShooter', 100)
      .roll(2, 2)
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled'])
      .expectBet({ typeId: 'hotShooter' }, { progress: 0 })
      .roll(3, 3)
      .expectBet({ typeId: 'hotShooter' }, { progress: 1 })
  })

  it('is a special game: once the dice roll it cannot be withdrawn or changed [V STWO]', () => {
    scenario('traditionalBubble')
      .place('pass', 300)
      .place('hotShooter', 100)
      .setAmount({ typeId: 'hotShooter' }, 200)
      .roll(2, 2)
      .expectReject('CONTRACT_BET', (a) => a.takeDown({ typeId: 'hotShooter' }), {
        change: 'remove',
      })
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'hotShooter' }, 300), {
        change: 'increase',
      })
      .expectReject('CONTRACT_BET', (a) => a.place('hotShooter', 100), { change: 'increase' })
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'hotShooter' }, false))
      .setGlobalWorking(true)
      .expectBet({ typeId: 'hotShooter' }, { working: true, amount: 200 })
  })
})
