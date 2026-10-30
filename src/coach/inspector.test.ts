import { describe, expect, it } from 'vitest'
import { compileConfig, type MachineConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { betId } from '../engine/bets/types.ts'
import { cents } from '../engine/core/money.ts'
import { makeRoll } from '../engine/core/dice.ts'
import { Fraction } from '../engine/core/rational.ts'
import type { Action } from '../engine/table/actions.ts'
import { applyAction } from '../engine/table/reducer.ts'
import { newTable, type TableState } from '../engine/table/state.ts'
import { formatPart } from './format.ts'
import { inspectorMath, type InspectorMath } from './inspector.ts'

/** Plays `actions` from a new table, failing on any refusal. */
function play(cfg: MachineConfig, actions: readonly Action[]): TableState {
  let state = newTable(cfg, 'coach-inspector')
  for (const action of actions) {
    const result = applyAction(state, action, cfg)
    if (!result.ok) throw new Error(`${action.type}: ${result.rejection.code}`)
    state = result.state
  }
  return state
}

const crapless = compileConfig(PRESETS.craplessBubble)

/** One line's rendered text, exactly as `InspectorExtras` renders it. */
function text(math: InspectorMath, id: string): string | null {
  const line = math.lines.find((l) => l.id === id) ?? null
  return line === null ? null : line.parts.map((part) => formatPart(part)).join('')
}

describe('inspectorMath', () => {
  it('prices Place 6 at $5: "$5.00 × 7:6 = $5.83" and a 1.55% edge (plan §10 M9a)', () => {
    const math = inspectorMath({ typeId: 'place', number: 6 }, cents(500), crapless)
    expect(math.edge !== null && (math.edge.exact as Fraction).equals(Fraction.of(17, 1100))).toBe(
      true,
    )
    expect(text(math, 'pays')).toBe('$5.00 × 7:6 = $5.83')
    expect(text(math, 'edge')).toBe('House edge 1.55%')
    expect(text(math, 'chance')).toBe('Wins 45.5% of decisions')
    expect(math.existing).toBeNull()
  })

  it('derives the math as steps: ways, chances, each payout, expected loss, edge', () => {
    const math = inspectorMath({ typeId: 'place', number: 6 }, cents(500), crapless)
    const kinds = math.steps.map((step) => step.id.split(':')[1])
    expect(kinds[0]).toBe('ways')
    expect(kinds[1]).toBe('chances')
    expect(kinds).toContain('payout')
    expect(kinds).toContain('expectedLoss')
    expect(kinds[kinds.length - 1]).toBe('edge')
    const rendered = math.steps.map((step) => step.parts.map((part) => formatPart(part)).join(''))
    expect(rendered[0]).toBe('Of 36 rolls: 5 win, 6 lose, 25 change nothing.')
    expect(rendered[1]).toBe('P(win) 45.5%, P(lose) 54.5%.')
    expect(rendered.find((line) => line.includes('$5.833…'))).toBe(
      '$5.00 × 7:6 = $5.833… → pays $5.83.',
    )
  })

  it('values a bet on the table: the $10 crapless pass on point 2 is worth ≈ $2.86', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(1_000) },
      { type: 'roll', dice: makeRoll(1, 1) },
    ])
    const math = inspectorMath(
      { typeId: 'pass', number: null },
      cents(1_000),
      crapless,
      state,
      betId(1),
    )
    expect(math.existing?.resolves).toBe(true)
    expect(
      math.existing !== null &&
        (math.existing.equity.exact as Fraction).equals(Fraction.of(2000, 7)),
    ).toBe(true)
    expect(text(math, 'equity')).toBe('Worth from now: ≈ $2.86')
    expect(text(math, 'loss-from-now')).toBe('Expected loss from here: ≈ $7.14')
    // A contract bet cannot come down: no take-down line may be offered.
    expect(math.existing?.canTakeDown).toBe(false)
    expect(text(math, 'take-down')).toBeNull()
  })

  it('offers the take-down line for a bet the machine lets down, with its exact return', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
    ])
    const math = inspectorMath(
      { typeId: 'place', number: 6 },
      cents(600),
      crapless,
      state,
      betId(1),
    )
    expect(math.existing?.canTakeDown).toBe(true)
    expect(text(math, 'take-down')).toBe('Taking it down returns $6.00')
    expect(text(math, 'never-resolves')).toBeNull()
  })

  it('says when a bet may never be decided (held OFF after a seven-out)', () => {
    const state = play(crapless, [
      { type: 'place', typeId: 'pass', amount: cents(500) },
      { type: 'roll', dice: makeRoll(2, 2) },
      { type: 'roll', dice: makeRoll(3, 4) }, // seven-out
      { type: 'place', typeId: 'place', number: 6, amount: cents(600) },
    ])
    const held = state.bets.find((bet) => bet.typeId === 'place')
    expect(held).toBeDefined()
    const math = inspectorMath(
      { typeId: 'place', number: 6 },
      cents(600),
      crapless,
      state,
      held?.id ?? betId(99),
    )
    expect(math.existing?.resolves).toBe(false)
    expect(text(math, 'never-resolves')).not.toBeNull()
  })

  it('every number carries its source and the config hash', () => {
    const math = inspectorMath({ typeId: 'place', number: 6 }, cents(500), crapless)
    for (const line of [...math.lines, ...math.steps]) {
      for (const part of line.parts) {
        if (typeof part === 'string') continue
        const coachNumber = 'style' in part ? part.n : part
        expect(coachNumber.source.configHash).toBe(crapless.configHash)
        expect(['analyzeBet', 'derive', 'analyzeExisting', 'takeDownValue']).toContain(
          coachNumber.source.fn,
        )
      }
    }
  })
})
