import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  betId,
  cents,
  compileConfig,
  dispatchBetting,
  makeRoll,
  newSession,
  rollWindow,
  type Action,
  type DieFace,
  type MachineConfig,
  type SettlementTrace,
  type WindowedSession,
} from '../../engine/index.ts'
import {
  addBetting,
  commissionTotal,
  depositCount,
  depositsIn,
  isDecision,
  metersOfSession,
  sessionTotals,
  startMeters,
  withOpenWindow,
} from './meters.ts'

/**
 * The session meters' fold (rules spec §4.6) on scripted sessions with hand-checked figures: what
 * counts as a decision (§0.1: a barred tie counts; odds handed back unplayed and a side bet left
 * up do not), the commission by where it came from, the deposits in log order, and a log that no
 * longer replays. The random-session property is tests/properties/sessionMeters.prop.test.ts; the
 * live store's is src/ui/state/sessionMeters.test.ts.
 */

const CRAPLESS = compileConfig(PRESETS.craplessBubble)
const STW = compileConfig(PRESETS.traditionalBubble)
const STRICT = compileConfig(PRESETS.strictBubble)

type Step = Action | readonly [DieFace, DieFace]

/** Plays `steps` on a new session: betting actions the table must accept, and scripted rolls. */
function play(cfg: MachineConfig, steps: readonly Step[], seed = 'meters-unit'): WindowedSession {
  let session = newSession(cfg, seed)
  for (const step of steps) {
    if ('type' in step) {
      const result = dispatchBetting(session, step, cfg)
      if (!result.ok) throw new Error(`refused ${JSON.stringify(step)}: ${result.rejection.code}`)
      session = result.session
    } else {
      const result = rollWindow(session, cfg, makeRoll(step[0], step[1]))
      if (!result.ok) throw new Error(`roll refused: ${result.rejection.code}`)
      session = result.session
    }
  }
  return session
}

function trace(overrides: Partial<SettlementTrace>): SettlementTrace {
  return {
    betId: betId(1),
    typeId: 'pass',
    number: null,
    outcome: 'win',
    pushReason: null,
    stake: cents(500),
    payKey: null,
    ratioLabel: '',
    winExact: '0',
    winPaid: cents(0),
    rounding: null,
    breakage: '0',
    vigOnWin: cents(0),
    vigRearm: cents(0),
    credited: cents(0),
    stakeDisposition: 'returned',
    ...overrides,
  }
}

describe('what counts as a decision (rules spec §0.1)', () => {
  it('counts wins, losses and ties, a winner left up included', () => {
    expect(isDecision(trace({ outcome: 'win', stakeDisposition: 'stays' }), CRAPLESS)).toBe(true)
    expect(isDecision(trace({ outcome: 'lose', stakeDisposition: 'lost' }), CRAPLESS)).toBe(true)
    const bar = trace({ typeId: 'dontPass', outcome: 'push', pushReason: 'bar' })
    expect(isDecision({ ...bar, stakeDisposition: 'stays' }, STW)).toBe(true)
  })

  it('leaves out odds handed back unplayed and a side bet left up', () => {
    const unplayed = trace({ typeId: 'comeOdds', outcome: 'push', pushReason: 'offReturned' })
    expect(isDecision(unplayed, CRAPLESS)).toBe(false)
    const luckyShooter = trace({
      typeId: 'luckyShooter',
      outcome: 'push',
      pushReason: 'bar',
      stakeDisposition: 'stays',
    })
    expect(isDecision(luckyShooter, STRICT)).toBe(false)
    // A side bet's settlement that takes it down is its one decision.
    const lost = trace({ typeId: 'luckyShooter', outcome: 'lose', stakeDisposition: 'lost' })
    expect(isDecision(lost, STRICT)).toBe(true)
    const stakeBack = trace({ typeId: 'hotShooter', outcome: 'push', pushReason: 'zeroNet' })
    expect(isDecision(stakeBack, STW)).toBe(true)
  })
})

describe('depositsIn', () => {
  it('finds deposits inside nested batches, in the order they apply', () => {
    const action: Action = {
      type: 'batch',
      actions: [
        { type: 'deposit', amount: cents(100) },
        {
          type: 'batch',
          actions: [
            { type: 'place', typeId: 'pass', amount: cents(500) },
            { type: 'deposit', amount: cents(200) },
          ],
        },
        { type: 'deposit', amount: cents(300) },
      ],
    }
    expect(depositsIn(action)).toStrictEqual([100, 200, 300])
    expect(depositsIn({ type: 'roll' })).toStrictEqual([])
  })
})

