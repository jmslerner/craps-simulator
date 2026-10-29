import { describe, expect, it } from 'vitest'
import type { PresetId } from '../../../src/engine/config/presets/index.ts'
import type { PointNumber } from '../../../src/engine/config/rulesets.ts'
import type { Dice } from '../../../src/engine/core/dice.ts'
import { Fraction } from '../../../src/engine/core/rational.ts'
import { isSettled } from '../../../src/engine/bets/types.ts'
import { settle } from '../../../src/engine/settle/settle.ts'
import { bet, decide, machine, rollContext, roundAt } from '../rules/support.ts'

// The line-bet settlement table, written from docs/rules/rules-spec.md §3.1 (line bets pay 1:1),
// §4.1 (credited = stake if returned + winPaid − vig) and §5.2 (afterWin per machine), with exact
// cents. Each bet is decided through its family on a real roll, then settled.

type Case = readonly [
  machine: PresetId,
  typeId: string,
  number: PointNumber | null,
  point: PointNumber | null,
  roll: Dice,
  stake: number,
  expected: Record<string, unknown>,
]

const SEVEN: Dice = { d1: 3, d2: 4 }

const TABLE: readonly Case[] = [
  // Interblock keeps a winning pass up: the win is credited, the stake stays (IB §2.1).
  [
    'craplessBubble',
    'pass',
    null,
    null,
    SEVEN,
    1_000,
    { outcome: 'win', winPaid: 1_000, credited: 1_000, stakeDisposition: 'stays' },
  ],
  [
    'craplessBubble',
    'pass',
    2,
    2,
    { d1: 1, d2: 1 },
    1_000,
    { outcome: 'win', winPaid: 1_000, credited: 1_000, stakeDisposition: 'stays' },
  ],
  // A returned come win credits the stake and the win.
  [
    'craplessBubble',
    'come',
    12,
    6,
    { d1: 6, d2: 6 },
    700,
    { outcome: 'win', winPaid: 700, credited: 1_400, stakeDisposition: 'returned' },
  ],
  [
    'craplessBubble',
    'come',
    null,
    9,
    SEVEN,
    300,
    { outcome: 'win', winPaid: 300, credited: 600, stakeDisposition: 'returned' },
  ],
  // A seven-out loses the pass: nothing credited, the stake is lost.
  [
    'craplessBubble',
    'pass',
    11,
    11,
    SEVEN,
    2_500,
    { outcome: 'lose', winPaid: 0, credited: 0, stakeDisposition: 'lost' },
  ],
  // Shoot To Win: don't pass rides after a first-roll win; bar 12 pushes and the bet stays.
  [
    'traditionalBubble',
    'dontPass',
    null,
    null,
    { d1: 1, d2: 2 },
    500,
    { outcome: 'win', winPaid: 500, credited: 500, stakeDisposition: 'stays' },
  ],
  [
    'traditionalBubble',
    'dontPass',
    null,
    null,
    { d1: 6, d2: 6 },
    500,
    { outcome: 'push', pushReason: 'bar', credited: 0, stakeDisposition: 'stays' },
  ],
  [
    'traditionalBubble',
    'dontPass',
    4,
    4,
    SEVEN,
    500,
    { outcome: 'win', winPaid: 500, credited: 1_000, stakeDisposition: 'returned' },
  ],
  // Shoot To Win: a come bet that wins on 11 in the come box stays there.
  [
    'traditionalBubble',
    'come',
    null,
    8,
    { d1: 5, d2: 6 },
    1_500,
    { outcome: 'win', winPaid: 1_500, credited: 1_500, stakeDisposition: 'stays' },
  ],
  [
    'traditionalBubble',
    'dontCome',
    null,
    8,
    { d1: 1, d2: 1 },
    1_500,
    { outcome: 'win', winPaid: 1_500, credited: 1_500, stakeDisposition: 'stays' },
  ],
  // The strict machine returns a winning don't come and keeps a winning don't pass up.
  [
    'strictBubble',
    'dontCome',
    10,
    5,
    SEVEN,
    900,
    { outcome: 'win', winPaid: 900, credited: 1_800, stakeDisposition: 'returned' },
  ],
  [
    'strictBubble',
    'dontPass',
    5,
    5,
    SEVEN,
    900,
    { outcome: 'win', winPaid: 900, credited: 900, stakeDisposition: 'stays' },
  ],
  // A live table pays even money in whole dollars, so a line bet loses nothing to rounding.
  [
    'traditionalLive345',
    'come',
    null,
    4,
    { d1: 6, d2: 5 },
    1_000,
    { outcome: 'win', winPaid: 1_000, credited: 2_000, stakeDisposition: 'returned' },
  ],
  [
    'traditionalLive345',
    'dontCome',
    null,
    4,
    { d1: 6, d2: 6 },
    1_000,
    { outcome: 'push', pushReason: 'bar', credited: 0, stakeDisposition: 'stays' },
  ],
]

describe('line bets pay 1:1 and credit per afterWin (§3.1, §4.1, §5.2)', () => {
  it.each(TABLE)('%s: %s on %s, point %s', (id, typeId, number, point, roll, stake, expected) => {
    const cfg = machine(id)
    const subject = bet(typeId, number, { amount: stake })
    const decision = decide(cfg, subject, rollContext(cfg, roundAt(point), roll))
    if (!isSettled(decision)) throw new Error(`${typeId} was not decided: ${decision.kind}`)
    const trace = settle(subject, decision, cfg)
    expect(trace).toMatchObject({ ...expected, stake, vigOnWin: 0, vigRearm: 0, breakage: '0' })
    if (trace.outcome === 'win') {
      expect(trace).toMatchObject({ winExact: String(stake), payKey: 'flat' })
      // As the machine writes it: "1:1" on Interblock, "1 to 1" on the others.
      expect(trace.ratioLabel).toMatch(/^1(:| to )1$/)
    }
  })
})

describe('any whole number of cents is paid in full at even money', () => {
  it.each(['craplessBubble', 'traditionalLive345'] as const)('%s', (id) => {
    const cfg = machine(id)
    const wrong: number[] = []
    for (let stake = 1; stake <= 2_000; stake += 7) {
      const subject = bet('pass', null, { amount: stake })
      const decision = decide(cfg, subject, rollContext(cfg, roundAt(null), SEVEN))
      if (!isSettled(decision)) throw new Error('the come-out 7 did not decide the pass line')
      const trace = settle(subject, decision, cfg)
      if (trace.winPaid !== stake) wrong.push(stake)
    }
    // The live table floors to the dollar, but 1:1 on a whole-dollar bet is always whole: only
    // off-grid stakes (which its limits reject) can lose cents there.
    if (id === 'craplessBubble') expect(wrong).toEqual([])
    else expect(wrong.every((stake) => stake % 100 !== 0)).toBe(true)
  })

  it('exact mode gives the same even-money amounts as fractions', () => {
    const cfg = machine('craplessBubble')
    const subject = bet('come', 6, { amount: 1_234 })
    const decision = decide(cfg, subject, rollContext(cfg, roundAt(8), { d1: 2, d2: 4 }))
    if (!isSettled(decision)) throw new Error('come on 6 was not decided')
    const trace = settle(subject, decision, cfg, 'exact')
    expect(trace.winPaid.equals(Fraction.of(1_234))).toBe(true)
    expect(trace.credited.equals(Fraction.of(2_468))).toBe(true)
  })
})
