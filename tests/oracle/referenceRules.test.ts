import { describe, expect, it } from 'vitest'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { ALL_ROLLS } from '../../src/engine/core/dice.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import { factsFrom, type MachineFacts } from './machineFacts.ts'
import {
  refDecide,
  refMaxOdds,
  refSettle,
  refTransition,
  refUpfrontVig,
  refVigOnReduce,
  refVigTopUp,
  roundRef,
  type RefBefore,
  type RefDecision,
  type RefStake,
} from './referenceRules.ts'

const crapless = factsFrom(PRESETS.craplessBubble)
const stw = factsFrom(PRESETS.traditionalBubble)
const strict = factsFrom(PRESETS.strictBubble)
const live = factsFrom(PRESETS.traditionalLive345)

const COME_OUT: RefBefore = { phase: 'comeOut', point: null }
const point = (n: number): RefBefore => ({ phase: 'point', point: n })
const frac = (num: number, den = 1) => Fraction.of(num, den)

/** A decision as short text: "win 7/6 stay", "lose", "push bar stay", "travel 6", "none". */
function text(decision: RefDecision): string {
  switch (decision.kind) {
    case 'win':
      return `win ${decision.ratio.toString()} ${decision.stake}`
    case 'push':
      return `push ${decision.reason} ${decision.stake}`
    case 'travel':
      return `travel ${decision.number}`
    case 'lose':
    case 'none':
      return decision.kind
  }
}

function decide(
  facts: MachineFacts,
  typeId: string,
  number: number | null,
  before: RefBefore,
  d1: number,
  d2: number,
  working = true,
  parent?: RefDecision,
): string {
  return text(refDecide(facts, { typeId, number }, before, { d1, d2 }, working, parent))
}

/** A roll showing `total`, never a pair except 1-1 and 6-6. */
function dice(total: number): [number, number] {
  const d1 = Math.max(1, total - 6)
  return [d1, total - d1]
}

/** Decisions on 2 to 12, each rolled the easy way where there is one. */
function byTotal(facts: MachineFacts, typeId: string, number: number | null, before: RefBefore) {
  return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((total) =>
    decide(facts, typeId, number, before, ...dice(total)),
  )
}

function settle(facts: MachineFacts, bet: Partial<RefStake> & { typeId: string }, d: RefDecision) {
  return refSettle(facts, { number: null, amount: 0, vigHeld: 0, ...bet }, d)
}

const win = (ratio: Fraction, stake: 'stay' | 'return'): RefDecision => ({
  kind: 'win',
  ratio,
  stake,
})

function edited(id: keyof typeof PRESETS, edit: (input: MachineConfigInput) => void) {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(input)
  return factsFrom(input)
}

describe('round transitions (rules spec §2.1)', () => {
  it('crapless: only 7 is a natural; 2, 3, 11 and 12 become points', () => {
    expect(refTransition(crapless, COME_OUT, 7).transition).toEqual({ kind: 'natural', total: 7 })
    for (const total of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
      const { transition, after } = refTransition(crapless, COME_OUT, total)
      expect(transition).toEqual({ kind: 'pointEstablished', point: total })
      expect(after).toEqual({ phase: 'point', point: total })
    }
  })

  it('traditional: 7 and 11 are naturals, 2, 3 and 12 craps', () => {
    expect([7, 11].map((t) => refTransition(stw, COME_OUT, t).transition.kind)).toEqual([
      'natural',
      'natural',
    ])
    expect([2, 3, 12].map((t) => refTransition(stw, COME_OUT, t).after)).toEqual([
      COME_OUT,
      COME_OUT,
      COME_OUT,
    ])
  })

  it('point phase: the point is made, a 7 sevens out, anything else does nothing', () => {
    expect(refTransition(crapless, point(2), 2)).toEqual({
      transition: { kind: 'pointMade', point: 2 },
      after: COME_OUT,
    })
    expect(refTransition(crapless, point(2), 7).transition).toEqual({ kind: 'sevenOut', point: 2 })
    expect(refTransition(crapless, point(2), 11)).toEqual({
      transition: { kind: 'none' },
      after: point(2),
    })
  })
})