describe('the fold on scripted sessions', () => {
  it('counts a barred tie and takes commission from a win on Shoot To Win', () => {
    // Don't pass $10, come-out 12: barred, a tie that counts, the bet stays ($10). 2-2 sets the
    // point. Buy 4 $20, then 1-3: the don't pass loses ($10) and the buy wins 2:1, $40 less the 5%
    // commission taken from the win, $1 ($20 decided).
    const session = play(STW, [
      { type: 'place', typeId: 'dontPass', amount: cents(1000) },
      [6, 6],
      [2, 2],
      { type: 'place', typeId: 'buy', number: 4, amount: cents(2000) },
      [1, 3],
    ])
    const totals = sessionTotals(metersOfSession(session, STW).current, session.state.ledger)
    expect(totals.wagered).toBe(4_000)
    expect(totals.decisions).toBe(3)
    expect(totals.commission).toBe(100)
    expect(totals.commissionParts).toStrictEqual({ upfront: 0, fromWins: 100, recollected: 0 })
    // Every settlement here is a decision, so the engine's own count agrees.
    expect(session.state.ledger.wagered).toBe(4_000)
  })

  it('leaves out a Lucky Shooter left up and come odds handed back, on the strict machine', () => {
    // Pass $5 and Lucky Shooter $1; 3-4 on the come-out: the pass wins ($5) and the Lucky
    // Shooter pushes and stays (no decision). 2-2: point 4. Come $5; 3-3: it moves to 6. Come odds
    // $10; 1-3 makes the point: the pass wins ($5) and the Lucky Shooter loses ($1). 3-4 on the
    // come-out: the pass wins ($5), the come on 6 loses ($5) and its odds, OFF on the come-out,
    // are handed back unplayed (no decision).
    const session = play(STRICT, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'place', typeId: 'luckyShooter', amount: cents(100) },
      [3, 4],
      [2, 2],
      { type: 'place', typeId: 'come', amount: cents(500) },
      [3, 3],
      { type: 'place', typeId: 'comeOdds', parentId: betId(3), amount: cents(1000) },
      [1, 3],
      [3, 4],
    ])
    const totals = sessionTotals(metersOfSession(session, STRICT).current, session.state.ledger)
    expect(totals.wagered).toBe(2_100)
    expect(totals.decisions).toBe(5)
    // The engine's ledger also counts the $1 push and the $10 of odds: $11 more.
    expect(session.state.ledger.wagered).toBe(3_200)
    expect(totals.commission).toBe(0)
  })

  it('lists top-ups with the roll they came before; an undone deposit leaves the log', () => {
    let session = play(CRAPLESS, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'deposit', amount: cents(10_000) },
      [2, 2],
      { type: 'batch', actions: [{ type: 'deposit', amount: cents(2_000) }] },
    ])
    const undone = dispatchBetting(session, { type: 'deposit', amount: cents(5_000) }, CRAPLESS)
    if (!undone.ok) throw new Error('deposit refused')
    // The $50 is undone before the roll: the open window keeps the $20 alone.
    session = { ...undone.session, pending: undone.session.pending.slice(0, -1) }
    const { committed, current } = metersOfSession(session, CRAPLESS)
    expect(committed.topUps).toStrictEqual([{ amount: 10_000, beforeRoll: 0 }])
    expect(current.topUps).toStrictEqual([
      { amount: 10_000, beforeRoll: 0 },
      { amount: 2_000, beforeRoll: 1 },
    ])
    expect(depositCount(current)).toBe(3)
    expect(withOpenWindow(committed, session, CRAPLESS)).toStrictEqual(current)
  })

  it('splits crapless buy commission into up front and re-collected from the win', () => {
    // Pass $5, Buy 10 $20 ($1 up front); 2-2 sets point 4; 6-4: the buy wins $40 and stays, its
    // $1 collected again from the win.
    const session = play(CRAPLESS, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'place', typeId: 'buy', number: 10, amount: cents(2000) },
      [2, 2],
      [6, 4],
    ])
    const { current } = metersOfSession(session, CRAPLESS)
    expect(current.wagering?.commission).toStrictEqual({
      upfront: 100,
      fromWins: 0,
      recollected: 100,
    })
    expect(commissionTotal(current.wagering!.commission)).toBe(session.state.ledger.vigPaid)
    expect(current.wagering?.wagered).toBe(2_000)
  })
})

describe('meters of a session', () => {
  it('start with the buy-in alone; a $0 buy-in is no deposit', () => {
    expect(depositCount(startMeters(cents(50_000)))).toBe(1)
    expect(depositCount(startMeters(cents(0)))).toBe(0)
    const meters = addBetting(startMeters(cents(0)), { type: 'deposit', amount: cents(100) }, [], 4)
    expect(meters.topUps).toStrictEqual([{ amount: 100, beforeRoll: 4 }])
    expect(depositCount(meters)).toBe(1)
  })

  it('take the totals from the ledger they are shown with', () => {
    const session = play(CRAPLESS, [{ type: 'deposit', amount: cents(10_000) }])
    const totals = sessionTotals(metersOfSession(session, CRAPLESS).current, session.state.ledger)
    expect(totals.creditAdded).toBe(60_000)
    expect(totals.deposits).toBe(2)
    expect(totals.commission).toBe(0)
  })

  it('keep the deposits of a log that no longer replays, and nothing else', () => {
    const played = play(CRAPLESS, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'deposit', amount: cents(10_000) },
      [2, 2],
      { type: 'deposit', amount: cents(2_000) },
    ])
    const [first, ...rest] = played.committed
    if (first === undefined) throw new Error('no window')
    const tampered = {
      ...played,
      committed: [{ ...first, hashAfter: '0000000000000000' }, ...rest],
    }
    const { committed, current } = metersOfSession(tampered, CRAPLESS)
    expect(committed.wagering).toBeNull()
    expect(current.wagering).toBeNull()
    expect(current.topUps).toStrictEqual([
      { amount: 10_000, beforeRoll: 0 },
      { amount: 2_000, beforeRoll: 1 },
    ])
    const totals = sessionTotals(current, tampered.state.ledger)
    expect(totals.wagered).toBeNull()
    expect(totals.commissionParts).toBeNull()
    expect(totals.creditAdded).toBe(62_000)
  })

  it('refuse a session of another machine', () => {
    expect(() => metersOfSession(newSession(STW, 'x'), CRAPLESS)).toThrow(RangeError)
  })
})
