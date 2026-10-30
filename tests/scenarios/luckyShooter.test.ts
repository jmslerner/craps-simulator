import { describe, it } from 'vitest'
import { pointRunProgress } from '../../src/engine/bets/families/pointRun.ts'
import { strictBubble } from '../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { scenario, type Scenario } from './dsl.ts'

// Lucky Shooter machine facts (rules spec §2.6, §6.3, §5.2; PA §623c.2, MD, Interblock), played
// through the table reducer on the strict Interblock machine, whose round needs $5 of main-game
// bets. Amounts are cents; the machine starts with $500.

const bit = (n: number) => 1 << n
const maskOf = (points: readonly PointNumber[]) => points.reduce((m, n) => m | bit(n), 0)

/** The strict machine with its Lucky Shooter edited, under its own id. */
function strictWith(
  id: string,
  edit: (shooter: Extract<MachineConfigInput['sideBets'][string], { family: 'pointRun' }>) => void,
): MachineConfigInput {
  const input = structuredClone(strictBubble)
  input.id = id
  const shooter = input.sideBets.luckyShooter
  if (shooter?.family !== 'pointRun') throw new Error('strictBubble has no Lucky Shooter')
  edit(shooter)
  return input
}

/** $5 on the pass line and $1 on the Lucky Shooter; the come-out sets 6, then five hits. */
function fiveHits(s: Scenario): Scenario {
  return s
    .place('pass', 500)
    .place('luckyShooter', 100)
    .roll(3, 3)
    .roll(2, 2)
    .roll(2, 3)
    .roll(4, 4)
    .roll(4, 5)
    .roll(5, 5)
    .expectBet(
      { typeId: 'luckyShooter' },
      { progress: pointRunProgress(6, maskOf([4, 5, 8, 9, 10])) },
    )
}