describe('line bets (rules spec §2.2, §3.1, §3.5)', () => {
  it('crapless come-out: only 7 wins the pass; every other total is its point', () => {
    for (const { d1, d2 } of ALL_ROLLS) {
      const total = d1 + d2
      expect(decide(crapless, 'pass', null, COME_OUT, d1, d2)).toBe(
        total === 7 ? 'win 1 stay' : `travel ${total}`,
      )
    }
  })

  it("traditional come-out: pass and don't pass, bar 12", () => {
    expect(byTotal(stw, 'pass', null, COME_OUT)).toEqual([
      'lose',
      'lose',
      'travel 4',
      'travel 5',
      'travel 6',
      'win 1 stay',
      'travel 8',
      'travel 9',
      'travel 10',
      'win 1 stay',
      'lose',
    ])
    // STW's don't pass rides a first-roll win ("stayIfFirstRoll"); the bar pushes and stays.
    expect(byTotal(stw, 'dontPass', null, COME_OUT)).toEqual([
      'win 1 stay',
      'win 1 stay',
      'travel 4',
      'travel 5',
      'travel 6',
      'lose',
      'travel 8',
      'travel 9',
      'travel 10',
      'lose',
      'push bar stay',
    ])
  })

  it('Reno bar 2: 2 pushes, 3 and 12 win', () => {
    const reno = edited('strictBubble', (input) => {
      input.rules.dontBar = 2
    })
    expect([2, 3, 12].map((t) => decide(reno, 'dontPass', null, COME_OUT, ...dice(t)))).toEqual([
      'push bar stay',
      'win 1 stay',
      'win 1 stay',
    ])
  })

  it('on a number: the number against 7, either way', () => {
    expect(byTotal(crapless, 'pass', 2, point(2))).toEqual([
      'win 1 stay',
      ...Array<string>(4).fill('none'),
      'lose',
      ...Array<string>(5).fill('none'),
    ])
    expect(decide(stw, 'dontPass', 6, point(6), 3, 4)).toBe('win 1 return')
    expect(decide(stw, 'dontPass', 6, point(6), 2, 4)).toBe('lose')
    expect(decide(strict, 'dontPass', 6, point(6), 3, 4)).toBe('win 1 stay')
  })

  it('come box in the point phase: traditional 7 and 11 win, craps lose; crapless travels', () => {
    expect(byTotal(stw, 'come', null, point(6))).toEqual([
      'lose',
      'lose',
      'travel 4',
      'travel 5',
      'travel 6',
      'win 1 return',
      'travel 8',
      'travel 9',
      'travel 10',
      'win 1 stay', // STW: a come bet that wins on 11 stays in the box (stayIf11)
      'lose',
    ])
    expect(byTotal(crapless, 'come', null, point(6))).toEqual([
      'travel 2',
      'travel 3',
      'travel 4',
      'travel 5',
      'travel 6',
      'win 1 return',
      'travel 8',
      'travel 9',
      'travel 10',
      'travel 11',
      'travel 12',
    ])
    expect(byTotal(stw, 'dontCome', null, point(6))).toEqual([
      'win 1 stay',
      'win 1 stay',
      'travel 4',
      'travel 5',
      'travel 6',
      'lose',
      'travel 8',
      'travel 9',
      'travel 10',
      'lose',
      'push bar stay',
    ])
  })

  it('a come bet on N wins on the roll the box come bet travels to N (§0.2 #12)', () => {
    expect(decide(crapless, 'come', 6, point(4), 2, 4)).toBe('win 1 return')
    expect(decide(crapless, 'come', null, point(4), 2, 4)).toBe('travel 6')
    // On the come-out the come bet on N is decided the same way.
    expect(decide(crapless, 'come', 6, COME_OUT, 3, 3)).toBe('win 1 return')
    expect(decide(crapless, 'come', 6, COME_OUT, 3, 4)).toBe('lose')
  })
})

describe('odds (rules spec §2.2, §2.3 step 4, §3.1)', () => {
  const comeWins = win(frac(1), 'return')
  const lose: RefDecision = { kind: 'lose' }
  const none: RefDecision = { kind: 'none' }

  it('follow the parent and pay their own ratio', () => {
    expect(decide(crapless, 'passOdds', 2, point(2), 1, 1, true, win(frac(1), 'stay'))).toBe(
      'win 6 return',
    )
    expect(decide(crapless, 'comeOdds', 11, point(4), 3, 4, true, lose)).toBe('lose')
    expect(decide(crapless, 'comeOdds', 11, point(4), 2, 2, true, none)).toBe('none')
    expect(decide(stw, 'dontComeOdds', 4, COME_OUT, 3, 4, true, comeWins)).toBe('win 1/2 return')
    expect(decide(stw, 'dontPassOdds', 6, point(6), 3, 4, true, comeWins)).toBe('win 5/6 return')
  })

  it('are returned when OFF and the parent is decided: come odds on a come-out', () => {
    expect(decide(crapless, 'comeOdds', 6, COME_OUT, 3, 4, false, lose)).toBe(
      'push offReturned return',
    )
    expect(decide(crapless, 'comeOdds', 6, COME_OUT, 3, 3, false, comeWins)).toBe(
      'push offReturned return',
    )
    expect(decide(crapless, 'comeOdds', 6, COME_OUT, 2, 2, false, none)).toBe('none')
  })

  it('Interblock returns every OFF odds bet when the point is made; Shoot To Win does not', () => {
    // Come odds on 5 while the pass point 6 is made: the come bet itself is not decided.
    expect(decide(crapless, 'comeOdds', 5, point(6), 2, 4, false, none)).toBe(
      'push offReturned return',
    )
    expect(decide(strict, 'dontComeOdds', 5, point(6), 2, 4, false, none)).toBe(
      'push offReturned return',
    )
    expect(decide(stw, 'comeOdds', 5, point(6), 2, 4, false, none)).toBe('none')
    expect(decide(crapless, 'comeOdds', 5, point(6), 2, 2, false, none)).toBe('none')
  })
})

