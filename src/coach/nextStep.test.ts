import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  applyAction,
  cents,
  compileConfig,
  legalBets,
  validateAction,
} from '../engine/index.ts'
import type { Action, MachineConfig, TableState } from '../engine/index.ts'
import { newTable } from '../engine/index.ts'
import { GUIDE_CYCLE, SEVEN_DICE, nextStep, sevenPreview } from './nextStep.ts'
import type { NextStep, NextStepSettings } from './nextStep.ts'

/**
 * The M9c provider (plan §0 #18, §10 M9c): the four deferred lessons — CoachNumber wording, the
 * 7-line on roll steps, per-idea dismissal, and never claiming an OFF bet plays — on top of the M8
 * mechanics, which `src/ui/state/nextStep.test.ts` still covers through the re-export. Everything
 * here drives the engine directly (core project, no shells).
 */

const CRAPLESS = compileConfig(PRESETS.craplessBubble)
const NO_CHIP: NextStepSettings = { selectedChip: null, chips: null }

function apply(state: TableState, action: Action, cfg: MachineConfig = CRAPLESS): TableState {
  const result = applyAction(state, action, cfg)
  if (!result.ok) throw new Error(`test action refused: ${result.rejection.code}`)
  return result.state
}

function stepFor(
  state: TableState,
  settings: NextStepSettings = NO_CHIP,
  cfg: MachineConfig = CRAPLESS,
): NextStep | null {
  return nextStep(state, cfg, legalBets(state, cfg), settings)
}

function expectValidActions(state: TableState, step: NextStep | null, cfg = CRAPLESS): void {
  if (step === null) return
  for (const offered of [step.action, step.alt?.action]) {
    if (offered === undefined) continue
    expect(validateAction(state, offered, cfg), step.stepId).toBeNull()
  }
}

const comeOutTable = () =>
  apply(newTable(CRAPLESS, 'coach-guide'), { type: 'place', typeId: 'pass', amount: cents(500) })

describe('the 7-preview (plan §0 #18: what a 7 would do to every bet)', () => {
  it('come-out with the pass line alone: the 7 wins it, nothing is taken', () => {
    const state = comeOutTable()
    const seven = sevenPreview(state, CRAPLESS)
    expect(seven).not.toBeNull()
    expect(seven?.wins.exact).toBe(500) // $5 pass at even money, computed by the engine
    expect(seven?.takes.exact).toBe(0)
    expect(seven?.returns.exact).toBe(0)
    expect(seven?.net.exact).toBe(500)
    expect(seven?.byBet).toHaveLength(1)
    expect(seven?.byBet[0]?.what).toBe('wins')
  })

  it('a winning line never stands alone: working place bets the 7 takes are named, with the net', () => {
    const state = apply(comeOutTable(), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(600),
    })
    const seven = sevenPreview(state, CRAPLESS)
    expect(seven?.wins.exact).toBe(500)
    expect(seven?.takes.exact).toBe(600) // place 6 works on this machine's come-out and the 7 takes it
    expect(seven?.net.exact).toBe(-100)
    expect(seven?.byBet.map((b) => b.what)).toStrictEqual(['wins', 'loses'])
    const step = stepFor(state)
    expect(step?.stepId).toBe('comeOutRoll')
    expect(step?.body).toBe(
      'Roll the dice to set the point for your Pass Line. ' +
        'A seven now: wins you $5.00, takes $6.00 — net -$1.00.',
    )
    expect(step?.numbers?.sevenTakes?.exact).toBe(600)
    expect(step?.numbers?.sevenTakes?.source.fn).toBe('sevenPreview')
  })

  it('never claims an OFF bet plays: Bets Off place bets sit out of the 7-line by name', () => {
    let state = apply(comeOutTable(), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(600),
    })
    state = apply(state, { type: 'setGlobalWorking', off: true })
    const seven = sevenPreview(state, CRAPLESS)
    expect(seven?.takes.exact).toBe(0)
    expect(seven?.byBet.find((b) => b.name === 'Place 6')?.what).toBe('off')
    expect(seven?.offCount.exact.toString()).toBe('1')
    const step = stepFor(state)
    expect(step?.body).toContain('OFF: a seven cannot take an OFF bet, and an OFF bet cannot win.')
    expect(step?.body).not.toContain('takes')
  })

  it('the preview replays the engine exactly: totals equal an independent fold of the same roll', () => {
    let state = apply(comeOutTable(), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(600),
    })
    state = apply(state, { type: 'roll', dice: { d1: 2, d2: 2 } }) // point 4; place 6 carried
    const seven = sevenPreview(state, CRAPLESS)
    expect(seven).not.toBeNull()
    const replay = applyAction(state, { type: 'roll', dice: SEVEN_DICE }, CRAPLESS, {
      checkInvariants: false,
    })
    if (!replay.ok) throw new Error('the preview said the roll was legal')
    let wins = 0
    let takes = 0
    for (const event of replay.events) {
      if (event.type !== 'betResolved') continue
      if (event.trace.outcome === 'win') {
        wins += event.trace.winPaid - event.trace.vigOnWin - event.trace.vigRearm
      }
      if (event.trace.outcome === 'lose') takes += event.trace.stake
    }
    const wealth = (s: TableState) =>
      s.bets.reduce((sum, b) => sum + b.amount, 0) + s.ledger.bankroll
    expect(seven?.wins.exact).toBe(wins)
    expect(seven?.takes.exact).toBe(takes)
    expect(seven?.net.exact).toBe(wealth(replay.state) - wealth(state))
  })

  it('returns null when the machine refuses the roll (nothing rollable to preview)', () => {
    const under = apply(newTable(CRAPLESS, 'coach-under'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(100),
    })
    expect(validateAction(under, { type: 'roll' }, CRAPLESS)).not.toBeNull()
    expect(sevenPreview(under, CRAPLESS)).toBeNull()
  })
})

