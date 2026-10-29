import { describe, it } from 'vitest'
import { traditionalLive345 } from '../../src/engine/config/presets/index.ts'
import { scenario } from './dsl.ts'

// Line-bet machine facts (rules spec §2.2, §3.1, §3.5, §5.2), played through the table reducer.
// Amounts are cents; every machine starts with $500. Each fact checks the provenance its config
// value records.

describe('crapless (Interblock heads-up)', () => {
  it('a come-out 7 wins the pass line, which stays up for the next come-out [V IB §2.1]', () => {
    scenario('craplessBubble')
      .expectProvenance('/rules/naturals', 'verified')
      .expectProvenance('/catalog/pass/afterWin', 'verified')
      .place('pass', 1_000)
      .expectBankroll(49_000)
      .roll(3, 4)
      .expect({ transition: 'natural', point: null })
      .expectSettled(
        { typeId: 'pass' },
        { outcome: 'win', winPaid: 1_000, credited: 1_000, stakeDisposition: 'stays' },
      )
      .expectBets([['pass', null, 1_000]])
      .expectBankroll(50_000)
      .expectLedger({ deposits: 50_000, houseNet: -1_000, wagered: 1_000 })
  })

  it.each([
    [1, 1, 2],
    [1, 2, 3],
    [5, 6, 11],
    [6, 6, 12],
  ] as const)('a come-out %i-%i makes %i the point; nothing loses [V]', (d1, d2, point) => {
    scenario('craplessBubble')
      .expectProvenance('/rules/craps', 'verified')
      .expectProvenance('/rules/points', 'verified')
      .place('pass', 1_000)
      .roll(d1, d2)
      .expect({ transition: 'pointEstablished', point })
      .expectEvents(['diceRolled', 'pointEstablished', 'betTraveled'])
      .expectBets([['pass', point, 1_000]])
      .expectBankroll(49_000)
  })

  it('come bets travel to 2 and to 12, and the 2 pays even money when it repeats', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(4, 4)
      .place('come', 500)
      .roll(1, 1)
      .expectBet({ typeId: 'come' }, { number: 2, amount: 500 })
      .place('come', 500)
      .roll(6, 6)
      .expectBets([
        ['pass', 8, 1_000],
        ['come', 2, 500],
        ['come', 12, 500],
      ])
      .expectBankroll(48_000)
      .roll(1, 1)
      .expectSettled(
        { typeId: 'come', number: 2 },
        { outcome: 'win', winPaid: 500, credited: 1_000, stakeDisposition: 'returned' },
      )
      .expectBets([
        ['pass', 8, 1_000],
        ['come', 12, 500],
      ])
      .expectBankroll(49_000)
  })

  it('a seven-out takes the pass line and every come point; the come box wins', () => {
    scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('come', 1_000)
      .roll(3, 3)
      .place('come', 1_000)
      .expectBankroll(47_000)
      .roll(5, 2)
      .expect({ transition: 'sevenOut', point: null, handIndex: 1 })
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose', credited: 0 })
      .expectSettled({ typeId: 'come', number: 6 }, { outcome: 'lose', credited: 0 })
      .expectSettled({ typeId: 'come', number: null }, { outcome: 'win', credited: 2_000 })
      .expectEvents([
        'diceRolled',
        'sevenOut',
        'betResolved',
        'betResolved',
        'betResolved',
        'newShooter',
      ])
      .expectBets([])
      .expectBankroll(49_000)
      .expectLedger({ houseNet: 1_000, wagered: 3_000 })
  })

  it('a come bet on 6 wins while the come box travels to 6: two decisions, never merged [§0.2 #12]', () => {
    const s = scenario('craplessBubble')
      .place('pass', 1_000)
      .roll(4, 4)
      .place('come', 1_000)
      .roll(5, 1)
      .place('come', 1_500)
    const onSix = s.find({ typeId: 'come', number: 6 }).id
    const inBox = s.find({ typeId: 'come', number: null }).id
    s.roll(2, 4)
      .expectEvents(['diceRolled', 'betResolved', 'betTraveled'])
      .expectSettled(
        { typeId: 'come', number: 6 },
        { betId: onSix, outcome: 'win', credited: 2_000, stakeDisposition: 'returned' },
      )
      .expectBet({ typeId: 'come', number: 6 }, { id: inBox, amount: 1_500 })
      .expectBets([
        ['pass', 8, 1_000],
        ['come', 6, 1_500],
      ])
      .expectBankroll(48_500)
  })

  it('pass is a contract bet once the point is set; before the come-out roll it is free [V IB §2.2]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/pass', 'verified')
      .place('pass', 1_000)
      .setAmount({ typeId: 'pass' }, 2_000)
      .setAmount({ typeId: 'pass' }, 500)
      .expectBankroll(49_500)
      .roll(1, 1)
      .expectReject('CONTRACT_BET', (a) => a.takeDown({ typeId: 'pass' }), { change: 'remove' })
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'pass' }, 100), {
        change: 'decrease',
      })
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'pass' }, 1_000), {
        change: 'increase',
      })
      .expectReject('WRONG_PHASE', (a) => a.place('pass', 500), { window: 'comeOut' })
      .place('come', 500)
      .roll(3, 3)
      .expectReject('CONTRACT_BET', (a) => a.takeDown({ typeId: 'come', number: 6 }))
  })

  it('come is bet only with a point on [V IB §2.4; §9 #26]', () => {
    scenario('craplessBubble')
      .expectProvenance('/catalog/come', 'verified')
      .expectReject('WRONG_PHASE', (a) => a.place('come', 500), { window: 'point' })
      .place('pass', 500)
      .roll(4, 5)
      .place('come', 500)
      .expectBet({ typeId: 'come' }, { number: null, amount: 500 })
  })

  it("offers no don't bets [V IB]", () => {
    scenario('craplessBubble')
      .expectReject('NOT_OFFERED', (a) => a.place('dontPass', 1_000))
      .place('pass', 500)
      .roll(2, 2)
      .expectReject('NOT_OFFERED', (a) => a.place('dontCome', 1_000))
  })
})