describe('number bets and hardways (rules spec §3.2, §3.3)', () => {
  it('place, buy and big win on the number; lay and place to lose on 7', () => {
    expect(decide(crapless, 'place', 6, COME_OUT, 3, 3)).toBe('win 7/6 stay')
    expect(decide(crapless, 'place', 6, COME_OUT, 3, 4)).toBe('lose')
    expect(decide(crapless, 'place', 6, COME_OUT, 4, 4)).toBe('none')
    expect(decide(crapless, 'place', 2, point(4), 1, 1)).toBe('win 11/2 stay')
    expect(decide(crapless, 'buy', 11, point(4), 5, 6)).toBe('win 3 stay')
    expect(decide(stw, 'big', 8, point(4), 2, 6)).toBe('win 1 stay')
    expect(decide(stw, 'lay', 4, point(6), 3, 4)).toBe('win 1/2 stay')
    expect(decide(stw, 'lay', 4, point(6), 1, 3)).toBe('lose')
    expect(decide(stw, 'placeToLose', 6, point(4), 6, 1)).toBe('win 4/5 stay')
    expect(decide(stw, 'placeToLose', 6, point(4), 5, 1)).toBe('lose')
  })

  it('a bet that is not working gets no action', () => {
    expect(decide(crapless, 'place', 6, COME_OUT, 3, 4, false)).toBe('none')
    expect(decide(stw, 'lay', 4, COME_OUT, 3, 4, false)).toBe('none')
    expect(decide(crapless, 'hard', 6, point(4), 3, 3, false)).toBe('none')
  })

  it('hard 6 wins on 3-3, loses on the easy way or any 7', () => {
    expect(decide(crapless, 'hard', 6, point(4), 3, 3)).toBe('win 9 stay')
    expect(decide(crapless, 'hard', 6, point(4), 5, 1)).toBe('lose')
    expect(decide(crapless, 'hard', 6, point(4), 2, 4)).toBe('lose')
    expect(decide(crapless, 'hard', 6, point(4), 6, 1)).toBe('lose')
    expect(decide(crapless, 'hard', 6, COME_OUT, 3, 4)).toBe('lose')
    expect(decide(crapless, 'hard', 6, point(4), 4, 4)).toBe('none')
    expect(decide(crapless, 'hard', 4, point(6), 2, 2)).toBe('win 7 stay')
  })
})

