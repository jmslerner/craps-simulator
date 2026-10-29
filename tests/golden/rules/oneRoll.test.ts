import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import { craplessBubble, type PresetId } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { requireType } from '../../../src/engine/bets/registry.ts'
import { newTable } from '../../../src/engine/table/state.ts'
import { ALL_DICE, bet, decide, machine, rollContext, roundAt, sumOf } from './support.ts'

// The one-roll rule table, written from docs/rules/rules-spec.md §3.4 (what each one-roll bet wins
// on and pays, the net-per-unit oracle table, and the hops each machine offers), §0.1 ("x for 1"
// nets (x−1):1), §2.4 (one-roll bets always work) and §5.2 (Shoot To Win re-bets one-roll winners,
// CW §32; Interblock and live tables return them, §9 #19). Its constants are its own.

/** Net pay per unit staked, by winning total (§3.4); every other total loses the bet. */
type NetByTotal = Readonly<Partial<Record<number, number>>>

/** The field on machines: 2:1 on 2 and 12 (CW, IB) … */
const FIELD_2_2: NetByTotal = { 2: 2, 3: 1, 4: 1, 9: 1, 10: 1, 11: 1, 12: 2 }
/** … and at live Las Vegas tables: 3:1 on 12. */
const FIELD_2_3: NetByTotal = { ...FIELD_2_2, 12: 3 }
const ANY_SEVEN: NetByTotal = { 7: 4 }
const ANY_CRAPS: NetByTotal = { 2: 7, 3: 7, 12: 7 }
const ELEVEN: NetByTotal = { 11: 15 }
const TWO: NetByTotal = { 2: 30 }
const THREE: NetByTotal = { 3: 15 }
const TWELVE: NetByTotal = { 12: 30 }

/** Every hop: low face first, 15 easy and 6 hard. */
const ALL_HOPS: readonly (readonly [number, number])[] = [1, 2, 3, 4, 5, 6].flatMap((lo) =>
  [1, 2, 3, 4, 5, 6].filter((hi) => hi >= lo).map((hi) => [lo, hi] as const),
)
/** Interblock: no 1-2 or 5-6 hop, and hard hops 2-2 to 5-5 only; the rest are horn singles. */
const IB_HOPS = ALL_HOPS.filter(([lo, hi]) => !['1-1', '1-2', '5-6', '6-6'].includes(`${lo}-${hi}`))

interface OneRollMachine {
  readonly name: PresetId
  /** The machine's one-roll bets by type id, with what each pays (§3.4, §5.2). */
  readonly bets: Readonly<Record<string, NetByTotal>>
  readonly hops: readonly (readonly [number, number])[]
  /** Whether a winner stays up for the next roll (§3.4: STW, CW §32) or comes back. */
  readonly stake: 'stay' | 'return'
}

const IB_PROPS = {
  field: FIELD_2_2,
  any7: ANY_SEVEN,
  anyCraps: ANY_CRAPS,
  c: ANY_CRAPS,
  e: ELEVEN,
  snakeEyes: TWO,
  aceDeuce: THREE,
  yo: ELEVEN,
  boxcars: TWELVE,
}

const MACHINES: readonly OneRollMachine[] = [
  { name: 'craplessBubble', bets: IB_PROPS, hops: IB_HOPS, stake: 'return' },
  {
    name: 'traditionalBubble',
    bets: {
      field: FIELD_2_2,
      any7: ANY_SEVEN,
      anyCraps: ANY_CRAPS,
      c: ANY_CRAPS,
      e: ELEVEN,
      horn2: TWO,
      horn3: THREE,
      horn11: ELEVEN,
      horn12: TWELVE,
    },
    hops: ALL_HOPS,
    stake: 'stay',
  },
  { name: 'strictBubble', bets: IB_PROPS, hops: IB_HOPS, stake: 'return' },
  {
    name: 'traditionalLive345',
    bets: {
      field: FIELD_2_3,
      any7: ANY_SEVEN,
      anyCraps: ANY_CRAPS,
      c: ANY_CRAPS,
      e: ELEVEN,
      aces: TWO,
      aceDeuce: THREE,
      yo: ELEVEN,
      boxcars: TWELVE,
    },
    hops: ALL_HOPS,
    stake: 'return',
  },
]

const hopId = ([lo, hi]: readonly [number, number]) => `hop${lo}${hi}`

/** A hop wins on its two faces in either order: 15:1 easy, 30:1 on a pair (§3.4). */
function hopNet([lo, hi]: readonly [number, number], dice: Dice): string {
  const hit = (dice.d1 === lo && dice.d2 === hi) || (dice.d1 === hi && dice.d2 === lo)
  return hit ? (lo === hi ? '+30' : '+15') : '-1'
}

function byTotal(table: NetByTotal, dice: Dice): string {
  const pays = table[sumOf(dice)]
  return pays === undefined ? '-1' : `+${pays}`
}

