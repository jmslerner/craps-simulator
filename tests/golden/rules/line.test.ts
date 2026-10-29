import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { PRESETS, type PresetId } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { LineTypeConfig } from '../../../src/engine/config/schema.ts'
import { resolveType } from '../../../src/engine/bets/registry.ts'
import {
  bet,
  decide,
  machine,
  mismatches,
  outcome,
  renoMachine,
  rollContext,
  roundAt,
} from './support.ts'

// The line-bet rule table: pass, come, don't pass and don't come on every roll, written from
// docs/rules/rules-spec.md §2.2 (decisions by event), §3.1 (line bets) and §3.5 (crapless), with
// research core.md §2.2's first-roll table. Its constants are its own: nothing here reads the
// engine's rulesets. Each case checks all 36 rolls.

const TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const
const POINTS = {
  traditional: [4, 5, 6, 8, 9, 10],
  crapless: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
} as const satisfies Record<string, readonly PointNumber[]>

type Variant = keyof typeof POINTS
type AfterWin = LineTypeConfig['afterWin']
type Table = Record<number, string>

/**
 * Whether a winner's stake stays up (rules spec §5.1 `afterWin`): `stayIfFirstRoll` is a don't
 * bet that won before it had a number; `stayIf11` a come bet that won on 11 in the come box.
 */
function after(rule: AfterWin, firstRoll: boolean, total: number): string {
  const stays =
    rule === 'stay' ||
    (rule === 'stayIfFirstRoll' && firstRoll) ||
    (rule === 'stayIf11' && firstRoll && total === 11)
  return `win:${stays ? 'stay' : 'return'}`
}

/** A pass bet on the come-out, or a come bet's first roll (§2.2; core.md §2.2). */
function doFirstRoll(variant: Variant, afterWin: AfterWin): Table {
  const naturals: readonly number[] = variant === 'crapless' ? [7] : [7, 11]
  const craps: readonly number[] = variant === 'crapless' ? [] : [2, 3, 12]
  return Object.fromEntries(
    TOTALS.map((t) => [
      t,
      naturals.includes(t) ? after(afterWin, true, t) : craps.includes(t) ? 'lose' : `travel:${t}`,
    ]),
  )
}

/** A don't pass bet on the come-out, or a don't come bet's first roll: the barred total pushes. */
function dontFirstRoll(bar: 2 | 12, afterWin: AfterWin): Table {
  return Object.fromEntries(
    TOTALS.map((t) => {
      if (t === bar) return [t, 'push:bar']
      if (t === 2 || t === 3 || t === 12) return [t, after(afterWin, true, t)]
      if (t === 7 || t === 11) return [t, 'lose']
      return [t, `travel:${t}`]
    }),
  )
}

/** Pass or come on N: N wins, 7 loses, anything else does nothing. */
function doOnNumber(n: PointNumber, afterWin: AfterWin): Table {
  return Object.fromEntries(
    TOTALS.map((t) => [t, t === n ? after(afterWin, false, t) : t === 7 ? 'lose' : 'none']),
  )
}

/** Don't pass or don't come on N: 7 wins, N loses, anything else does nothing. */
function dontOnNumber(n: PointNumber, afterWin: AfterWin): Table {
  return Object.fromEntries(
    TOTALS.map((t) => [t, t === 7 ? after(afterWin, false, t) : t === n ? 'lose' : 'none']),
  )
}

/** The rolls on which `subject` departs from `table`, with the round at `point`. */
function check(
  cfg: MachineConfig,
  subject: ReturnType<typeof bet>,
  point: PointNumber | null,
  table: Table,
): string[] {
  const before = roundAt(point)
  return mismatches(table, (dice) => outcome(decide(cfg, subject, rollContext(cfg, before, dice))))
}

function afterWinOf(cfg: MachineConfig, typeId: string): AfterWin {
  const type = cfg.input.catalog[typeId]
  if (type?.family !== 'line') throw new Error(`${cfg.id} has no line type ${typeId}`)
  return type.afterWin
}

/** Another point than `n`, for a come bet on n while the pass point is elsewhere. */
const otherPoint = (variant: Variant, n: PointNumber) => POINTS[variant].find((p) => p !== n)!

interface Machine {
  readonly name: string
  readonly cfg: MachineConfig
  readonly variant: Variant
  /** The don't bar, for machines with don't bets. */
  readonly bar: 2 | 12 | null
}

const MACHINES: readonly Machine[] = [
  { name: 'craplessBubble', cfg: machine('craplessBubble'), variant: 'crapless', bar: null },
  { name: 'traditionalBubble', cfg: machine('traditionalBubble'), variant: 'traditional', bar: 12 },
  { name: 'strictBubble', cfg: machine('strictBubble'), variant: 'traditional', bar: 12 },
  {
    name: 'traditionalLive345',
    cfg: machine('traditionalLive345'),
    variant: 'traditional',
    bar: 12,
  },
  { name: 'Reno (bar 2)', cfg: renoMachine(), variant: 'traditional', bar: 2 },
]

