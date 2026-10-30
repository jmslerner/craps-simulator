import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ALL_ROLLS, TOTALS, cents, legalBets, totalOf, validateAction } from '../../engine/index.ts'
import type {
  Action,
  Cents,
  Dice,
  LegalBet,
  MachineConfig,
  Rejection,
  TableState,
  WindowedSession,
} from '../../engine/index.ts'
import { CRAPLESS, bet, roll, testSession } from '../test/game.ts'
import { COMPILED_PRESETS } from './machineStore.ts'
import {
  PREVIEW_CACHE_SIZE,
  cachedNextRoll,
  nextRollPreview,
  outcomeOf,
  selectNextRoll,
  type BetNeeds,
  type NeedTotal,
  type NextRollPreview,
  type NextRollRow,
} from './nextRoll.ts'
import { rollEntryOf } from './rollHistory.ts'

/**
 * The Next roll panel's data (plan §0 #18 lessons): every figure below is pinned to what the
 * engine itself does when the dice land, never to a payout written here. The pinned amounts were
 * read from the engine's own settlement of the same table (the probe in the task report), and the
 * honesty property then rolls the real dice on random sessions and checks the panel predicted
 * exactly that — net, credit, round event and every bet-level event — with the pinned fast-check
 * seed.
 */

/** Pass $5, place 8 $6, hard 8 $1 and field $5 on a fresh come-out. */
function comeOutTable(seed = 'next-roll-comeout'): WindowedSession {
  let session = testSession(seed)
  session = bet(session, { type: 'place', typeId: 'pass', amount: cents(500) })
  session = bet(session, { type: 'place', typeId: 'place', number: 8, amount: cents(600) })
  session = bet(session, { type: 'place', typeId: 'hard', number: 8, amount: cents(100) })
  session = bet(session, { type: 'place', typeId: 'field', amount: cents(500) })
  return session
}

/** The come-out table after a 4-4 sets the point 8, with $10 odds, a $5 come and a $20 buy 4. */
function pointTable(seed = 'next-roll-point'): WindowedSession {
  let session = roll(comeOutTable(seed), [4, 4]).session
  const odds = legalBets(session.state, CRAPLESS).find((spot) => spot.typeId === 'passOdds')
  if (odds === undefined || odds.parentId === null) throw new Error('no odds spot on the point')
  session = bet(session, {
    type: 'place',
    typeId: 'passOdds',
    parentId: odds.parentId,
    amount: cents(1000),
  })
  session = bet(session, { type: 'place', typeId: 'come', amount: cents(500) })
  session = bet(session, { type: 'place', typeId: 'buy', number: 4, amount: cents(2000) })
  return session
}

function rowOf(preview: NextRollPreview, total: number): NextRollRow {
  const row = preview.rows.find((candidate) => candidate.total === total)
  if (row === undefined) throw new Error(`no row for ${total}`)
  return row
}

function needOf(preview: NextRollPreview, typeId: string, number: number | null = null): BetNeeds {
  const need = preview.needs.find(
    (candidate) => candidate.bet.typeId === typeId && candidate.bet.number === number,
  )
  if (need === undefined) throw new Error(`no needs line for ${typeId} ${number}`)
  return need
}

const anyTotal = (total: number, ways: number): NeedTotal => ({
  total: total as NeedTotal['total'],
  way: 'any',
  dice: null,
  ways,
})

