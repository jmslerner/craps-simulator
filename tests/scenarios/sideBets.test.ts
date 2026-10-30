import { describe, expect, it } from 'vitest'
import { compileConfig } from '../../src/engine/config/compile.ts'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import { cents } from '../../src/engine/core/money.ts'
import { legalBets } from '../../src/engine/bets/legal.ts'
import { requireBet, resolveBet, resolveType } from '../../src/engine/bets/registry.ts'
import { betId } from '../../src/engine/bets/types.ts'
import { workingStatus } from '../../src/engine/bets/working.ts'
import { invariantViolations } from '../../src/engine/table/invariants.ts'
import { scenario } from './dsl.ts'

// What every side-bet family shares (rules spec §2.6; plan §4.5, §10 M11): one spot per type on
// the layout, always working, listed by `legalBets` only on request, progress kept on the bet and
// checked by the table invariants, and the largest pay counted when a roll checks the ledger's room.

describe('side bets on every machine', () => {
  const machines = [
    ['craplessBubble', 'luckyRollerAll'],
    ['traditionalBubble', 'hotShooter'],
    ['strictBubble', 'luckyShooter'],
    ['traditionalLive345', 'fire'],
  ] as const

  it.each(machines)(
    '%s: %s resolves for the table but not for the solver, and always works',
    (id, typeId) => {
      const cfg = compileConfig(PRESETS[id])
      expect(resolveType(cfg, typeId)).toBeNull()
      const resolved = resolveBet(cfg, typeId)
      expect(resolved?.type.typeId).toBe(typeId)
      expect(resolved?.family.toggleable).toBe(false)
      expect(requireBet(cfg, typeId).type.family).toBe(cfg.sideBets.get(typeId)?.family)
      const s = scenario(id).place(id === 'traditionalLive345' ? 'pass' : 'pass', 1_000)
      s.place(typeId, 100)
      const bet = s.find({ typeId })
      expect(workingStatus(bet, s.state, cfg)).toEqual({ working: true, source: 'always' })
      if (cfg.working.toggle.global) {
        s.setGlobalWorking(true).expectBet({ typeId }, { working: true })
      }
      s.expectReject('NOT_TOGGLEABLE', (a) => a.setWorking({ typeId }, false), { typeId })
    },
  )

  it('every side bet spot the layout can show sits beside the main game in legalBets', () => {
    for (const [id] of machines) {
      const s = scenario(id)
      const main = legalBets(s.state, s.cfg)
      const all = legalBets(s.state, s.cfg, { sideBets: true })
      expect(all.slice(0, main.length), id).toEqual(main)
      expect(
        all.slice(main.length).map((spot) => spot.typeId),
        id,
      ).toEqual([...s.cfg.sideBets.keys()])
      for (const spot of all.slice(main.length)) {
        expect(spot, `${id} ${spot.typeId}`).toMatchObject({
          number: null,
          parentId: null,
          betId: null,
        })
      }
    }
  })
})

describe('progress is a side bet’s own (table invariants)', () => {
  const cfg = compileConfig(PRESETS.craplessBubble)

  it('a main-game bet with progress, or a side bet with bad progress, breaks the table', () => {
    const s = scenario('craplessBubble').place('pass', 500).place('luckyRollerLow', 100)
    const [pass, roller] = s.state.bets
    if (pass === undefined || roller === undefined) throw new Error('two bets expected')
    expect(invariantViolations(s.state, cfg)).toEqual([])
    expect(
      invariantViolations({ ...s.state, bets: [{ ...pass, progress: 3 }, roller] }, cfg),
    ).toEqual([expect.stringMatching(/only side bets keep/)])
    expect(
      invariantViolations({ ...s.state, bets: [pass, { ...roller, progress: -1 }] }, cfg),
    ).toEqual([expect.stringMatching(/bad progress/), expect.stringMatching(/not its targets/)])
    expect(
      invariantViolations({ ...s.state, bets: [pass, { ...roller, progress: 1 << 9 }] }, cfg),
    ).toEqual([expect.stringMatching(/not its targets/)])
  })

  it('a bet of a side-bet type on a number or behind a parent breaks the table', () => {
    const s = scenario('craplessBubble').place('pass', 500).place('luckyRollerLow', 100)
    const [pass, roller] = s.state.bets
    if (pass === undefined || roller === undefined) throw new Error('two bets expected')
    expect(
      invariantViolations({ ...s.state, bets: [pass, { ...roller, number: 6 }] }, cfg),
    ).toEqual([expect.stringMatching(/takes no number/)])
    expect(
      invariantViolations({ ...s.state, bets: [pass, { ...roller, parentId: betId(1) }] }, cfg),
    ).toEqual([expect.stringMatching(/only odds back a bet/), expect.stringMatching(/backs b1/)])
  })
})

describe('a roll makes room in the ledger for what a side bet could win (plan §4.6)', () => {
  // With D cents deposited, $5 on the pass line and $500 on Roll 'Em All, the roll is allowed while
  // deposits + 2 × (credit + stakes + every bet's largest win) fits in safe cents: the pass line can
  // win 500 + 1 (a rounding step) and Roll 'Em All 50,000 × 155 + 1, so 3D + 150,000 + 2 × 7,750,502
  // must not pass Number.MAX_SAFE_INTEGER. The largest such D is 3,002,399,746,363,329 cents.
  const room = 3_002_399_746_363_329

  it('refuses the roll one cent past the room the Roll ’Em All pay needs, and allows it without the bet', () => {
    scenario('craplessBubble')
      .deposit(room)
      .place('pass', 500)
      .place('luckyRollerAll', 50_000)
      .roll(2, 2)
      .expect({ point: 4 })
    scenario('craplessBubble')
      .deposit(room + 1)
      .place('pass', 500)
      .place('luckyRollerAll', 50_000)
      .expectReject('ABOVE_MAX', (a) => a.roll(2, 2), { scope: 'ledger' })
      .takeDown({ typeId: 'luckyRollerAll' })
      .roll(2, 2)
      .expect({ point: 4 })
      .expectBankroll(cents(room + 1 + 50_000 - 500))
  })
})
