import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { craplessBubble, traditionalLive345 } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../../src/engine/config/schema.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { requireBet } from '../../../src/engine/bets/registry.ts'
import { newTable } from '../../../src/engine/table/state.ts'
import {
  bet,
  decide,
  departures,
  machine,
  outcome,
  rollContext,
  roundAt,
  sumOf,
} from './support.ts'

// The Fire Bet rule table (family uniquePointsMade), written from docs/rules/rules-spec.md §2.6,
// §6.6 and research sidebets.md §5: the bet counts the distinct points the hand both sets and
// makes, among the points that count; repeating a point adds nothing; come-out naturals and craps
// do nothing; it is paid once, by the count, at the seven-out (pay table A: 24, 249 and 999 to 1
// at 4, 5 and 6 points), or at once on the 6th point where a house pays immediately. Crapless: all
// ten points count, or only 4–10 (§0.2 #13). Constants are this file's own.

const BOX: readonly PointNumber[] = [4, 5, 6, 8, 9, 10]
const CRAPLESS_POINTS: readonly PointNumber[] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
const PAYS: Readonly<Record<number, readonly [bigint, bigint]>> = {
  4: [24n, 1n],
  5: [249n, 1n],
  6: [999n, 1n],
}

const bit = (n: number) => 1 << n
const bits = (mask: number) => CRAPLESS_POINTS.filter((n) => (mask & bit(n)) !== 0).length
const maskOf = (points: readonly PointNumber[]) => points.reduce((m, n) => m | bit(n), 0)

/**
 * §6.6: with a point on, its total makes it (a new counted point progresses; a repeat does
 * nothing); a 7 settles by the count; the come-out decides nothing.
 */
function expected(
  counted: readonly PointNumber[],
  payNow: number | null,
  progress: number,
  point: PointNumber | null,
  dice: Dice,
): string {
  const total = sumOf(dice)
  if (point === null) return 'none'
  if (total === 7) return bits(progress) in PAYS ? 'win:return' : 'lose'
  if (total !== point || !counted.includes(point)) return 'none'
  if ((progress & bit(point)) !== 0) return 'none'
  const next = progress | bit(point)
  if (payNow !== null && bits(next) >= payNow) return 'win:return'
  return `progress:${next}`
}

/** A crapless machine with a Fire Bet counting `counted`, under its own id. */
function craplessFire(
  counted: readonly PointNumber[],
  payImmediatelyAt: number | null,
): MachineConfig {
  const input: MachineConfigInput = structuredClone(craplessBubble)
  input.id = `craplessFire${counted.length}${payImmediatelyAt ?? ''}`
  input.sideBets.fire = {
    family: 'uniquePointsMade',
    label: 'Fire Bet',
    countedPoints: [...counted],
    payTable: { '4': '24:1', '5': '249:1', '6': '999:1' },
    payImmediatelyAt,
    placement: 'newHand',
  }
  input.provenance['/sideBets/fire'] = {
    status: 'assumed',
    note: 'A test machine: the live Fire Bet carried onto a crapless layout (rules spec §0.2 #13).',
  }
  return machine(input)
}

const MACHINES: readonly {
  name: string
  cfg: MachineConfig
  counted: readonly PointNumber[]
  points: readonly PointNumber[]
  payNow: number | null
}[] = [
  { name: 'live, 4-10', cfg: machine(traditionalLive345), counted: BOX, points: BOX, payNow: null },
  {
    name: 'crapless, all ten',
    cfg: craplessFire(CRAPLESS_POINTS, null),
    counted: CRAPLESS_POINTS,
    points: CRAPLESS_POINTS,
    payNow: null,
  },
  {
    name: 'crapless, 4-10 only',
    cfg: craplessFire(BOX, null),
    counted: BOX,
    points: CRAPLESS_POINTS,
    payNow: null,
  },
  {
    name: 'live, paid at once on the 6th',
    cfg: machine(traditionalLive345),
    counted: BOX,
    points: BOX,
    payNow: 6,
  },
].map((m) =>
  m.payNow === null
    ? m
    : {
        ...m,
        cfg: (() => {
          const input: MachineConfigInput = structuredClone(traditionalLive345)
          input.id = 'livePayNow'
          const fire = input.sideBets.fire
          if (fire?.family !== 'uniquePointsMade') throw new Error('the live table has no Fire Bet')
          fire.payImmediatelyAt = 6
          return machine(input)
        })(),
      },
)