describe('traditional', () => {
  it('a come-out 7 or 11 wins the pass line; 2, 3 and 12 lose it [V CW §5]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/rules', 'verified')
      .expectProvenance('/catalog/pass/afterWin', 'verified')
      .place('pass', 1_000)
      .roll(5, 6)
      .expect({ transition: 'natural' })
      .expectSettled(
        { typeId: 'pass' },
        { outcome: 'win', credited: 1_000, stakeDisposition: 'stays' },
      )
      .roll(3, 4)
      .expectBankroll(51_000)
      .roll(1, 1)
      .expect({ transition: 'craps' })
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose', credited: 0, stakeDisposition: 'lost' })
      .expectNoBet({ typeId: 'pass' })
      .place('pass', 1_000)
      .roll(1, 2)
      .place('pass', 1_000)
      .roll(6, 6)
      .expectBets([])
      .expectBankroll(49_000)
      .expectLedger({ houseNet: 1_000 })
  })

  it("12 pushes don't pass on the come-out (bar 12); it then wins on 3 and rides [V CW §11c, §30]", () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/dontPass/afterWin', 'verified')
      .place('dontPass', 1_000)
      .roll(6, 6)
      .expect({ transition: 'craps' })
      .expectSettled(
        { typeId: 'dontPass' },
        { outcome: 'push', pushReason: 'bar', credited: 0, stakeDisposition: 'stays' },
      )
      .expectBets([['dontPass', null, 1_000]])
      .expectBankroll(49_000)
      .roll(1, 2)
      .expectSettled(
        { typeId: 'dontPass' },
        { outcome: 'win', credited: 1_000, stakeDisposition: 'stays' },
      )
      .expectBankroll(50_000)
      .roll(5, 6)
      .expectSettled({ typeId: 'dontPass' }, { outcome: 'lose' })
      .expectBets([])
      .expectBankroll(50_000)
  })

  it("under Reno rules 2 pushes don't pass and 12 wins it", () => {
    const reno = {
      ...traditionalLive345,
      id: 'reno',
      rules: { ...traditionalLive345.rules, dontBar: 2 as const },
    }
    scenario(reno)
      .place('dontPass', 1_000)
      .roll(1, 1)
      .expectSettled({ typeId: 'dontPass' }, { outcome: 'push', pushReason: 'bar' })
      .roll(6, 6)
      .expectSettled(
        { typeId: 'dontPass' },
        { outcome: 'win', credited: 1_000, stakeDisposition: 'stays' },
      )
      .expectBets([['dontPass', null, 1_000]])
      .expectBankroll(50_000)
  })

  it('on Shoot To Win a come bet that wins on 11 stays in the come box; elsewhere it is returned [V CW §31]', () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/come/afterWin', 'verified')
      .place('pass', 1_000)
      .roll(4, 5)
      .place('come', 500)
      .roll(5, 6)
      .expectSettled(
        { typeId: 'come' },
        { outcome: 'win', credited: 500, stakeDisposition: 'stays' },
      )
      .expectBets([
        ['pass', 9, 1_000],
        ['come', null, 500],
      ])
      .roll(6, 6)
      .expectSettled({ typeId: 'come' }, { outcome: 'lose' })
      .expectBets([['pass', 9, 1_000]])
    scenario('strictBubble')
      .place('pass', 1_000)
      .roll(4, 5)
      .place('come', 500)
      .roll(5, 6)
      .expectSettled(
        { typeId: 'come' },
        { outcome: 'win', credited: 1_000, stakeDisposition: 'returned' },
      )
      .expectBets([['pass', 9, 1_000]])
  })

  it("don't come: 12 pushes in the box, 3 wins and rides, then it travels and a seven-out wins it", () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/dontCome/afterWin', 'verified')
      .place('pass', 1_000)
      .roll(4, 4)
      .place('dontCome', 500)
      .roll(6, 6)
      .expectSettled({ typeId: 'dontCome' }, { outcome: 'push', pushReason: 'bar' })
      .expectBet({ typeId: 'dontCome' }, { number: null, amount: 500 })
      .roll(1, 2)
      .expectSettled(
        { typeId: 'dontCome' },
        { outcome: 'win', credited: 500, stakeDisposition: 'stays' },
      )
      .roll(5, 5)
      .expectBet({ typeId: 'dontCome' }, { number: 10 })
      .roll(3, 4)
      .expectSettled({ typeId: 'pass' }, { outcome: 'lose' })
      .expectSettled(
        { typeId: 'dontCome', number: 10 },
        { outcome: 'win', credited: 1_000, stakeDisposition: 'returned' },
      )
      .expectBets([])
      .expectBankroll(50_000)
  })

  it("Interblock lets don't pass be reduced or taken down after the point, not raised [V IB §2.3]", () => {
    scenario('strictBubble')
      .expectProvenance('/catalog/dontPass', 'verified')
      .place('dontPass', 1_000)
      .roll(2, 2)
      .setAmount({ typeId: 'dontPass' }, 500)
      .expectBankroll(49_500)
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'dontPass' }, 800), {
        change: 'increase',
      })
      .takeDown({ typeId: 'dontPass' })
      .expectBankroll(50_000)
      .expectBets([])
      .expectReject('WRONG_PHASE', (a) => a.place('dontPass', 1_000))
  })

  it("Shoot To Win locks don't pass once the point is set [V CW §11e]", () => {
    scenario('traditionalBubble')
      .expectProvenance('/catalog/dontPass', 'verified')
      .place('dontPass', 1_000)
      .setAmount({ typeId: 'dontPass' }, 600)
      .roll(2, 2)
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'dontPass' }, 500), {
        change: 'decrease',
      })
      .expectReject('CONTRACT_BET', (a) => a.takeDown({ typeId: 'dontPass' }), { change: 'remove' })
  })

  it("a don't come taken down cannot be bet again until the next come-out (nextCycle) [A]", () => {
    scenario('strictBubble')
      .expectProvenance('/catalog/dontCome/rebetAfterRemove', 'assumed')
      .place('pass', 1_000)
      .roll(2, 2)
      .place('dontCome', 1_000)
      .roll(3, 3)
      .takeDown({ typeId: 'dontCome', number: 6 })
      .expectReject('WINDOW_CLOSED', (a) => a.place('dontCome', 1_000), {
        reason: 'rebetAfterRemove',
      })
      .roll(4, 5)
      .expectReject('WINDOW_CLOSED', (a) => a.place('dontCome', 1_000))
      .roll(1, 3)
      .expect({ transition: 'pointMade', point: null })
      .roll(5, 5)
      .place('dontCome', 1_000)
      .expectBet({ typeId: 'dontCome' }, { number: null, amount: 1_000 })
  })

  it("pass and don't pass exclude each other on Shoot To Win [V CW §5f]", () => {
    scenario('traditionalBubble')
      .expectProvenance('/exclusiveGroups', 'verified')
      .place('pass', 1_000)
      .expectReject('EXCLUSIVE_CONFLICT', (a) => a.place('dontPass', 1_000), {
        conflictsWith: 'pass',
      })
  })

  it('a live table takes a put bet: pass made with the point on goes straight to the point [R WOO-B]', () => {
    scenario('traditionalLive345')
      .expectProvenance('/rules/allowPutBets', 'reported')
      .roll(3, 3)
      .place('pass', 1_000)
      .expectBet({ typeId: 'pass' }, { number: 6, amount: 1_000 })
      .setAmount({ typeId: 'pass' }, 2_000)
      .expectReject('CONTRACT_BET', (a) => a.setAmount({ typeId: 'pass' }, 1_000))
      .roll(5, 1)
      .expectSettled(
        { typeId: 'pass' },
        { outcome: 'win', credited: 2_000, stakeDisposition: 'stays' },
      )
      .expectBets([['pass', null, 2_000]])
    scenario('strictBubble')
      .place('pass', 500)
      .roll(3, 3)
      .expectReject('WRONG_PHASE', (a) => a.place('pass', 1_000))
  })
})
