import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { factsFrom, type MachineFacts } from './machineFacts.ts'
import { refMaxOdds } from './referenceRules.ts'
import {
  refApply,
  refLedgerHolds,
  refNewTable,
  refSnapshot,
  type RefAction,
  type RefRejection,
  type RefSettled,
  type RefTable,
} from './referenceTable.ts'

const SEED = 20261028

/** A test session: applies actions, checking that rejections change nothing and the ledger holds. */
function session(input: MachineConfigInput) {
  const facts = factsFrom(input)
  let table = refNewTable(facts)
  const api = {
    facts,
    table: () => table,
    apply(action: RefAction): readonly RefSettled[] {
      const before = JSON.stringify(table)
      const outcome = refApply(facts, table, action)
      expect(JSON.stringify(table), 'the old table is never mutated').toBe(before)
      if (!outcome.ok)
        throw new Error(`${action.type} rejected: ${outcome.reason} ${outcome.detail}`)
      expect(refLedgerHolds(outcome.table)).toBe(true)
      table = outcome.table
      return outcome.settled
    },
    rejects(action: RefAction, reason: RefRejection) {
      const before = JSON.stringify(table)
      const outcome = refApply(facts, table, action)
      expect(outcome.ok ? 'accepted' : outcome.reason).toBe(reason)
      expect(JSON.stringify(table)).toBe(before)
    },
    place(typeId: string, amount: number, at: { number?: number; parent?: string } = {}) {
      return api.apply({ type: 'place', typeId, amount, ...at })
    },
    roll(d1: number, d2: number) {
      return api.apply({ type: 'roll', d1, d2 })
    },
    snap: () => refSnapshot(facts, table),
    bankroll: () => table.bankroll,
    /** The snapshot row of one bet, or undefined. */
    bet(typeId: string, number: number | null = null) {
      return refSnapshot(facts, table).bets.find((b) => b.typeId === typeId && b.number === number)
    },
    bets: () =>
      refSnapshot(facts, table).bets.map((b) => `${b.typeId}@${b.number ?? '-'} ${b.amount}`),
  }
  return api
}

function edited(id: keyof typeof PRESETS, edit: (input: MachineConfigInput) => void) {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  return input
}

const settledText = (settled: readonly RefSettled[]) =>
  settled.map(
    (s) => `${s.typeId}@${s.number ?? '-'} ${s.settlement.outcome} ${s.settlement.credited}`,
  )

describe('the plan §10 M8 run on the default crapless machine', () => {
  it('ends at $621 with the pass still up (pass afterWin stay, §13 M2 note)', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 1_000)
    s.roll(1, 1)
    expect([s.snap().phase, s.snap().point]).toEqual(['point', 2])
    s.place('passOdds', 2_000, { parent: 'pass@2' })
    s.place('place', 600, { number: 6 })
    expect(settledText(s.roll(3, 3))).toEqual(['place@6 win 700'])
    expect(settledText(s.roll(1, 1))).toEqual(['pass@2 win 1000', 'passOdds@2 win 14000'])
    expect(s.bankroll()).toBe(62_100)
    expect(s.bets()).toEqual(['pass@- 1000', 'place@6 600'])
    expect(s.snap()).toMatchObject({ houseNet: -13_700, deposits: 50_000, vigPaid: 0 })
  })

  it('ends at $631 when the pass is returned', () => {
    const s = session(
      edited('craplessBubble', (input) => {
        const pass = input.catalog.pass
        if (pass?.family === 'line') pass.afterWin = 'return'
      }),
    )
    s.place('pass', 1_000)
    s.roll(1, 1)
    s.place('passOdds', 2_000, { parent: 'pass@2' })
    s.place('place', 600, { number: 6 })
    s.roll(3, 3)
    s.roll(1, 1)
    expect(s.bankroll()).toBe(63_100)
    expect(s.bets()).toEqual(['place@6 600'])
  })
})

describe('line bets on the table (rules spec §2.2, §3.1, §3.5)', () => {
  it('crapless: 2, 3, 11 and 12 on the come-out become the point; only 7 wins', () => {
    for (const [d1, d2] of [
      [1, 1],
      [1, 2],
      [5, 6],
      [6, 6],
    ] as const) {
      const s = session(PRESETS.craplessBubble)
      s.place('pass', 1_000)
      expect(settledText(s.roll(d1, d2))).toEqual(['pass@- travel 0'])
      expect(s.snap().point).toBe(d1 + d2)
      expect(s.bets()).toEqual([`pass@${d1 + d2} 1000`])
    }
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 1_000)
    expect(settledText(s.roll(3, 4))).toEqual(['pass@- win 1000'])
    expect(s.bets()).toEqual(['pass@- 1000'])
  })

  it('a come bet travels, and the next one travels to N as the come bet on N wins (no merge)', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 1_000)
    s.roll(2, 2)
    s.place('come', 1_000)
    s.roll(3, 3)
    expect(s.bets()).toEqual(['come@6 1000', 'pass@4 1000'])
    s.place('come', 1_000)
    expect(settledText(s.roll(2, 4))).toEqual(['come@6 win 2000', 'come@- travel 0'])
    expect(s.bets()).toEqual(['come@6 1000', 'pass@4 1000'])
    expect(s.bankroll()).toBe(49_000)
  })

  it("traditional: the don't pass bar 12 pushes and stays; a first-roll win rides (STW)", () => {
    const s = session(PRESETS.traditionalBubble)
    s.place('dontPass', 1_000)
    expect(settledText(s.roll(6, 6))).toEqual(['dontPass@- push 0'])
    expect(settledText(s.roll(1, 2))).toEqual(['dontPass@- win 1000'])
    expect(s.bets()).toEqual(['dontPass@- 1000'])
    expect(s.bankroll()).toBe(50_000)
    expect(settledText(s.roll(5, 6))).toEqual(['dontPass@- lose 0'])
    expect(s.bets()).toEqual([])
  })

  it('come odds are returned when the come bet is decided on the come-out', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 1_000)
    s.roll(2, 2)
    s.place('come', 1_000)
    s.roll(1, 5)
    s.place('comeOdds', 2_000, { parent: 'come@6' })
    s.roll(1, 3) // the point is made; the come bet and its odds ride into the come-out
    expect(s.bet('comeOdds', 6)?.working).toBe(false)
    expect(settledText(s.roll(3, 4))).toEqual([
      'pass@- win 1000',
      'come@6 lose 0',
      'comeOdds@6 push 2000',
    ])
    expect(s.bankroll()).toBe(50_000)
    expect(s.snap().houseNet).toBe(-1_000)
  })
})