describe('the come-out table: pass $5, place 8 $6, hard 8 $1, field $5', () => {
  const session = comeOutTable()
  const preview = nextRollPreview(session, CRAPLESS)

  it('has one row per total, with the ways and chances of the engine’s dice module', () => {
    expect(preview.refused).toBeNull()
    expect(preview.comeOut).toBe(true)
    expect(preview.point).toBeNull()
    expect(preview.betCount).toBe(4)
    expect(preview.rows.map((row) => row.total)).toStrictEqual(TOTALS)
    expect(preview.rows.map((row) => row.ways)).toStrictEqual([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1])
    for (const row of preview.rows) {
      expect(row.ways).toBe(ALL_ROLLS.filter((dice) => totalOf(dice) === row.total).length)
      expect(row.chance.toString()).toBe(reduced(row.ways))
    }
    expect(preview.rows.map((row) => row.chance.formatPercent(0))).toStrictEqual([
      '3',
      '6',
      '8',
      '11',
      '14',
      '17',
      '14',
      '11',
      '8',
      '6',
      '3',
    ])
  })

  it('a 7 wins the line and takes the working place, hardway and field: net -$7.00', () => {
    const seven = rowOf(preview, 7)
    expect(seven.roundEvent?.type).toBe('natural')
    expect(seven.net).toBe(-700)
    expect(seven.winners.map((b) => [b.typeId, b.net])).toStrictEqual([['pass', 500]])
    expect(seven.losers.map((b) => [`${b.typeId}${b.number ?? ''}`, b.net])).toStrictEqual([
      ['place8', -600],
      ['hard8', -100],
      ['field', -500],
    ])
    expect(seven.hardSplit).toBeUndefined()
    expect(seven.outcomes).toHaveLength(1)
    expect(seven.outcomes[0]?.dice).toHaveLength(6)
    // The bets' own nets add up to the ledgers' net.
    expect(seven.bets.reduce((sum, b) => sum + b.net, 0)).toBe(seven.net)
  })

  it('splits the 8 into hard and easy, because the hardway is the one bet that tells them apart', () => {
    const eight = rowOf(preview, 8)
    expect(eight.outcomes).toHaveLength(2)
    expect(eight.hardSplit).toBeDefined()
    const { hard, easy } = eight.hardSplit ?? { hard: null, easy: null }
    expect(hard?.dice).toStrictEqual([{ d1: 4, d2: 4 }])
    expect(hard?.ways).toBe(1)
    expect(hard?.net).toBe(1100) // place 8 +$7, hard 8 +$9 (9:1), field -$5
    expect(hard?.roundEvent).toStrictEqual({ type: 'pointEstablished', point: 8 })
    expect(easy?.ways).toBe(4)
    expect(easy?.net).toBe(100) // place 8 +$7, hard 8 -$1, field -$5
    // The row's own figures are the likelier outcome's, and its ways cover both.
    expect(eight.net).toBe(100)
    expect(eight.ways).toBe(5)
    expect(eight.outcomes[0]).toBe(easy)
    expect(eight.bets.map((b) => `${b.typeId}:${b.fate}`)).toStrictEqual([
      'pass:travel',
      'place:win',
      'hard:lose',
      'field:lose',
    ])
    expect(eight.bets[0]?.travelTo).toBe(8)
    // No other total splits: nothing else on the table reads the dice.
    expect(
      preview.rows.filter((row) => row.hardSplit !== undefined).map((r) => r.total),
    ).toStrictEqual([8])
  })

  it('reads the field’s pays from the engine: 2 and 12 pay $10 on $5, 3 pays $5', () => {
    expect(rowOf(preview, 2).net).toBe(1000)
    expect(rowOf(preview, 12).net).toBe(1000)
    expect(rowOf(preview, 3).net).toBe(500)
    expect(rowOf(preview, 5).net).toBe(-500) // the field loses; the point is set, nothing else acts
    expect(rowOf(preview, 5).roundEvent).toStrictEqual({ type: 'pointEstablished', point: 5 })
  })

  it('tells each bet what it needs, hard and easy named where the dice matter', () => {
    const hard8 = needOf(preview, 'hard', 8)
    expect(hard8.working).toBe(true)
    expect(hard8.winsOn).toStrictEqual([{ total: 8, way: 'hard', dice: { d1: 4, d2: 4 }, ways: 1 }])
    expect(hard8.losesOn).toStrictEqual([
      anyTotal(7, 6),
      { total: 8, way: 'easy', dice: null, ways: 4 },
    ])
    expect(hard8.winChance.toString()).toBe('1/36')
    expect(hard8.loseChance.toString()).toBe('5/18')

    const place8 = needOf(preview, 'place', 8)
    expect(place8.winsOn).toStrictEqual([anyTotal(8, 5)])
    expect(place8.losesOn).toStrictEqual([anyTotal(7, 6)])

    const field = needOf(preview, 'field')
    expect(field.winsOn.map((n) => n.total)).toStrictEqual([2, 3, 4, 9, 10, 11, 12])
    expect(field.losesOn.map((n) => n.total)).toStrictEqual([5, 6, 7, 8])
    expect(field.winChance.toString()).toBe('4/9')

    const pass = needOf(preview, 'pass')
    expect(pass.winsOn).toStrictEqual([anyTotal(7, 6)])
    expect(pass.losesOn).toStrictEqual([]) // crapless: nothing loses the line on the come-out
    expect(pass.movesOn.map((n) => n.total)).toStrictEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12])
    expect(preview.needs.map((n) => n.bet.id)).toStrictEqual(session.state.bets.map((b) => b.id))
  })

  it('sums the chances of a winning, a losing and an even roll', () => {
    expect(preview.summary).toMatchObject({ winWays: 21, loseWays: 15, evenWays: 0 })
    expect(preview.summary.winChance.formatPercent(0)).toBe('58')
    expect(preview.summary.loseChance.formatPercent(0)).toBe('42')
  })
})

