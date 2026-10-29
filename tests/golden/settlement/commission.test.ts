import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../../src/engine/config/presets/index.ts'
import { pruneProvenance } from '../../../src/engine/config/provenance.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type {
  CommissionInput,
  MachineConfigInput,
  RoundingRule,
} from '../../../src/engine/config/schema.ts'
import { cents } from '../../../src/engine/core/money.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import { requireType } from '../../../src/engine/bets/registry.ts'
import type { BetInstance, WinDecision } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, machine, rollContext, roundAt } from '../rules/support.ts'

// The commission settlement table, written from docs/rules/rules-spec.md §4.2 (commission rounding:
// machines round sub-cent commission up to the cent [A], live tables floor to the dollar with a $1
// minimum [V]; the "$1 lay on 4" breakage row) and §4.3 (the commission modes, their formulas and
// the edge each gives on every number). Amounts are cents. Rates, ways and the published edges
// are this file's own constants.

type Basis = CommissionInput['basis']
type Timing = CommissionInput['timing']
type Rearm = CommissionInput['rearm']

const CENT_UP: RoundingRule = { mode: 'ceil', increment: 1 }

/** Ways to roll each number out of 36 (§1.2). */
const WAYS: Readonly<Record<PointNumber, number>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
}

const ALL_POINTS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const

/** A 5% commission with the given basis, timing and re-arm, cents rounded up, no minimum. */
function fivePercent(basis: Basis, timing: Timing, rearm: Rearm = 'none'): CommissionInput {
  return {
    rate: '1:20',
    basis,
    timing,
    rounding: CENT_UP,
    minimum: 0,
    refundOnTakeDown: false,
    rearm,
  }
}

/**
 * `base` with `typeId` charging `commission` on every number (overrides dropped) and its winners
 * staying up or coming back per `afterWin`. A crapless machine gets a lay bet on all ten points
 * (1:6, 1:3, 1:2, 2:3, 5:6; "rare live", §3.2) so the §4.3 table can be checked in full.
 */
function charging(
  base: PresetId,
  typeId: 'buy' | 'lay',
  commission: CommissionInput,
  afterWin: 'stay' | 'return' = 'stay',
): MachineConfig {
  const input = structuredClone(PRESETS[base]) as MachineConfigInput
  if (typeId === 'lay' && input.catalog.lay === undefined) {
    input.catalog.lay = {
      family: 'numberVsSeven',
      kind: 'lay',
      label: 'Lay',
      numbers: [...ALL_POINTS],
      pays: {
        '2': '1:6',
        '3': '1:3',
        '4': '1:2',
        '5': '2:3',
        '6': '5:6',
        '8': '5:6',
        '9': '2:3',
        '10': '1:2',
        '11': '1:3',
        '12': '1:6',
      },
      commission,
      afterWin,
      comeOutDefault: 'on',
    }
  }
  const type = input.catalog[typeId]
  if (type?.family !== 'numberVsSeven') throw new Error(`${base} has no ${typeId}`)
  type.commission = commission
  delete type.commissionByNumber
  type.afterWin = afterWin
  const { basis, timing, rearm, rounding } = commission
  input.id = `${base}-${typeId}-${basis}-${timing}-${rearm}-${rounding.mode}-${afterWin}`
  input.provenance = pruneProvenance(input)
  return machine(input)
}

/** A bet of `stake` on `n` holding `vigHeld`, as the table would hold it after placement. */
function held(typeId: string, n: PointNumber, stake: number, vigHeld = 0): BetInstance {
  return { ...bet(typeId, n, { amount: stake }), vigHeld: cents(vigHeld) }
}

/** A win on `n` that leaves the bet up (`stay`) or brings it back (`return`). */
function win(n: PointNumber, stake: 'stay' | 'return' = 'stay'): WinDecision {
  return { kind: 'win', payKey: String(n), stake }
}

