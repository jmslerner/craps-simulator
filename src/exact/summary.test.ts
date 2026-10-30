import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALL_ROLLS,
  Fraction,
  PRESETS,
  ReplayError,
  applyAction,
  cents,
  compileConfig,
  dispatchBetting,
  hashJson,
  headerConfig,
  makeRoll,
  newSession,
  rollWindow,
  type Action,
  type MachineConfig,
  type MachineConfigInput,
  type SessionHeader,
  type TableState,
  type WindowRecord,
  type WindowedSession,
} from '../engine/index.ts'
import { takeDownValue } from './equity.ts'
import {
  SessionAccountant,
  accountRoll,
  accountSession,
  betEquity,
  identityGap,
} from './summary.ts'

/**
 * The session account (plan §5.7, §10 M13): the identity on the pinned crapless-200 log, luck that
 * averages exactly zero over the 36 rolls of hand-built tables, the machine's re-wager, a declined
 * re-collection, the machine's post-seven-out hold, and replay failures. The property over random
 * sessions is tests/properties/sessionSummary.prop.test.ts; the golden fixture
 * tests/golden/sessionSummary.test.ts.
 */

const CRAPLESS = compileConfig(PRESETS.craplessBubble)

interface Fixture {
  readonly header: SessionHeader
  readonly windows: readonly WindowRecord[]
  readonly pending?: readonly Action[]
}

const FIXTURE = JSON.parse(
  readFileSync(new URL('../../tests/replay/fixtures/crapless-200.json', import.meta.url), 'utf8'),
) as Fixture

function play(cfg: MachineConfig, seed: string, steps: readonly (Action | [number, number])[]) {
  let session: WindowedSession = newSession(cfg, seed)
  for (const step of steps) {
    if (Array.isArray(step)) {
      const rolled = rollWindow(session, cfg, makeRoll(step[0], step[1]))
      if (!rolled.ok) throw new Error(`roll refused: ${rolled.rejection.code}`)
      session = rolled.session
    } else {
      const result = dispatchBetting(session, step, cfg)
      if (!result.ok) throw new Error(`refused ${JSON.stringify(step)}: ${result.rejection.code}`)
      session = result.session
    }
  }
  return session
}

/** Σ luck over the 36 rolls of `atRoll`: zero when equity is fair to the engine's own roll. */
function luckOverAllRolls(atRoll: TableState, cfg: MachineConfig): Fraction {
  return Fraction.sum(
    ALL_ROLLS.map((dice) => {
      const rolled = applyAction(atRoll, { type: 'roll', dice }, cfg)
      if (!rolled.ok) throw new Error(`refused: ${rolled.rejection.code}`)
      return accountRoll(atRoll, rolled.state, rolled.events, 0, cfg).roll.luck
    }),
  )
}