/** What the bet does on `dice` from `point`: "+n" or "+n/d" net per unit, "-1", or the decision. */
function netOn(cfg: MachineConfig, typeId: string, dice: Dice, point: PointNumber | null): string {
  const decision = decide(cfg, bet(typeId, null), rollContext(cfg, roundAt(point), dice))
  if (decision.kind === 'lose') return '-1'
  if (decision.kind !== 'win') return decision.kind
  const { family, type } = requireType(cfg, typeId)
  const { num, den } = family.payout(type, decision.payKey)
  return den === 1n ? `+${num}` : `+${num}/${den}`
}

/** The rolls, from the come-out and with a point on, where the bet departs from `want`. */
function departures(cfg: MachineConfig, typeId: string, want: (dice: Dice) => string): string[] {
  return [null, 6 as const].flatMap((point) =>
    ALL_DICE.flatMap((dice) => {
      const [w, a] = [want(dice), netOn(cfg, typeId, dice, point)]
      return w === a ? [] : [`${dice.d1}-${dice.d2} (point ${String(point)}): ${w} ≠ ${a}`]
    }),
  )
}

describe.each(MACHINES)('one-roll bets on $name', ({ name, bets, hops, stake }) => {
  const cfg = machine(name)

  it(`the field table for every total, ${name === 'traditionalLive345' ? '2:1/3:1' : '2:1/2:1'}`, () => {
    expect(departures(cfg, 'field', (dice) => byTotal(bets.field ?? {}, dice))).toEqual([])
  })

  it.each(Object.keys(bets).filter((id) => id !== 'field'))('%s', (typeId) => {
    expect(departures(cfg, typeId, (dice) => byTotal(bets[typeId] ?? {}, dice))).toEqual([])
  })

  it(`${hops.length} hops, each won on its own dice in either order`, () => {
    for (const hop of hops) {
      expect(
        departures(cfg, hopId(hop), (dice) => hopNet(hop, dice)),
        hopId(hop),
      ).toEqual([])
    }
  })

  it('offers no other one-roll bets', () => {
    const offered = [...cfg.catalog.values()].filter((t) => t.family === 'oneRoll')
    expect(offered.map((t) => t.typeId).sort()).toEqual(
      [...Object.keys(bets), ...hops.map(hopId)].sort(),
    )
  })

  it(`a winner ${stake === 'stay' ? 'stays up for the next roll' : 'comes back'} (§3.4, §9 #19)`, () => {
    for (const typeId of [...Object.keys(bets), ...hops.map(hopId)]) {
      const decision = decide(
        cfg,
        bet(typeId, null),
        rollContext(cfg, roundAt(null), winningRoll(cfg, typeId)),
      )
      expect(decision, typeId).toMatchObject({ kind: 'win', stake })
    }
  })

  it('always works and cannot be switched OFF (§2.4)', () => {
    const { family, type } = requireType(cfg, 'field')
    expect(family.toggleable).toBe(false)
    expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg)).toBe(true)
  })
})

describe('the acceptance cases (plan §10 M4c)', () => {
  it('hop 1-2 matches both orders and a hard hop only its pair', () => {
    for (const name of ['traditionalBubble', 'traditionalLive345'] as const) {
      const cfg = machine(name)
      const at = (typeId: string, d1: Dice['d1'], d2: Dice['d2']) =>
        netOn(cfg, typeId, { d1, d2 }, null)
      expect([at('hop12', 1, 2), at('hop12', 2, 1), at('hop12', 1, 1), at('hop12', 3, 4)]).toEqual([
        '+15',
        '+15',
        '-1',
        '-1',
      ])
      // 3-3 wins hard hop 3-3; 1-5, 5-1, 2-4 and 4-2 make 6 too and lose it.
      expect(
        [
          [3, 3],
          [1, 5],
          [5, 1],
          [2, 4],
          [4, 2],
        ].map(([d1, d2]) => at('hop33', d1 as Dice['d1'], d2 as Dice['d2'])),
        name,
      ).toEqual(['+30', '-1', '-1', '-1', '-1'])
    }
    // Interblock has no 1-2 hop: its Ace-Deuce horn single takes 1-2 either way, as a 3.
    const ib = machine('craplessBubble')
    expect(() => requireType(ib, 'hop12')).toThrow()
    expect([
      netOn(ib, 'aceDeuce', { d1: 1, d2: 2 }, null),
      netOn(ib, 'aceDeuce', { d1: 2, d2: 1 }, null),
    ]).toEqual(['+15', '+15'])
  })

  it('"15 for 1" pays 14:1 net and "30 for 1" pays 29:1, keeping the wording', () => {
    const input = structuredClone(craplessBubble)
    input.id = 'craplessForOne'
    const e = input.catalog.e
    const snakeEyes = input.catalog.snakeEyes
    if (e?.family !== 'oneRoll' || snakeEyes?.family !== 'oneRoll') throw new Error('no props')
    e.pays = { '11': '15 for 1' }
    snakeEyes.pays = { '2': '30 for 1' }
    // The horn singles must still agree with the other horn parts on after-win and rounding,
    // which they do; their pays may differ.
    const cfg = machine(input)
    expect(netOn(cfg, 'e', { d1: 5, d2: 6 }, null)).toBe('+14')
    expect(netOn(cfg, 'snakeEyes', { d1: 1, d2: 1 }, null)).toBe('+29')
    const { family, type } = requireType(cfg, 'e')
    expect(family.payout(type, '11')).toEqual({ num: 14n, den: 1n, label: '15 for 1' })
    const horn = requireType(cfg, 'snakeEyes')
    expect(horn.family.payout(horn.type, '2')).toEqual({ num: 29n, den: 1n, label: '30 for 1' })
  })

  it('Interblock posts props "for 1" and pays the same nets as "to 1" tables', () => {
    const cfg = machine('craplessBubble')
    const labelled = (typeId: string, key: string) => {
      const { family, type } = requireType(cfg, typeId)
      const { num, den, label } = family.payout(type, key)
      return `${label} = ${num}:${den}`
    }
    expect([
      labelled('any7', '7'),
      labelled('anyCraps', '12'),
      labelled('e', '11'),
      labelled('boxcars', '12'),
      labelled('hop25', '2-5'),
      labelled('hop44', '4-4'),
    ]).toEqual([
      '5 for 1 = 4:1',
      '8 for 1 = 7:1',
      '16 for 1 = 15:1',
      '31 for 1 = 30:1',
      '16 for 1 = 15:1',
      '31 for 1 = 30:1',
    ])
  })
})