/** The up-front charge and refund `typeId` moves when a bet goes from `from` (holding `vigHeld`) to `to`. */
function vigChange(
  cfg: MachineConfig,
  typeId: string,
  n: PointNumber,
  from: number,
  to: number,
  vigHeld = 0,
) {
  const { family, type } = requireType(cfg, typeId)
  const change = family.vigOnChange?.(held(typeId, n, from, vigHeld), cents(to), type, cfg)
  return change ?? { charge: 0, refund: 0 }
}

describe('the acceptance case: $25 buy 4 with vig on the win credits $48.75 (plan §10 M4b)', () => {
  it('Shoot To Win: wins $50, 5% of the bet ($1.25) comes off the win, the bet stays up [V CW §18d]', () => {
    const cfg = machine('traditionalBubble')
    expect(settle(held('buy', 4, 2_500), win(4), cfg)).toMatchObject({
      outcome: 'win',
      ratioLabel: '2 to 1',
      winPaid: 5_000,
      vigOnWin: 125,
      vigRearm: 0,
      credited: 4_875,
      stakeDisposition: 'stays',
    })
  })
})

describe('commission from the win, 5% of the bet (Shoot To Win buy, §4.3)', () => {
  /** [number, stake, win, commission]: credited = win − commission; the bet stays up. */
  const TABLE: readonly (readonly [PointNumber, number, number, number])[] = [
    [4, 2_000, 4_000, 100],
    [10, 2_500, 5_000, 125],
    // "$5 buy on 5 paid $7.25" [F WOV-35576]; "a $50 Buy Bet would pay $72.50" [F WOV-36634].
    [5, 500, 750, 25],
    [9, 5_000, 7_500, 250],
    [6, 2_000, 2_400, 100],
    [8, 600, 720, 30],
    [4, 100, 200, 5],
  ]
  it.each(TABLE)('buy %i for %i¢ wins %i¢, less %i¢', (n, stake, paid, vig) => {
    const cfg = machine('traditionalBubble')
    expect(settle(held('buy', n, stake), win(n), cfg)).toMatchObject({
      winPaid: paid,
      vigOnWin: vig,
      credited: paid - vig,
    })
    expect(vigChange(cfg, 'buy', n, 0, stake)).toEqual({ charge: 0, refund: 0 })
  })
})

