import { describe, expect, it } from 'vitest'
import { compileConfig } from '../../src/engine/config/compile.ts'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import { legalBets } from '../../src/engine/bets/legal.ts'
import { smallestBet, typeLimits } from '../../src/engine/bets/limits.ts'
import { newTable } from '../../src/engine/table/state.ts'
import { scenario } from './dsl.ts'

// The live table's posted minimums (M12, impl4 item 18; rules spec §4.3, LIVE minimums): Harrah's
// Philadelphia takes a buy from $20 and a lay only when it wins at least $20 [V HAR-PA], so a lay is
// $40 on 4 and 10 (1 to 2), $30 on 5 and 9 (2 to 3) and $24 on 6 and 8 (5 to 6); place bets go from
// $5 [A]. The per-number minimum (`/limits/perType/<t>/minByNumber`) replaces the type's minimum on
// its number, through `typeLimits`, so validation, `legalBets` and the exact analysis all see it.
// Amounts are cents; the table starts with $500.

describe('the live table posts real place, buy and lay minimums', () => {
  it('a lay must win $20: $40 on 4, $30 on 5, $24 on 6, each paying a whole $1 vig', () => {
    scenario('traditionalLive345')
      .expectProvenance('/limits/perType/lay/minByNumber', 'verified')
      .expectReject('BELOW_MIN', (a) => a.place('lay', 3_900, { number: 4 }), {
        typeId: 'lay',
        min: 4_000,
      })
      .expectReject('BELOW_MIN', (a) => a.place('lay', 2_900, { number: 5 }), { min: 3_000 })
      .expectReject('BELOW_MIN', (a) => a.place('lay', 2_300, { number: 6 }), { min: 2_400 })
      .place('lay', 4_000, { number: 4 })
      .place('lay', 3_000, { number: 5 })
      .place('lay', 2_400, { number: 6 })
      .expectEvents(['betPlaced', 'vigCharged'])
      // $1 of vig on each: 5% of the $20 each would win.
      .expectLedger({ bankroll: 50_000 - 9_400 - 300, vigPaid: 300 })
      .roll(3, 4)
      .expectSettled(
        { typeId: 'lay', number: 6 },
        { winPaid: 2_000, vigRearm: 100, credited: 1_900, stakeDisposition: 'stays' },
      )
  })

  it('a buy goes from $20, whose 5% is a whole dollar; place bets from $5', () => {
    scenario('traditionalLive345')
      .expectProvenance('/limits/perType/buy', 'verified')
      .expectProvenance('/limits/perType/place', 'assumed')
      .expectReject('BELOW_MIN', (a) => a.place('buy', 1_900, { number: 5 }), {
        typeId: 'buy',
        min: 2_000,
      })
      .expectReject('BELOW_MIN', (a) => a.place('place', 400, { number: 4 }), {
        typeId: 'place',
        min: 500,
      })
      .place('buy', 2_000, { number: 5 })
      .expectEvents(['betPlaced', 'vigCharged'])
      .expectLedger({ vigPaid: 100 })
      // A $5 place 6 is still taken: the dealer pays $5, keeping the change [V LVA-RND].
      .place('place', 500, { number: 6 })
  })

  it('the minimum on a number reaches legalBets and the smallest bet there', () => {
    const cfg = compileConfig(PRESETS.traditionalLive345)
    const smallest = (typeId: string, number: 4 | 5 | 6 | 8 | 9 | 10) =>
      smallestBet(typeLimits(cfg, typeId, number))
    expect([4, 5, 6, 8, 9, 10].map((n) => smallest('lay', n as 4))).toEqual([
      4_000, 3_000, 2_400, 2_400, 3_000, 4_000,
    ])
    const spot = (state: ReturnType<typeof newTable>, number: 4 | 6) =>
      legalBets(state, cfg).find((s) => s.typeId === 'lay' && s.number === number)
    expect(spot(newTable(cfg, 'live-minimums'), 4)?.canAdd).toBeNull()
    // $40 of credit left: a lay on 4 needs $40 and its $1 vig, a lay on 6 only $24 and $1.
    const poor = scenario('traditionalLive345').place('pass', 46_000).state
    expect(spot(poor, 4)?.canAdd?.code).toBe('INSUFFICIENT_CREDIT')
    expect(spot(poor, 6)?.canAdd).toBeNull()
  })
})