describe("the family's own checks", () => {
  it('pays only listed outcomes, and flags a one-roll bet on a number, behind a bet or stale', () => {
    const cfg = machine('craplessBubble')
    const { family, type } = requireType(cfg, 'field')
    expect(() => family.payout(type, '7')).toThrow(RangeError)
    const table = newTable(cfg, 'spot')
    expect(family.invariants?.(bet('field', null), table, type, cfg)).toEqual([])
    expect(family.invariants?.(bet('field', 6), table, type, cfg)).toEqual([
      expect.stringMatching(/takes no number/),
    ])
    const backing = bet('field', null, { parent: bet('pass', 6) })
    expect(family.invariants?.(backing, table, type, cfg)).toEqual([
      expect.stringMatching(/backs b1/),
    ])
    // A field placed for roll 0 cannot still be up at roll 3 where winners come back …
    const later = { ...table, round: { ...table.round, rollIndex: 3 } }
    expect(family.invariants?.(bet('field', null), later, type, cfg)).toEqual([
      expect.stringMatching(/placed for roll 0 and is still up/),
    ])
    // … but it can where winners ride.
    const stw = machine('traditionalBubble')
    const riding = requireType(stw, 'field')
    const stwLater = { ...newTable(stw, 'spot'), round: later.round }
    expect(riding.family.invariants?.(bet('field', null), stwLater, riding.type, stw)).toEqual([])
  })

  it('a spot bet stays up only after a win or a zero-net push that rides', () => {
    const cfg = machine('traditionalBubble')
    const { family, type } = requireType(cfg, 'field')
    const subject = bet('field', null)
    const ctx = rollContext(cfg, roundAt(null), { d1: 1, d2: 1 })
    const after = (decision: Parameters<typeof family.apply>[1]) =>
      family.apply(subject, decision, ctx, type)
    expect(after({ kind: 'win', payKey: '2', stake: 'stay' })).toBe(subject)
    expect(after({ kind: 'win', payKey: '2', stake: 'return' })).toBeNull()
    expect(after({ kind: 'push', reason: 'zeroNet', stake: 'stay' })).toBe(subject)
    expect(after({ kind: 'push', reason: 'zeroNet', stake: 'return' })).toBeNull()
    expect(after({ kind: 'push', reason: 'bar' })).toBeNull()
    expect(after({ kind: 'lose' })).toBeNull()
    expect(after({ kind: 'none' })).toBe(subject)
  })
})

describe('what a one-roll bet reads from the config', () => {
  it('how it matches, its pays, after-win and rounding', () => {
    const cfg = machine('craplessBubble')
    const { family, type } = requireType(cfg, 'hop25')
    expect(family.configPaths(type, null, cfg)).toEqual([
      '/catalog/hop25/match',
      '/catalog/hop25/pays',
      '/catalog/hop25/afterWin',
      '/money/payoutRounding',
    ])
  })
})

/** A roll that wins `typeId`: the first of the 36 with a pay. */
function winningRoll(cfg: MachineConfig, typeId: string): Dice {
  const { type } = requireType(cfg, typeId)
  if (type.family !== 'oneRoll') throw new Error(`${typeId} is not a one-roll bet`)
  const roll = ALL_DICE.find((dice) => {
    const lo = Math.min(dice.d1, dice.d2)
    const hi = Math.max(dice.d1, dice.d2)
    return type.pays.has(type.match === 'total' ? String(sumOf(dice)) : `${lo}-${hi}`)
  })
  if (roll === undefined) throw new Error(`${typeId} wins on no roll`)
  return roll
}