describe('one-roll bets (rules spec §3.4)', () => {
  /** Net per unit by total: the pay on a win, −1 on a loss. */
  const net = (facts: MachineFacts, typeId: string) =>
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((total) => {
      const decision = refDecide(
        facts,
        { typeId, number: null },
        COME_OUT,
        {
          d1: dice(total)[0],
          d2: dice(total)[1],
        },
        true,
      )
      return decision.kind === 'win'
        ? decision.ratio.toString()
        : decision.kind === 'lose'
          ? '-1'
          : '?'
    })

  it('field 2:1/2:1 on machines, 2:1/3:1 at the live table', () => {
    expect(net(crapless, 'field')).toEqual([
      '2',
      '1',
      '1',
      '-1',
      '-1',
      '-1',
      '-1',
      '1',
      '1',
      '1',
      '2',
    ])
    expect(net(stw, 'field')).toEqual(net(crapless, 'field'))
    expect(net(live, 'field')).toEqual(['2', '1', '1', '-1', '-1', '-1', '-1', '1', '1', '1', '3'])
  })

  it('props: any 7, any craps, the horn singles ("for 1" read as one less)', () => {
    expect(net(crapless, 'any7')).toEqual(net(stw, 'any7'))
    expect(net(crapless, 'any7')[5]).toBe('4')
    expect(net(crapless, 'anyCraps')).toEqual([
      '7',
      '7',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
      '7',
    ])
    expect([net(crapless, 'snakeEyes')[0], net(crapless, 'yo')[9]]).toEqual(['30', '15'])
    expect([net(stw, 'horn2')[0], net(stw, 'horn11')[9]]).toEqual(['30', '15'])
  })

  it('hops match their dice in either order', () => {
    expect(decide(crapless, 'hop13', null, point(4), 1, 3)).toBe('win 15 return')
    expect(decide(crapless, 'hop13', null, point(4), 3, 1)).toBe('win 15 return')
    expect(decide(crapless, 'hop13', null, point(4), 2, 2)).toBe('lose')
    expect(decide(crapless, 'hop22', null, point(4), 2, 2)).toBe('win 30 return')
    expect(decide(crapless, 'hop22', null, point(4), 1, 3)).toBe('lose')
    expect(decide(stw, 'hop12', null, COME_OUT, 2, 1)).toBe('win 15 stay')
    expect(decide(stw, 'hop66', null, COME_OUT, 6, 6)).toBe('win 30 stay')
  })

  it('composites settle once on their whole-bet net (plan §0 amendment 15)', () => {
    // A $4 horn on 2 nets +$27; $100 on 6-6 nets +$675 (Interblock's formula).
    const horn2 = refDecide(
      crapless,
      { typeId: 'horn', number: null },
      COME_OUT,
      { d1: 1, d2: 1 },
      true,
    )
    expect(text(horn2)).toBe('win 27/4 return')
    expect(settle(crapless, { typeId: 'horn', amount: 400 }, horn2)).toMatchObject({
      winPaid: 2_700,
      credited: 3_100,
      stakeDisposition: 'returned',
    })
    const horn12 = refDecide(
      crapless,
      { typeId: 'horn', number: null },
      point(6),
      { d1: 6, d2: 6 },
      true,
    )
    expect(settle(crapless, { typeId: 'horn', amount: 10_000 }, horn12).winPaid).toBe(67_500)
    expect(decide(crapless, 'horn', null, point(6), 1, 2)).toBe('win 3 return')
    expect(decide(crapless, 'horn', null, point(6), 3, 4)).toBe('lose')
    expect(decide(stw, 'ce', null, COME_OUT, 5, 6)).toBe('win 7 stay')
    // A world bet on 7 nets 0: a push that returns the stake.
    const world7 = refDecide(
      live,
      { typeId: 'world', number: null },
      COME_OUT,
      { d1: 3, d2: 4 },
      true,
    )
    expect(text(world7)).toBe('push zeroNet return')
    expect(settle(live, { typeId: 'world', amount: 500 }, world7)).toMatchObject({
      credited: 500,
      winPaid: 0,
      stakeDisposition: 'returned',
    })
    expect(decide(live, 'world', null, COME_OUT, 1, 1)).toBe('win 26/5 return')
  })
})

describe('decisions do not depend on which die shows which face', () => {
  it('holds for every bet, number and round state of every preset', () => {
    for (const facts of [crapless, stw, strict, live]) {
      const befores = [COME_OUT, ...facts.points.map(point)]
      for (const [typeId, type] of facts.types) {
        if (type.family === 'odds') continue
        const numbers =
          type.family === 'numberVsSeven' || type.family === 'hardway'
            ? type.numbers
            : type.family === 'line'
              ? [null, ...facts.points]
              : [null]
        for (const number of numbers) {
          for (const before of befores) {
            for (const { d1, d2 } of ALL_ROLLS) {
              expect(decide(facts, typeId, number, before, d1, d2)).toBe(
                decide(facts, typeId, number, before, d2, d1),
              )
            }
          }
        }
      }
    }
  })
})

