import { describe, expect, it } from 'vitest'
import {
  Fraction,
  PRESETS,
  cents,
  compileConfig,
  dispatchBetting,
  makeRoll,
  newSession,
  rollWindow,
} from '../engine/index.ts'
import type {
  Action,
  BetId,
  GameEvent,
  MachineConfig,
  SettlementTrace,
  TableState,
  WindowedSession,
} from '../engine/index.ts'
import { formatPart } from './format.ts'
import { coachMoney, sourceOf } from './numbers.ts'
import {
  breakageSign,
  chasingMoment,
  detectMoments,
  detectNoAction,
  momentLine,
  momentWantsEquity,
  noActionLine,
  recapMath,
  stakesOf,
} from './recap.ts'
import type { RecapContext, RecapItem } from './recap.ts'
import type { TemplateParts } from './types.ts'

/**
 * Recaps and teachable moments (plan §10 M9b): the arithmetic is rendered from real engine events
 * — `rollWindow` on the crapless preset, never the solver — and asserted as the exact text the
 * history panel shows. One test per roll-event kind, the no-action lines included.
 */

const CFG = compileConfig(PRESETS.craplessBubble)
/** Shoot To Win: place 6/8 pays round UP to the cent (`payoutRoundingByNumber` CENT_UP, [R]). */
const TRADITIONAL = compileConfig(PRESETS.traditionalBubble)

function bet(session: WindowedSession, action: Action, cfg: MachineConfig = CFG): WindowedSession {
  const result = dispatchBetting(session, action, cfg)
  if (!result.ok) throw new Error(`test bet refused: ${result.rejection.code}`)
  return result.session
}

interface Played {
  readonly atRoll: TableState
  readonly events: readonly GameEvent[]
  readonly after: TableState
  readonly session: WindowedSession
}

function roll(session: WindowedSession, d1: number, d2: number, cfg: MachineConfig = CFG): Played {
  const atRoll = session.state
  const result = rollWindow(session, cfg, makeRoll(d1, d2))
  if (!result.ok) throw new Error(`test roll refused: ${result.rejection.code}`)
  return { atRoll, events: result.events, after: result.session.state, session: result.session }
}

function ctxOf(played: Played): RecapContext {
  const rolled = played.events.find((event) => event.type === 'diceRolled')
  if (rolled === undefined || rolled.type !== 'diceRolled') throw new Error('no diceRolled event')
  return {
    rollIndex: rolled.rollIndex,
    comeOut: played.atRoll.round.phase.kind === 'comeOut',
    total: rolled.total,
  }
}

function itemOf(played: Played, typeId: string): RecapItem {
  const item = played.events.find(
    (event) => event.type === 'betResolved' && event.trace.typeId === typeId,
  )
  if (item === undefined) throw new Error(`no betResolved for ${typeId}`)
  return item as RecapItem
}

function text(parts: TemplateParts | null): string {
  if (parts === null) throw new Error('expected recap parts')
  return parts.map((part) => formatPart(part)).join('')
}

const SYNTHETIC_CTX: RecapContext = { rollIndex: 0, comeOut: false, total: 8 }

function trace(overrides: Partial<SettlementTrace>): SettlementTrace {
  return {
    betId: 'b1' as BetId,
    typeId: 'place',
    number: 6,
    outcome: 'push',
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
    stakeDisposition: 'stays',
    ...overrides,
  }
}