describe('on the point 8 with odds, a come bet and a buy 4', () => {
  const session = pointTable()
  const preview = nextRollPreview(session, CRAPLESS)

  it('a seven-out takes everything working but pays the come bet: net -$37.00', () => {
    const seven = rowOf(preview, 7)
    expect(preview.point).toBe(8)
    expect(seven.roundEvent?.type).toBe('sevenOut')
    expect(seven.outcomes[0]?.endedHand).toBe(true)
    expect(seven.net).toBe(-3700)
    expect(seven.winners.map((b) => b.typeId)).toStrictEqual(['come'])
    expect(seven.losers.map((b) => `${b.typeId}${b.number ?? ''}`)).toStrictEqual([
      'pass8',
      'place8',
      'hard8',
      'passOdds8',
      'buy4',
    ])
  })

  it('the point made pays the line, its odds and the place; the hard 8 splits the row again', () => {
    const eight = rowOf(preview, 8)
    expect(eight.roundEvent).toStrictEqual({ type: 'pointMade', point: 8 })
    expect(eight.net).toBe(2300) // pass +$5, odds +$12 (6:5), place 8 +$7, hard 8 -$1
    expect(eight.hardSplit?.hard.net).toBe(3300)
    expect(eight.bets.find((b) => b.typeId === 'come')?.fate).toBe('travel')
  })

  it('the buy 4 wins $39: $40 at 2:1 less the commission the engine charges', () => {
    const four = rowOf(preview, 4)
    expect(four.net).toBe(3900)
    expect(four.roundEvent).toBeNull()
    const buy = four.bets.find((b) => b.typeId === 'buy')
    expect(buy?.fate).toBe('win')
    expect(buy?.net).toBe(3900)
    expect(buy?.trace?.winPaid).toBe(4000)
  })

  it('Set bets OFF: off bets sit out, OFF odds come back when the line is decided', () => {
    const off = bet(session, { type: 'setGlobalWorking', off: true })
    const offPreview = nextRollPreview(off, CRAPLESS)
    const seven = rowOf(offPreview, 7)
    expect(seven.net).toBe(0) // the line loses $5, the come wins $5, the rest is off
    expect(seven.bets.map((b) => `${b.typeId}:${b.fate}`)).toStrictEqual([
      'pass:lose',
      'place:off',
      'hard:off',
      'passOdds:returned',
      'come:win',
      'buy:off',
    ])
    expect(rowOf(offPreview, 8).hardSplit).toBeUndefined()
    expect(needOf(offPreview, 'place', 8)).toMatchObject({
      working: false,
      winsOn: [],
      losesOn: [],
    })
    const odds = needOf(offPreview, 'passOdds', 8)
    expect(odds.working).toBe(false)
    expect(odds.returnsOn.map((n) => n.total)).toStrictEqual([7, 8])
    expect(offPreview.summary).toMatchObject({ winWays: 5, loseWays: 0, evenWays: 31 })
  })
})