describe('rounding (rules spec §4.2 breakage table)', () => {
  const round = (exact: Fraction, mode: 'floor' | 'ceil' | 'halfUp' | 'halfEven', increment = 1) =>
    roundRef(exact, { mode, increment })
  const place6 = (dollars: number) => frac(dollars * 100).mul(frac(7, 6))

  it('$1, $2 and $5 on place 6 at 7:6', () => {
    expect([1, 2, 5].map((d) => round(place6(d), 'floor'))).toEqual([116, 233, 583])
    expect([1, 2, 5].map((d) => round(place6(d), 'halfUp'))).toEqual([117, 233, 583])
    expect([1, 2, 5].map((d) => round(place6(d), 'ceil'))).toEqual([117, 234, 584])
    expect(round(place6(5), 'floor', 100)).toBe(500)
  })

  it('$1 lay odds at 5:6 and 2:3', () => {
    const odds = (num: number, den: number) => frac(100).mul(frac(num, den))
    const modes = ['floor', 'halfUp', 'ceil'] as const
    expect(modes.map((mode) => round(odds(5, 6), mode))).toEqual([83, 83, 84])
    expect([round(odds(2, 3), 'floor'), round(odds(2, 3), 'halfUp')]).toEqual([66, 67])
  })

  it('half to even and half up differ only on exact halves', () => {
    expect([frac(5, 2), frac(7, 2), frac(9, 4)].map((x) => round(x, 'halfEven'))).toEqual([2, 4, 2])
    expect([frac(5, 2), frac(7, 2), frac(9, 4)].map((x) => round(x, 'halfUp'))).toEqual([3, 4, 2])
    expect(round(frac(250), 'halfEven', 100)).toBe(200)
    expect(round(frac(350), 'halfEven', 100)).toBe(400)
    expect(round(frac(0), 'ceil')).toBe(0)
    expect(() => round(frac(-1), 'floor')).toThrow(RangeError)
  })

  it('$5 place 6 pays $5.83 floored, $5.84 on Shoot To Win, $5 at the live table', () => {
    const place6Win = win(frac(7, 6), 'stay')
    expect(settle(crapless, { typeId: 'place', number: 6, amount: 500 }, place6Win).winPaid).toBe(
      583,
    )
    expect(settle(strict, { typeId: 'place', number: 6, amount: 500 }, place6Win).winPaid).toBe(583)
    expect(settle(stw, { typeId: 'place', number: 6, amount: 500 }, place6Win).winPaid).toBe(584)
    expect(settle(stw, { typeId: 'place', number: 6, amount: 100 }, place6Win).winPaid).toBe(117)
    expect(settle(stw, { typeId: 'place', number: 6, amount: 200 }, place6Win).winPaid).toBe(234)
    expect(settle(live, { typeId: 'place', number: 6, amount: 500 }, place6Win).winPaid).toBe(500)
    const exact = settle(crapless, { typeId: 'place', number: 6, amount: 500 }, place6Win).winExact
    expect(exact.toString()).toBe('1750/3')
  })

  it('$1 lay on 4 with 5% of the win: the vig rounds up to 3¢ (net 47¢) or down to 2¢ (48¢)', () => {
    const layWin = win(frac(1, 2), 'stay')
    const ceilVig = settle(stw, { typeId: 'lay', number: 4, amount: 100 }, layWin)
    expect([ceilVig.winPaid, ceilVig.vigOnWin, ceilVig.credited]).toEqual([50, 3, 47])
    const floorVigFacts = edited('traditionalBubble', (input) => {
      const lay = input.catalog.lay
      if (lay?.family === 'numberVsSeven' && lay.commission) {
        lay.commission.rounding = { mode: 'floor', increment: 1 }
      }
    })
    const floorVig = settle(floorVigFacts, { typeId: 'lay', number: 4, amount: 100 }, layWin)
    expect([floorVig.vigOnWin, floorVig.credited]).toEqual([2, 48])
  })
})