describe('Interblock heads-up working policy (rules spec §2.3 step 8, §2.4; craplessBubble)', () => {
  it('walks through the come-out, a seven-out, and Set bets On', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 1_000)
    s.place('place', 600, { number: 6 })
    expect(s.bet('place', 6)?.working).toBe(true) // place bets work on the come-out (§0.2 #4)
    expect(settledText(s.roll(3, 4))).toEqual(['pass@- win 1000', 'place@6 lose 0'])
    expect(s.bankroll()).toBe(49_400)

    s.place('place', 600, { number: 6 })
    s.roll(2, 2)
    s.place('passOdds', 2_000, { parent: 'pass@4' })
    expect(settledText(s.roll(3, 3))).toEqual(['place@6 win 700'])
    s.roll(3, 4) // seven-out
    expect(s.bets()).toEqual([])
    expect(s.bankroll()).toBe(47_500)

    // Place and buy bets placed after the seven-out start OFF; the upfront vig is still charged.
    s.place('place', 600, { number: 8 })
    s.place('buy', 2_000, { number: 4 })
    s.place('hard', 100, { number: 6 })
    expect([
      s.bet('place', 8)?.working,
      s.bet('buy', 4)?.working,
      s.bet('hard', 6)?.working,
    ]).toEqual([false, false, true])
    expect(s.bet('buy', 4)?.vigHeld).toBe(100)
    s.place('pass', 1_000)
    expect(s.bankroll()).toBe(43_700)
    expect(settledText(s.roll(3, 4))).toEqual(['hard@6 lose 0', 'pass@- win 1000'])

    // The next window flags nothing; the flagged bets stay OFF into the point (until player On).
    s.place('place', 500, { number: 9 })
    expect(s.bet('place', 9)?.working).toBe(true)
    expect(settledText(s.roll(4, 4))).toEqual(['pass@- travel 0'])
    expect([s.bet('place', 8)?.working, s.bet('buy', 4)?.working]).toEqual([false, false])
    s.apply({ type: 'setGlobalWorking', off: false })
    expect([s.bet('place', 8)?.working, s.bet('buy', 4)?.working]).toEqual([true, true])
    expect(settledText(s.roll(4, 4))).toEqual(['place@8 win 700', 'pass@8 win 1000'])
    expect(s.bankroll()).toBe(45_900)
    expect(s.snap().vigPaid).toBe(100)
  })

  it('with until pointEstablished the flag ends at the next point; anySeven also starts it', () => {
    const until = session(
      edited('craplessBubble', (input) => {
        const rule = input.afterSevenOut.newPlacedOff
        if (rule !== null) rule.until = 'pointEstablished'
      }),
    )
    until.place('pass', 1_000)
    until.roll(2, 2)
    until.roll(3, 4)
    until.place('place', 600, { number: 6 })
    until.place('place', 600, { number: 8 })
    until.place('pass', 1_000)
    expect(until.bet('place', 6)?.working).toBe(false)
    // OFF for the roll that sets the point, ON after it: the 8 sets the point and does not pay.
    expect(settledText(until.roll(4, 4))).toEqual(['pass@- travel 0'])
    expect([until.bet('place', 6)?.working, until.bet('place', 8)?.working]).toEqual([true, true])
    // Set bets On ends it sooner, whatever the `until`.
    until.roll(3, 4)
    until.place('place', 600, { number: 5 })
    until.apply({ type: 'setGlobalWorking', off: null })
    expect(until.bet('place', 5)?.working).toBe(true)

    const anySeven = session(
      edited('craplessBubble', (input) => {
        const rule = input.afterSevenOut.newPlacedOff as { trigger?: string } | null
        if (rule !== null) rule.trigger = 'anySeven'
      }),
    )
    anySeven.place('pass', 1_000)
    anySeven.roll(3, 4) // a come-out 7, not a seven-out
    anySeven.place('place', 600, { number: 6 })
    expect(anySeven.bet('place', 6)?.working).toBe(false)
  })

  it('Set bets Off: OFF bets keep their credit but do not meet the minimum total', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('place', 600, { number: 6 })
    s.apply({ type: 'setGlobalWorking', off: true })
    expect(s.bet('place', 6)?.working).toBe(false)
    s.rejects({ type: 'roll', d1: 3, d2: 4 }, 'BELOW_MIN_TOTAL')
    s.place('field', 500)
    expect(settledText(s.roll(3, 4))).toEqual(['field@- lose 0'])
    expect(s.bets()).toEqual(['place@6 600'])
    s.rejects(
      { type: 'setWorking', bet: { typeId: 'place', number: 6 }, working: true },
      'NOT_TOGGLEABLE',
    )
  })

  it('returns every OFF odds bet when the point is made (Shoot To Win leaves them up)', () => {
    const run = (input: MachineConfigInput) => {
      const s = session(input)
      s.place('pass', 1_000)
      s.roll(2, 2)
      s.place('passOdds', 2_000, { parent: 'pass@4' })
      s.place('come', 1_000)
      s.roll(1, 5)
      s.place('comeOdds', 2_000, { parent: 'come@6' })
      s.apply({ type: 'setGlobalWorking', off: true })
      return { settled: settledText(s.roll(2, 2)), bets: s.bets(), bankroll: s.bankroll() }
    }
    expect(run(PRESETS.craplessBubble)).toEqual({
      settled: ['pass@4 win 1000', 'passOdds@4 push 2000', 'comeOdds@6 push 2000'],
      bets: ['come@6 1000', 'pass@- 1000'],
      bankroll: 49_000,
    })
    expect(run(PRESETS.traditionalBubble)).toEqual({
      settled: ['pass@4 win 1000', 'passOdds@4 push 2000'],
      bets: ['come@6 1000', 'comeOdds@6 2000', 'pass@- 1000'],
      bankroll: 47_000,
    })
  })
})