describe.each(MACHINES)('the Fire Bet ($name)', ({ cfg, counted, points, payNow }) => {
  const progresses = [
    0,
    bit(4),
    maskOf([4, 5, 6]),
    maskOf([4, 5, 6, 8]),
    maskOf([4, 5, 6, 8, 9]),
    maskOf([2, 12]),
    maskOf([2, 3, 11]),
  ].filter((mask) => (mask & ~maskOf(counted)) === 0)

  it('counts a new point once, settles by the count at the seven-out, ignores the come-out', () => {
    for (const point of [null, ...points]) {
      for (const progress of progresses) {
        const subject = bet('fire', null, { progress })
        const got = departures(
          (dice) => expected(counted, payNow, progress, point, dice),
          (dice) => outcome(decide(cfg, subject, rollContext(cfg, roundAt(point), dice))),
        )
        expect(got, `point ${String(point)} progress ${progress}`).toEqual([])
      }
    }
  })

  it('pays 24, 249 and 999 to 1 at 4, 5 and 6 points, nothing below', () => {
    const { family, type } = requireBet(cfg, 'fire')
    for (const [count, [num, den]] of Object.entries(PAYS)) {
      const ratio = family.payout(type, count)
      expect([ratio.num, ratio.den], `${count} points`).toEqual([num, den])
    }
    expect(() => family.payout(type, '3')).toThrow(RangeError)
    expect(() => family.payout(type, 'set')).toThrow(RangeError)
  })
})

describe("the family's own checks", () => {
  const cfg = machine(traditionalLive345)
  const { family, type } = requireBet(cfg, 'fire')

  it('always works, follows the round, and is never switched OFF', () => {
    expect(family.toggleable).toBe(false)
    expect(family.decidesWhenOff).toBe(false)
    expect(family.projection).toBe('round')
    expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg)).toBe(true)
    expect(family.defaultWorking({ kind: 'point', point: 6 }, type, cfg)).toBe(true)
  })

  it('keeps a progressing bet up with its new mask, and takes down a settled one', () => {
    const subject = bet('fire', null, { progress: bit(4) })
    const ctx = rollContext(cfg, roundAt(6), { d1: 3, d2: 3 })
    const after = (decision: Parameters<typeof family.apply>[1]) =>
      family.apply(subject, decision, ctx, type)
    expect(after({ kind: 'none' })).toBe(subject)
    expect(after({ kind: 'progress', progress: bit(4) | bit(6) })).toMatchObject({
      progress: bit(4) | bit(6),
    })
    expect(after({ kind: 'win', payKey: '4', stake: 'return' })).toBeNull()
    expect(after({ kind: 'lose' })).toBeNull()
  })

  it('flags points that do not count, more points than the hand made, and a paid count still up', () => {
    const table = newTable(cfg, 'fire')
    const made = {
      ...table,
      round: { ...table.round, hand: { index: 0, rolls: 4, pointsMadeMask: bit(4) | bit(5) } },
    }
    expect(family.invariants?.(bet('fire', null, { progress: bit(4) }), made, type, cfg)).toEqual(
      [],
    )
    expect(family.invariants?.(bet('fire', null, { progress: bit(2) }), made, type, cfg)).toEqual([
      expect.stringMatching(/does not count/),
      expect.stringMatching(/its hand has not made/),
    ])
    expect(family.invariants?.(bet('fire', null, { progress: bit(6) }), made, type, cfg)).toEqual([
      expect.stringMatching(/its hand has not made/),
    ])
    const payNow = MACHINES[3]!.cfg
    const nowType = requireBet(payNow, 'fire')
    const six = {
      ...newTable(payNow, 'fire'),
      round: { ...table.round, hand: { index: 0, rolls: 12, pointsMadeMask: maskOf(BOX) } },
    }
    expect(
      nowType.family.invariants?.(
        bet('fire', null, { progress: maskOf(BOX) }),
        six,
        nowType.type,
        payNow,
      ),
    ).toEqual([expect.stringMatching(/should have been paid/)])
  })

  it('reads the counted points, the pay table, the immediate pay, the window and the rounding', () => {
    expect(family.configPaths(type, null, cfg)).toEqual([
      '/sideBets/fire/countedPoints',
      '/sideBets/fire/payTable',
      '/sideBets/fire/payImmediatelyAt',
      '/sideBets/fire/placement',
      '/money/payoutRounding',
    ])
  })
})