describe('commission (rules spec §4.3)', () => {
  const buy4Win = win(frac(2), 'stay')

  it('$25 buy 4, 5% of the stake taken from the win, credits $48.75', () => {
    expect(settle(stw, { typeId: 'buy', number: 4, amount: 2_500 }, buy4Win)).toMatchObject({
      winPaid: 5_000,
      vigOnWin: 125,
      vigRearm: 0,
      credited: 4_875,
      stakeDisposition: 'stays',
    })
  })

  it('upfront vig: charged on the stake, re-collected from a winner that stays, or not', () => {
    expect(refUpfrontVig(crapless, 'buy', 4, 2_000)).toBe(100)
    expect(refUpfrontVig(crapless, 'place', 4, 2_000)).toBe(0)
    const recollect = settle(
      crapless,
      { typeId: 'buy', number: 4, amount: 2_000, vigHeld: 100 },
      buy4Win,
    )
    expect(recollect).toMatchObject({
      winPaid: 4_000,
      vigRearm: 100,
      vigRearmFrom: 'win',
      credited: 3_900,
      debited: 0,
      vigHeldAfter: 100,
    })
    const rearm = (mode: 'none' | 'recollectFromCredit') =>
      edited('craplessBubble', (input) => {
        const buy = input.catalog.buy
        if (buy?.family === 'numberVsSeven' && buy.commission) buy.commission.rearm = mode
      })
    const none = settle(
      rearm('none'),
      { typeId: 'buy', number: 4, amount: 2_000, vigHeld: 100 },
      buy4Win,
    )
    expect(none).toMatchObject({ vigRearm: 0, credited: 4_000, debited: 0, vigHeldAfter: 100 })
    const fromCredit = settle(
      rearm('recollectFromCredit'),
      { typeId: 'buy', number: 4, amount: 2_000, vigHeld: 100 },
      buy4Win,
    )
    expect(fromCredit).toMatchObject({
      vigRearm: 100,
      vigRearmFrom: 'credit',
      credited: 4_000,
      debited: 100,
    })
    // A winner that comes down is not charged again.
    const returned = settle(
      crapless,
      { typeId: 'buy', number: 4, amount: 2_000, vigHeld: 100 },
      win(frac(2), 'return'),
    )
    expect(returned).toMatchObject({ vigRearm: 0, credited: 6_000, vigHeldAfter: 0 })
  })

  it('lifecycle edges of a buy 4 left up until it loses: 1/21, 1/31 and 1/60 (§4.3)', () => {
    // Each decision wins with P = 1/3 and stays up, so E[wins] = 1/2 and E[decisions] = 3/2.
    // Risked per §0.1 HE_res: the stakes plus upfront vig (at placement and re-collected); vig
    // taken from a win is not part of the divisor, which gives §4.3's r·P(win) = 1/60.
    const edge = (facts: MachineFacts, vig: number) => {
      const s = settle(facts, { typeId: 'buy', number: 4, amount: 2_000, vigHeld: vig }, buy4Win)
      const wins = frac(1, 2)
      const paidIn = frac(2_000 + vig).add(wins.mul(frac(s.debited)))
      const loss = paidIn.sub(wins.mul(frac(s.credited)))
      const stakes = frac(2_000).mul(frac(3, 2))
      const risked = stakes.add(frac(vig)).add(wins.mul(frac(s.vigRearm)))
      return loss.div(risked).toString()
    }
    const none = edited('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family === 'numberVsSeven' && buy.commission) buy.commission.rearm = 'none'
    })
    expect([edge(crapless, 100), edge(none, 100), edge(stw, 0)]).toEqual(['1/21', '1/31', '1/60'])
  })

  it('lay vig on the potential win, charged up front (strict) or from the win (STW)', () => {
    expect(refUpfrontVig(strict, 'lay', 4, 200)).toBe(5) // $2 lay on 4 → $0.05
    expect(refUpfrontVig(strict, 'lay', 5, 100)).toBe(4) // win 66¢ → 3.3¢ → 4¢
    expect(refUpfrontVig(strict, 'lay', 6, 600)).toBe(25)
    expect(refUpfrontVig(stw, 'lay', 4, 200)).toBe(0) // on win, nothing up front
    const stwLay = settle(stw, { typeId: 'lay', number: 6, amount: 1_200 }, win(frac(5, 6), 'stay'))
    expect([stwLay.winPaid, stwLay.vigOnWin, stwLay.credited]).toEqual([1_000, 50, 950])
  })

  it('live: whole-dollar vig with a $1 minimum; 4 and 10 on the win', () => {
    expect(refUpfrontVig(live, 'buy', 5, 2_500)).toBe(100) // $1.25 → $1
    expect(refUpfrontVig(live, 'buy', 5, 1_000)).toBe(100) // 50¢ → $0, minimum $1
    expect(refUpfrontVig(live, 'buy', 5, 4_000)).toBe(200)
    expect(refUpfrontVig(live, 'buy', 4, 2_500)).toBe(0)
    const buy4 = (amount: number) => settle(live, { typeId: 'buy', number: 4, amount }, buy4Win)
    expect([buy4(2_500).vigOnWin, buy4(2_500).credited]).toEqual([100, 4_900])
    // $5 buy, $1 minimum: pays $9, the same as placing it.
    expect(buy4(500).credited).toBe(900)
    expect(refUpfrontVig(live, 'lay', 4, 4_000)).toBe(100) // 5% of a $20 win
  })

  it('tops upfront vig up on increases; refunds it on a take-down only when the machine does', () => {
    const lay = { typeId: 'lay', number: 4, amount: 1_000, vigHeld: 25 }
    expect(refVigTopUp(strict, lay, 2_000)).toBe(25) // 5% of a $10 win, $0.25 already held
    expect(
      refVigTopUp(live, { typeId: 'buy', number: 5, amount: 2_000, vigHeld: 100 }, 2_500),
    ).toBe(0)
    expect(
      refVigTopUp(live, { typeId: 'buy', number: 5, amount: 2_000, vigHeld: 100 }, 4_000),
    ).toBe(100)
    expect(refVigOnReduce(strict, lay, 0)).toEqual({ vigHeld: 25, refund: 0 }) // no refund (§5.2)
    const buy = { typeId: 'buy', number: 5, amount: 4_000, vigHeld: 200 }
    expect(refVigOnReduce(live, buy, 0)).toEqual({ vigHeld: 0, refund: 200 })
    expect(refVigOnReduce(live, buy, 2_000)).toEqual({ vigHeld: 100, refund: 100 })
    expect(refVigOnReduce(live, buy, 3_000)).toEqual({ vigHeld: 100, refund: 100 }) // $1.50 → $1
    expect(refVigOnReduce(crapless, { ...buy, typeId: 'buy', vigHeld: 200 }, 0)).toEqual({
      vigHeld: 200,
      refund: 0,
    })
  })

  it('a loss keeps nothing; a push in the box keeps the bet; an OFF return refunds the stake', () => {
    expect(
      settle(crapless, { typeId: 'buy', number: 4, amount: 2_000, vigHeld: 100 }, { kind: 'lose' }),
    ).toMatchObject({
      credited: 0,
      stakeDisposition: 'lost',
      vigHeldAfter: 0,
    })
    expect(
      settle(
        stw,
        { typeId: 'dontPass', amount: 1_000 },
        { kind: 'push', reason: 'bar', stake: 'stay' },
      ),
    ).toMatchObject({
      credited: 0,
      stakeDisposition: 'stays',
    })
    expect(
      settle(
        crapless,
        { typeId: 'comeOdds', number: 6, amount: 2_000 },
        { kind: 'push', reason: 'offReturned', stake: 'return' },
      ),
    ).toMatchObject({
      credited: 2_000,
      stakeDisposition: 'returned',
    })
  })
})