describe('Shoot To Win working policy (rules spec §2.4 STW, §0.2 #1-#2; traditionalBubble)', () => {
  it('turns carried and new chips OFF on the come-out and back ON at the point', () => {
    const s = session(PRESETS.traditionalBubble)
    s.place('pass', 1_000)
    s.place('place', 600, { number: 6 })
    s.place('lay', 1_000, { number: 4 })
    expect([s.bet('place', 6)?.working, s.bet('lay', 4)?.working]).toEqual([false, true])
    s.rejects({ type: 'place', typeId: 'lay', number: 6, amount: 1_000 }, 'EXCLUSIVE_CONFLICT')
    s.rejects(
      { type: 'place', typeId: 'placeToLose', number: 6, amount: 500 },
      'EXCLUSIVE_CONFLICT',
    )
    s.rejects({ type: 'place', typeId: 'dontPass', amount: 1_000 }, 'EXCLUSIVE_CONFLICT')
    expect(settledText(s.roll(3, 4))).toEqual(['pass@- win 1000', 'lay@4 win 475'])
    // All On cannot override the come-out auto-OFF (§9 #7).
    s.apply({ type: 'setGlobalWorking', off: false })
    expect(s.bet('place', 6)?.working).toBe(false)
    expect(settledText(s.roll(3, 3))).toEqual(['pass@- travel 0'])
    expect(s.bet('place', 6)?.working).toBe(true)
    expect(settledText(s.roll(2, 4))).toEqual(['pass@6 win 1000', 'place@6 win 700'])
    expect(s.bet('place', 6)?.working).toBe(false)
    expect(settledText(s.roll(2, 2))).toEqual(['pass@- travel 0', 'lay@4 lose 0'])
    expect(s.bets()).toEqual(['pass@4 1000', 'place@6 600'])
    expect(s.snap()).toMatchObject({ bankroll: 50_575, vigPaid: 25 })
  })

  it('per-chip OFF works from the next roll; All Off then All On clears it', () => {
    const s = session(PRESETS.traditionalBubble)
    s.place('pass', 1_000)
    s.roll(2, 2)
    s.place('place', 600, { number: 6 })
    s.place('hard', 100, { number: 8 })
    s.apply({ type: 'setWorking', bet: { typeId: 'place', number: 6 }, working: false })
    expect(s.roll(3, 3)).toEqual([])
    s.apply({ type: 'setGlobalWorking', off: true })
    expect([s.bet('place', 6)?.working, s.bet('hard', 8)?.working]).toEqual([false, false])
    s.apply({ type: 'setGlobalWorking', off: false })
    expect(settledText(s.roll(3, 3))).toEqual(['place@6 win 700'])
    s.rejects({ type: 'setWorking', bet: { typeId: 'pass' }, working: false }, 'NOT_TOGGLEABLE')
  })

  it("come wins on 11 stay in the box; don't bets: pass locked, come reduce/remove", () => {
    const s = session(PRESETS.traditionalBubble)
    s.place('dontPass', 1_000)
    s.roll(2, 2)
    s.rejects({ type: 'setAmount', bet: { typeId: 'dontPass' }, amount: 0 }, 'CONTRACT_BET')
    s.rejects({ type: 'place', typeId: 'dontPass', amount: 500 }, 'WRONG_PHASE')
    s.place('dontCome', 1_000)
    s.roll(5, 5)
    s.apply({ type: 'setAmount', bet: { typeId: 'dontCome', number: 10 }, amount: 500 })
    s.rejects(
      { type: 'setAmount', bet: { typeId: 'dontCome', number: 10 }, amount: 1_000 },
      'CONTRACT_BET',
    )
    s.place('dontComeOdds', 2_000, { parent: 'dontCome@10' }) // 2 × $5 ÷ (1:2)
    s.rejects(
      { type: 'place', typeId: 'dontComeOdds', parent: 'dontCome@10', amount: 100 },
      'ODDS_LIMIT',
    )
    expect(settledText(s.roll(2, 2))).toEqual(['dontPass@4 lose 0'])
    expect(s.bet('dontComeOdds', 10)?.working).toBe(true) // don't come odds work on the come-out
    expect(settledText(s.roll(3, 4))).toEqual(['dontCome@10 win 1000', 'dontComeOdds@10 win 3000'])
    expect(s.bankroll()).toBe(50_500)

    const come = session(PRESETS.traditionalBubble)
    come.place('pass', 1_000)
    come.roll(3, 3)
    come.place('come', 1_000)
    expect(settledText(come.roll(5, 6))).toEqual(['come@- win 1000'])
    expect(come.bets()).toEqual(['come@- 1000', 'pass@6 1000'])
  })
})

describe('toggles and composites on the table (rules spec §2.4, plan §0 amendment 15)', () => {
  it('a per-bet ON beats a global OFF; null returns the bet to the button', () => {
    const s = session(PRESETS.traditionalBubble)
    s.place('pass', 1_000)
    s.roll(2, 2)
    s.place('place', 600, { number: 6 })
    s.place('place', 600, { number: 8 })
    s.apply({ type: 'setGlobalWorking', off: true })
    s.apply({ type: 'setWorking', bet: { typeId: 'place', number: 8 }, working: true })
    expect([s.bet('place', 6)?.working, s.bet('place', 8)?.working]).toEqual([false, true])
    expect(settledText(s.roll(4, 4))).toEqual(['place@8 win 700'])
    s.apply({ type: 'setWorking', bet: { typeId: 'place', number: 8 }, working: null })
    expect(s.bet('place', 8)?.working).toBe(false)
  })

  it('with scope nextRollOnly, OFF lasts one roll', () => {
    const s = session(
      edited('traditionalBubble', (input) => {
        input.workingToggle.scope = 'nextRollOnly'
      }),
    )
    s.place('pass', 1_000)
    s.roll(2, 2)
    s.place('place', 600, { number: 6 })
    s.apply({ type: 'setGlobalWorking', off: true })
    expect(s.roll(3, 3)).toEqual([])
    expect(s.bet('place', 6)?.working).toBe(true)
    expect(settledText(s.roll(3, 3))).toEqual(['place@6 win 700'])
  })

  it('a composite is one bet: paid once, returned on Interblock, riding on Shoot To Win', () => {
    const ib = session(PRESETS.craplessBubble)
    ib.place('pass', 1_000)
    ib.place('horn', 400)
    expect(settledText(ib.roll(1, 1))).toEqual(['pass@- travel 0', 'horn@- win 3100'])
    expect(ib.bets()).toEqual(['pass@2 1000'])
    const stw = session(PRESETS.traditionalBubble)
    stw.place('ce', 200)
    stw.place('pass', 1_000)
    expect(settledText(stw.roll(5, 6))).toEqual(['ce@- win 1400', 'pass@- win 1000'])
    expect(stw.bets()).toEqual(['ce@- 200', 'pass@- 1000'])
    expect(settledText(stw.roll(2, 5))).toEqual(['ce@- lose 0', 'pass@- win 1000'])
    const live = session(PRESETS.traditionalLive345)
    live.place('world', 500)
    expect(settledText(live.roll(3, 4))).toEqual(['world@- push 500'])
    expect(live.snap()).toMatchObject({ bankroll: 50_000, houseNet: 0, bets: [] })
  })

  it('odds name their parent as typeId@number', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 1_000)
    s.roll(5, 6)
    s.rejects(
      { type: 'place', typeId: 'passOdds', parent: 'pass at 11', amount: 1_000 },
      'BAD_PARAMS',
    )
    s.rejects({ type: 'place', typeId: 'passOdds', parent: 'come@11', amount: 1_000 }, 'NO_PARENT')
    s.place('passOdds', 1_000, { parent: 'pass@11' })
    s.place('passOdds', 1_000, { parent: 'pass@11' })
    expect(s.snap().bets).toEqual([
      { typeId: 'pass', number: 11, parent: null, amount: 1_000, vigHeld: 0, working: true },
      {
        typeId: 'passOdds',
        number: 11,
        parent: 'pass@11',
        amount: 2_000,
        vigHeld: 0,
        working: true,
      },
    ])
    s.apply({ type: 'setAmount', bet: { typeId: 'passOdds', parent: 'pass@11' }, amount: 500 })
    expect(settledText(s.roll(5, 6))).toEqual(['pass@11 win 1000', 'passOdds@11 win 2000'])
  })
})

