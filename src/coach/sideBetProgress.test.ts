import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { betId } from '../engine/bets/types.ts'
import { pointRunProgress } from '../engine/bets/families/pointRun.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import type { Action } from '../engine/table/actions.ts'
import { applyAction } from '../engine/table/reducer.ts'
import { newTable, type TableState } from '../engine/table/state.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { analyzeExisting, distribution, payDrops, startOfBet } from '../exact/index.ts'
import { formatPart } from './format.ts'
import { sideBetProgress, type SideBetProgress } from './sideBetProgress.ts'
import { settlesNow } from './sideBetStanding.ts'
import type { CoachLine } from './types.ts'

/** Plays `actions` from a new table, failing on any refusal. */
function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  let state = newTable(cfg, 'coach-side')
  for (const action of actions) {
    const result = applyAction(state, action, cfg)
    if (!result.ok) throw new Error(`${action.type}: ${result.rejection.code}`)
    state = result.state
  }
  return state
}

/** A bet of `typeId` with `progress`, alone on a hand-built table in `phase`. */
function tableWith(
  cfg: MachineConfig,
  typeId: string,
  progress: number,
  phase: TableState['round']['phase'],
  pointsMadeMask = 0,
): TableState {
  return {
    ...newTable(cfg, 'coach-side'),
    round: {
      phase,
      rollIndex: 30,
      hand: { index: 0, rolls: 30, pointsMadeMask },
      sinceSeven: { rolls: 30, totalsMask: 0 },
    },
    bets: [
      {
        id: betId(1),
        typeId,
        number: null,
        parentId: null,
        amount: cents(100),
        vigHeld: cents(0),
        working: null,
        progress,
        placedAtRoll: 0,
      },
    ],
    nextBetSeq: 2,
  }
}

const text = (line: CoachLine | undefined) =>
  line === undefined ? null : line.parts.map((part) => formatPart(part)).join('')
const lineOf = (progress: SideBetProgress, id: string) =>
  text(progress.lines.find((line) => line.id === id))
const exact = (n: { exact: Fraction | number }) =>
  typeof n.exact === 'number' ? Fraction.of(n.exact) : n.exact

const crapless = compileConfig(PRESETS.craplessBubble)

/** A roll of `total`, the easy way where there is one. */
const rollOf = (total: number): Action => {
  const d1 = Math.max(1, total - 6)
  return { type: 'roll', dice: { d1, d2: total - d1 } } as Action
}

/** A preset copy with its side bets edited, provenance left to cover what it still names. */
function edited(
  id: keyof typeof PRESETS,
  edit: (input: MachineConfigInput) => void,
): MachineConfig {
  const input = structuredClone(PRESETS[id]) as MachineConfigInput
  input.id = `${id}-edited`
  edit(input)
  return compileConfig(input)
}