describe('commission from the win, 5% of the win (Shoot To Win lay, §4.2, §4.3)', () => {
  /** [number, stake, win, commission]. */
  const TABLE: readonly (readonly [PointNumber, number, number, number])[] = [
    [4, 2_000, 1_000, 50],
    [10, 4_000, 2_000, 100],
    [5, 300, 200, 10],
    [9, 3_000, 2_000, 100],
    [6, 600, 500, 25],
    [8, 1_200, 1_000, 50],
    // §4.2: $1 on 4 wins $0.50, and 5% of it ($0.025) rounds up to 3¢, netting $0.47.
    [4, 100, 50, 3],
    // $1 on 6 wins 83⅓¢, floored to 83¢; 5% of that (4.15¢) rounds up to 5¢.
    [6, 100, 83, 5],
  ]
  it.each(TABLE)('lay %i for %i¢ wins %i¢, less %i¢', (n, stake, paid, vig) => {
    const cfg = machine('traditionalBubble')
    expect(settle(held('lay', n, stake), win(n), cfg)).toMatchObject({
      winPaid: paid,
      vigOnWin: vig,
      vigRearm: 0,
      credited: paid - vig,
      stakeDisposition: 'stays',
    })
  })

  it('§4.2: the $1 lay on 4 edge is 1/50 with the vig rounded up, 1/75 down, 1/60 exactly', () => {
    const floor = charging('traditionalBubble', 'lay', {
      ...fivePercent('win', 'onWin'),
      rounding: { mode: 'floor', increment: 1 },
    })
    const cases = [
      [machine('traditionalBubble'), 47, Fraction.of(1, 50)],
      [floor, 48, Fraction.of(1, 75)],
    ] as const
    for (const [cfg, net, edge] of cases) {
      const trace = settle(held('lay', 4, 100), win(4), cfg)
      expect(trace.credited, cfg.id).toBe(net)
      // A lay on 4 wins on 7 (6 ways) and loses on 4 (3 ways).
      expect(Fraction.of(3 * 100 - 6 * trace.credited, 9 * 100).equals(edge), cfg.id).toBe(true)
    }
    const exact = settle(held('lay', 4, 100), win(4), machine('traditionalBubble'), 'exact')
    const nominal = Fraction.of(300)
      .sub(exact.credited.mul(Fraction.of(6)))
      .div(Fraction.of(900))
    expect(nominal.equals(Fraction.of(1, 60))).toBe(true)
  })

  it('every stake from 1¢ to $12 on every number: the win floored, 5% of it rounded up', () => {
    const cfg = machine('traditionalBubble')
    const lay: Readonly<Record<number, readonly [bigint, bigint]>> = {
      4: [1n, 2n],
      5: [2n, 3n],
      6: [5n, 6n],
      8: [5n, 6n],
      9: [2n, 3n],
      10: [1n, 2n],
    }
    const wrong: string[] = []
    for (const n of [4, 5, 6, 8, 9, 10] as const) {
      const [num, den] = lay[n]!
      for (let stake = 1; stake <= 1_200; stake++) {
        const paid = (BigInt(stake) * num) / den
        const vig = paid === 0n ? 0n : (paid + 19n) / 20n
        const trace = settle(held('lay', n, stake), win(n), cfg)
        if (trace.winPaid !== Number(paid) || trace.vigOnWin !== Number(vig)) {
          wrong.push(`${stake}¢ on ${n}: ${trace.winPaid}/${trace.vigOnWin}, want ${paid}/${vig}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('5% of the win on a buy (the Isle Pompano / Interblock settlement, §4.3) [V TCA]', () => {
  it('"a $20 bet paying 2:1 ($60 due) returned $58"', () => {
    const cfg = charging('traditionalBubble', 'buy', fivePercent('win', 'onWin'), 'return')
    expect(settle(held('buy', 4, 2_000), win(4, 'return'), cfg)).toMatchObject({
      winPaid: 4_000,
      vigOnWin: 200,
      credited: 5_800,
      stakeDisposition: 'returned',
    })
  })
})

describe('commission up front (Interblock GV6.5, live tables; §4.3)', () => {
  it('Interblock buy: 5% of the bet on placement, topped up on each increase [V IB §3.3]', () => {
    const cfg = machine('craplessBubble')
    expect(vigChange(cfg, 'buy', 4, 0, 2_000)).toEqual({ charge: 100, refund: 0 })
    expect(vigChange(cfg, 'buy', 4, 2_000, 3_000, 100)).toEqual({ charge: 50, refund: 0 })
    expect(vigChange(cfg, 'buy', 2, 0, 100)).toEqual({ charge: 5, refund: 0 })
    expect(vigChange(cfg, 'buy', 12, 100, 300, 5)).toEqual({ charge: 10, refund: 0 })
  })

  it('Interblock: no refund on a cut or a take-down [A §9 #3]', () => {
    const cfg = machine('craplessBubble')
    expect(vigChange(cfg, 'buy', 6, 3_000, 1_000, 150)).toEqual({ charge: 0, refund: 0 })
    expect(vigChange(cfg, 'buy', 6, 3_000, 0, 150)).toEqual({ charge: 0, refund: 0 })
  })

  it('Interblock lay: 5% of the win it would pay; "$0.05 commission" on a $2 lay on 4 [R IB]', () => {
    const cfg = machine('strictBubble')
    expect(vigChange(cfg, 'lay', 4, 0, 200)).toEqual({ charge: 5, refund: 0 })
    expect(vigChange(cfg, 'lay', 10, 0, 4_000)).toEqual({ charge: 100, refund: 0 })
    // $1 on 6 would win 83¢: 4.15¢, rounded up to 5¢. Raised to $2 it would win $1.66: 8.3¢ → 9¢,
    // so the top-up is 4¢, not another 5¢.
    expect(vigChange(cfg, 'lay', 6, 0, 100)).toEqual({ charge: 5, refund: 0 })
    expect(vigChange(cfg, 'lay', 6, 100, 200, 5)).toEqual({ charge: 4, refund: 0 })
  })

  it('live: 5% floored to the dollar, $1 minimum, refunded when cut or taken down [V HAR-PA]', () => {
    const cfg = machine('traditionalLive345')
    // Buy 5, 6, 8, 9 up front: $10 → $1 (the minimum); $25 → $1.25 → $1; $40 → $2.
    expect(vigChange(cfg, 'buy', 5, 0, 1_000)).toEqual({ charge: 100, refund: 0 })
    expect(vigChange(cfg, 'buy', 6, 0, 2_500)).toEqual({ charge: 100, refund: 0 })
    expect(vigChange(cfg, 'buy', 8, 0, 4_000)).toEqual({ charge: 200, refund: 0 })
    expect(vigChange(cfg, 'buy', 9, 2_500, 4_000, 100)).toEqual({ charge: 100, refund: 0 })
    expect(vigChange(cfg, 'buy', 9, 2_500, 3_000, 100)).toEqual({ charge: 0, refund: 0 })
    expect(vigChange(cfg, 'buy', 9, 4_000, 2_000, 200)).toEqual({ charge: 0, refund: 100 })
    expect(vigChange(cfg, 'buy', 9, 4_000, 0, 200)).toEqual({ charge: 0, refund: 200 })
    // Lay up front on what it would win: $40 on 4 wins $20 → $1; $10 on 4 wins $5 → the $1 minimum.
    expect(vigChange(cfg, 'lay', 4, 0, 4_000)).toEqual({ charge: 100, refund: 0 })
    expect(vigChange(cfg, 'lay', 4, 0, 1_000)).toEqual({ charge: 100, refund: 0 })
    expect(vigChange(cfg, 'lay', 6, 0, 12_000)).toEqual({ charge: 500, refund: 0 })
    // Buy 4 and 10 pay theirs on the win [R WOO-B]: nothing up front.
    expect(vigChange(cfg, 'buy', 4, 0, 2_500)).toEqual({ charge: 0, refund: 0 })
  })

  it('a lay’s commission base is its win rounded as its own number rounds (payoutRoundingFor)', () => {
    // Strict Interblock with lays on 4 rounded down to the dollar: a $3 lay on 4 would win $1.50,
    // paid as $1, so its up-front vig is 5¢ rather than the 8¢ of $1.50 rounded up; 10 is unchanged.
    const input = structuredClone(PRESETS.strictBubble) as MachineConfigInput
    const lay = input.catalog.lay
    if (lay?.family !== 'numberVsSeven') throw new Error('no lay bets')
    lay.payoutRoundingByNumber = { '4': { mode: 'floor', increment: 100 } }
    input.id = 'strictLayFourInDollars'
    const cfg = machine(input)
    expect(vigChange(cfg, 'lay', 4, 0, 300)).toEqual({ charge: 5, refund: 0 })
    expect(vigChange(cfg, 'lay', 10, 0, 300)).toEqual({ charge: 8, refund: 0 })
    expect(settle(held('lay', 4, 300), win(4), cfg)).toMatchObject({ winPaid: 100 })
    expect(settle(held('lay', 10, 300), win(10), cfg)).toMatchObject({ winPaid: 150 })
  })

  it('live buy 4 on the win: $25 nets $49; $5 pays $9, the same as placing it (§4.3)', () => {
    const cfg = machine('traditionalLive345')
    expect(settle(held('buy', 4, 2_500), win(4), cfg)).toMatchObject({
      winPaid: 5_000,
      vigOnWin: 100,
      credited: 4_900,
    })
    expect(settle(held('buy', 10, 500), win(10), cfg)).toMatchObject({
      winPaid: 1_000,
      vigOnWin: 100,
      credited: 900,
    })
  })
})

describe('re-collecting up-front commission when a winner stays up (`rearm`, §4.3)', () => {
  it('recollectFromWin (Interblock, [A §9 #3]): the win pays the next decision its vig', () => {
    const cfg = machine('craplessBubble')
    expect(settle(held('buy', 4, 2_000, 100), win(4), cfg)).toMatchObject({
      winPaid: 4_000,
      vigOnWin: 0,
      vigRearm: 100,
      credited: 3_900,
      stakeDisposition: 'stays',
    })
    expect(settle(held('lay', 4, 2_000, 50), win(4), machine('strictBubble'))).toMatchObject({
      winPaid: 1_000,
      vigRearm: 50,
      credited: 950,
    })
    // Live: $25 on 5 wins $37.50, paid $37; the re-collected 5% ($1.25) floors to $1.
    expect(settle(held('buy', 5, 2_500, 100), win(5), machine('traditionalLive345'))).toMatchObject(
      { winPaid: 3_700, vigRearm: 100, credited: 3_600 },
    )
  })

  it('a winner that comes back re-collects nothing; neither does `none` or `recollectFromCredit`', () => {
    const returned = charging(
      'craplessBubble',
      'buy',
      fivePercent('stake', 'upfront', 'recollectFromWin'),
      'return',
    )
    expect(settle(held('buy', 4, 2_000, 100), win(4, 'return'), returned)).toMatchObject({
      vigRearm: 0,
      credited: 6_000,
      stakeDisposition: 'returned',
    })
    for (const rearm of ['none', 'recollectFromCredit'] as const) {
      const cfg = charging('craplessBubble', 'buy', fivePercent('stake', 'upfront', rearm))
      expect(settle(held('buy', 4, 2_000, 100), win(4), cfg), rearm).toMatchObject({
        vigOnWin: 0,
        vigRearm: 0,
        credited: 4_000,
      })
    }
  })

  it('what the bet holds after a win that stays up: the vig due again, or what it held', () => {
    const vigHeldAfter = (cfg: MachineConfig, before: number) => {
      const { family, type } = requireType(cfg, 'buy')
      const subject = held('buy', 4, 2_000, before)
      const ctx = rollContext(cfg, roundAt(6), { d1: 1, d2: 3 })
      return family.apply(subject, win(4), ctx, type)?.vigHeld
    }
    expect(vigHeldAfter(machine('craplessBubble'), 100)).toBe(100)
    const credit = charging(
      'craplessBubble',
      'buy',
      fivePercent('stake', 'upfront', 'recollectFromCredit'),
    )
    expect(vigHeldAfter(credit, 100)).toBe(100)
    const none = charging('craplessBubble', 'buy', fivePercent('stake', 'upfront', 'none'))
    expect(vigHeldAfter(none, 100)).toBe(100)
    // A cut without a refund leaves more held than is due; a re-collection resets it.
    expect(vigHeldAfter(machine('craplessBubble'), 300)).toBe(100)
    expect(vigHeldAfter(none, 300)).toBe(300)
  })
})

describe('a win never costs money: commission taken from a win is cut to the win', () => {
  it('a $1 buy on 6 with a $5 minimum on the win loses its whole $1.20 win, no more', () => {
    const cfg = charging('traditionalBubble', 'buy', {
      ...fivePercent('stake', 'onWin'),
      minimum: 500,
    })
    expect(settle(held('buy', 6, 100), win(6), cfg)).toMatchObject({
      winPaid: 120,
      vigOnWin: 120,
      credited: 0,
    })
  })
})

describe('the §4.3 edges in every commission mode, from the engine’s own settlements', () => {
  /**
   * The edge of a bet left up until it loses (§0.1 lifecycle; §4.3's convention): stake S, up-front
   * vig v, and per win `credited` back with the stake left up. With p = P(win) and q = 1 − p, the
   * bet makes p/q wins on average, so
   *   E[loss] = S + v − (p/q)·credited
   *   E[risked] = S/q + v + (p/q)·re-collected vig
   * (commission taken from a win is netted from the win, not risked; §4.3 divides on-win modes by
   * the stake and up-front modes by stake + vig).
   */
  function edge(cfg: MachineConfig, typeId: 'buy' | 'lay', n: PointNumber, stake: number) {
    const v = vigChange(cfg, typeId, n, 0, stake).charge
    const trace = settle(held(typeId, n, stake, v), win(n), cfg)
    const w = WAYS[n]
    const p = typeId === 'buy' ? Fraction.of(w, w + 6) : Fraction.of(6, w + 6)
    const q = Fraction.ONE.sub(p)
    const wins = p.div(q)
    const S = Fraction.of(stake)
    const loss = S.add(Fraction.of(v)).sub(wins.mul(Fraction.of(trace.credited)))
    const risked = S.div(q)
      .add(Fraction.of(v))
      .add(wins.mul(Fraction.of(trace.vigRearm)))
    return loss.div(risked)
  }

  const f = (num: number, den: number) => Fraction.of(num, den)
  /** §4.3 by number 2, 3, 4, 5, 6, 8, 9, 10, 11, 12. */
  const byNumber = (
    two: Fraction,
    three: Fraction,
    four: Fraction,
    five: Fraction,
    six: Fraction,
  ) => [two, three, four, five, six, six, five, four, three, two] as const

  const MODES = [
    {
      name: 'buy, 5% of the bet from the win',
      typeId: 'buy',
      commission: fivePercent('stake', 'onWin'),
      edges: byNumber(f(1, 140), f(1, 80), f(1, 60), f(1, 50), f(1, 44)),
    },
    {
      name: 'buy, 5% of the win from the win',
      typeId: 'buy',
      commission: fivePercent('win', 'onWin'),
      edges: byNumber(f(3, 70), f(3, 80), f(1, 30), f(3, 100), f(3, 110)),
    },
    {
      name: 'buy, up front, re-collected',
      typeId: 'buy',
      commission: fivePercent('stake', 'upfront', 'recollectFromWin'),
      edges: byNumber(f(1, 21), f(1, 21), f(1, 21), f(1, 21), f(1, 21)),
    },
    {
      name: 'buy, up front, not re-collected',
      typeId: 'buy',
      commission: fivePercent('stake', 'upfront', 'none'),
      edges: byNumber(f(3, 73), f(3, 83), f(1, 31), f(3, 103), f(3, 113)),
    },
    {
      name: 'lay, 5% of the win from the win',
      typeId: 'lay',
      commission: fivePercent('win', 'onWin'),
      edges: byNumber(f(1, 140), f(1, 80), f(1, 60), f(1, 50), f(1, 44)),
    },
    {
      name: 'lay, up front, re-collected',
      typeId: 'lay',
      commission: fivePercent('win', 'upfront', 'recollectFromWin'),
      edges: byNumber(f(1, 121), f(1, 61), f(1, 41), f(1, 31), f(1, 25)),
    },
    {
      name: 'lay, up front, not re-collected',
      typeId: 'lay',
      commission: fivePercent('win', 'upfront', 'none'),
      edges: byNumber(f(1, 841), f(1, 241), f(1, 121), f(1, 76), f(5, 269)),
    },
  ] as const

  it.each(MODES)('$name', ({ typeId, commission, edges }) => {
    const cfg = charging('craplessBubble', typeId, commission)
    ALL_POINTS.forEach((n, i) => {
      // $120: every win and every 5% here is a whole number of cents.
      const got = edge(cfg, typeId, n, 12_000)
      expect(got.equals(edges[i]!), `${typeId} ${n}: ${got.toString()}`).toBe(true)
    })
  })
})

describe('rounding and minimums, against this file’s own model (seeded)', () => {
  /** round(x/den) to `increment` by `mode`, for x ≥ 0, in bigint. */
  function roundTo(x: bigint, den: bigint, { mode, increment }: RoundingRule): bigint {
    const unit = den * BigInt(increment)
    const whole = x / unit
    const rest = x % unit
    const up =
      mode === 'ceil'
        ? rest > 0n
        : mode === 'floor'
          ? false
          : 2n * rest > unit || (2n * rest === unit && (mode === 'halfUp' || whole % 2n === 1n))
    return (whole + (up ? 1n : 0n)) * BigInt(increment)
  }

  /** Commission on `base` cents: base/20 rounded, at least the minimum; none on nothing. */
  function vigOn(base: bigint, rule: CommissionInput): bigint {
    if (base === 0n) return 0n
    const rounded = roundTo(base, 20n, rule.rounding)
    return rounded > BigInt(rule.minimum) ? rounded : BigInt(rule.minimum)
  }

  const MODES = ['floor', 'ceil', 'halfUp', 'halfEven'] as const
  const rules: fc.Arbitrary<CommissionInput> = fc
    .record({
      basis: fc.constantFrom<Basis>('stake', 'win'),
      timing: fc.constantFrom<Timing>('upfront', 'onWin'),
      rearm: fc.constantFrom<Rearm>('recollectFromWin', 'recollectFromCredit', 'none'),
      mode: fc.constantFrom(...MODES),
      increment: fc.constantFrom(1, 5, 25, 100),
      minimum: fc.constantFrom(0, 1, 25, 100),
      refund: fc.boolean(),
    })
    .map(({ basis, timing, rearm, mode, increment, minimum, refund }) => ({
      rate: '1:20',
      basis,
      timing,
      rounding: { mode, increment },
      minimum,
      refundOnTakeDown: timing === 'upfront' && refund,
      rearm: timing === 'upfront' ? rearm : 'none',
    }))

  it('charges, refunds, commission on the win and re-collection all match, lay and buy', () => {
    // Lay pays w:6 on the strict machine; buy pays 6:w. Both floor wins to the cent.
    const pays: Readonly<Record<string, Readonly<Record<number, readonly [bigint, bigint]>>>> = {
      buy: { 4: [2n, 1n], 5: [3n, 2n], 6: [6n, 5n], 8: [6n, 5n], 9: [3n, 2n], 10: [2n, 1n] },
      lay: { 4: [1n, 2n], 5: [2n, 3n], 6: [5n, 6n], 8: [5n, 6n], 9: [2n, 3n], 10: [1n, 2n] },
    }
    fc.assert(
      fc.property(
        rules,
        fc.constantFrom<'buy' | 'lay'>('buy', 'lay'),
        fc.constantFrom<PointNumber>(4, 5, 6, 8, 9, 10),
        fc.integer({ min: 1, max: 600 }),
        fc.integer({ min: 0, max: 600 }),
        (rule, typeId, n, units, cut) => {
          const cfg = charging('strictBubble', typeId, rule)
          const stake = units * 100
          const [num, den] = pays[typeId]![n]!
          const winPaid = (BigInt(stake) * num) / den
          const base = (amount: number) =>
            rule.basis === 'stake' ? BigInt(amount) : (BigInt(amount) * num) / den
          const due = (amount: number) =>
            rule.timing === 'upfront' ? vigOn(base(amount), rule) : 0n

          // Placement, then a cut to `cut` units (or a take-down at 0).
          const placed = vigChange(cfg, typeId, n, 0, stake)
          expect(placed).toEqual({ charge: Number(due(stake)), refund: 0 })
          const to = Math.min(cut, units) * 100
          const refund = rule.refundOnTakeDown && to < stake ? due(stake) - due(to) : 0n
          expect(vigChange(cfg, typeId, n, stake, to, placed.charge)).toEqual({
            charge: 0,
            refund: Number(refund > 0n ? refund : 0n),
          })

          // A win that stays up.
          const trace = settle(held(typeId, n, stake, placed.charge), win(n), cfg)
          const taken = (vig: bigint) => (vig < winPaid ? vig : winPaid)
          const onWin =
            rule.timing === 'onWin'
              ? taken(vigOn(rule.basis === 'stake' ? BigInt(stake) : winPaid, rule))
              : 0n
          const rearm =
            rule.timing === 'upfront' && rule.rearm === 'recollectFromWin' ? taken(due(stake)) : 0n
          expect(trace).toMatchObject({
            winPaid: Number(winPaid),
            vigOnWin: Number(onWin),
            vigRearm: Number(rearm),
            credited: Number(winPaid - onWin - rearm),
          })
        },
      ),
      { seed: 20261028, numRuns: 300 },
    )
  })
})