describe('Interblock traditional (strictBubble)', () => {
  it('turns lays back ON after a 7 while the other bets stay OFF', () => {
    const s = session(PRESETS.strictBubble)
    s.place('pass', 1_000)
    s.place('lay', 1_000, { number: 4 })
    s.place('place', 600, { number: 6 })
    expect(s.bet('lay', 4)?.vigHeld).toBe(25) // 5% of the $5 the lay would win
    s.apply({ type: 'setGlobalWorking', off: true })
    expect(settledText(s.roll(3, 4))).toEqual(['pass@- win 1000'])
    expect([s.bet('lay', 4)?.working, s.bet('place', 6)?.working]).toEqual([true, false])
    s.place('lay', 1_000, { number: 4 })
    expect(s.bet('lay', 4)).toMatchObject({ amount: 2_000, vigHeld: 50 })
    expect(s.snap().vigPaid).toBe(50)
  })

  it("a pass bet blocks a lay on its point; a don't pass bet blocks a buy there", () => {
    const pass = session(PRESETS.strictBubble)
    pass.place('pass', 1_000)
    pass.roll(4, 4)
    pass.rejects({ type: 'place', typeId: 'lay', number: 8, amount: 1_200 }, 'EXCLUSIVE_CONFLICT')
    pass.place('lay', 1_200, { number: 5 })
    const dont = session(PRESETS.strictBubble)
    dont.place('dontPass', 1_000)
    dont.roll(4, 4)
    dont.rejects({ type: 'place', typeId: 'buy', number: 8, amount: 1_000 }, 'EXCLUSIVE_CONFLICT')
    dont.place('buy', 1_000, { number: 5 })
  })

  it("don't bets reduce or come down, and a removed one waits for the next cycle", () => {
    const s = session(PRESETS.strictBubble)
    s.place('dontPass', 1_000)
    s.roll(3, 3)
    s.apply({ type: 'setAmount', bet: { typeId: 'dontPass' }, amount: 500 })
    s.rejects({ type: 'setAmount', bet: { typeId: 'dontPass' }, amount: 1_000 }, 'CONTRACT_BET')
    s.place('dontCome', 1_000)
    s.roll(2, 2)
    s.apply({ type: 'setAmount', bet: { typeId: 'dontCome', number: 4 }, amount: 0 })
    s.rejects({ type: 'place', typeId: 'dontCome', amount: 1_000 }, 'WINDOW_CLOSED')
    expect(settledText(s.roll(3, 3))).toEqual(['dontPass@6 lose 0'])
    s.place('dontPass', 1_000)
    s.roll(2, 3)
    s.place('dontCome', 1_000)
    expect(s.bankroll()).toBe(47_500)
  })
})

describe('the live reference table (traditionalLive345)', () => {
  it('refunds upfront vig on a take-down, pays whole dollars, and takes put bets', () => {
    const s = session(PRESETS.traditionalLive345)
    s.place('place', 500, { number: 6 })
    expect(s.bet('place', 6)?.working).toBe(false) // live: place bets are OFF on the come-out
    s.place('buy', 2_500, { number: 5 })
    expect(s.snap()).toMatchObject({ bankroll: 46_900, vigPaid: 100, houseNet: 100 })
    s.apply({ type: 'setAmount', bet: { typeId: 'buy', number: 5 }, amount: 0 })
    expect(s.snap()).toMatchObject({ bankroll: 49_500, vigPaid: 0, houseNet: 0 })
    s.rejects({ type: 'setGlobalWorking', off: true }, 'NOT_TOGGLEABLE')
    s.rejects({ type: 'place', typeId: 'pass', amount: 500 }, 'BELOW_MIN')
    s.roll(2, 3)
    s.place('pass', 1_000) // a put bet, straight onto the point
    expect(s.bet('pass', 5)?.amount).toBe(1_000)
    s.place('passOdds', 4_000, { parent: 'pass@5' })
    s.place('buy', 2_500, { number: 4 })
    expect(settledText(s.roll(3, 3))).toEqual(['place@6 win 500']) // $5 × 7/6 = $5.83 → $5
    expect(settledText(s.roll(2, 2))).toEqual(['buy@4 win 4900']) // $50 − $1 vig on the win
    expect(s.roll(3, 4).map((x) => x.settlement.outcome)).toEqual(['lose', 'lose', 'lose', 'lose'])
    expect(s.snap()).toMatchObject({ bankroll: 47_400, houseNet: 2_600, vigPaid: 100, bets: [] })
  })

  it('without a refund, upfront vig stays with the house (craplessBubble)', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('buy', 2_000, { number: 4 })
    s.apply({ type: 'setAmount', bet: { typeId: 'buy', number: 4 }, amount: 0 })
    expect(s.snap()).toMatchObject({ bankroll: 49_900, houseNet: 100, vigPaid: 100, bets: [] })
  })

  it('re-collects upfront vig from a winner that stays up', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 1_000)
    s.place('buy', 2_000, { number: 4 })
    expect(settledText(s.roll(2, 2))).toEqual(['pass@- travel 0', 'buy@4 win 3900'])
    expect(s.bet('buy', 4)).toMatchObject({ amount: 2_000, vigHeld: 100 })
    expect(s.snap().vigPaid).toBe(200)
  })
})

