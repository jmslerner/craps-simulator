import { describe, expect, it } from 'vitest'
import { traditionalBubble } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { scenario, type Scenario } from './dsl.ts'

// Hot Shooter Jackpot machine facts (rules spec §2.6, §6.2, §5.2), played through the table
// reducer on Shoot To Win, whose round needs $3 of main-game bets. Amounts are cents; the machine
// starts with $500.

type Definition = 'allRolls' | 'exceptSevenOut' | 'exceptComeOutAndSevenOut'

/**
 * Shoot To Win with the Hot Shooter counting under `definition`, under its own id; with
 * `anyComeOut`, taken on any come-out as in Pennsylvania (rules spec §2.6) rather than only on a
 * new hand's.
 */
function counting(definition: Definition, anyComeOut = false): MachineConfigInput {
  const input = structuredClone(traditionalBubble)
  input.id = `stw-${definition}${anyComeOut ? '-anyComeOut' : ''}`
  const hot = input.sideBets.hotShooter
  if (hot?.family !== 'handLength') throw new Error('traditionalBubble has no Hot Shooter')
  hot.countDefinition = definition
  if (anyComeOut) hot.placement = 'anyComeOut'
  return input
}

/**
 * The M11 audit's repro (scratchpad audit-m11/hsj-anycomeout.ts): pass $5, a 4 made on the hand's
 * first two rolls, a $1 Hot Shooter placed on the come-out after it, then a 6, five 5s and the
 * seven-out: a hand of 9 rolls, the bet up for the last 7 of them.
 */
function laterComeOut(s: Scenario): Scenario {
  s.place('pass', 500).roll(2, 2).roll(2, 2).expect({ transition: 'pointMade', handRolls: 2 })
  s.place('hotShooter', 100).expectBet({ typeId: 'hotShooter' }, { progress: 2 })
  s.roll(3, 3)
  for (let index = 0; index < 5; index += 1) s.roll(2, 3)
  s.expectBet({ typeId: 'hotShooter' }, { progress: 8 })
  return s.roll(3, 4).expect({ endedHand: { index: 0, rolls: 9, pointsMade: [4] } })
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
    // The bet's progress is the hand's rolls under every definition; C leaves the hand's first
    // come-out out of the count only when the seven-out settles it.
    scenario(counting('exceptComeOutAndSevenOut'))
      .place('pass', 300)
      .place('hotShooter', 100)
      .roll(2, 2)
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled', 'betProgress'])
      .expectBet({ typeId: 'hotShooter' }, { progress: 1 })
      .roll(3, 3)
      .expectBet({ typeId: 'hotShooter' }, { progress: 2 })
  })

  it("counts the hand's rolls, so a bet placed on a later come-out carries them [A §2.6; M11 audit]", () => {
    // A 9-roll hand: 8 to 15 rolls return the stake under definition A, the bet's 7 rolls aside.
    laterComeOut(scenario(counting('allRolls', true)))
      .expectSettled(
        { typeId: 'hotShooter' },
        { outcome: 'push', pushReason: 'zeroNet', winPaid: 0, credited: 100 },
      )
      .expectBankroll(50_000)
    // Under C the same hand counts 7 (its first come-out and the seven-out left out): a loss.
    laterComeOut(scenario(counting('exceptComeOutAndSevenOut', true))).expectSettled(
      { typeId: 'hotShooter' },
      { outcome: 'lose', credited: 0 },
    )
    // Shoot To Win's own window takes it only before a new hand's first roll, so it never carries
    // rolls there: the same tap after the made 4 is refused.
    scenario('traditionalBubble')
      .place('pass', 500)
      .roll(2, 2)
      .roll(2, 2)
      .expectReject('WINDOW_CLOSED', (a) => a.place('hotShooter', 100), {
        reason: 'comeOutAfterSevenOut',
      })
  })

  it('with only a locked Hot Shooter up, the roll waits for the main game and says why [A §9 #11]', () => {
    // The M11 audit's repro (audit-m11/hsj-mintotal.ts): the come-out 2 takes the $3 pass and the
    // Hot Shooter rides; side bets do not count toward the $3 round minimum, so the trainer asks
    // for a main-game bet where a community dome would roll on regardless — a flow it does not
    // model, and lists as such.
    const s = scenario('traditionalBubble')
      .place('pass', 300)
      .place('hotShooter', 100)
      .roll(1, 1)
      .expect({ transition: 'craps', handRolls: 1 })
      .expectBets([['hotShooter', null, 100]])
      .expectReject('BELOW_MIN_TOTAL', (a) => a.roll(2, 2), {
        scope: 'totalRound',
        min: 300,
        total: 0,
        short: 300,
        sideBets: 100,
      })
      .place('pass', 300)
      .roll(2, 2)
      .expectBet({ typeId: 'hotShooter' }, { progress: 2 })
    expect(s.cfg.notModelled).toContain('/flow/shooter/mode')
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