describe('the dice are told apart only where a bet reads them', () => {
  it('a hop 1-4 splits the 5 by pair, with no hard/easy split', () => {
    const session = bet(pointTable('next-roll-hop'), {
      type: 'place',
      typeId: 'hop14',
      amount: cents(100),
    })
    const five = rowOf(nextRollPreview(session, CRAPLESS), 5)
    expect(five.outcomes).toHaveLength(2)
    expect(five.hardSplit).toBeUndefined()
    expect(five.outcomes.map((o) => o.dice)).toStrictEqual([
      [
        { d1: 1, d2: 4 },
        { d1: 4, d2: 1 },
      ],
      [
        { d1: 2, d2: 3 },
        { d1: 3, d2: 2 },
      ],
    ])
    expect(five.outcomes.map((o) => o.net)).toStrictEqual([1500, -100])
    const hop = nextRollPreview(session, CRAPLESS).needs.find((n) => n.bet.typeId === 'hop14')
    expect(hop?.winsOn).toStrictEqual([{ total: 5, way: 'dice', dice: { d1: 1, d2: 4 }, ways: 2 }])
    expect(hop?.losesOn.filter((n) => n.total === 5)).toStrictEqual([
      { total: 5, way: 'dice', dice: { d1: 2, d2: 3 }, ways: 2 },
    ])
  })
})

describe('a table the machine will not roll', () => {
  it('a side bet whose seven-out hands the stake back is returned on 7, never "no action" (M11)', () => {
    // Shoot To Win: the Hot Shooter counts every roll (definition A); 8 to 15 rolls pay "1 for 1".
    const STW = COMPILED_PRESETS.traditionalBubble
    let session = testSession('next-roll-hot-shooter', STW)
    session = bet(session, { type: 'place', typeId: 'pass', amount: cents(500) }, STW)
    session = bet(session, { type: 'place', typeId: 'hotShooter', amount: cents(100) }, STW)
    for (const dice of [
      [2, 2],
      [2, 3],
      [3, 3],
      [4, 4],
      [4, 5],
      [5, 5],
      [1, 2],
    ] as const) {
      session = roll(session, dice, STW).session // point 4, then six rolls that decide nothing
    }
    const preview = nextRollPreview(session, STW)
    const hot = needOf(preview, 'hotShooter')
    // The seven-out is the hand's 8th roll: the stake comes back and the bet comes down.
    expect(hot.returnsOn.map((n) => n.total)).toStrictEqual([7])
    expect(hot.winsOn).toStrictEqual([])
    expect(hot.losesOn).toStrictEqual([])
    const seven = rowOf(preview, 7).bets.find((b) => b.typeId === 'hotShooter')
    expect(seven?.fate).toBe('push')
    expect(seven?.trace?.pushReason).toBe('zeroNet')
    expect(seven?.net).toBe(0)
  })

  it('carries the refusal, no rows and no needs, as validateAction says', () => {
    const session = testSession('next-roll-empty')
    const preview = nextRollPreview(session, CRAPLESS)
    expect(preview.refused).toStrictEqual(validateAction(session.state, { type: 'roll' }, CRAPLESS))
    expect(preview.refused?.code).toBe('BELOW_MIN_TOTAL')
    expect(preview.rows).toStrictEqual([])
    expect(preview.needs).toStrictEqual([])
    expect(preview.betCount).toBe(0)
    expect(preview.summary).toMatchObject({ winWays: 0, loseWays: 0, evenWays: 0 })
    expect(outcomeOf(preview, { d1: 3, d2: 4 })).toBeNull()
  })
})