describe('rejections (plan §4.6 codes) change nothing', () => {
  it('covers the codes the spec states clearly', () => {
    const s = session(PRESETS.craplessBubble)
    const place = (typeId: string, amount: number, at: { number?: number; parent?: string } = {}) =>
      ({ type: 'place', typeId, amount, ...at }) as const
    s.rejects(place('dontPass', 1_000), 'NOT_OFFERED')
    s.rejects(place('place', 600), 'BAD_PARAMS')
    s.rejects(place('place', 600, { number: 7 }), 'BAD_PARAMS')
    s.rejects(place('pass', 1_000, { number: 4 }), 'BAD_PARAMS')
    s.rejects(place('pass', 0), 'BAD_PARAMS')
    s.rejects(place('come', 1_000), 'WRONG_PHASE')
    s.rejects(place('place', 650, { number: 6 }), 'BAD_INCREMENT')
    s.rejects(place('place', 60_000, { number: 6 }), 'ABOVE_MAX')
    s.rejects(place('passOdds', 1_000), 'NO_PARENT')
    s.rejects(place('passOdds', 1_000, { parent: 'pass@4' }), 'NO_PARENT')
    s.place('pass', 1_000)
    s.rejects(place('passOdds', 1_000, { parent: 'pass' }), 'PARENT_NOT_ON_POINT')
    s.rejects(
      { type: 'setAmount', bet: { typeId: 'place', number: 5 }, amount: 500 },
      'BET_NOT_FOUND',
    )
    s.roll(2, 2)
    s.rejects(place('pass', 1_000), 'WRONG_PHASE')
    s.rejects(place('passOdds', 2_100, { parent: 'pass@4' }), 'ODDS_LIMIT')
    s.rejects({ type: 'setAmount', bet: { typeId: 'pass' }, amount: 0 }, 'CONTRACT_BET')
    s.rejects({ type: 'setAmount', bet: { typeId: 'pass' }, amount: 2_000 }, 'CONTRACT_BET')
    s.rejects({ type: 'roll', d1: 0, d2: 7 }, 'BAD_PARAMS')
    s.rejects({ type: 'deposit', amount: -100 }, 'BAD_PARAMS')
  })

  it('credit covers the stake and its upfront vig; the table maximum caps the layout', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 48_000)
    s.rejects({ type: 'place', typeId: 'buy', number: 4, amount: 2_000 }, 'INSUFFICIENT_CREDIT')
    s.place('buy', 1_900, { number: 4 }) // $19 + 95¢ vig fits the $20 left
    expect(s.bankroll()).toBe(5)
    s.apply({ type: 'deposit', amount: 10_000 })
    expect(s.snap()).toMatchObject({ bankroll: 10_005, deposits: 60_000 })
    const capped = session(
      edited('craplessBubble', (input) => {
        input.limits.tableMax = 2_000
        input.limits.max = 2_000
      }),
    )
    capped.place('pass', 1_000)
    capped.place('field', 1_000)
    capped.rejects({ type: 'place', typeId: 'field', amount: 100 }, 'TABLE_MAX')
  })
})

describe('wagered and rebetBlocked in the snapshot (rules spec §0.1, §0.2 #5)', () => {
  it('counts the stake of every win, loss and push, OFF odds returned included; not travel', () => {
    const s = session(PRESETS.craplessBubble)
    s.place('pass', 1_000)
    s.roll(2, 2) // travels: no decision
    expect(s.snap().wagered).toBe(0)
    s.place('come', 1_000)
    s.roll(1, 5)
    s.place('comeOdds', 2_000, { parent: 'come@6' })
    s.roll(1, 3) // the pass wins on 4
    expect(s.snap().wagered).toBe(1_000)
    // Come-out 7: the pass wins, the come bet on 6 loses, and its OFF odds come back (a push).
    s.roll(3, 4)
    expect(s.snap().wagered).toBe(5_000)

    const stw = session(PRESETS.traditionalBubble)
    stw.place('dontPass', 1_000)
    stw.roll(6, 6) // the bar pushes and the bet stays
    stw.roll(3, 4)
    expect(stw.snap()).toMatchObject({ wagered: 2_000, bets: [] })
    const live = session(PRESETS.traditionalLive345)
    live.place('world', 500)
    live.roll(3, 4) // a world bet nets 0 on 7
    expect(live.snap().wagered).toBe(500)
  })

  it("lists the don't types blocked until the next come-out, sorted", () => {
    const s = session(PRESETS.strictBubble)
    s.place('dontPass', 1_000)
    s.roll(2, 2)
    s.place('dontCome', 1_000)
    s.roll(4, 5)
    s.apply({ type: 'setAmount', bet: { typeId: 'dontCome', number: 9 }, amount: 0 })
    s.apply({ type: 'setAmount', bet: { typeId: 'dontPass' }, amount: 0 })
    expect(s.snap().rebetBlocked).toEqual(['dontCome', 'dontPass'])
    s.place('place', 600, { number: 6 })
    s.roll(1, 2) // nothing ends the cycle
    expect(s.snap().rebetBlocked).toEqual(['dontCome', 'dontPass'])
    s.roll(1, 3) // the point is made: the next roll is a come-out
    expect(s.snap().rebetBlocked).toEqual([])
  })
})

