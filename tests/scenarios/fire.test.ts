import { describe, it } from 'vitest'
import { craplessBubble, traditionalLive345 } from '../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { scenario } from './dsl.ts'

// Fire Bet machine facts (rules spec §2.6, §6.6; research sidebets.md §5), played through the
// table reducer on the live reference table, whose pass line is $10 and which has no minimum for
// the round. Amounts are cents; the table starts with $500.

const bit = (n: number) => 1 << n
const maskOf = (points: readonly PointNumber[]) => points.reduce((m, n) => m | bit(n), 0)

/** The crapless machine with a Fire Bet counting `counted`, under its own id. */
function craplessFire(counted: readonly PointNumber[]): MachineConfigInput {
  const input = structuredClone(craplessBubble)
  input.id = `craplessFire${counted.length}`
  input.sideBets.fire = {
    family: 'uniquePointsMade',
    label: 'Fire Bet',
    countedPoints: [...counted],
    payTable: { '4': '24:1', '5': '249:1', '6': '999:1' },
    payImmediatelyAt: null,
    placement: 'newHand',
  }
  input.provenance['/sideBets/fire'] = {
    status: 'assumed',
    note: 'A test machine: the live Fire Bet carried onto a crapless layout (rules spec §0.2 #13).',
  }
  return input
}

describe('the Fire Bet on the live table [R WOO-FIRE; MD-C]', () => {
  it('pays 24 to 1 at the seven-out after 4 unique points, a repeated point ignored (plan §10 M11)', () => {
    scenario('traditionalLive345')
      .expectProvenance('/sideBets/fire', 'reported')
      .place('pass', 1_000)
      .place('fire', 1_000)
      .expectBankroll(48_000)
      .roll(2, 2)
      .expect({ point: 4 })
      .roll(2, 2)
      .expect({ transition: 'pointMade', pointsMade: [4] })
      .expectEvents(['diceRolled', 'pointMade', 'betResolved', 'betProgress'])
      .expectBet({ typeId: 'fire' }, { progress: bit(4) })
      .roll(2, 3)
      .roll(2, 3)
      .roll(3, 3)
      .roll(3, 3)
      .expectBet({ typeId: 'fire' }, { progress: maskOf([4, 5, 6]) })
      // The 4 repeats: the pass line wins again, the Fire Bet does not move.
      .roll(2, 2)
      .roll(2, 2)
      .expectEvents(['diceRolled', 'pointMade', 'betResolved'])
      .expectBet({ typeId: 'fire' }, { progress: maskOf([4, 5, 6]) })
      .roll(4, 4)
      .roll(4, 4)
      .expectBet({ typeId: 'fire' }, { progress: maskOf([4, 5, 6, 8]) })
      .expectBankroll(53_000)
      .roll(5, 5)
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectSettled(
        { typeId: 'fire' },
        {
          outcome: 'win',
          payKey: '4',
          ratioLabel: '24 to 1',
          winExact: '24000',
          winPaid: 24_000,
          credited: 25_000,
          stakeDisposition: 'returned',
        },
      )
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose' })
      .expectBets([])
      .expectBankroll(78_000)
  })

  it('is bet only before a new hand’s first roll, and the window closes after it (plan §10 M11) [V MD-C]', () => {
    scenario('traditionalLive345')
      .place('pass', 1_000)
      .roll(2, 2)
      .expectReject('WINDOW_CLOSED', (a) => a.place('fire', 1_000), {
        typeId: 'fire',
        reason: 'newHand',
        until: 'nextHand',
      })
      .roll(2, 2)
      .expect({ transition: 'pointMade', handRolls: 2 })
      .expectReject('WINDOW_CLOSED', (a) => a.place('fire', 1_000), { reason: 'newHand' })
      .roll(5, 5)
      .roll(3, 4)
      .expect({ transition: 'sevenOut', handRolls: 0 })
      .place('fire', 1_000)
      .expectBets([['fire', null, 1_000]])
  })

  it('is a contract bet once the dice roll, and free before [V MD-C]', () => {
    scenario('traditionalLive345')
      .place('pass', 1_000)
      .place('fire', 1_000)
      .setAmount({ typeId: 'fire' }, 2_000)
      .takeDown({ typeId: 'fire' })
      .expectNoBet({ typeId: 'fire' })
      .place('fire', 500)
      .roll(3, 3)
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'fire' }, 1_000), {
        change: 'increase',
      })
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'fire' }, 100), {
        change: 'decrease',
      })
      .expectReject('CONTRACT_BET', (a) => a.takeDown({ typeId: 'fire' }), { change: 'remove' })
      .expectReject('CONTRACT_BET', (a) => a.place('fire', 100), { change: 'increase' })
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'fire' }, false))
  })

  it('loses at the seven-out with fewer than 4 points', () => {
    scenario('traditionalLive345')
      .place('pass', 1_000)
      .place('fire', 1_000)
      .roll(2, 2)
      .roll(2, 2)
      .roll(3, 3)
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectSettled({ typeId: 'fire' }, { outcome: 'lose', credited: 0, stakeDisposition: 'lost' })
      .expectBets([])
      .expectBankroll(49_000)
  })

  it('a house that pays at once on the 6th point takes the bet down there [U]', () => {
    const input = structuredClone(traditionalLive345)
    input.id = 'livePayAtSix'
    const fire = input.sideBets.fire
    if (fire?.family !== 'uniquePointsMade') throw new Error('the live table has no Fire Bet')
    fire.payImmediatelyAt = 6
    scenario(input)
      .place('pass', 1_000)
      .place('fire', 1_000)
      .roll(2, 2)
      .roll(2, 2)
      .roll(2, 3)
      .roll(2, 3)
      .roll(3, 3)
      .roll(3, 3)
      .roll(4, 4)
      .roll(4, 4)
      .roll(4, 5)
      .roll(4, 5)
      .roll(5, 5)
      .expectBet({ typeId: 'fire' }, { progress: maskOf([4, 5, 6, 8, 9]) })
      .roll(5, 5)
      .expect({ transition: 'pointMade' })
      .expectSettled(
        { typeId: 'fire' },
        {
          outcome: 'win',
          payKey: '6',
          ratioLabel: '999 to 1',
          winPaid: 999_000,
          credited: 1_000_000,
        },
      )
      .expectNoBet({ typeId: 'fire' })
      .expectBankroll(1_054_000)
  })
})

describe('a crapless Fire Bet counts the points the config lists (rules spec §0.2 #13)', () => {
  it('2 and 12 count only when they are counted points', () => {
    scenario(craplessFire([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]))
      .place('pass', 500)
      .place('fire', 100)
      .roll(1, 1)
      .roll(1, 1)
      .expect({ transition: 'pointMade', pointsMade: [2] })
      .expectBet({ typeId: 'fire' }, { progress: bit(2) })
    scenario(craplessFire([4, 5, 6, 8, 9, 10]))
      .place('pass', 500)
      .place('fire', 100)
      .roll(1, 1)
      .roll(1, 1)
      .expect({ transition: 'pointMade', pointsMade: [2] })
      .expectEvents(['diceRolled', 'pointMade', 'betResolved'])
      .expectBet({ typeId: 'fire' }, { progress: 0 })
  })
})