describe('Interblock Lucky Shooter on the strict machine [V IB §6.1; IBLS; PA623c]', () => {
  it('a come-out 7 or 11 pushes and the bet stays; 2, 3 or 12 lose it [V; §0.2 #8]', () => {
    scenario('strictBubble')
      .expectProvenance('/sideBets/luckyShooter', 'verified')
      .place('pass', 500)
      .place('luckyShooter', 100)
      .roll(5, 6)
      .expect({ transition: 'natural' })
      .expectEvents(['diceRolled', 'natural', 'betResolved', 'betResolved'])
      .expectSettled({ typeId: 'pass' }, { outcome: 'win', credited: 500 })
      .expectSettled(
        { typeId: 'luckyShooter' },
        { outcome: 'push', pushReason: 'bar', credited: 0, stakeDisposition: 'stays' },
      )
      .expectBets([
        ['pass', null, 500],
        ['luckyShooter', null, 100],
      ])
      .expectBankroll(49_900)
      .roll(1, 1)
      .expect({ transition: 'craps' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose' })
      .expectSettled({ typeId: 'luckyShooter' }, { outcome: 'lose', credited: 0 })
      .expectBets([])
  })

  it('pays table D for the hits when the point repeats: 3 hits then the point pay 5 for 1 [R IBLS]', () => {
    scenario('strictBubble')
      .expectProvenance('/sideBets/luckyShooter/payTable', 'reported')
      .place('pass', 500)
      .place('luckyShooter', 100)
      .roll(3, 3)
      .expect({ point: 6 })
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled', 'betProgress'])
      .expectBet({ typeId: 'luckyShooter' }, { progress: pointRunProgress(6, 0) })
      .roll(2, 2)
      .roll(2, 3)
      .roll(4, 4)
      .expectBet({ typeId: 'luckyShooter' }, { progress: pointRunProgress(6, maskOf([4, 5, 8])) })
      .roll(3, 3)
      .expect({ transition: 'pointMade' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'win', credited: 500 })
      .expectSettled(
        { typeId: 'luckyShooter' },
        {
          outcome: 'win',
          payKey: '3',
          ratioLabel: '5 for 1',
          winExact: '400',
          winPaid: 400,
          credited: 500,
          stakeDisposition: 'returned',
        },
      )
      .expectBets([['pass', null, 500]])
      .expectBankroll(50_400)
  })

  it('five hits then the point pay 500 for 1; anything else after five hits pays 100 for 1 [R IBLS; V PA623c]', () => {
    fiveHits(
      scenario('strictBubble').expectProvenance('/sideBets/luckyShooter/topAward', 'reported'),
    )
      .roll(3, 3)
      .expectSettled(
        { typeId: 'luckyShooter' },
        {
          outcome: 'win',
          payKey: 'top',
          ratioLabel: '500 for 1',
          winPaid: 49_900,
          credited: 50_000,
        },
      )
      .expectBankroll(99_900)
    fiveHits(scenario('strictBubble'))
      .roll(5, 6)
      .expectSettled(
        { typeId: 'luckyShooter' },
        { outcome: 'win', payKey: '5', ratioLabel: '100 for 1', winPaid: 9_900, credited: 10_000 },
      )
      .expectBets([['pass', 6, 500]])
  })

  it('a repeated box number settles the bet [A PA623c; MD-C]: with 1 hit it loses', () => {
    scenario('strictBubble')
      .expectProvenance('/sideBets/luckyShooter/repeatEndsBet', 'assumed')
      .place('pass', 500)
      .place('luckyShooter', 100)
      .roll(3, 3)
      .roll(2, 2)
      .roll(2, 2)
      .expectSettled({ typeId: 'luckyShooter' }, { outcome: 'lose' })
      .expectBets([['pass', 6, 500]])
  })

  it('a machine on which repeats do not end the bet lets it ride', () => {
    scenario(strictWith('strictRepeats', (shooter) => (shooter.repeatEndsBet = false)))
      .place('pass', 500)
      .place('luckyShooter', 100)
      .roll(3, 3)
      .roll(2, 2)
      .roll(2, 2)
      .expectEvents(['diceRolled'])
      .expectBet({ typeId: 'luckyShooter' }, { progress: pointRunProgress(6, bit(4)) })
  })

  it('a seven-out settles it by the hits: 2 hits pay 2 for 1, 1 hit loses', () => {
    scenario('strictBubble')
      .place('pass', 500)
      .place('luckyShooter', 100)
      .roll(3, 3)
      .roll(2, 2)
      .roll(2, 3)
      .roll(3, 4)
      .expect({ transition: 'sevenOut' })
      .expectSettled(
        { typeId: 'luckyShooter' },
        { outcome: 'win', payKey: '2', ratioLabel: '2 for 1', winPaid: 100, credited: 200 },
      )
      .expectBankroll(49_600)
    scenario('strictBubble')
      .place('pass', 500)
      .place('luckyShooter', 100)
      .roll(3, 3)
      .roll(2, 2)
      .roll(3, 4)
      .expectSettled({ typeId: 'luckyShooter' }, { outcome: 'lose' })
      .expectBets([])
  })

  it('is bet before the point [V IB], may come down until then [A §9 #12], and is a contract bet after [V]', () => {
    scenario('strictBubble')
      .expectProvenance('/sideBets/luckyShooter/removableBeforePoint', 'assumed')
      .place('pass', 500)
      .place('luckyShooter', 100)
      .roll(5, 6)
      .place('luckyShooter', 100)
      .expectBet({ typeId: 'luckyShooter' }, { amount: 200 })
      .setAmount({ typeId: 'luckyShooter' }, 100)
      .takeDown({ typeId: 'luckyShooter' })
      .expectNoBet({ typeId: 'luckyShooter' })
      .place('luckyShooter', 100)
      .roll(3, 3)
      .expectReject('CONTRACT_BET', (a) => a.takeDown({ typeId: 'luckyShooter' }), {
        change: 'remove',
      })
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'luckyShooter' }, 50), {
        change: 'decrease',
      })
      .expectReject('CONTRACT_BET', (a) => a.place('luckyShooter', 100), { change: 'increase' })
      .expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId: 'luckyShooter' }, false))
    scenario('strictBubble')
      .place('pass', 500)
      .roll(3, 3)
      .expectReject('WRONG_PHASE', (a) => a.place('luckyShooter', 100), {
        typeId: 'luckyShooter',
        phase: 'point',
        window: 'comeOut',
      })
  })

  it('a machine that locks it from placement keeps it up through a come-out 7 or 11', () => {
    scenario(strictWith('strictLocked', (shooter) => (shooter.removableBeforePoint = false)))
      .place('pass', 500)
      .place('luckyShooter', 100)
      .takeDown({ typeId: 'luckyShooter' })
      .place('luckyShooter', 100)
      .roll(5, 6)
      .expectReject('CONTRACT_BET', (a) => a.takeDown({ typeId: 'luckyShooter' }), {
        change: 'remove',
      })
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'luckyShooter' }, 50), {
        change: 'decrease',
      })
      .place('luckyShooter', 100)
      .expectBet({ typeId: 'luckyShooter' }, { amount: 200 })
  })
})