describe('re-collected vig is judged after all of the roll payouts (rules spec §4.3, §4.5)', () => {
  /** The live table, starting with `bankroll` cents: its lays pay whole dollars, $1 vig minimum. */
  const live = (bankroll: number) =>
    session(
      edited('traditionalLive345', (input) => {
        input.money.startingBankroll = bankroll
      }),
    )

  it('a later payout on the same roll can fund it', () => {
    // $1 laid on 4 costs $1 + $1 vig and wins 50¢, paid $0 at the live table; staying up, it owes
    // $1 again, all from credit. The any 7 placed after it pays $4 on the same roll.
    const s = live(300)
    s.place('lay', 100, { number: 4 })
    s.place('any7', 100)
    expect(s.bankroll()).toBe(0)
    const settled = s.roll(3, 4)
    expect(settled.map((x) => [x.typeId, x.settlement.credited, x.vigDeclined])).toEqual([
      ['lay', 0, false],
      ['any7', 500, false],
    ])
    expect(s.snap()).toMatchObject({ bankroll: 400, vigPaid: 200, houseNet: -200, wagered: 200 })
    expect(s.bet('lay', 4)).toMatchObject({ amount: 100, vigHeld: 100 })
  })

  it('declining when credit cannot pay: the bet comes down with its stake, nothing is charged', () => {
    const s = live(200)
    s.place('lay', 100, { number: 4 })
    expect(s.snap()).toMatchObject({ bankroll: 0, vigPaid: 100 })
    const [lay] = s.roll(3, 4)
    expect([lay?.decision.kind, lay?.vigDeclined]).toEqual(['win', true])
    expect(s.snap()).toMatchObject({ bankroll: 100, houseNet: 100, vigPaid: 100, bets: [] })
  })

  it('charges in settlement order: the first lay keeps its place, the second comes down', () => {
    const s = live(600)
    s.place('lay', 100, { number: 4 })
    s.place('lay', 100, { number: 10 })
    s.place('field', 100)
    expect(s.bankroll()).toBe(100) // $1 of credit: enough for one re-collection
    const settled = s.roll(3, 4) // the field loses; both lays win $0 and owe $1 each
    expect(settled.map((x) => `${x.typeId}@${x.number ?? '-'} ${x.vigDeclined}`)).toEqual([
      'lay@4 false',
      'lay@10 true',
      'field@- false',
    ])
    expect(s.bets()).toEqual(['lay@4 100'])
    expect(s.snap()).toMatchObject({ bankroll: 100, vigPaid: 300, houseNet: 400 })
  })

  it('takes what the win covers first and credit the rest; refunds the win part on a decline', () => {
    // A minimum vig of $5 on a crapless buy: a $10 buy 2 wins $60, enough; a $1 buy 6 wins $1.20.
    const minimum = (bankroll: number) =>
      session(
        edited('craplessBubble', (input) => {
          input.money.startingBankroll = bankroll
          input.limits.minTotal = null
          const buy = input.catalog.buy
          if (buy?.family === 'numberVsSeven' && buy.commission) buy.commission.minimum = 500
        }),
      )
    const paid = minimum(1_000)
    paid.place('buy', 100, { number: 6 }) // $1 + $5 vig
    expect(paid.bankroll()).toBe(400)
    expect(paid.roll(3, 3).map((x) => x.settlement.credited)).toEqual([0]) // $1.20 to the vig
    expect(paid.snap()).toMatchObject({ bankroll: 20, vigPaid: 1_000 })
    const declined = minimum(600)
    declined.place('buy', 100, { number: 6 })
    expect(declined.bankroll()).toBe(0)
    const [buy] = declined.roll(3, 3)
    expect(buy?.vigDeclined).toBe(true)
    // The stake and the whole $1.20 win come back; only the first $5 was charged.
    expect(declined.snap()).toMatchObject({ bankroll: 220, vigPaid: 500, houseNet: 380, bets: [] })
  })

  it('rearm none keeps the vig the bet paid and charges nothing again', () => {
    const s = session(
      edited('craplessBubble', (input) => {
        const buy = input.catalog.buy
        if (buy?.family === 'numberVsSeven' && buy.commission) buy.commission.rearm = 'none'
      }),
    )
    s.place('buy', 2_000, { number: 4 })
    expect(settledText(s.roll(2, 2))).toEqual(['buy@4 win 4000'])
    expect(s.bet('buy', 4)).toMatchObject({ amount: 2_000, vigHeld: 100 })
    expect(s.snap()).toMatchObject({ vigPaid: 100, bankroll: 51_900 })
  })

  it('recollectFromCredit charges credit after the win is paid; a decline keeps the whole win', () => {
    const fromCredit = (bankroll: number, minimum: number) =>
      session(
        edited('craplessBubble', (input) => {
          input.money.startingBankroll = bankroll
          input.limits.minTotal = null
          const buy = input.catalog.buy
          if (buy?.family === 'numberVsSeven' && buy.commission) {
            buy.commission.rearm = 'recollectFromCredit'
            buy.commission.minimum = minimum
          }
        }),
      )
    // $20 buy 4 with $1 vig and nothing else on credit: the $40 win pays the next $1.
    const paid = fromCredit(2_100, 0)
    paid.place('buy', 2_000, { number: 4 })
    expect(paid.bankroll()).toBe(0)
    expect(settledText(paid.roll(2, 2))).toEqual(['buy@4 win 4000'])
    expect(paid.snap()).toMatchObject({ bankroll: 3_900, vigPaid: 200 })
    expect(paid.bet('buy', 4)?.vigHeld).toBe(100)
    // A $50 minimum on a $1 buy 6: the $1.20 win cannot pay it, so the bet comes down with its
    // win and stake.
    const declined = fromCredit(5_100, 5_000)
    declined.place('buy', 100, { number: 6 })
    const [buy] = declined.roll(3, 3)
    expect([buy?.settlement.credited, buy?.vigDeclined]).toEqual([120, true])
    expect(declined.snap()).toMatchObject({ bankroll: 220, vigPaid: 5_000, bets: [] })
  })
})

describe('working-rule variants (rules spec §2.3 step 8, §2.4, §9 #6)', () => {
  const crapless = (edit: (input: MachineConfigInput) => void) =>
    session(edited('craplessBubble', edit))
  /** Pass, point 4, seven-out: the next window is the one after a seven-out. */
  const afterSevenOut = (s: ReturnType<typeof session>) => {
    s.place('pass', 1_000)
    s.roll(2, 2)
    s.roll(3, 4)
  }

  it('per-bet toggles: ON works while set; null falls back to the post-seven-out OFF', () => {
    const s = crapless((input) => {
      input.workingToggle.perBet = true
    })
    afterSevenOut(s)
    s.place('place', 600, { number: 6 })
    s.place('place', 600, { number: 8 })
    const set = (number: number, working: boolean | null) =>
      s.apply({ type: 'setWorking', bet: { typeId: 'place', number }, working })
    set(6, null)
    set(8, false)
    expect([s.bet('place', 6)?.working, s.bet('place', 8)?.working]).toEqual([false, false])
    set(6, true)
    set(8, null)
    expect([s.bet('place', 6)?.working, s.bet('place', 8)?.working]).toEqual([true, false])
    // Only Set bets On ends the flag (rules spec §0.2 #4): back to its default, 6 is OFF again.
    set(6, null)
    expect(s.bet('place', 6)?.working).toBe(false)
    s.apply({ type: 'setGlobalWorking', off: null })
    expect([s.bet('place', 6)?.working, s.bet('place', 8)?.working]).toEqual([true, true])
  })

  it('nextRollOnly resets the toggles after each roll but keeps the post-seven-out OFF', () => {
    const s = crapless((input) => {
      input.workingToggle.scope = 'nextRollOnly'
    })
    afterSevenOut(s)
    s.place('place', 600, { number: 6 })
    s.place('pass', 1_000)
    s.roll(1, 3)
    expect(s.bet('place', 6)?.working).toBe(false)
    s.apply({ type: 'setGlobalWorking', off: false }) // Set bets On ends the flag
    s.apply({ type: 'setGlobalWorking', off: true })
    expect(s.roll(1, 2)).toEqual([]) // OFF for this roll only
    expect(s.bet('place', 6)?.working).toBe(true)
  })

  it('anySeven starts the OFF window on a come-out 7; a seven-out does too', () => {
    const anySeven = (input: MachineConfigInput) => {
      const rule = input.afterSevenOut.newPlacedOff as { trigger?: string } | null
      if (rule !== null) rule.trigger = 'anySeven'
    }
    const s = crapless(anySeven)
    s.place('pass', 1_000)
    s.roll(5, 2)
    s.place('buy', 2_000, { number: 4 })
    s.roll(2, 2) // a point: the next window flags nothing
    s.place('place', 600, { number: 8 })
    expect([s.bet('buy', 4)?.working, s.bet('place', 8)?.working]).toEqual([false, true])
    const out = crapless(anySeven)
    afterSevenOut(out)
    out.place('place', 600, { number: 6 })
    expect(out.bet('place', 6)?.working).toBe(false)
    // sevenOut, the default: a come-out 7 starts nothing.
    const sevenOut = crapless(() => undefined)
    sevenOut.place('pass', 1_000)
    sevenOut.roll(3, 4)
    sevenOut.place('place', 600, { number: 6 })
    expect(sevenOut.bet('place', 6)?.working).toBe(true)
  })
})