describe('cachedNextRoll and selectNextRoll', () => {
  it('returns one object per table: by identity, then by hash across undo and copies', () => {
    const session = comeOutTable('next-roll-cache')
    const first = cachedNextRoll(session, CRAPLESS)
    expect(cachedNextRoll(session, CRAPLESS)).toBe(first)
    const copy = JSON.parse(JSON.stringify(session.state)) as TableState
    expect(copy).not.toBe(session.state)
    expect(cachedNextRoll({ ...session, state: copy }, CRAPLESS, copy)).toBe(first)
    // A bet and its undo bring back an equal table, and the same preview object.
    const pressed = bet(session, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    expect(cachedNextRoll(pressed, CRAPLESS)).not.toBe(first)
    const undone = { ...pressed, pending: session.pending, state: session.state }
    expect(cachedNextRoll(undone, CRAPLESS)).toBe(first)
    expect(PREVIEW_CACHE_SIZE).toBeGreaterThanOrEqual(8)
  })

  it('selectNextRoll follows the shown table while a roll animates, and is null before a game', () => {
    const session = comeOutTable('next-roll-select')
    const before = cachedNextRoll(session, CRAPLESS)
    const played = roll(session, [3, 4])
    // During the roll the view shows the pre-roll table while the session is already past it.
    const shown = selectNextRoll({
      cfg: CRAPLESS,
      session: played.session,
      view: { shown: session.state },
    })
    expect(shown).toBe(before)
    const after = selectNextRoll({
      cfg: CRAPLESS,
      session: played.session,
      view: { shown: played.session.state },
    })
    expect(after).not.toBe(before)
    expect(after?.stateHash).not.toBe(before.stateHash)
    expect(selectNextRoll({ cfg: null, session: null, view: null })).toBeNull()
    expect(selectNextRoll({ cfg: CRAPLESS, session, view: null })).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The honesty property (mandatory): for the dice the panel predicts, rolling them gives exactly
// the predicted net, round event and per-bet outcomes.
// ---------------------------------------------------------------------------------------------

/** What the preview must look like for any table, whatever the bets. */
function expectWellFormed(preview: NextRollPreview, state: TableState): void {
  if (preview.refused !== null) {
    expect(preview.rows).toHaveLength(0)
    expect(preview.needs).toHaveLength(0)
    return
  }
  expect(preview.rows.map((row) => row.total)).toStrictEqual(TOTALS)
  let ways = 0
  for (const row of preview.rows) {
    expect(row.ways).toBe(ALL_ROLLS.filter((dice) => totalOf(dice) === row.total).length)
    expect(row.outcomes.reduce((sum, o) => sum + o.ways, 0)).toBe(row.ways)
    expect(row.outcomes[0]?.net).toBe(row.net)
    expect(row.outcomes[0]?.bets).toBe(row.bets)
    for (const outcome of row.outcomes) {
      expect(outcome.dice).toHaveLength(outcome.ways)
      expect(outcome.bets.map((b) => b.betId)).toStrictEqual(state.bets.map((b) => b.id))
      expect(outcome.bets.reduce((sum, b) => sum + b.net, 0)).toBe(outcome.net)
    }
    if (row.hardSplit !== undefined) {
      expect(row.outcomes).toHaveLength(2)
      expect(row.hardSplit.hard.dice).toHaveLength(1)
      expect(row.hardSplit.hard.dice[0]?.d1).toBe(row.hardSplit.hard.dice[0]?.d2)
      expect(row.hardSplit.easy.ways).toBe(row.ways - 1)
    }
    ways += row.ways
  }
  expect(ways).toBe(36)
  const { summary } = preview
  expect(summary.winWays + summary.loseWays + summary.evenWays).toBe(36)
  expect(preview.needs.map((n) => n.bet.id)).toStrictEqual(state.bets.map((b) => b.id))
  for (const [index, need] of preview.needs.entries()) {
    const winWays = need.winsOn.reduce((sum, n) => sum + n.ways, 0)
    expect(need.winChance.toString()).toBe(reduced(winWays))
    const winningTotals = preview.rows
      .filter((row) => row.outcomes.some((o) => o.bets[index]?.fate === 'win'))
      .map((row) => row.total)
    expect([...new Set(need.winsOn.map((n) => n.total))]).toStrictEqual(winningTotals)
    if (!need.working) {
      expect(need.winsOn).toStrictEqual([])
      expect(need.losesOn).toStrictEqual([])
    }
  }
}

/** `ways/36` as the Fraction prints it. */
function reduced(ways: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  if (ways === 0) return '0'
  const g = gcd(ways, 36)
  return 36 / g === 1 ? `${ways / g}` : `${ways / g}/${36 / g}`
}

/** The real roll must match the prediction for its dice in every particular. */
function expectHonest(
  preview: NextRollPreview,
  before: TableState,
  played: ReturnType<typeof roll>,
): void {
  const actual = rollEntryOf(before, played.events, played.session.state)
  const predicted = outcomeOf(preview, actual.dice)
  expect(predicted, `dice ${actual.dice.d1}-${actual.dice.d2}`).not.toBeNull()
  if (predicted === null) return
  expect(predicted.total).toBe(actual.total)
  expect(predicted.net).toBe(actual.net)
  expect(predicted.creditAfter).toBe(actual.creditAfter)
  expect(predicted.roundEvent).toStrictEqual(actual.roundEvent)
  expect(predicted.endedHand).toBe(actual.endedHand)
  expect(predicted.items).toStrictEqual(actual.items)
  const resolved = new Map(
    actual.items.flatMap((item) =>
      item.type === 'betResolved' ? [[item.trace.betId, item.trace] as const] : [],
    ),
  )
  const traveled = new Map(
    actual.items.flatMap((item) =>
      item.type === 'betTraveled' ? [[item.betId, item.number] as const] : [],
    ),
  )
  for (const bet of predicted.bets) {
    const trace = resolved.get(bet.betId)
    if (trace !== undefined) {
      expect(bet.trace).toStrictEqual(trace)
      const fate =
        trace.outcome === 'push' && trace.pushReason === 'offReturned' ? 'returned' : trace.outcome
      expect(bet.fate).toBe(fate)
    } else if (traveled.has(bet.betId)) {
      expect(bet.fate).toBe('travel')
      expect(bet.travelTo).toBe(traveled.get(bet.betId))
    } else {
      expect(['none', 'off']).toContain(bet.fate)
      expect(bet.net).toBe(0)
    }
  }
}

interface Driven {
  rolls: number
  splits: number
  refusals: number
}

/** A `place` on a spot, at `amount` when the table takes it and at the spot's unit otherwise. */
function placeOn(session: WindowedSession, spot: LegalBet, amount: Cents, cfg: MachineConfig) {
  const action: Action = {
    type: 'place',
    typeId: spot.typeId,
    ...(spot.number === null ? {} : { number: spot.number }),
    ...(spot.parentId === null ? {} : { parentId: spot.parentId }),
    amount,
  }
  if (validateAction(session.state, action, cfg) === null) return bet(session, action, cfg)
  return bet(session, { ...action, amount: spot.minAdd }, cfg)
}

/**
 * Meets a refused roll the way a player would: the machine's shortfall (`BELOW_MIN_TOTAL.short`)
 * goes on the line, the come or a place spot; any other refusal gets credit. Null when nothing
 * can be done, so the driver moves on.
 */
function topUp(
  session: WindowedSession,
  cfg: MachineConfig,
  refusal: Rejection,
): WindowedSession | null {
  if (refusal.code !== 'BELOW_MIN_TOTAL') {
    const deposit: Action = { type: 'deposit', amount: cents(50_000) }
    return validateAction(session.state, deposit, cfg) === null ? bet(session, deposit, cfg) : null
  }
  const short = refusal.details['short']
  if (typeof short !== 'number') return null
  const spots = legalBets(session.state, cfg).filter((spot) => spot.canAdd === null)
  for (const typeId of ['pass', 'come', 'place']) {
    const spot = spots.find((candidate) => candidate.typeId === typeId && candidate.maxAdd >= short)
    if (spot === undefined) continue
    return placeOn(session, spot, cents(Math.max(short, spot.minAdd)), cfg)
  }
  return null
}

/**
 * A random session driven through the real session API with fast-check's choices: bets on legal
 * spots (hardways and hops among them) at one to five units, the ON/OFF switches, deposits and
 * rolls. Before every roll the panel predicts, then the dice come from the RNG and the prediction
 * is checked against them in every particular.
 */
function drive(cfg: MachineConfig, choices: readonly number[], counts: Driven): void {
  let session: WindowedSession = testSession(
    `next-roll-prop-${choices.length}-${choices[0] ?? 0}`,
    cfg,
  )
  for (const choice of choices) {
    const kind = choice % 6
    const pick = Math.trunc(choice / 6)
    if (kind <= 1) {
      const spots = legalBets(session.state, cfg).filter((spot) => spot.canAdd === null)
      const spot = spots[pick % Math.max(spots.length, 1)]
      if (spot === undefined) continue
      const units = 1 + (pick % 5)
      session = placeOn(session, spot, cents(Math.min(spot.minAdd * units, spot.maxAdd)), cfg)
    } else if (kind === 2) {
      const sub = pick % 4
      const target = session.state.bets[pick % Math.max(session.state.bets.length, 1)]
      const action: Action =
        sub === 0
          ? { type: 'setGlobalWorking', off: true }
          : sub === 1
            ? { type: 'setGlobalWorking', off: null }
            : target === undefined
              ? { type: 'setGlobalWorking', off: false }
              : { type: 'setWorking', betId: target.id, working: sub === 2 ? false : null }
      if (validateAction(session.state, action, cfg) === null) session = bet(session, action, cfg)
    } else if (kind === 3) {
      const deposit: Action = { type: 'deposit', amount: cents(5_000) }
      if (validateAction(session.state, deposit, cfg) === null) session = bet(session, deposit, cfg)
    } else {
      let before = session.state
      let preview = nextRollPreview(session, cfg)
      expectWellFormed(preview, before)
      const refusal = validateAction(before, { type: 'roll' }, cfg)
      if (refusal !== null) {
        // The panel carries exactly the refusal the machine would give.
        expect(preview.refused).toStrictEqual(refusal)
        counts.refusals += 1
        const topped = topUp(session, cfg, refusal)
        if (topped === null) continue
        session = topped
        before = session.state
        preview = nextRollPreview(session, cfg)
        expectWellFormed(preview, before)
        if (validateAction(before, { type: 'roll' }, cfg) !== null) continue
      }
      expect(preview.refused).toBeNull()
      const played = roll(session, undefined, cfg) // the dice come from the session's RNG
      expectHonest(preview, before, played)
      counts.rolls += 1
      if (preview.rows.some((row) => row.hardSplit !== undefined)) counts.splits += 1
      session = played.session
    }
  }
}

describe('property: rolling the dice the panel predicts gives exactly the predicted outcome', () => {
  const machines: readonly MachineConfig[] = [
    CRAPLESS,
    COMPILED_PRESETS.traditionalBubble,
    COMPILED_PRESETS.strictBubble,
  ]
  for (const cfg of machines) {
    it(
      `holds on ${cfg.id} over random sessions (fast-check seed 20261028)`,
      { timeout: 30_000 },
      () => {
        const counts: Driven = { rolls: 0, splits: 0, refusals: 0 }
        fc.assert(
          fc.property(
            fc.array(fc.nat({ max: 100_000 }), { minLength: 6, maxLength: 30 }),
            (choices) => drive(cfg, choices, counts),
          ),
          { seed: 20261028, numRuns: 50 },
        )
        // Not vacuous: real rolls were checked, refusals among them, and some tables carried a
        // hard/easy split.
        expect(counts.rolls).toBeGreaterThan(150)
        expect(counts.refusals).toBeGreaterThan(0)
        expect(counts.splits).toBeGreaterThan(0)
      },
    )
  }
})

describe('every one of the 36 dice is predicted, on the point table', () => {
  it('scripting each pair in turn lands on the outcome that names it', () => {
    const session = pointTable('next-roll-all')
    const preview = nextRollPreview(session, CRAPLESS)
    for (const dice of ALL_ROLLS) {
      const played = roll(session, [dice.d1, dice.d2])
      expectHonest(preview, session.state, played)
      const predicted = outcomeOf(preview, dice as Dice)
      expect(predicted?.dice).toContainEqual(dice)
    }
  })
})