describe('sideBetProgress', () => {
  it('Lucky Roller with four of five targets: the set is the next tier, 5/11 from here', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'place', typeId: 'luckyRollerLow', amount: cents(100) },
      { type: 'roll', dice: { d1: 1, d2: 1 } },
      { type: 'roll', dice: { d1: 1, d2: 2 } },
      { type: 'roll', dice: { d1: 2, d2: 2 } },
      { type: 'roll', dice: { d1: 2, d2: 3 } },
    ])
    const low = state.bets.find((bet) => bet.typeId === 'luckyRollerLow')
    if (low === undefined) throw new Error('no Lucky Roller')
    const progress = sideBetProgress(low.id, state, crapless)
    if (progress === null) throw new Error('no progress')
    expect(progress.family).toBe('collectSet')
    expect(progress.stage).toEqual({ kind: 'collectSet', rolled: [2, 3, 4, 5], remaining: [6] })
    // Worst first: the 7 loses, the 6 completes the set.
    expect(progress.outcomes.map((o) => [o.kind, o.key, o.cash])).toEqual([
      ['lose', '-', 0],
      ['win', 'set', 3_100],
    ])
    expect(progress.assured.outcome.kind).toBe('lose')
    expect(progress.nextTier?.label).toBe('31 for 1')
    expect(exact(progress.nextTier!.chance).equals(Fraction.of(5, 11))).toBe(true)
    expect(exact(progress.pWin).equals(Fraction.of(5, 11))).toBe(true)
    expect(exact(progress.equity).equals(Fraction.of(15_500, 11))).toBe(true)
    expect(exact(progress.equity).equals(analyzeExisting(low.id, state, crapless).equity)).toBe(
      true,
    )
    // Every roll that is neither a 6 nor a 7 changes nothing: 36/11 rolls left on average.
    expect(exact(progress.expectedRolls).equals(Fraction.of(36, 11))).toBe(true)
    expect(lineOf(progress, 'side-stage')).toBe(
      'Rolled so far: 2, 3, 4, 5. Still needs 6 (1 more) before any seven.',
    )
    expect(lineOf(progress, 'side-now')).toBe('Settled now it loses the stake.')
    expect(lineOf(progress, 'side-next')).toBe(
      'Next step: 31 for 1 ($31.00 back) — 45.5% chance of reaching it from here.',
    )
    expect(lineOf(progress, 'side-chances')).toBe(
      'Wins 45.5% of the time from here, over about 3.3 more rolls.',
    )
    expect(progress.nextTier?.chance.source).toEqual({
      fn: 'sideBetProgress',
      args: { betId: low.id, field: 'nextTierChance' },
      configHash: crapless.configHash,
    })
    // The pays are reported [R]; only the machine's cent rounding is assumed on this preset.
    expect(progress.assumedPaths).toEqual(['/money/payoutRounding'])
  })

  it('a fresh Lucky Roller names every target it needs', () => {
    const state = tableWith(crapless, 'luckyRollerAll', 0, { kind: 'comeOut' })
    const progress = sideBetProgress(betId(1), state, crapless)
    expect(lineOf(progress!, 'side-stage')).toBe(
      'Nothing collected yet: it needs 2, 3, 4, 5, 6, 8, 9, 10, 11, 12 before any seven.',
    )
    expect(progress?.nextTier?.label).toBe('156 for 1')
  })

  it('Lucky Shooter with every other box number hit: 100 for 1 assured, the top award 5/36 away', () => {
    const strict = compileConfig(PRESETS.strictBubble)
    const hits = (1 << 4) | (1 << 5) | (1 << 8) | (1 << 9) | (1 << 10)
    const state = tableWith(strict, 'luckyShooter', pointRunProgress(6, hits), {
      kind: 'point',
      point: 6,
    })
    const progress = sideBetProgress(betId(1), state, strict)
    if (progress === null) throw new Error('no progress')
    expect(progress.stage).toEqual({ kind: 'pointRun', point: 6, hits: [4, 5, 8, 9, 10] })
    expect(progress.outcomes.map((o) => [o.key, o.cash])).toEqual([
      ['5', 10_000],
      ['top', 50_000],
    ])
    expect(progress.assured.outcome.key).toBe('5')
    expect(exact(progress.assured.chance).toString()).toBe('1')
    expect(progress.nextTier?.label).toBe('500 for 1')
    expect(exact(progress.nextTier!.chance).equals(Fraction.of(5, 36))).toBe(true)
    expect(exact(progress.pWin).toString()).toBe('1')
    expect(exact(progress.equity).equals(Fraction.of(140_000, 9))).toBe(true)
    expect(lineOf(progress, 'side-stage')).toBe('Point 6 with 5 hits so far: 4, 5, 8, 9, 10.')
    expect(lineOf(progress, 'side-now')).toBe('Settled now it pays 100 for 1: $100.00 back.')
    expect(lineOf(progress, 'side-next')).toBe(
      'Next step: 500 for 1 ($500.00 back) — 13.9% chance of reaching it from here.',
    )
  })

  it('Lucky Shooter before its point: the come-out pushes continue it, the pay steps are hits', () => {
    const strict = compileConfig(PRESETS.strictBubble)
    const state = tableWith(strict, 'luckyShooter', 0, { kind: 'comeOut' })
    const progress = sideBetProgress(betId(1), state, strict)
    if (progress === null) throw new Error('no progress')
    // The 7/11 push stays up, so it is no way to come down: loss, then 2 hits and up.
    expect(progress.outcomes.map((o) => o.key)).toEqual(['-', '2', '3', '4', '5', 'top'])
    expect(
      exact(progress.nextTier!.chance).equals(Fraction.of(13, 81).mul(Fraction.of(9, 7))),
    ).toBe(true)
    expect(Fraction.sum(progress.outcomes.map((o) => o.chance)).toString()).toBe('1')
    expect(lineOf(progress, 'side-stage')).toBe('No point yet: the come-out roll sets it.')
  })

  it('Hot Shooter at 20 rolls: 3 for 1 assured, the 24-roll tier next; at 8 rolls the stake back is next', () => {
    const stw = compileConfig(PRESETS.traditionalBubble)
    const twenty = sideBetProgress(
      betId(1),
      tableWith(stw, 'hotShooter', 20, { kind: 'point', point: 8 }),
      stw,
    )
    if (twenty === null) throw new Error('no progress')
    expect(twenty.stage).toEqual({ kind: 'handLength', rolls: 20 })
    expect(twenty.assured.outcome).toMatchObject({ kind: 'win', key: '16', cash: 300 })
    expect(twenty.nextTier?.outcome).toMatchObject({ kind: 'win', key: '24', cash: 500 })
    expect(twenty.nextTier?.label).toBe('5 for 1')
    // P(next tier) is everything but ending in the assured tier.
    expect(
      exact(twenty.nextTier!.chance).equals(Fraction.ONE.sub(twenty.assured.outcome.chance)),
    ).toBe(true)
    expect(exact(twenty.pWin).toString()).toBe('1')
    expect(lineOf(twenty, 'side-stage')).toBe(
      'Rolls counted this hand: 20. The seven-out settles it at the highest tier the count reaches.',
    )
    const five = sideBetProgress(
      betId(1),
      tableWith(stw, 'hotShooter', 5, { kind: 'point', point: 8 }),
      stw,
    )
    if (five === null) throw new Error('no progress')
    expect(five.assured.outcome.kind).toBe('lose')
    expect(five.nextTier?.outcome).toMatchObject({ kind: 'push', key: 'zeroNet', cash: 100 })
    expect(lineOf(five, 'side-next')).toMatch(
      /^Next step: the stake back \(\$1\.00\) — .*% chance from here\.$/,
    )
    // Past the top tier the count is lumped: nothing left to reach.
    const sixty = sideBetProgress(
      betId(1),
      tableWith(stw, 'hotShooter', 60, { kind: 'point', point: 8 }),
      stw,
    )
    expect(sixty?.nextTier).toBeNull()
    expect(lineOf(sixty!, 'side-next')).toBe('Nothing left to reach: this is the top pay.')
    expect(sixty?.assured.outcome.key).toBe('50')
  })

  it('Fire Bet with three points made: nothing assured yet, the 24 to 1 tier is next', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    const made = (1 << 4) | (1 << 5) | (1 << 9)
    const state = tableWith(live, 'fire', made, { kind: 'point', point: 6 }, made)
    const progress = sideBetProgress(betId(1), state, live)
    if (progress === null) throw new Error('no progress')
    expect(progress.stage).toEqual({ kind: 'uniquePointsMade', made: [4, 5, 9], counted: 6 })
    expect(progress.assured.outcome.kind).toBe('lose')
    expect(progress.nextTier?.outcome).toMatchObject({ kind: 'win', key: '4', cash: 2_500 })
    expect(progress.nextTier?.label).toBe('24 to 1')
    // P(4 or more) from here equals P(any win) from here, and matches the solver's own chain.
    const now = distribution(
      { typeId: 'fire', number: null },
      startOfBet(state.bets[0]!, state),
      'decision',
      live,
    )
    const lose = now.labels.findIndex((label) => label.key === 'lose:-:lost')
    expect(
      exact(progress.nextTier!.chance).equals(Fraction.ONE.sub(now.counts[lose] ?? Fraction.ZERO)),
    ).toBe(true)
    expect(exact(progress.pWin).equals(exact(progress.nextTier!.chance))).toBe(true)
    expect(lineOf(progress, 'side-stage')).toBe(
      'Points made this hand: 4, 5, 9 — 3 of the 6 that count. It is paid at the seven-out.',
    )
  })

  it('settles now from the current progress, even where more progress pays less (M11 audit)', () => {
    // The audit's repro (audit-m11/fire-nonmono.ts): a crapless Fire Bet counting all ten points
    // with table A as written (4, 5 and 6 points pay; seven or more pay nothing, rules spec §6.6's
    // 17.1059% reading). Six points made and the 2 on: a seven-out now pays 999 to 1.
    const cfg = edited('craplessBubble', (input) => {
      input.sideBets.fire = {
        family: 'uniquePointsMade',
        label: 'Fire Bet',
        countedPoints: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
        payTable: { '4': '24 to 1', '5': '249 to 1', '6': '999 to 1' },
        payImmediatelyAt: null,
        placement: 'newHand',
      }
    })
    const state = play(cfg, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'place', typeId: 'fire', amount: cents(100) },
      ...[4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 2].map(rollOf),
    ])
    const fire = state.bets.find((bet) => bet.typeId === 'fire')
    if (fire === undefined) throw new Error('no Fire Bet')
    const progress = sideBetProgress(fire.id, state, cfg)
    if (progress === null) throw new Error('no progress')
    expect(progress.assured.outcome).toMatchObject({ kind: 'win', key: '6', cash: 100_000 })
    expect(lineOf(progress, 'side-now')).toBe('Settled now it pays 999 to 1: $1,000.00 back.')
    // Nothing pays more: a seventh point only loses it.
    expect(progress.nextTier).toBeNull()
    expect(lineOf(progress, 'side-next')).toBe('Nothing left to reach: this is the top pay.')
    // The lowest way down is still a loss, with what it takes: a new point made before the 7.
    expect(progress.outcomes.map((o) => o.key)).toEqual(['-', '6'])
    expect(exact(progress.assured.chance).equals(progress.outcomes[1]!.chance)).toBe(true)
    // The machine editor is warned about the table (`sanityCheck` carries the same warning).
    expect(
      payDrops({ typeId: 'fire', number: null }, cfg.sideBets.get('fire')!, []).map(
        (issue) => issue.code,
      ),
    ).toEqual(['payDrops'])
  }, 60_000)

  it("counts a later come-out Hot Shooter's hand from the hand's first roll (rules spec §2.6)", () => {
    // The audit's repro (audit-m11/hsj-anycomeout.ts): placed after a made 4, then a 6 and five 5s.
    const stw = edited('traditionalBubble', (input) => {
      const hot = input.sideBets.hotShooter
      if (hot?.family !== 'handLength') throw new Error('no Hot Shooter')
      hot.placement = 'anyComeOut'
    })
    const state = play(stw, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      ...[4, 4].map(rollOf),
      { type: 'place', typeId: 'hotShooter', amount: cents(100) },
      ...[6, 5, 5, 5, 5, 5].map(rollOf),
    ])
    const hot = state.bets.find((bet) => bet.typeId === 'hotShooter')
    if (hot === undefined) throw new Error('no Hot Shooter')
    const progress = sideBetProgress(hot.id, state, stw)
    if (progress === null) throw new Error('no progress')
    expect(lineOf(progress, 'side-stage')).toBe(
      'Rolls counted this hand: 8. The seven-out settles it at the highest tier the count reaches.',
    )
    // A seven-out now ends a 9-roll hand: 8 to 15 rolls return the stake.
    expect(lineOf(progress, 'side-now')).toBe('Settled now it returns the stake: $1.00.')
  })

  it('reads a Hot Shooter tier where its earliest seven-out lands (M11 audit MINOR-1)', () => {
    const stw = compileConfig(PRESETS.traditionalBubble)
    const at = (progress: number, phase: TableState['round']['phase']) => {
      const state = tableWith(stw, 'hotShooter', progress, phase)
      const progressed = sideBetProgress(
        betId(1),
        {
          ...state,
          round: { ...state.round, hand: { ...state.round.hand, rolls: Math.max(progress, 1) } },
        },
        stw,
      )
      if (progressed === null) throw new Error('no progress')
      return progressed
    }
    // 7 rolls with point 4 on: the next roll may be the seven-out, the hand's 8th: the stake back.
    const seven = at(7, { kind: 'point', point: 4 })
    expect(lineOf(seven, 'side-now')).toBe('Settled now it returns the stake: $1.00.')
    expect(seven.nextTier?.label).toBe('3 for 1')
    expect(lineOf(seven, 'side-next')).toMatch(/^Next step: 3 for 1 \(\$3\.00 back\) — 28\.1% /)
    // 49 rolls with point 10 on: the next seven-out is the 50th roll, the top tier.
    const top = at(49, { kind: 'point', point: 10 })
    expect(lineOf(top, 'side-now')).toBe('Settled now it pays 100 for 1: $100.00 back.')
    expect(lineOf(top, 'side-next')).toBe('Nothing left to reach: this is the top pay.')
    // 43 rolls on a come-out: two more rolls at least, so 45, 30 for 1, not the 40-roll tier.
    const comeOut = at(43, { kind: 'comeOut' })
    expect(lineOf(comeOut, 'side-now')).toBe('Settled now it pays 30 for 1: $30.00 back.')
    expect(comeOut.nextTier?.label).toBe('100 for 1')
    expect(settlesNow(stw.sideBets.get('hotShooter')!, 43, { kind: 'comeOut' }).row).toBe('45')
  })

  it('words each bet from its config: a seven-out-only Lucky Roller, a Fire Bet paid at once', () => {
    const sevenOut = edited('craplessBubble', (input) => {
      const low = input.sideBets.luckyRollerLow
      if (low?.family !== 'collectSet') throw new Error('no Low Rolls')
      low.endsOn = 'sevenOut'
    })
    const fresh = sideBetProgress(
      betId(1),
      tableWith(sevenOut, 'luckyRollerLow', 0, { kind: 'comeOut' }),
      sevenOut,
    )
    expect(lineOf(fresh!, 'side-stage')).toBe(
      'Nothing collected yet: it needs 2, 3, 4, 5, 6 before a seven-out.',
    )
    const payAtSix = edited('traditionalLive345', (input) => {
      const fire = input.sideBets.fire
      if (fire?.family !== 'uniquePointsMade') throw new Error('no Fire Bet')
      fire.payImmediatelyAt = 6
    })
    const made = (1 << 4) | (1 << 5)
    const fire = sideBetProgress(
      betId(1),
      tableWith(payAtSix, 'fire', made, { kind: 'point', point: 6 }, made),
      payAtSix,
    )
    expect(lineOf(fire!, 'side-stage')).toBe(
      'Points made this hand: 4, 5 — 2 of the 6 that count. It is paid at the seven-out, or at once on reaching 6 points.',
    )
    expect(
      fire?.lines[0]?.parts.some(
        (part) =>
          typeof part !== 'string' &&
          'source' in part &&
          part.source.args !== null &&
          (part.source.args as { field?: string }).field === 'payAt',
      ),
    ).toBe(true)
  })

  it('says "1 hit", not "1 hits" (M11 audit MINOR)', () => {
    const strict = compileConfig(PRESETS.strictBubble)
    const state = tableWith(strict, 'luckyShooter', pointRunProgress(4, 1 << 10), {
      kind: 'point',
      point: 4,
    })
    const progress = sideBetProgress(betId(1), state, strict)
    expect(lineOf(progress!, 'side-stage')).toBe('Point 4 with 1 hit so far: 10.')
  })

  it('is null for a bet that is not a side bet, or not on the table', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
    ])
    expect(sideBetProgress(betId(1), state, crapless)).toBeNull()
    expect(sideBetProgress(betId(2), state, crapless)).toBeNull()
  })
})