describe('recapMath: betResolved', () => {
  it('a win with breakage reads stake × ratio = exact → paid, kept, credit, stake (§10 M9b)', () => {
    const session = bet(newSession(CFG, 'recap-win'), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(500),
    })
    const played = roll(session, 3, 3)
    const math = text(recapMath(itemOf(played, 'place'), ctxOf(played), CFG))
    // The §10 M9b acceptance string, exactly.
    expect(math).toContain('$5 × 7/6 = $5.833… → paid $5.83')
    expect(math).toBe(
      '($5 × 7/6 = $5.833… → paid $5.83, machine kept $0.003…, +$5.83 to credit, stake stays up)',
    )
  })

  it('a win the machine rounds UP says it paid extra, never that it kept anything (M9 audit)', () => {
    let session = bet(
      newSession(TRADITIONAL, 'recap-ceil'),
      { type: 'place', typeId: 'pass', amount: cents(500) },
      TRADITIONAL,
    )
    session = roll(session, 2, 3, TRADITIONAL).session // the point is 5
    session = bet(
      session,
      { type: 'place', typeId: 'place', number: 8, amount: cents(100) },
      TRADITIONAL,
    )
    const played = roll(session, 4, 4, TRADITIONAL)
    const math = text(recapMath(itemOf(played, 'place'), ctxOf(played), TRADITIONAL))
    expect(math).toBe(
      '($1 × 7/6 = $1.166… → paid $1.17, rounded up — machine paid $0.003… extra, ' +
        '+$1.17 to credit, stake stays up)',
    )
    expect(math).not.toContain('kept')
  })

  it('reads the breakage sign from the trace: positive kept, negative paid extra, zero exact', () => {
    expect(breakageSign('')).toBe(0)
    expect(breakageSign('0')).toBe(0)
    expect(breakageSign('1/3')).toBe(1)
    expect(breakageSign('2')).toBe(1)
    expect(breakageSign('-1/3')).toBe(-1)
    expect(breakageSign('-2')).toBe(-1)
    // A synthetic exact pay carries neither clause.
    const exact = text(
      recapMath(
        {
          type: 'betResolved',
          trace: trace({
            outcome: 'win',
            winExact: '700',
            winPaid: cents(700),
            credited: cents(700),
            stake: cents(600),
          }),
        } as RecapItem,
        SYNTHETIC_CTX,
        CFG,
      ),
    )
    expect(exact).toBe('($6 × 7/6 = $7.00 → paid $7.00, +$7.00 to credit, stake stays up)')
  })

  it('every recap number is a CoachNumber sourced to the settlement, never the solver', () => {
    const session = bet(newSession(CFG, 'recap-source'), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(500),
    })
    const played = roll(session, 3, 3)
    const parts = recapMath(itemOf(played, 'place'), ctxOf(played), CFG)
    expect(parts).not.toBeNull()
    const numbers = (parts ?? []).filter((part) => typeof part !== 'string')
    expect(numbers.length).toBeGreaterThan(0)
    for (const part of numbers) {
      const n = 'style' in part ? part.n : part
      expect(n.source.fn).toBe('settle')
      expect(n.source.configHash).toBe(CFG.configHash)
    }
  })

  it('an even-money win multiplies by a whole ratio', () => {
    const session = bet(newSession(CFG, 'recap-natural'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    const played = roll(session, 3, 4)
    const math = text(recapMath(itemOf(played, 'pass'), ctxOf(played), CFG))
    expect(math).toBe('($5 × 1 = $5.00 → paid $5.00, +$5.00 to credit, stake stays up)')
  })

  it('a buy win shows the re-collected commission, matching the trace and the vig event', () => {
    let session = bet(newSession(CFG, 'recap-rearm'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    session = roll(session, 1, 1).session // point 2
    session = bet(session, { type: 'place', typeId: 'buy', number: 4, amount: cents(2500) })
    const played = roll(session, 2, 2) // buy 4 wins 2:1, stays up, vig re-collected from the win
    const math = text(recapMath(itemOf(played, 'buy'), ctxOf(played), CFG))
    expect(math).toBe(
      '($25 × 2 = $50.00 → paid $50.00, commission $1.25 re-collected from the win, ' +
        '+$48.75 to credit, stake stays up)',
    )
    const vig = played.events.find((event) => event.type === 'vigCharged')
    expect(vig?.type === 'vigCharged' && vig.reason === 'rearm' && vig.from === 'win').toBe(true)
    expect(text(recapMath(vig as RecapItem, ctxOf(played), CFG))).toBe(
      '(already taken out of the win above)',
    )
  })

  it('a loss reads as the stake gone', () => {
    let session = bet(newSession(CFG, 'recap-lose'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    session = roll(session, 1, 1).session // point 2
    const played = roll(session, 3, 4) // seven-out
    const math = text(recapMath(itemOf(played, 'pass'), ctxOf(played), CFG))
    expect(math).toBe('(−$5 stake)')
  })

  it('come odds off on the come-out are returned, and the moment triggers (plan §5.4)', () => {
    let session = bet(newSession(CFG, 'recap-off-odds'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    session = roll(session, 1, 1).session // point 2
    session = bet(session, { type: 'place', typeId: 'come', amount: cents(500) })
    const traveled = roll(session, 2, 2) // come travels to 4
    expect(recapMath(itemOf0(traveled, 'betTraveled'), ctxOf(traveled), CFG)).toBeNull()
    const comeBet = traveled.after.bets.find((b) => b.typeId === 'come')
    if (comeBet === undefined) throw new Error('no come bet on 4')
    session = bet(traveled.session, {
      type: 'place',
      typeId: 'comeOdds',
      parentId: comeBet.id,
      amount: cents(500),
    })
    session = roll(session, 1, 1).session // point 2 made; next roll is a come-out
    const played = roll(session, 3, 4) // come-out 7: come 4 loses, its OFF odds come back
    const math = text(recapMath(itemOf(played, 'comeOdds'), ctxOf(played), CFG))
    expect(math).toBe('(off for this decision — $5 returned to credit)')
    const moments = detectMoments(played.atRoll, played.events, CFG)
    expect(moments.some((m) => m.id === 'come-odds-returned')).toBe(true)
  })

  it('a zero-net composite push and a barred push read by their reason', () => {
    const zero = trace({ outcome: 'push', pushReason: 'zeroNet', stakeDisposition: 'stays' })
    expect(text(recapMath({ type: 'betResolved', trace: zero }, SYNTHETIC_CTX, CFG))).toBe(
      '(won and lost the same — no net pay, stake stays up)',
    )
    const bar = trace({ outcome: 'push', pushReason: 'bar' })
    expect(text(recapMath({ type: 'betResolved', trace: bar }, SYNTHETIC_CTX, CFG))).toBe(
      '(barred — no money moved, stake stays up)',
    )
  })

  it('a side bet’s push is neither a composite netting 0 nor a barred total (M11)', () => {
    // The Hot Shooter's stake-back tier (Shoot To Win, 8 to 15 rolls) ends the bet, stake returned.
    const stakeBack = trace({
      typeId: 'hotShooter',
      number: null,
      pushReason: 'zeroNet',
      stakeDisposition: 'returned',
    })
    expect(
      text(recapMath({ type: 'betResolved', trace: stakeBack }, SYNTHETIC_CTX, TRADITIONAL)),
    ).toBe('(a stake-back tier — no net pay, stake returned)')
    // The Lucky Shooter's come-out 7 or 11 pushes and leaves the bet up (rules spec §6.3).
    const STRICT = compileConfig(PRESETS.strictBubble)
    const stays = trace({ typeId: 'luckyShooter', number: null, pushReason: 'bar' })
    expect(text(recapMath({ type: 'betResolved', trace: stays }, SYNTHETIC_CTX, STRICT))).toBe(
      '(a push — no money moved, the bet stays up)',
    )
  })
})

function itemOf0(played: Played, type: RecapItem['type']): RecapItem {
  const item = played.events.find((event) => event.type === type)
  if (item === undefined) throw new Error(`no ${type} event`)
  return item as RecapItem
}

describe('recapMath: the other roll events', () => {
  const betId = 'b1' as BetId

  it('words each commission event by its source', () => {
    const rearmCredit: RecapItem = {
      type: 'vigCharged',
      betId,
      amount: cents(25),
      reason: 'rearm',
      from: 'credit',
    }
    expect(text(recapMath(rearmCredit, SYNTHETIC_CTX, CFG))).toBe(
      '(charged to credit — the win did not cover it)',
    )
    const placement: RecapItem = {
      type: 'vigCharged',
      betId,
      amount: cents(25),
      reason: 'placement',
    }
    expect(text(recapMath(placement, SYNTHETIC_CTX, CFG))).toBe('(charged to credit with the bet)')
    const refund: RecapItem = { type: 'vigRefunded', betId, amount: cents(25) }
    expect(text(recapMath(refund, SYNTHETIC_CTX, CFG))).toBe('(returned to credit)')
  })

  it('a vig-declined take-down carries its note; the rest add nothing to their lead line', () => {
    const declined: RecapItem = {
      type: 'betRemoved',
      betId,
      typeId: 'buy',
      amount: cents(2500),
      reason: 'vigDeclined',
    }
    expect(text(recapMath(declined, SYNTHETIC_CTX, CFG))).toBe(
      '(credit could not cover the commission to keep it up)',
    )
    const takenDown: RecapItem = {
      type: 'betRemoved',
      betId,
      typeId: 'place',
      amount: cents(600),
      reason: 'takenDown',
    }
    expect(recapMath(takenDown, SYNTHETIC_CTX, CFG)).toBeNull()
    const switched: RecapItem = { type: 'workingChanged', scope: 'bet', betId, working: false }
    expect(recapMath(switched, SYNTHETIC_CTX, CFG)).toBeNull()
  })
})

describe('no-action lines (plan §5.5: bets the roll left untouched)', () => {
  it('an off place bet surviving a come-out 7 gets the "didn\'t take it" line and the moment', () => {
    let session = bet(newSession(CFG, 'recap-off-seven'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    session = bet(session, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    session = bet(session, { type: 'setGlobalWorking', off: true })
    const played = roll(session, 3, 4) // come-out 7: pass wins, the off place 6 is untouched
    const untouched = detectNoAction(played.atRoll, played.events, CFG)
    expect(
      untouched.map((b) => ({
        typeId: b.typeId,
        number: b.number,
        amount: b.amount,
        working: b.working,
      })),
    ).toEqual([{ typeId: 'place', number: 6, amount: 600, working: false }])
    const first = untouched[0]
    if (first === undefined) throw new Error('expected an untouched bet')
    const line = noActionLine(first, ctxOf(played), CFG)
    expect(line.id).toBe('no-action:off-seven')
    expect(text(line.parts)).toBe('Place 6 $6.00 was off — the 7 didn’t take it')
    const moments = detectMoments(played.atRoll, played.events, CFG)
    expect(moments.some((m) => m.id === 'place-off-comeout-7')).toBe(true)
  })

  it('a working bet the roll misses reads "no action", with no moment', () => {
    let session = bet(newSession(CFG, 'recap-no-action'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    session = bet(session, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    const played = roll(session, 2, 3) // come-out 5: the point is 5, place 6 untouched
    const untouched = detectNoAction(played.atRoll, played.events, CFG)
    expect(untouched.map((b) => [b.typeId, b.number, b.working])).toEqual([['place', 6, true]])
    const first = untouched[0]
    if (first === undefined) throw new Error('expected an untouched bet')
    const line = noActionLine(first, ctxOf(played), CFG)
    expect(line.id).toBe('no-action:on')
    expect(text(line.parts)).toBe('Place 6 $6.00 — no action on the 5')
    expect(detectMoments(played.atRoll, played.events, CFG)).toEqual([])
  })

  it('an off bet on any other roll reads "was off — no action"', () => {
    let session = bet(newSession(CFG, 'recap-off'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    session = bet(session, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    session = bet(session, { type: 'setGlobalWorking', off: true })
    const played = roll(session, 2, 3) // come-out 5, place 6 off
    const first = detectNoAction(played.atRoll, played.events, CFG)[0]
    if (first === undefined) throw new Error('expected an untouched bet')
    const line = noActionLine(first, ctxOf(played), CFG)
    expect(line.id).toBe('no-action:off')
    expect(text(line.parts)).toBe('Place 6 $6.00 was off — no action')
  })
})

describe('teachable moments (plan §5.4: event-triggered)', () => {
  it('the crapless equity point: the pass line stuck on 2, worth sentence from the worker equity', () => {
    const session = bet(newSession(CFG, 'recap-point-2'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(1000),
    })
    const played = roll(session, 1, 1)
    const moments = detectMoments(played.atRoll, played.events, CFG)
    expect(moments).toHaveLength(1)
    const moment = moments[0]
    if (moment === undefined) throw new Error('expected the point-outside moment')
    expect(moment.id).toBe('point-outside')
    expect(moment.number).toBe(2)
    expect(moment.amount).toBe(1000)
    const want = momentWantsEquity(moment)
    expect(want).toEqual({
      spec: { typeId: 'pass', number: null },
      amount: 1000,
      betId: moment.betId,
    })
    // Without the worker's answer the line never invents a number.
    expect(text(momentLine(moment, null, CFG).parts)).toBe(
      'Lesson: the point is 2 — pass wins only when 2 rolls again before a seven.',
    )
    // With it (worker fn analyzeExisting; 2 × $10 × 1/7 = 2000/7 cents) it shows the worth: the
    // §10 M9b acceptance value, "$2.86" on a $10 pass stuck on 2.
    const equity = coachMoney(
      Fraction.of(2000, 7),
      sourceOf('analyzeExisting', { betId: moment.betId }, CFG),
    )
    expect(text(momentLine(moment, equity, CFG).parts)).toBe(
      'Lesson: the point is 2 — pass wins only when 2 rolls again before a seven.' +
        ' Your $10 on the line is worth ≈ $2.86 right now.',
    )
  })

  it('a come bet travelling to an outside number', () => {
    let session = bet(newSession(CFG, 'recap-come-11'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(1000),
    })
    session = roll(session, 2, 3).session // point 5
    session = bet(session, { type: 'place', typeId: 'come', amount: cents(500) })
    const played = roll(session, 5, 6) // come travels to 11
    const moments = detectMoments(played.atRoll, played.events, CFG)
    expect(moments.map((m) => m.id)).toEqual(['come-outside'])
    const moment = moments[0]
    if (moment === undefined) throw new Error('expected the come-outside moment')
    expect(moment.number).toBe(11)
    expect(text(momentLine(moment, null, CFG).parts)).toBe(
      'Lesson: Come moved to 11 — it wins only when 11 rolls again before a seven.',
    )
  })

  it('the rounding loss carries what the machine kept, straight from the trace', () => {
    const session = bet(newSession(CFG, 'recap-shave'), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(500),
    })
    const played = roll(session, 3, 3)
    const moment = detectMoments(played.atRoll, played.events, CFG).find(
      (m) => m.id === 'rounding-loss',
    )
    expect(moment?.kept).toBe('1/3')
    if (moment === undefined) throw new Error('expected the rounding-loss moment')
    expect(text(momentLine(moment, null, CFG).parts)).toBe(
      'Lesson: the machine rounded this pay down — it kept $0.003… of this win. ' +
        'Amounts the pay divides evenly avoid the shave.',
    )
  })

  it('a pay the machine rounds UP is never a shave: no rounding-loss moment (M9 audit MAJOR-1)', () => {
    // traditionalBubble place 8 at $1 wins 350/3 ¢ and is paid $1.17 (ceil): breakage -1/3.
    let session = bet(
      newSession(TRADITIONAL, 'recap-round-up'),
      { type: 'place', typeId: 'pass', amount: cents(500) },
      TRADITIONAL,
    )
    session = roll(session, 2, 3, TRADITIONAL).session // the point is 5
    session = bet(
      session,
      { type: 'place', typeId: 'place', number: 8, amount: cents(100) },
      TRADITIONAL,
    )
    const played = roll(session, 4, 4, TRADITIONAL)
    const item = itemOf(played, 'place')
    if (item.type !== 'betResolved') throw new Error('expected a settlement')
    expect(item.trace.breakage).toBe('-1/3')
    expect(item.trace.rounding?.mode).toBe('ceil')
    expect(detectMoments(played.atRoll, played.events, TRADITIONAL).map((m) => m.id)).toEqual([])
  })

  it('chasing losses: three straight losing rolls, then more on the table', () => {
    const losing = { net: cents(-500), stakes: cents(1000) }
    expect(chasingMoment([losing, losing, losing], cents(1500))?.id).toBe('chasing-losses')
    expect(chasingMoment([losing, losing, losing], cents(1000))).toBeNull() // no raise
    expect(chasingMoment([losing, losing], cents(1500))).toBeNull() // only two losses
    expect(
      chasingMoment([losing, { net: cents(0), stakes: cents(1000) }, losing], cents(1500)),
    ).toBeNull() // a flat roll breaks the streak
    const fired = chasingMoment([losing, losing, losing], cents(1500))
    if (fired === null) throw new Error('expected the chasing-losses moment')
    expect(text(momentLine(fired, null, CFG).parts)).toBe(
      'Lesson: three losing rolls, then a bigger bet — the dice have no memory, ' +
        'and the odds never change.',
    )
  })

  it('stakesOf sums the table', () => {
    let session = bet(newSession(CFG, 'recap-stakes'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(500),
    })
    session = bet(session, { type: 'place', typeId: 'place', number: 6, amount: cents(600) })
    expect(stakesOf(session.state)).toBe(1100)
    expect(stakesOf(newSession(CFG, 'recap-stakes-2').state)).toBe(0)
  })
})
