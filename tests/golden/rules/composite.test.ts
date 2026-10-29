import { describe, expect, it } from 'vitest'
import type { MachineConfig } from '../../../src/engine/config/compile.ts'
import {
  craplessBubble,
  traditionalLive345,
  type PresetId,
} from '../../../src/engine/config/presets/index.ts'
import type { MachineConfigInput } from '../../../src/engine/config/schema.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import { requireType } from '../../../src/engine/bets/registry.ts'
import { ALL_DICE, bet, decide, machine, rollContext, roundAt, sumOf } from './support.ts'

// The composite rule table, written from docs/rules/rules-spec.md §3.4 (C&E, horn, horn high and
// world: what each wins, and the net-per-unit oracle table), §4.1 (a composite settles as one bet
// on its whole-bet net) and plan §0 amendment 15 (one bet of the composite's id; net per unit
// = Σ(winning units × (pay + 1)) ÷ total units − 1; a net of 0 is a push; after-win from the
// parts). Its constants are its own.

/** Net per unit staked on each winning total, as [num, den]; every other total loses it all. */
type NetTable = Readonly<Partial<Record<number, readonly [bigint, bigint]>>>

/** C&E: half on any craps at 7:1, half on 11 at 15:1, so +3 on 2, 3 and 12 and +7 on 11. */
const CE: NetTable = { 2: [3n, 1n], 3: [3n, 1n], 11: [7n, 1n], 12: [3n, 1n] }
/** Horn: a quarter on each of 2 and 12 at 30:1 and 3 and 11 at 15:1: +27/4 and +3 per unit. */
const HORN: NetTable = { 2: [27n, 4n], 3: [3n, 1n], 11: [3n, 1n], 12: [27n, 4n] }
/** World: the horn ×4 plus any 7 ×1; a 7 nets 0, a push (§3.4: +26, +11, 0 per 5 units). */
const WORLD: NetTable = { 2: [26n, 5n], 3: [11n, 5n], 7: [0n, 1n], 11: [11n, 5n], 12: [26n, 5n] }

/** Horn high X: the horn plus a fifth unit on X (§3.4), which returns 2 × (pay + 1) on X. */
function hornHigh(x: 2 | 3 | 11 | 12): NetTable {
  const table: Record<number, readonly [bigint, bigint]> = {
    2: [26n, 5n],
    3: [11n, 5n],
    11: [11n, 5n],
    12: [26n, 5n],
  }
  table[x] = x === 2 || x === 12 ? [57n, 5n] : [27n, 5n]
  return table
}

/** The composites each machine offers (§3.4, §5.2), and whether a winner stays up (CW §32). */
const MACHINES: readonly {
  readonly name: PresetId
  readonly composites: Readonly<Record<string, NetTable>>
  readonly stake: 'stay' | 'return'
}[] = [
  { name: 'craplessBubble', composites: { ce: CE, horn: HORN }, stake: 'return' },
  { name: 'traditionalBubble', composites: { ce: CE, horn: HORN }, stake: 'stay' },
  { name: 'strictBubble', composites: { ce: CE, horn: HORN }, stake: 'return' },
  {
    name: 'traditionalLive345',
    composites: {
      ce: CE,
      horn: HORN,
      hornHigh2: hornHigh(2),
      hornHigh3: hornHigh(3),
      hornHigh11: hornHigh(11),
      hornHigh12: hornHigh(12),
      world: WORLD,
    },
    stake: 'return',
  },
]

/** The expected decision on `dice`: "+n" or "+n/d" net per unit, "push" for 0, or "-1". */
function want(table: NetTable, dice: Dice): string {
  const net = table[sumOf(dice)]
  if (net === undefined) return '-1'
  const [num, den] = net
  if (num === 0n) return 'push'
  return den === 1n ? `+${num}` : `+${num}/${den}`
}

/** What the composite bet does on `dice`, in the same form, through its family as a roll would. */
function actual(cfg: MachineConfig, typeId: string, dice: Dice): string {
  const decision = decide(cfg, bet(typeId, null), rollContext(cfg, roundAt(null), dice))
  switch (decision.kind) {
    case 'lose':
      return '-1'
    case 'push':
      return decision.reason === 'zeroNet' ? 'push' : `push:${decision.reason}`
    case 'win': {
      const { family, type } = requireType(cfg, typeId)
      const { num, den } = family.payout(type, decision.payKey)
      return den === 1n ? `+${num}` : `+${num}/${den}`
    }
    case 'none':
    case 'travel':
    case 'progress':
      return decision.kind
  }
}

function departures(cfg: MachineConfig, typeId: string, table: NetTable): string[] {
  return ALL_DICE.flatMap((dice) => {
    const [w, a] = [want(table, dice), actual(cfg, typeId, dice)]
    return w === a ? [] : [`${dice.d1}-${dice.d2}: expected ${w}, got ${a}`]
  })
}

describe.each(MACHINES)('composites on $name', ({ name, composites, stake }) => {
  const cfg = machine(name)

  it.each(Object.keys(composites))('%s settles as one bet on its whole-bet net', (id) => {
    expect(departures(cfg, id, composites[id] ?? {})).toEqual([])
  })

  it('each is one bet type: its own id, and the composite family', () => {
    for (const id of Object.keys(composites)) {
      const { family, type } = requireType(cfg, id)
      expect(type, id).toMatchObject({ family: 'composite', typeId: id })
      expect(family.toggleable, id).toBe(false)
      expect(family.defaultWorking({ kind: 'comeOut' }, type, cfg), id).toBe(true)
    }
    expect([...cfg.composites.keys()].sort()).toEqual(Object.keys(composites).sort())
  })

  it(`a winner ${stake === 'stay' ? 'stays up' : 'comes back'}, as its parts do`, () => {
    for (const id of Object.keys(composites)) {
      const decision = decide(cfg, bet(id, null), rollContext(cfg, roundAt(null), { d1: 6, d2: 6 }))
      expect(decision, id).toMatchObject({ kind: 'win', stake })
    }
  })
})

