import { describe, it } from 'vitest'
import { scenario } from './dsl.ts'

/**
 * Researched facts behind the high-limit crapless machine
 * (docs/rules/research/high-limit-machines.md), one scenario per fact with the provenance of the
 * config value it rests on. The machine starts with $5,000; amounts are cents.
 */

describe('craplessBubbleHighLimit (Las Vegas high-limit crapless unit)', () => {
  it('holds at most $20,000 on the layout for one roll [R WOV-35576]', () => {
    scenario('craplessBubbleHighLimit')
      .expectProvenance('/limits/tableMax', 'reported')
      .deposit(2_000_000)
      .place('pass', 500_000)
      .place('field', 500_000)
      .place('place', 500_000, { number: 6 })
      .place('place', 500_000, { number: 8 })
      // Exactly $20,000 is on the layout; the next dollar is over the table maximum.
      .expectReject('TABLE_MAX', (a) => a.place('place', 500, { number: 5 }), {
        total: 2_000_500,
        tableMax: 2_000_000,
      })
      .expectBankroll(500_000)
  })

  it('takes $5 to $5,000 a wager, in $5 steps [A, from the Venetian live maximum]', () => {
    scenario('craplessBubbleHighLimit')
      .expectProvenance('/limits/min', 'assumed')
      .expectProvenance('/limits/max', 'assumed')
      .expectProvenance('/money/betIncrement', 'assumed')
      .expectReject('BELOW_MIN', (a) => a.place('field', 200), { min: 500 })
      .expectReject('BAD_INCREMENT', (a) => a.place('field', 700), { increment: 500 })
      .expectReject('ABOVE_MAX', (a) => a.place('pass', 500_500), { max: 500_000 })
      .place('pass', 500_000)
      .expectBankroll(0)
  })

  it('BETS ARE NOT VALID YET until the bets add up to $25 [A, Venetian minimums]', () => {
    scenario('craplessBubbleHighLimit')
      .expectProvenance('/limits/minTotal', 'verified')
      .expectProvenance('/limits/minTotal/amount', 'assumed')
      .place('pass', 2_000)
      .expectReject('BELOW_MIN_TOTAL', (a) => a.roll(3, 4), {
        scope: 'totalRound',
        min: 2_500,
        total: 2_000,
        short: 500,
      })
      .place('field', 500)
      .roll(3, 4)
      // The come-out 7 wins the pass +$20 (its stake stays up) and loses the $5 field.
      .expectBankroll(499_500)
  })

  it('still takes only 2x odds, as reported for crapless machines [R VA, LVA-CL]', () => {
    scenario('craplessBubbleHighLimit')
      .expectProvenance('/catalog/passOdds/limit', 'reported')
      .deposit(1_500_000)
      .place('pass', 200_000)
      .roll(1, 1) // crapless: 2 is a point
      .expectReject('ODDS_LIMIT', (a) => a.place('passOdds', 400_500), { max: 400_000 })
      .place('passOdds', 400_000)
      .roll(1, 1)
      // True odds on the 2: 6:1 on $4,000 = $24,000, the line even money.
      .expectSettled({ typeId: 'passOdds' }, { winPaid: 2_400_000 })
      .expectBankroll(4_400_000)
  })

  it('a $5,000 line bet carries its full $10,000 double odds under the per-type cap [A]', () => {
    scenario('craplessBubbleHighLimit')
      .deposit(1_500_000)
      .place('pass', 500_000)
      .roll(1, 1)
      // The per-type maximum equals the 2x cap on a maximum line bet, so it never cuts odds short.
      .expectReject('ABOVE_MAX', (a) => a.place('passOdds', 1_000_500), { max: 1_000_000 })
      .place('passOdds', 1_000_000)
      .roll(1, 1)
      .expectSettled({ typeId: 'passOdds' }, { winPaid: 6_000_000 })
      .expectBankroll(8_000_000)
  })

  it('caps high-pay props by tier: $900 at 31 for 1, $1,800 at 16 for 1 [A, scaled from WOV-35576]', () => {
    scenario('craplessBubbleHighLimit')
      .expectProvenance('/limits/perType', 'assumed')
      .expectReject('ABOVE_MAX', (a) => a.place('boxcars', 90_500), { max: 90_000 })
      .expectReject('ABOVE_MAX', (a) => a.place('yo', 180_500), { max: 180_000 })
      .expectReject('ABOVE_MAX', (a) => a.place('hard', 300_500, { number: 8 }), { max: 300_000 })
      .place('boxcars', 90_000)
      .place('yo', 180_000)
      .expectBankroll(230_000)
  })

  it('lets place and buy run to $10,000, twice the line maximum [A, scaled from WOV-35576]', () => {
    scenario('craplessBubbleHighLimit')
      .deposit(1_500_000)
      .expectReject('ABOVE_MAX', (a) => a.place('place', 1_000_500, { number: 6 }), {
        max: 1_000_000,
      })
      .place('place', 1_000_000, { number: 6 })
      .place('pass', 2_500) // the $25 round minimum still applies at these stakes
      .roll(3, 3)
      // 7:6 on $10,000 floored to the cent: the base machine's pay table, only the stakes moved.
      .expectSettled(
        { typeId: 'place', number: 6 },
        { ratioLabel: '7:6', winPaid: 1_166_666, stakeDisposition: 'stays' },
      )
      .expectBankroll(2_164_166)
  })
})
