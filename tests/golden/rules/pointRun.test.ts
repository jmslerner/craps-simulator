import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { strictBubble } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../../src/engine/config/schema.ts'
import type { Dice, Total } from '../../../src/engine/core/dice.ts'
import { pointRunProgress } from '../../../src/engine/bets/families/pointRun.ts'
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

// The Lucky Shooter rule table (family pointRun), written from docs/rules/rules-spec.md §2.6 and
// §6.3 (PA §623c.2, MD, Interblock): on the come-out, 2, 3 or 12 lose, 7 or 11 push with the bet
// staying up (§0.2 #8), and a box number becomes the Lucky Shooter point P. Each later roll of a
// box number not yet hit and not P adds a hit; any other roll (2, 3, 7, 11, 12, P, or a repeat
// where the repeat rule applies) settles with k hits; after 5 hits the next roll settles: P pays
// the top award, anything else the 5-hit award. Pay table D ("for 1", Interblock's screen): 500 /
// 100 / 10 / 5 / 2 at 5 hits + P / 5 / 4 / 3 / 2 hits. Constants are this file's own.

const BOX: readonly PointNumber[] = [4, 5, 6, 8, 9, 10]
const CRAPS: readonly Total[] = [2, 3, 12]
const NATURALS: readonly Total[] = [7, 11]

/** Pay table D, net to 1; the top award is 5 hits followed by the point. */
const PAYS_D: Readonly<Record<number, readonly [bigint, bigint]>> = {
  2: [1n, 1n],
  3: [4n, 1n],
  4: [9n, 1n],
  5: [99n, 1n],
}
const TOP_D: readonly [bigint, bigint] = [499n, 1n]

/** Pay table A, for a machine on which 2 hits lose. */
const PAYS_A: Readonly<Record<number, readonly [bigint, bigint]>> = {
  3: [4n, 1n],
  4: [14n, 1n],
  5: [149n, 1n],
}

const bit = (n: number) => 1 << n
const maskOf = (points: readonly PointNumber[]) => points.reduce((m, n) => m | bit(n), 0)
const bits = (mask: number) => BOX.filter((n) => (mask & bit(n)) !== 0).length

interface Run {
  readonly point: PointNumber | null
  readonly hits: number
}

function expected(
  pays: Readonly<Record<number, unknown>>,
  repeatEnds: boolean,
  run: Run,
  dice: Dice,
): string {
  const total = sumOf(dice)
  const isBox = (BOX as readonly number[]).includes(total)
  if (run.point === null) {
    if (CRAPS.includes(total)) return 'lose'
    if (NATURALS.includes(total)) return 'push:bar'
    return isBox ? `progress:${pointRunProgress(total as PointNumber, 0)}` : 'none'
  }
  const count = bits(run.hits)
  const settle = (top: boolean) => (top || count in pays ? 'win:return' : 'lose')
  if (total === run.point) return settle(count >= BOX.length - 1)
  if (count >= BOX.length - 1) return settle(false)
  if (isBox) {
    if ((run.hits & bit(total)) === 0) {
      return `progress:${pointRunProgress(run.point, run.hits | bit(total))}`
    }
    return repeatEnds ? settle(false) : 'none'
  }
  return settle(false)
}

/** The strict machine's Lucky Shooter with its repeat rule or pay table changed. */
function strictWith(
  edit: (shooter: Extract<MachineConfigInput['sideBets'][string], { family: 'pointRun' }>) => void,
  id: string,
): MachineConfig {
  const input: MachineConfigInput = structuredClone(strictBubble)
  input.id = id
  const shooter = input.sideBets.luckyShooter
  if (shooter?.family !== 'pointRun') throw new Error('strictBubble has no Lucky Shooter')
  edit(shooter)
  return machine(input)
}

const MACHINES = [
  {
    name: 'strictBubble (D, repeats end the bet)',
    cfg: machine(strictBubble),
    pays: PAYS_D,
    repeatEnds: true,
  },
  {
    name: 'repeats do not end the bet',
    cfg: strictWith((s) => (s.repeatEndsBet = false), 'strictRepeatFree'),
    pays: PAYS_D,
    repeatEnds: false,
  },
  {
    name: 'pay table A (2 hits lose)',
    cfg: strictWith((s) => {
      s.payTable = { '3': '5 for 1', '4': '15 for 1', '5': '150 for 1' }
      s.topAward = '1000 for 1'
    }, 'strictTableA'),
    pays: PAYS_A,
    repeatEnds: true,
  },
] as const