describe.each(MACHINES)('line bets on $name', ({ cfg, variant, bar }) => {
  const points = POINTS[variant]

  it('pass: the come-out', () => {
    const table = doFirstRoll(variant, afterWinOf(cfg, 'pass'))
    expect(check(cfg, bet('pass', null), null, table)).toEqual([])
  })

  it('pass: on each point, the point wins and 7 loses', () => {
    for (const n of points) {
      const table = doOnNumber(n, afterWinOf(cfg, 'pass'))
      expect(check(cfg, bet('pass', n), n, table), `point ${n}`).toEqual([])
    }
  })

  it("come: its first roll, whatever the pass point, decides like the pass line's come-out", () => {
    const table = doFirstRoll(variant, afterWinOf(cfg, 'come'))
    for (const p of points) {
      expect(check(cfg, bet('come', null), p, table), `pass point ${p}`).toEqual([])
    }
  })

  it('come: on N, N wins and 7 loses, in the point phase and on the come-out', () => {
    for (const n of points) {
      const table = doOnNumber(n, afterWinOf(cfg, 'come'))
      const pointPhase = check(cfg, bet('come', n), otherPoint(variant, n), table)
      expect(pointPhase, `come on ${n}, point phase`).toEqual([])
      expect(check(cfg, bet('come', n), null, table), `come on ${n}, come-out`).toEqual([])
    }
  })

  if (bar === null) {
    it("offers no don't bets: crapless has nothing to bar (§3.5)", () => {
      const sides = [...cfg.catalog.values()].flatMap((t) => (t.family === 'line' ? [t.side] : []))
      expect(sides).not.toContain('dont')
      expect(resolveType(cfg, 'dontPass')).toBeNull()
      expect(resolveType(cfg, 'dontCome')).toBeNull()
    })
    return
  }

  it(`don't pass: the come-out, bar ${bar}`, () => {
    const table = dontFirstRoll(bar, afterWinOf(cfg, 'dontPass'))
    expect(check(cfg, bet('dontPass', null), null, table)).toEqual([])
  })

  it("don't pass: on each point, 7 wins and the point loses", () => {
    for (const n of points) {
      const table = dontOnNumber(n, afterWinOf(cfg, 'dontPass'))
      expect(check(cfg, bet('dontPass', n), n, table), `point ${n}`).toEqual([])
    }
  })

  it(`don't come: its first roll, whatever the pass point, bar ${bar}`, () => {
    const table = dontFirstRoll(bar, afterWinOf(cfg, 'dontCome'))
    for (const p of points) {
      expect(check(cfg, bet('dontCome', null), p, table), `pass point ${p}`).toEqual([])
    }
  })

  it("don't come: on N, 7 wins and N loses, in the point phase and on the come-out", () => {
    for (const n of points) {
      const table = dontOnNumber(n, afterWinOf(cfg, 'dontCome'))
      const pointPhase = check(cfg, bet('dontCome', n), otherPoint(variant, n), table)
      expect(pointPhase, `don't come on ${n}, point phase`).toEqual([])
      expect(check(cfg, bet('dontCome', n), null, table), `don't come on ${n}, come-out`).toEqual(
        [],
      )
    }
  })
})

describe('line bets: the same roll decides each bet on its own (rules spec §0.2 #12)', () => {
  it('a come bet on 6 wins while the come box travels to 6', () => {
    const cfg = machine('craplessBubble')
    const before = roundAt(8)
    const ctx = rollContext(cfg, before, { d1: 2, d2: 4 })
    expect(outcome(decide(cfg, bet('come', 6, { seq: 1 }), ctx))).toBe('win:return')
    expect(outcome(decide(cfg, bet('come', null, { seq: 2 }), ctx))).toBe('travel:6')
  })

  it('a come-out 7 wins the pass line and loses every come bet on a number (§2.2)', () => {
    const cfg = machine('craplessBubble')
    const ctx = rollContext(cfg, roundAt(null), { d1: 3, d2: 4 })
    expect(outcome(decide(cfg, bet('pass', null), ctx))).toBe('win:stay')
    for (const n of POINTS.crapless) expect(outcome(decide(cfg, bet('come', n), ctx))).toBe('lose')
  })

  it("a seven-out wins the come box and the don't side, and loses pass and come points", () => {
    const cfg = machine('strictBubble')
    const ctx = rollContext(cfg, roundAt(5), { d1: 6, d2: 1 })
    expect(outcome(decide(cfg, bet('pass', 5), ctx))).toBe('lose')
    expect(outcome(decide(cfg, bet('come', 9), ctx))).toBe('lose')
    expect(outcome(decide(cfg, bet('come', null), ctx))).toBe('win:return')
    expect(outcome(decide(cfg, bet('dontPass', 5), ctx))).toBe('win:stay')
    expect(outcome(decide(cfg, bet('dontCome', 9), ctx))).toBe('win:return')
    expect(outcome(decide(cfg, bet('dontCome', null), ctx))).toBe('lose')
  })
})

describe('after a win, the line bets follow each machine (rules spec §5.2 afterWin)', () => {
  const rules = (id: PresetId) =>
    Object.fromEntries(
      Object.entries(PRESETS[id].catalog).flatMap(([typeId, type]) =>
        type.family === 'line' ? [[typeId, type.afterWin]] : [],
      ),
    )

  it("Shoot To Win: pass stays, come stays on 11, don't bets stay after a first-roll win", () => {
    expect(rules('traditionalBubble')).toEqual({
      pass: 'stay',
      dontPass: 'stayIfFirstRoll',
      come: 'stayIf11',
      dontCome: 'stayIfFirstRoll',
    })
  })

  it('Interblock crapless: a winning pass is pushed to the next round; come is returned', () => {
    expect(rules('craplessBubble')).toEqual({ pass: 'stay', come: 'return' })
  })

  it('the strict machine and the live table: pass stays, come is returned', () => {
    for (const id of ['strictBubble', 'traditionalLive345'] as const) {
      expect(rules(id)).toMatchObject({ pass: 'stay', come: 'return' })
    }
  })
})