describe('the acceptance cases (plan §10 M4c)', () => {
  it('the C&E net table: +3 on 2, 3 and 12, +7 on 11, −1 otherwise, on every machine', () => {
    for (const { name } of MACHINES) {
      expect(departures(machine(name), 'ce', CE), name).toEqual([])
    }
  })

  it('a horn is 4 units: +27/4 per unit on 2 and 12, +3 on 3 and 11, −1 otherwise', () => {
    for (const { name } of MACHINES) {
      const cfg = machine(name)
      expect(requireType(cfg, 'horn').type).toMatchObject({ units: 4 })
      expect(departures(cfg, 'horn', HORN), name).toEqual([])
    }
  })

  it('world on 7 pushes, and the stake comes back where winners come back', () => {
    const cfg = machine('traditionalLive345')
    for (const dice of ALL_DICE.filter((d) => sumOf(d) === 7)) {
      const decision = decide(cfg, bet('world', null), rollContext(cfg, roundAt(8), dice))
      expect(decision, `${dice.d1}-${dice.d2}`).toEqual({
        kind: 'push',
        reason: 'zeroNet',
        stake: 'return',
      })
    }
  })

  it('a world bet whose parts ride pushes on 7 and stays up', () => {
    const cfg = machine(withRiders(traditionalLive345, 'liveRiders'))
    const decision = decide(
      cfg,
      bet('world', null),
      rollContext(cfg, roundAt(null), { d1: 1, d2: 6 }),
    )
    expect(decision).toEqual({ kind: 'push', reason: 'zeroNet', stake: 'stay' })
  })
})

describe('the net comes from the parts', () => {
  it("follows the parts' catalog pays: a horn whose 12 pays 30 for 1 nets 13/2 on 12", () => {
    const input = structuredClone(craplessBubble)
    input.id = 'craplessHorn30For1'
    const boxcars = input.catalog.boxcars
    if (boxcars?.family !== 'oneRoll') throw new Error('no boxcars')
    boxcars.pays = { '12': '30 for 1' }
    const cfg = machine(input)
    expect(departures(cfg, 'horn', { ...HORN, 12: [13n, 2n] })).toEqual([])
  })

  it('a composite of hops is keyed by dice: "hop the sevens" on 1-6, 2-5 and 3-4', () => {
    const input: MachineConfigInput = {
      ...structuredClone(traditionalLive345),
      id: 'liveHopSevens',
    }
    input.composites.hopSevens = {
      label: 'Hop the Sevens',
      parts: [
        { typeId: 'hop16', units: 1 },
        { typeId: 'hop25', units: 1 },
        { typeId: 'hop34', units: 1 },
      ],
    }
    const cfg = machine(input)
    const { family, type } = requireType(cfg, 'hopSevens')
    expect(type).toMatchObject({ match: 'dice', units: 3 })
    // One part wins 15 to 1 and returns 16 of the 3 units staked: +13/3 per unit.
    for (const dice of ALL_DICE) {
      const decision = decide(cfg, bet('hopSevens', null), rollContext(cfg, roundAt(null), dice))
      if (sumOf(dice) !== 7) {
        expect(decision.kind, `${dice.d1}-${dice.d2}`).toBe('lose')
        continue
      }
      expect(decision.kind).toBe('win')
      if (decision.kind !== 'win') continue
      const lo = Math.min(dice.d1, dice.d2)
      expect(decision.payKey).toBe(`${lo}-${7 - lo}`)
      const ratio = family.payout(type, decision.payKey)
      expect(Fraction.of(ratio.num, ratio.den).equals(Fraction.of(13, 3))).toBe(true)
    }
  })
})

describe("the family's own checks", () => {
  it('pays only on the outcomes its parts win: a horn has no pay on 7', () => {
    const cfg = machine('craplessBubble')
    const { family, type } = requireType(cfg, 'horn')
    expect(() => family.payout(type, '7')).toThrow(RangeError)
    expect(family.payout(type, '12')).toEqual({ num: 27n, den: 4n, label: '27:4' })
  })
})

describe('what a composite reads from the config', () => {
  it("its parts, the parts' outcomes, pays and after-win, and their rounding", () => {
    const cfg = machine('craplessBubble')
    const { family, type } = requireType(cfg, 'ce')
    expect(family.configPaths(type, null, cfg)).toEqual([
      '/composites/ce',
      '/catalog/c/match',
      '/catalog/c/pays',
      '/catalog/c/afterWin',
      '/catalog/e/match',
      '/catalog/e/pays',
      '/catalog/e/afterWin',
      '/money/payoutRounding',
    ])
  })
})

/** A copy of `base` whose one-roll bets all ride after a win, as on Shoot To Win. */
function withRiders(base: MachineConfigInput, id: string): MachineConfigInput {
  const input = structuredClone(base)
  input.id = id
  for (const type of Object.values(input.catalog)) {
    if (type.family === 'oneRoll') type.afterWin = 'stay'
  }
  return input
}