describe('per-idea dismissal memory (plan §0 #18)', () => {
  it('the come-out working idea appears, and its id dismisses it for good', () => {
    const state = apply(comeOutTable(), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(600),
    })
    const step = stepFor(state)
    expect(step?.alt?.ideaId).toBe('come-out-working')
    expect(step?.alt?.action).toStrictEqual({ type: 'setGlobalWorking', off: true })
    expect(step?.alt?.numbers?.atRisk?.exact).toBe(600) // what Bets Off saves from the 7
    expectValidActions(state, step)
    const dismissed = stepFor(state, { ...NO_CHIP, dismissedIdeas: ['come-out-working'] })
    expect(dismissed?.alt).toBeUndefined()
  })

  it('the skip-odds idea carries its id and respects dismissal', () => {
    let state = comeOutTable()
    state = apply(state, { type: 'roll', dice: { d1: 1, d2: 1 } }) // point 2
    const step = stepFor(state)
    expect(step?.stepId).toBe('odds')
    expect(step?.alt?.ideaId).toBe('skip-odds')
    const dismissed = stepFor(state, { ...NO_CHIP, dismissedIdeas: ['skip-odds'] })
    expect(dismissed?.stepId).toBe('odds')
    expect(dismissed?.alt).toBeUndefined()
  })

  it('the idea only fires when Bets Off actually helps: with bets already off there is no idea', () => {
    let state = apply(comeOutTable(), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(600),
    })
    state = apply(state, { type: 'setGlobalWorking', off: true })
    expect(stepFor(state)?.alt).toBeUndefined()
  })
})

describe('wording as CoachNumbers (plan §0 #18, §10 M9c)', () => {
  it('the line step amount is a CoachNumber from legalBets, and the body shows it', () => {
    const state = newTable(CRAPLESS, 'coach-line')
    const step = stepFor(state)
    expect(step?.stepId).toBe('line')
    expect(step?.cycle).toBe(GUIDE_CYCLE)
    const min = step?.numbers?.min
    expect(min?.source.fn).toBe('legalBets')
    expect(min?.source.configHash).toBe(CRAPLESS.configHash)
    const spot = legalBets(state, CRAPLESS).find((s) => s.typeId === 'pass')
    expect(min?.exact).toBe(spot?.minAdd)
    expect(step?.body).toContain('$1.00')
    expectValidActions(state, step)
  })

  it('the odds step offers exactly maxAdd as a CoachNumber (per-bet caps apply, §0 #18)', () => {
    let state = comeOutTable()
    state = apply(state, { type: 'roll', dice: { d1: 1, d2: 1 } })
    const spot = legalBets(state, CRAPLESS).find((s) => s.typeId === 'passOdds')
    const step = stepFor(state)
    expect(step?.stepId).toBe('odds')
    expect(step?.numbers?.most?.exact).toBe(spot?.maxAdd)
    expect(step?.numbers?.most?.source.fn).toBe('legalBets')
    expect(step?.action).toMatchObject({ type: 'place', typeId: 'passOdds', amount: spot?.maxAdd })
    expectValidActions(state, step)
  })

  it('the chip step names a chip the credit can back, as a verifiable CoachNumber', () => {
    const state = apply(newTable(CRAPLESS, 'coach-chip'), {
      type: 'place',
      typeId: 'place',
      number: 6,
      amount: cents(49_800),
    })
    const step = stepFor(state, { selectedChip: 10_000, chips: null })
    expect(step?.stepId).toBe('chip')
    expect(step?.target).toBe('control:chip:100')
    expect(step?.numbers?.chip?.exact).toBe(100)
    expect(step?.numbers?.chip?.source.fn).toBe('chipFits')
    // The claim is honest: that chip's first tap on the line is accepted.
    expect(
      validateAction(state, { type: 'place', typeId: 'pass', amount: cents(100) }, CRAPLESS),
    ).toBeNull()
  })

  it('the minimum-total step carries the legalBets add as a CoachNumber', () => {
    const state = apply(newTable(CRAPLESS, 'coach-min'), {
      type: 'place',
      typeId: 'pass',
      amount: cents(100),
    })
    const step = stepFor(state)
    expect(step?.stepId).toBe('minTotal')
    expect(step?.numbers?.add?.source.fn).toBe('legalBets')
    expect(step?.action).toBeDefined()
    expectValidActions(state, step)
  })
})

describe('provider contract (§13 M8 → M9 hand-off)', () => {
  it('returns null when no line spot is offered', () => {
    const state = newTable(CRAPLESS, 'coach-null')
    expect(nextStep(state, CRAPLESS, [], NO_CHIP)).toBeNull()
  })

  it('every constructed step suggests only actions the table accepts', () => {
    let state = comeOutTable()
    expectValidActions(state, stepFor(state))
    state = apply(state, { type: 'place', typeId: 'place', number: 8, amount: cents(600) })
    expectValidActions(state, stepFor(state))
    state = apply(state, { type: 'roll', dice: { d1: 3, d2: 3 } }) // point 6
    expectValidActions(state, stepFor(state))
    state = apply(state, { type: 'setGlobalWorking', off: true })
    expectValidActions(state, stepFor(state))
  })
})