/** Every run worth a table: before the point, then each point with 0, 1, 4 and all 5 hits. */
function runs(): Run[] {
  const out: Run[] = [{ point: null, hits: 0 }]
  for (const point of BOX) {
    const others = BOX.filter((n) => n !== point)
    out.push({ point, hits: 0 })
    out.push({ point, hits: bit(others[0]!) })
    out.push({ point, hits: maskOf(others.slice(0, 4)) })
    out.push({ point, hits: maskOf(others) })
  }
  return out
}

describe.each(MACHINES)('the Lucky Shooter: $name', ({ cfg, pays, repeatEnds }) => {
  it('sets its point on the come-out, counts new box numbers, and settles on anything else', () => {
    for (const run of runs()) {
      const subject = bet('luckyShooter', null, { progress: pointRunProgress(run.point, run.hits) })
      const got = departures(
        (dice) => expected(pays, repeatEnds, run, dice),
        (dice) => outcome(decide(cfg, subject, rollContext(cfg, roundAt(run.point), dice))),
      )
      expect(got, `point ${String(run.point)} hits ${run.hits}`).toEqual([])
    }
  })
})

describe('the PA examples (§623c.2)', () => {
  const cfg = machine(strictBubble)
  const roll = (run: Run, dice: Dice) =>
    outcome(
      decide(
        cfg,
        bet('luckyShooter', null, { progress: pointRunProgress(run.point, run.hits) }),
        rollContext(cfg, roundAt(run.point), dice),
      ),
    )

  it('(i) point 9, then 10, 4, 6, 10: the repeat settles it with 3 hits', () => {
    expect(roll({ point: null, hits: 0 }, { d1: 4, d2: 5 })).toBe(
      `progress:${pointRunProgress(9, 0)}`,
    )
    expect(roll({ point: 9, hits: 0 }, { d1: 5, d2: 5 })).toBe(
      `progress:${pointRunProgress(9, bit(10))}`,
    )
    expect(roll({ point: 9, hits: bit(10) }, { d1: 1, d2: 3 })).toBe(
      `progress:${pointRunProgress(9, bit(10) | bit(4))}`,
    )
    expect(roll({ point: 9, hits: bit(10) | bit(4) }, { d1: 3, d2: 3 })).toBe(
      `progress:${pointRunProgress(9, bit(10) | bit(4) | bit(6))}`,
    )
    const settled = decide(
      cfg,
      bet('luckyShooter', null, { progress: pointRunProgress(9, bit(10) | bit(4) | bit(6)) }),
      rollContext(cfg, roundAt(9), { d1: 6, d2: 4 }),
    )
    expect(settled).toEqual({ kind: 'win', payKey: '3', stake: 'return' })
  })

  it('(iii) point 6, then 9, then 6: the point before 2 hits loses', () => {
    expect(roll({ point: 6, hits: 0 }, { d1: 4, d2: 5 })).toBe(
      `progress:${pointRunProgress(6, bit(9))}`,
    )
    expect(roll({ point: 6, hits: bit(9) }, { d1: 3, d2: 3 })).toBe('lose')
  })

  it('(ii) all five others, then the point: the top award; anything else the 5-hit award', () => {
    const five = maskOf([4, 5, 8, 9, 10])
    const top = decide(
      cfg,
      bet('luckyShooter', null, { progress: pointRunProgress(6, five) }),
      rollContext(cfg, roundAt(6), { d1: 3, d2: 3 }),
    )
    expect(top).toEqual({ kind: 'win', payKey: 'top', stake: 'return' })
    for (const dice of [
      { d1: 5, d2: 6 },
      { d1: 1, d2: 1 },
      { d1: 3, d2: 4 },
      { d1: 2, d2: 2 },
    ] as const) {
      const other = decide(
        cfg,
        bet('luckyShooter', null, { progress: pointRunProgress(6, five) }),
        rollContext(cfg, roundAt(6), dice),
      )
      expect(other, `${dice.d1}-${dice.d2}`).toEqual({ kind: 'win', payKey: '5', stake: 'return' })
    }
  })
})