describe('limits on the table (rules spec §4.4, §4.5)', () => {
  it('the table maximum counts odds and OFF bets', () => {
    // Validation needs the table maximum at least the per-bet maximum (rules spec §5.3 #11).
    const s = session(
      edited('craplessBubble', (input) => {
        input.limits.tableMax = 5_000
        input.limits.max = 5_000
      }),
    )
    s.place('pass', 1_000)
    s.roll(2, 2)
    s.place('passOdds', 2_000, { parent: 'pass@4' })
    s.place('place', 600, { number: 6 })
    s.apply({ type: 'setGlobalWorking', off: true })
    s.place('place', 1_400, { number: 8 })
    s.rejects({ type: 'place', typeId: 'field', amount: 100 }, 'TABLE_MAX')
    s.rejects(
      { type: 'setAmount', bet: { typeId: 'place', number: 6 }, amount: 1_200 },
      'TABLE_MAX',
    )
    s.apply({ type: 'setAmount', bet: { typeId: 'place', number: 6 }, amount: 0 })
    s.place('field', 600)
  })

  it('per-number increments: place 6/8 in $6 units; odds caps floor to their point step', () => {
    const s = session(
      edited('craplessBubble', (input) => {
        input.limits.perType = {
          place: { incrementByNumber: { '6': 600, '8': 600 } },
          passOdds: { incrementByNumber: { '5': 300 } },
        } as never
      }),
    )
    s.rejects({ type: 'place', typeId: 'place', number: 6, amount: 500 }, 'BAD_INCREMENT')
    s.place('place', 600, { number: 6 })
    s.place('place', 500, { number: 5 }) // $1 steps elsewhere
    s.rejects(
      { type: 'setAmount', bet: { typeId: 'place', number: 6 }, amount: 900 },
      'BAD_INCREMENT',
    )
    s.apply({ type: 'setAmount', bet: { typeId: 'place', number: 6 }, amount: 1_200 })
    s.place('pass', 500)
    s.roll(2, 3)
    // 2x a $5 flat is $10, floored to $3 steps: $9.
    const odds = (amount: number) => ({
      type: 'place' as const,
      typeId: 'passOdds',
      parent: 'pass@5',
      amount,
    })
    s.rejects(odds(1_000), 'BAD_INCREMENT')
    s.rejects(odds(1_200), 'ODDS_LIMIT')
    s.apply(odds(900))
    expect(s.bet('passOdds', 5)?.amount).toBe(900)
  })

  it('pays each number with its own rounding', () => {
    const s = session(
      edited('craplessBubble', (input) => {
        Object.assign(input.catalog.place ?? {}, {
          payoutRoundingByNumber: { '6': { mode: 'ceil', increment: 1 } },
        })
      }),
    )
    s.place('pass', 500)
    s.place('place', 100, { number: 6 })
    s.place('place', 100, { number: 8 })
    expect(settledText(s.roll(3, 3))).toEqual(['pass@- travel 0', 'place@6 win 117'])
    expect(settledText(s.roll(4, 4))).toEqual(['place@8 win 116'])
  })
})

/** Plays a fixed 50-roll script: each window tops up a betting plan, then rolls the next dice. */
function scripted(input: MachineConfigInput, dice: readonly (readonly [number, number])[]) {
  const s = session(input)
  const offered = (id: string) => s.facts.types.has(id)
  const tryApply = (action: RefAction) => {
    const before = JSON.stringify(s.table())
    const outcome = refApply(s.facts, s.table(), action)
    if (outcome.ok) s.apply(action)
    else expect(JSON.stringify(s.table())).toBe(before)
  }
  const has = (typeId: string, number: number | null = null) => s.bet(typeId, number) !== undefined
  const settled: RefSettled[] = []
  dice.forEach(([d1, d2], i) => {
    const { phase, point } = s.snap()
    if (phase === 'comeOut' && !has('pass') && !has('dontPass')) {
      tryApply({
        type: 'place',
        typeId: i % 4 === 3 && offered('dontPass') ? 'dontPass' : 'pass',
        amount: 1_000,
      })
    }
    for (const n of [6, 8])
      if (!has('place', n)) tryApply({ type: 'place', typeId: 'place', number: n, amount: 600 })
    if (i % 2 === 0) tryApply({ type: 'place', typeId: 'field', amount: 500 })
    if (i % 5 === 0 && offered('horn')) tryApply({ type: 'place', typeId: 'horn', amount: 400 })
    if (i % 7 === 0) tryApply({ type: 'place', typeId: 'hard', number: 6, amount: 100 })
    if (phase === 'point' && point !== null) {
      for (const line of ['pass', 'dontPass']) {
        const odds = line === 'pass' ? 'passOdds' : 'dontPassOdds'
        if (has(line, point) && !s.bets().some((b) => b.startsWith(`${odds}@`))) {
          tryApply({ type: 'place', typeId: odds, parent: `${line}@${point}`, amount: 2_000 })
        }
      }
      if (!has('come')) tryApply({ type: 'place', typeId: 'come', amount: 1_000 })
      for (const bet of s.snap().bets) {
        if (bet.typeId === 'come' && bet.number !== null && !has('comeOdds', bet.number)) {
          tryApply({
            type: 'place',
            typeId: 'comeOdds',
            parent: `come@${bet.number}`,
            amount: 1_000,
          })
        }
      }
      if (!has('buy', 4)) tryApply({ type: 'place', typeId: 'buy', number: 4, amount: 2_000 })
      if (offered('lay') && !has('lay', 10))
        tryApply({ type: 'place', typeId: 'lay', number: 10, amount: 2_000 })
    }
    if (i % 9 === 4) tryApply({ type: 'setAmount', bet: { typeId: 'place', number: 8 }, amount: 0 })
    if (i % 11 === 5) tryApply({ type: 'setGlobalWorking', off: true })
    if (i % 11 === 8) tryApply({ type: 'setGlobalWorking', off: null })
    if (s.bankroll() < 10_000) s.apply({ type: 'deposit', amount: 20_000 })
    settled.push(...s.roll(d1, d2))
  })
  return { s, settled }
}