describe('per-number rounding, the on-win cap and re-collection parts (rules spec §4.1-§4.3)', () => {
  /** Shoot To Win place with its rounding per number: 6/8 up to the cent, the rest down. */
  const stwByNumber = edited('traditionalBubble', (input) => {
    const place = input.catalog.place
    if (place?.family !== 'numberVsSeven') throw new Error('place')
    place.payoutRounding = { mode: 'floor', increment: 1 }
    Object.assign(place, {
      payoutRoundingByNumber: {
        '6': { mode: 'ceil', increment: 1 },
        '8': { mode: 'ceil', increment: 1 },
      },
    })
  })

  it('rounds a win by its number: $1 place 6 pays $1.17, $1 place 5 at an odd 7:5 cent floors', () => {
    const place = (number: number, amount: number, ratio: Fraction) =>
      settle(stwByNumber, { typeId: 'place', number, amount }, win(ratio, 'stay')).winPaid
    expect([place(6, 100, frac(7, 6)), place(8, 200, frac(7, 6))]).toEqual([117, 234])
    // A 1¢ odd stake shows the direction on numbers that are exact with whole dollars.
    expect([place(5, 101, frac(7, 5)), place(4, 101, frac(9, 5))]).toEqual([141, 181])
    const ceilEverywhere = edited('traditionalBubble', (input) => {
      const place = input.catalog.place
      if (place?.family !== 'numberVsSeven') throw new Error('place')
      place.payoutRounding = { mode: 'ceil', increment: 1 }
      delete (place as { payoutRoundingByNumber?: unknown }).payoutRoundingByNumber
    })
    expect(
      settle(ceilEverywhere, { typeId: 'place', number: 5, amount: 101 }, win(frac(7, 5), 'stay'))
        .winPaid,
    ).toBe(142)
  })

  it('a lay with vig on its win as paid takes that number rounding', () => {
    // Strict lay, 5% of the win up front; its win rounds up to the cent on 5 only.
    const laid = edited('strictBubble', (input) => {
      Object.assign(input.catalog.lay ?? {}, {
        payoutRoundingByNumber: { '5': { mode: 'ceil', increment: 1 } },
      })
    })
    // 61¢ laid on 5 wins 40.67¢: floored to 40¢ the vig is 2¢; ceiled to 41¢ it is 2.05¢ → 3¢.
    expect([refUpfrontVig(strict, 'lay', 5, 61), refUpfrontVig(laid, 'lay', 5, 61)]).toEqual([2, 3])
    // $10 laid on 5 wins $6.66 or $6.67: 34¢ either way; 4 keeps the type's floor.
    expect([refUpfrontVig(strict, 'lay', 5, 1_000), refUpfrontVig(laid, 'lay', 5, 1_000)]).toEqual([
      34, 34,
    ])
    expect(refUpfrontVig(laid, 'lay', 4, 61)).toBe(2) // 30.5¢ → 30¢ → 1.5¢ → 2¢
    expect(
      settle(laid, { typeId: 'lay', number: 5, amount: 61, vigHeld: 3 }, win(frac(2, 3), 'stay')),
    ).toMatchObject({ winPaid: 41, vigRearm: 3, vigRearmFromWin: 3, credited: 38 })
  })

  it('takes on-win commission from the win only: a minimum above the win takes the whole win', () => {
    // Live lay with its vig moved to the win: $1 laid on 4 wins 50¢, floored to $0 at the live
    // table, and the $1 minimum cannot take more than that.
    const onWin = edited('traditionalLive345', (input) => {
      const lay = input.catalog.lay
      if (lay?.family === 'numberVsSeven' && lay.commission) {
        lay.commission = { ...lay.commission, timing: 'onWin', refundOnTakeDown: false }
        lay.commission.rearm = 'none'
      }
    })
    const small = settle(onWin, { typeId: 'lay', number: 4, amount: 300 }, win(frac(1, 2), 'stay'))
    expect([small.winPaid, small.vigOnWin, small.credited]).toEqual([100, 100, 0])
    const tiny = settle(onWin, { typeId: 'lay', number: 4, amount: 100 }, win(frac(1, 2), 'return'))
    expect([tiny.winPaid, tiny.vigOnWin, tiny.credited]).toEqual([0, 0, 100])
  })

  it('splits a re-collection between the win and credit', () => {
    const fromCredit = edited('craplessBubble', (input) => {
      const buy = input.catalog.buy
      if (buy?.family === 'numberVsSeven' && buy.commission)
        buy.commission.rearm = 'recollectFromCredit'
    })
    const bet = { typeId: 'buy', number: 4, amount: 2_000, vigHeld: 100 }
    expect(settle(crapless, bet, win(frac(2), 'stay'))).toMatchObject({
      vigRearm: 100,
      vigRearmFromWin: 100,
      vigRearmFromCredit: 0,
      credited: 3_900,
      debited: 0,
    })
    expect(settle(fromCredit, bet, win(frac(2), 'stay'))).toMatchObject({
      vigRearm: 100,
      vigRearmFromWin: 0,
      vigRearmFromCredit: 100,
      credited: 4_000,
      debited: 100,
    })
    // Live lay on 4, $1 laid: the win floors to $0, so the whole $1 re-collection needs credit.
    const live1 = settle(
      live,
      { typeId: 'lay', number: 4, amount: 100, vigHeld: 100 },
      win(frac(1, 2), 'stay'),
    )
    expect(live1).toMatchObject({
      winPaid: 0,
      vigRearm: 100,
      vigRearmFromWin: 0,
      vigRearmFromCredit: 100,
      credited: 0,
      debited: 100,
      vigHeldAfter: 100,
    })
    // $3 laid on 4 wins $1.50, paid $1: the win pays the $1 re-collection in full.
    expect(
      settle(
        live,
        { typeId: 'lay', number: 4, amount: 300, vigHeld: 100 },
        win(frac(1, 2), 'stay'),
      ),
    ).toMatchObject({ winPaid: 100, vigRearmFromWin: 100, vigRearmFromCredit: 0, credited: 0 })
  })
})

