import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import { derive, type DerivationStep } from './derive.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

function step<K extends DerivationStep['kind']>(
  steps: readonly DerivationStep[],
  kind: K,
): Extract<DerivationStep, { kind: K }> {
  const found = steps.find((s): s is Extract<DerivationStep, { kind: K }> => s.kind === kind)
  if (found === undefined) throw new Error(`no ${kind} step`)
  return found
}

describe('derive', () => {
  it('derives a $5 place 6 floored to the penny step by step (plan §5.2)', () => {
    const steps = derive({ typeId: 'place', number: 6 }, cents(500), crapless)
    const ways = step(steps, 'ways')
    expect([ways.win, ways.lose, ways.push, ways.travel, ways.none]).toEqual([5, 6, 0, 0, 25])
    // Every state decides by the same ways, so P(win) = 5 ÷ (5 + 6) follows from this one roll.
    expect(ways.complete).toBe(true)
    const chances = step(steps, 'chances')
    expect([chances.win.toString(), chances.lose.toString(), chances.push.toString()]).toEqual([
      '5/11',
      '6/11',
      '0',
    ])
    const payout = step(steps, 'payout')
    expect(payout.ratio.toString()).toBe('7/6')
    expect(payout.winExact.toString()).toBe('1750/3')
    expect(payout.winPaid).toBe(583)
    expect(payout.breakage.toString()).toBe('1/3')
    expect(payout.rounding).toEqual({ mode: 'floor', increment: 1 })
    // The payout step carries its chance and the stake's fate, so the expected loss can be
    // rebuilt from the steps alone (M5/M6 audit).
    expect(payout.chance.toString()).toBe('5/11')
    expect(payout.disposition).toBe('stays')
    expect(step(steps, 'expectedLoss').perDecision.toString()).toBe('85/11')
    const edge = step(steps, 'edge')
    expect([edge.edge.toString(), edge.nominalEdge.toString(), edge.breakage.toString()]).toEqual([
      '17/1100',
      '1/66',
      '1/3300',
    ])
    // Lifecycle loss ÷ (working rolls × stake) = the per-working-roll edge, now rebuildable:
    expect(
      step(steps, 'expectedLoss')
        .lifecycle.div(edge.workingRolls.mul(Fraction.of(500)))
        .toString(),
    ).toBe(edge.perWorkingRoll.toString())
    expect(steps.some((s) => s.kind === 'commission')).toBe(false)
  })

  it('shows commission charged up front and again on a buy', () => {
    const steps = derive({ typeId: 'buy', number: 4 }, cents(2_000), crapless)
    expect(step(steps, 'commission')).toEqual({ kind: 'commission', placement: 100, rearm: 100 })
    expect(step(steps, 'edge').edge.toString()).toBe('1/21')
  })

  it('counts the ways of a pass bet on the come-out, and says they are not the whole story', () => {
    const ways = step(derive({ typeId: 'pass', number: null }, cents(1_000), crapless), 'ways')
    expect([ways.win, ways.lose, ways.travel]).toEqual([6, 0, 30])
    // The decision runs through the round: P(win) does not follow from one roll's ways, and the
    // step says which state it shows (the come-out, weight 1).
    expect(ways.complete).toBe(false)
    expect(ways.phase).toEqual({ kind: 'comeOut' })
    expect(ways.weight.toString()).toBe('1')
  })

  it('counts ways where the bet works: Shoot To Win place 6 with a point on', () => {
    const stw = compileConfig(PRESETS.traditionalBubble)
    const ways = step(derive({ typeId: 'place', number: 6 }, cents(600), stw), 'ways')
    expect([ways.win, ways.lose]).toEqual([5, 6])
    // The come-out never decides it (OFF there), so the deciding states still agree: complete.
    expect(ways.complete).toBe(true)
    expect(ways.phase?.kind).toBe('point')
  })

  it('marks come odds incomplete: their chances mix point play with come-out returns', () => {
    const ways = step(derive({ typeId: 'comeOdds', number: 4 }, cents(1_000), crapless), 'ways')
    expect(ways.complete).toBe(false)
  })
})