describe('the ledger identity over a scripted 50-roll sequence (rules spec §4.1)', () => {
  // A fixed script: naturals, craps, every point, points made, seven-outs, hardways, horn rolls.
  const SCRIPT =
    '34 11 33 11 66 56 22 44 34 12 23 45 13 61 55 26 33 24 52 66 46 15 22 35 43 ' +
    '14 63 14 51 25 12 36 44 62 16 56 21 34 65 42 11 53 64 41 25 32 66 44 54 16'
  const dice = SCRIPT.split(' ').map((pair) => [Number(pair[0]), Number(pair[1])] as const)

  it.each(PRESET_IDS)('%s: deposits = bankroll + Σ amounts + house net throughout', (id) => {
    const { s, settled } = scripted(PRESETS[id], dice)
    const snap = s.snap()
    expect([dice.length, s.table().rolls]).toEqual([50, 50])
    expect(new Set(dice.map(([a, b]) => a + b)).size).toBe(11)
    const onTable = snap.bets.reduce((sum, bet) => sum + bet.amount, 0)
    expect(snap.deposits).toBe(snap.bankroll + onTable + snap.houseNet)
    expect(snap.bankroll).toBeGreaterThanOrEqual(0)
    // The script exercises every kind of decision and some commission on every machine.
    const kinds = new Set(settled.map((x) => x.decision.kind))
    expect([...kinds].sort()).toEqual(['lose', 'push', 'travel', 'win'])
    expect(snap.vigPaid).toBeGreaterThan(0)
  })
})

describe('reference table properties (fast-check, pinned seed)', () => {
  const tables = PRESET_IDS.map((id) => factsFrom(PRESETS[id]))
  const intent = fc.record({
    kind: fc.nat({ max: 11 }),
    a: fc.nat({ max: 1_000 }),
    b: fc.nat({ max: 1_000 }),
    c: fc.nat({ max: 1_000 }),
  })

  /** Turns random numbers into an action against the current table: mostly plausible ones. */
  function actionFor(
    facts: MachineFacts,
    table: RefTable,
    i: { kind: number; a: number; b: number; c: number },
  ): RefAction {
    const ids = [...facts.types.keys()]
    const pick = <T>(list: readonly T[], n: number): T | undefined =>
      list[n % Math.max(1, list.length)]
    const snapBets = refSnapshot(facts, table).bets
    switch (i.kind) {
      case 0:
      case 1: {
        const typeId = pick(ids, i.a) ?? 'pass'
        const type = facts.types.get(typeId)
        const amount = (1 + (i.c % 30)) * 100
        if (type?.family === 'numberVsSeven' || type?.family === 'hardway') {
          return { type: 'place', typeId, number: pick(type.numbers, i.b) ?? 6, amount }
        }
        if (type?.family === 'odds') {
          const parent = snapBets.find((b) => b.typeId === type.parent && b.number !== null)
          return {
            type: 'place',
            typeId,
            amount,
            ...(parent ? { parent: `${parent.typeId}@${parent.number}` } : {}),
          }
        }
        return { type: 'place', typeId, amount }
      }
      case 2: {
        const bet = pick(snapBets, i.a)
        if (bet === undefined) return { type: 'deposit', amount: 100 }
        const amount = (i.b % 4) * (bet.amount / 2)
        return {
          type: 'setAmount',
          bet: { typeId: bet.typeId, number: bet.number, parent: bet.parent },
          amount: amount - (amount % 100),
        }
      }
      case 3: {
        const bet = pick(snapBets, i.a)
        if (bet === undefined) return { type: 'deposit', amount: 100 }
        const working = [true, false, null][i.b % 3] ?? null
        return {
          type: 'setWorking',
          bet: { typeId: bet.typeId, number: bet.number, parent: bet.parent },
          working,
        }
      }
      case 4:
        return { type: 'setGlobalWorking', off: [true, false, null][i.a % 3] ?? null }
      case 5:
        return { type: 'deposit', amount: (1 + (i.a % 5)) * 1_000 }
      default:
        return { type: 'roll', d1: (i.a % 6) + 1, d2: (i.b % 6) + 1 }
    }
  }

  it('keeps the ledger, the odds caps and the bankroll; rejected actions change nothing', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: tables.length - 1 }),
        fc.array(intent, { maxLength: 80 }),
        (t, intents) => {
          const facts = tables[t]
          if (facts === undefined) return
          let table = refNewTable(facts)
          for (const i of intents) {
            const before = JSON.stringify(table)
            const outcome = refApply(facts, table, actionFor(facts, table, i))
            expect(JSON.stringify(table)).toBe(before)
            if (!outcome.ok) continue
            table = outcome.table
            expect(refLedgerHolds(table)).toBe(true)
            expect(table.bankroll).toBeGreaterThanOrEqual(0)
            const snap = refSnapshot(facts, table)
            expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
            for (const bet of snap.bets) {
              if (bet.parent === null || bet.number === null) continue
              const parent = snap.bets.find((p) => `${p.typeId}@${p.number}` === bet.parent)
              expect(parent).toBeDefined()
              expect(bet.amount).toBeLessThanOrEqual(
                refMaxOdds(facts, bet.typeId, bet.number, parent?.amount ?? 0),
              )
            }
          }
        },
      ),
      { seed: SEED, numRuns: 300 },
    )
  })
})