describe('odds caps (rules spec §4.4)', () => {
  it('floor to the odds increment on the point (incrementByNumber)', () => {
    const stepped = edited('traditionalLive345', (input) => {
      input.limits.perType = {
        ...input.limits.perType,
        passOdds: { max: 2_500_000, incrementByNumber: { '6': 500, '5': 300 } },
        dontComeOdds: { max: 3_000_000, incrementByNumber: { '6': 2_500 } },
      }
    })
    // 3-4-5x on a $7 flat: $35 on 6 (a multiple of $5), $28 on 5 floored to $27 ($3 steps), and
    // $21 on 4 at the type's $1 step. Lays 6x the flat: $42 on 6 floored to $25 steps.
    expect([
      refMaxOdds(stepped, 'passOdds', 6, 700),
      refMaxOdds(stepped, 'passOdds', 5, 700),
      refMaxOdds(stepped, 'passOdds', 4, 700),
      refMaxOdds(stepped, 'dontComeOdds', 6, 700),
      refMaxOdds(stepped, 'dontComeOdds', 5, 700),
    ]).toEqual([3_500, 2_700, 2_100, 2_500, 4_200])
  })

  it('stake basis: the multiple × flat', () => {
    expect([2, 3, 6, 11].map((n) => refMaxOdds(crapless, 'passOdds', n, 1_000))).toEqual([
      2_000, 2_000, 2_000, 2_000,
    ])
    expect([4, 5, 6].map((n) => refMaxOdds(live, 'passOdds', n, 1_000))).toEqual([
      3_000, 4_000, 5_000,
    ])
    expect(refMaxOdds(stw, 'dontPassOdds', 4, 1_000)).toBe(2_000)
    expect(refMaxOdds(live, 'dontPassOdds', 6, 1_000)).toBe(6_000)
  })

  it('win basis: lay ≤ multiple × flat ÷ pay, floored to the bet increment', () => {
    expect([4, 5, 6].map((n) => refMaxOdds(stw, 'dontComeOdds', n, 1_000))).toEqual([
      4_000, 3_000, 2_400,
    ])
    expect(refMaxOdds(stw, 'dontComeOdds', 6, 300)).toBe(700) // $7.20 → $7
    expect(refMaxOdds(stw, 'dontComeOdds', 5, 500)).toBe(1_500)
  })
})