describe('pays and checks', () => {
  const cfg = machine(strictBubble)
  const { family, type } = requireBet(cfg, 'luckyShooter')

  it('pays table D by hits, and the top award for 5 hits plus the point', () => {
    for (const [hits, [num, den]] of Object.entries(PAYS_D)) {
      const ratio = family.payout(type, hits)
      expect([ratio.num, ratio.den], `${hits} hits`).toEqual([num, den])
    }
    const top = family.payout(type, 'top')
    expect([top.num, top.den]).toEqual([...TOP_D])
    expect(() => family.payout(type, '1')).toThrow(RangeError)
    expect(() => family.payout(type, '0')).toThrow(RangeError)
  })

  it('always works, follows the round, and is never switched OFF', () => {
    expect(family.toggleable).toBe(false)
    expect(family.decidesWhenOff).toBe(false)
    expect(family.projection).toBe('round')
    expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg)).toBe(true)
    expect(family.defaultWorking({ kind: 'point', point: 6 }, type, cfg)).toBe(true)
  })

  it('keeps a bet up through a push or a hit, and takes down a settled one', () => {
    const subject = bet('luckyShooter', null)
    const ctx = rollContext(cfg, roundAt(null), { d1: 5, d2: 6 })
    const after = (decision: Parameters<typeof family.apply>[1]) =>
      family.apply(subject, decision, ctx, type)
    expect(after({ kind: 'push', reason: 'bar' })).toBe(subject)
    expect(after({ kind: 'progress', progress: pointRunProgress(6, 0) })).toMatchObject({
      progress: pointRunProgress(6, 0),
    })
    expect(after({ kind: 'win', payKey: 'top', stake: 'return' })).toBeNull()
    expect(after({ kind: 'lose' })).toBeNull()
  })

  it('flags a point that is not a box number, hits on the point or off the box, and a run out of step with the round', () => {
    const comeOut = newTable(cfg, 'shooter')
    const onSix = { ...comeOut, round: roundAt(6) }
    expect(family.invariants?.(bet('luckyShooter', null), comeOut, type, cfg)).toEqual([])
    expect(
      family.invariants?.(
        bet('luckyShooter', null, { progress: pointRunProgress(6, bit(4)) }),
        onSix,
        type,
        cfg,
      ),
    ).toEqual([])
    expect(
      family.invariants?.(
        bet('luckyShooter', null, { progress: pointRunProgress(6, bit(6)) }),
        onSix,
        type,
        cfg,
      ),
    ).toEqual([expect.stringMatching(/its own point/)])
    expect(
      family.invariants?.(
        bet('luckyShooter', null, { progress: pointRunProgress(6, bit(11)) }),
        onSix,
        type,
        cfg,
      ),
    ).toEqual([expect.stringMatching(/not box numbers/)])
    expect(
      family.invariants?.(
        bet('luckyShooter', null, { progress: pointRunProgress(6, 0) }),
        comeOut,
        type,
        cfg,
      ),
    ).toEqual([expect.stringMatching(/the round's point/)])
    expect(
      family.invariants?.(
        bet('luckyShooter', null, { progress: pointRunProgress(11, 0) }),
        { ...comeOut, round: roundAt(11) },
        type,
        cfg,
      ),
    ).toEqual([expect.stringMatching(/not a box number/)])
    expect(
      family.invariants?.(bet('luckyShooter', null, { progress: bit(4) }), comeOut, type, cfg),
    ).toEqual([expect.stringMatching(/hits before its point/)])
  })

  it('reads the come-out lists, its box numbers, pays, repeat rule, window and removability', () => {
    expect(family.configPaths(type, null, cfg)).toEqual([
      '/rules/craps',
      '/rules/naturals',
      '/sideBets/luckyShooter/points',
      '/sideBets/luckyShooter/payTable',
      '/sideBets/luckyShooter/topAward',
      '/sideBets/luckyShooter/repeatEndsBet',
      '/sideBets/luckyShooter/placement',
      '/sideBets/luckyShooter/removableBeforePoint',
      '/money/payoutRounding',
    ])
  })
})