describe('the session account', () => {
  it('holds the identity exactly over the pinned crapless-200 log, ending on its table', () => {
    const cfg = headerConfig(FIXTURE.header)
    const account = accountSession(FIXTURE.header, FIXTURE.windows, FIXTURE.pending ?? [], cfg)
    expect(identityGap(account).isZero()).toBe(true)
    expect(account.windows).toBe(200)
    expect(account.rolls).toHaveLength(200)
    expect(account.start.wealth.equals(Fraction.of(cfg.startingBankroll))).toBe(true)
    expect(account.topUps).toBe(account.end.deposits - cfg.startingBankroll)
    expect(account.costs.some((entry) => entry.kind === 'rewager')).toBe(true)
    // The account's table is the one the log's last window recorded.
    expect(hashJson(account.state)).toBe(FIXTURE.windows.at(-1)?.hashAfter)
  })

  it('gives the same account window by window as in one pass, asked part-way or not', () => {
    const cfg = headerConfig(FIXTURE.header)
    const whole = accountSession(FIXTURE.header, FIXTURE.windows.slice(0, 60), [], cfg)
    const accountant = new SessionAccountant(FIXTURE.header, cfg)
    FIXTURE.windows.slice(0, 60).forEach((record, index) => {
      accountant.addWindow(record)
      if (index % 7 === 0) accountant.account([])
    })
    const stepwise = accountant.account([])
    expect(stepwise.costs).toEqual(whole.costs)
    expect(stepwise.rolls).toEqual(whole.rolls)
    expect(stepwise.end).toEqual(whole.end)
  })

  it('books a crapless pass that wins and stays up as a re-wager on the come-out', () => {
    // Pass $10, point 4, made: the winner rides into the come-out as a new decision.
    const session = play(CRAPLESS, 'rewager', [
      { type: 'place', typeId: 'pass', amount: cents(1000) },
      [2, 2],
      [1, 3],
    ])
    const account = accountSession(session.header, session.committed, [], CRAPLESS)
    const [placed, rewager] = account.costs
    expect(placed?.kind).toBe('action')
    expect(rewager?.kind).toBe('rewager')
    // Both decisions cost the pass's 373/6930 of $10, in cents.
    const passCost = Fraction.of(1000).mul(Fraction.of(373, 6930))
    expect(placed?.cost.equals(passCost)).toBe(true)
    expect(rewager?.cost.equals(passCost)).toBe(true)
    expect(identityGap(account).isZero()).toBe(true)
  })

  it('averages luck to exactly zero over the 36 rolls of mixed tables', () => {
    // Crapless: pass on 4 with odds, place 6, buy 4 (vig re-collected from the win), a hardway, a
    // field, and Low Rolls with the 4 already rolled.
    const crapless = play(CRAPLESS, 'fair-crapless', [
      { type: 'place', typeId: 'pass', amount: cents(1000) },
      { type: 'place', typeId: 'luckyRollerLow', amount: cents(100) },
      [2, 2],
    ])
    const passId = crapless.state.bets.find((b) => b.typeId === 'pass')?.id
    if (passId === undefined) throw new Error('no pass')
    const table = play(CRAPLESS, 'fair-crapless', [
      { type: 'place', typeId: 'pass', amount: cents(1000) },
      { type: 'place', typeId: 'luckyRollerLow', amount: cents(100) },
      [2, 2],
      { type: 'place', typeId: 'passOdds', parentId: passId, amount: cents(2000) },
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
      { type: 'place', typeId: 'buy', number: 4, amount: cents(2500) },
      { type: 'place', typeId: 'hard', number: 8, amount: cents(300) },
      { type: 'place', typeId: 'field', amount: cents(500) },
    ]).state
    expect(luckOverAllRolls(table, CRAPLESS).isZero()).toBe(true)

    // Shoot To Win: commission taken from the win, a hard way, and a come bet in the box.
    const stw = compileConfig(PRESETS.traditionalBubble)
    const stwTable = play(stw, 'fair-stw', [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      [3, 3],
      { type: 'place', typeId: 'come', amount: cents(500) },
      { type: 'place', typeId: 'buy', number: 10, amount: cents(2000) },
    ]).state
    expect(luckOverAllRolls(stwTable, stw).isZero()).toBe(true)
  })

  it('values a bet the machine holds OFF at its take-down, and books its decision when set ON', () => {
    // Interblock: a place bet made right after a seven-out stays OFF until Set bets On.
    const session = play(CRAPLESS, 'held', [
      { type: 'place', typeId: 'pass', amount: cents(1000) },
      [2, 2],
      [3, 4],
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
    ])
    const held = session.state.bets.find((b) => b.typeId === 'place')
    if (held === undefined) throw new Error('no place 6')
    expect(session.state.heldOff).toContain(held.id)
    expect(betEquity(held, session.state, CRAPLESS)).toEqual(
      takeDownValue(held, session.state, CRAPLESS),
    )
    const on = dispatchBetting(session, { type: 'setGlobalWorking', off: null }, CRAPLESS)
    if (!on.ok) throw new Error('Set bets On refused')
    const account = accountSession(
      on.session.header,
      on.session.committed,
      on.session.pending,
      CRAPLESS,
    )
    const [placed, setOn] = account.costs.filter((entry) => entry.betId === held.id)
    // Placing a held bet risks nothing yet; setting it ON costs the decision's 1/66 of $6.
    expect(placed?.cost.isZero()).toBe(true)
    expect(setOn?.outlay).toBe(0)
    expect(setOn?.cost.equals(Fraction.of(100, 11))).toBe(true)
    expect(identityGap(account).isZero()).toBe(true)
  })

  it('books a declined re-collection as luck on the decision, never a re-wager', () => {
    // A $50 minimum buy vig on a $100 bankroll: the 4 wins $10, which pays $10 of the $50 due;
    // credit cannot pay the other $40, so the machine takes the buy down instead.
    const input = structuredClone(PRESETS.craplessBubble) as MachineConfigInput
    const buy = input.catalog.buy
    if (buy?.family !== 'numberVsSeven' || buy.commission === undefined) throw new Error('no buy')
    buy.commission = { ...buy.commission, minimum: 5_000, refundOnTakeDown: true }
    input.money.startingBankroll = 10_000
    const cfg = compileConfig(input)
    const session = play(cfg, 'declined', [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'place', typeId: 'buy', number: 4, amount: cents(500) },
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
      [2, 2],
    ])
    expect(session.state.bets.some((b) => b.typeId === 'buy')).toBe(false)
    const account = accountSession(session.header, session.committed, [], cfg)
    expect(identityGap(account).isZero()).toBe(true)
    expect(account.costs.filter((entry) => entry.kind === 'rewager')).toHaveLength(0)
    const declined = account.rolls[0]?.bets.find((entry) => entry.spec.typeId === 'buy')
    // Realized: the $10 win (all of it toward the vig, so given back) and the $5 stake.
    expect(declined?.cash).toBe(1_500)
    expect(declined?.decided).toBe(true)
    expect(declined?.luck.equals(Fraction.of(1_500).sub(declined.equityBefore))).toBe(true)
  })

  it('refuses a log that does not replay', () => {
    const cfg = headerConfig(FIXTURE.header)
    const tampered = FIXTURE.windows
      .slice(0, 3)
      .map((record, index) => (index === 2 ? { ...record, hashAfter: '0000000000000000' } : record))
    expect(() => accountSession(FIXTURE.header, tampered, [], cfg)).toThrow(ReplayError)
    expect(() => accountSession(FIXTURE.header, [], [], CRAPLESS)).not.toThrow()
    expect(
      () => new SessionAccountant(FIXTURE.header, compileConfig(PRESETS.strictBubble)),
    ).toThrow(RangeError)
  })
})
