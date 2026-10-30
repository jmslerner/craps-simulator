import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cents, legalBets, validateAction } from '../../engine/index.ts'
import type { Action, MachineConfig, TableState, WindowedSession } from '../../engine/index.ts'
import { CRAPLESS, bet, placePass, roll, testSession } from '../test/game.ts'
import { COMPILED_PRESETS } from './machineStore.ts'
import {
  GUIDE_CYCLE,
  createCoachMemoryStore,
  nextStep,
  type NextStep,
  type NextStepSettings,
} from './nextStep.ts'

const NO_CHIP: NextStepSettings = { selectedChip: null, chips: null }

function stepFor(
  state: TableState,
  settings: NextStepSettings = NO_CHIP,
  cfg: MachineConfig = CRAPLESS,
): NextStep | null {
  return nextStep(state, cfg, legalBets(state, cfg), settings)
}

/** Every suggested action must pass validateAction on the state it was suggested for. */
function expectValidActions(state: TableState, step: NextStep | null, cfg: MachineConfig): void {
  if (step === null) return
  if (step.action !== undefined) {
    expect(validateAction(state, step.action, cfg), step.stepId).toBeNull()
  }
  if (step.alt?.action !== undefined) {
    expect(validateAction(state, step.alt.action, cfg), step.alt.stepId).toBeNull()
  }
}

describe('the guide walks the basic round (plan §0 #18)', () => {
  it('a new game starts at step 1: bet the line, one tap at the smallest bet', () => {
    const session = testSession('guide-fresh')
    const step = stepFor(session.state)
    expect(step).not.toBeNull()
    expect(step?.cycle).toBe(GUIDE_CYCLE)
    expect(step?.activeStep).toBe(0)
    expect(step?.stepId).toBe('line')
    expect(step?.target).toBe('zone:pass')
    expect(step?.action).toStrictEqual({ type: 'place', typeId: 'pass', amount: 100 })
    expect(step?.body).toContain('$1.00') // minAdd, formatted with formatCents
    expectValidActions(session.state, step, CRAPLESS)
  })

  it('with the line bet down and the minimum met, the step is the come-out roll', () => {
    const session = placePass(testSession('guide-comeout'))
    const step = stepFor(session.state)
    expect(step?.activeStep).toBe(1)
    expect(step?.stepId).toBe('comeOutRoll')
    expect(step?.target).toBe('control:roll')
    expect(step?.action).toStrictEqual({ type: 'roll' })
  })

  it('under the round minimum it explains the refused roll and offers a legal add', () => {
    const session = placePass(testSession('guide-mintotal'), 100) // $1 pass, $5 minimum
    const step = stepFor(session.state)
    expect(step?.stepId).toBe('minTotal')
    expect(step?.activeStep).toBe(1)
    expect(step?.action).toBeDefined()
    expectValidActions(session.state, step, CRAPLESS)
  })

  it('on the point it offers odds at exactly the maxAdd the machine takes', () => {
    const opened = placePass(testSession('guide-odds'))
    const pointSet = roll(opened, [1, 1]).session // point 2
    const spot = legalBets(pointSet.state, CRAPLESS).find((s) => s.typeId === 'passOdds')
    const step = stepFor(pointSet.state)
    expect(step?.activeStep).toBe(2)
    expect(step?.stepId).toBe('odds')
    expect(step?.target).toBe('zone:passOdds')
    expect(step?.action).toMatchObject({ type: 'place', typeId: 'passOdds', amount: spot?.maxAdd })
    // The optional idea: roll without odds, since the roll is legal.
    expect(step?.alt?.stepId).toBe('skipOdds')
    expect(step?.alt?.action).toStrictEqual({ type: 'roll' })
    expectValidActions(pointSet.state, step, CRAPLESS)
  })

  it('with the odds maxed out, the step is to roll for the point', () => {
    const opened = placePass(testSession('guide-maxed'))
    let session = roll(opened, [1, 1]).session
    const spot = legalBets(session.state, CRAPLESS).find((s) => s.typeId === 'passOdds')
    if (spot === undefined || spot.parentId === null) throw new Error('no odds spot')
    session = bet(session, {
      type: 'place',
      typeId: 'passOdds',
      parentId: spot.parentId,
      amount: spot.maxAdd,
    })
    const step = stepFor(session.state)
    expect(step?.activeStep).toBe(3)
    expect(step?.stepId).toBe('pointRoll')
    expect(step?.action).toStrictEqual({ type: 'roll' })
  })

  it('without credit for the line it says to add credit, with a one-tap deposit', () => {
    let session = testSession('guide-nocredit')
    session = bet(session, { type: 'place', typeId: 'place', number: 6, amount: cents(50_000) })
    const step = stepFor(session.state)
    expect(step?.stepId).toBe('addCredit')
    expect(step?.activeStep).toBe(0)
    expect(step?.target).toBe('control:add-credit')
    expect(step?.action).toStrictEqual({ type: 'deposit', amount: CRAPLESS.startingBankroll })
    expectValidActions(session.state, step, CRAPLESS)
  })

  it('points at a smaller chip when the chip in hand cannot make the line bet (§0 #18)', () => {
    let session = testSession('guide-chip')
    session = bet(session, { type: 'place', typeId: 'place', number: 6, amount: cents(49_800) })
    // $2.00 credit left: the $100 chip in hand cannot bet the line, the $1 chip can.
    const step = stepFor(session.state, { selectedChip: 10_000, chips: null })
    expect(step?.stepId).toBe('chip')
    expect(step?.target).toBe('control:chip:100')
    expect(step?.action).toBeUndefined()
    expect(step?.body).toContain('$1.00')
  })

  it('never suggests a chip the credit cannot back: it falls back to the line step', () => {
    const session = testSession('guide-chip-fits')
    const step = stepFor(session.state, { selectedChip: 2_500, chips: null })
    expect(step?.stepId).toBe('line') // the $25 chip fits a fresh table
  })

  it('returns null for a machine without a come-out do line', () => {
    const live = COMPILED_PRESETS.traditionalLive345
    const state = testSession('guide-live', live).state
    const step = nextStep(state, live, legalBets(state, live), NO_CHIP)
    // The live table has a pass line, so this machine does give a guide; assert it exists to keep
    // the preset honest, and build the no-line case from a state with no line spot instead.
    expect(step).not.toBeNull()
    const noLine = nextStep(state, live, [], NO_CHIP)
    expect(noLine).toBeNull()
  })
})

describe('property: every suggested action passes validateAction (plan §0 #18)', () => {
  // Random short sessions on two machines, driven through the real session API with choices from
  // fast-check (pinned seed 20261028): at every betting state along the way, the guide's action
  // and its alternative must be actions the table accepts.
  const machines: readonly MachineConfig[] = [CRAPLESS, COMPILED_PRESETS.strictBubble]

  function driveAndCheck(
    cfg: MachineConfig,
    choices: readonly number[],
    chip: number | null,
  ): void {
    let session: WindowedSession = testSession(`guide-prop-${choices.length}`, cfg)
    const settings: NextStepSettings = { selectedChip: chip, chips: null }
    const check = (state: TableState) => {
      const step = nextStep(state, cfg, legalBets(state, cfg), settings)
      expectValidActions(state, step, cfg)
    }
    check(session.state)
    for (const choice of choices) {
      const spots = legalBets(session.state, cfg).filter((spot) => spot.canAdd === null)
      const kind = choice % 4
      if (kind === 0 && spots.length > 0) {
        const spot = spots[Math.trunc(choice / 4) % spots.length]
        if (spot !== undefined) {
          const action: Action = {
            type: 'place',
            typeId: spot.typeId,
            ...(spot.number === null ? {} : { number: spot.number }),
            ...(spot.parentId === null ? {} : { parentId: spot.parentId }),
            amount: spot.minAdd,
          }
          const result = bet(session, action, cfg)
          session = result
        }
      } else if (kind === 1) {
        const step = nextStep(session.state, cfg, legalBets(session.state, cfg), settings)
        if (step?.action !== undefined && step.action.type !== 'roll') {
          session = bet(session, step.action, cfg) // the guide's own suggestion must apply
        }
      } else if (kind === 2) {
        const rolled = validateAction(session.state, { type: 'roll' }, cfg)
        if (rolled === null) session = roll(session, undefined, cfg).session
      } else {
        const deposit = validateAction(
          session.state,
          { type: 'deposit', amount: cents(5_000) },
          cfg,
        )
        if (deposit === null) {
          session = bet(session, { type: 'deposit', amount: cents(5_000) }, cfg)
        }
      }
      check(session.state)
    }
  }

  for (const cfg of machines) {
    it(`holds on ${cfg.id} over random short sessions`, () => {
      fc.assert(
        fc.property(
          fc.array(fc.nat({ max: 1_000 }), { minLength: 1, maxLength: 24 }),
          fc.option(fc.constantFrom(100, 500, 2_500, 10_000), { nil: null }),
          (choices, chip) => driveAndCheck(cfg, choices, chip),
        ),
        { seed: 20261028, numRuns: 60 },
      )
    })
  }
})

describe('the coach memory store (plan §10 M9c): per-idea dismissals and gate memory', () => {
  it('remembers dismissed ideas once each, and the provider then drops that idea', () => {
    const store = createCoachMemoryStore()
    expect(store.getState().dismissedIdeas).toStrictEqual([])
    store.getState().dismissIdea('skip-odds')
    store.getState().dismissIdea('skip-odds')
    expect(store.getState().dismissedIdeas).toStrictEqual(['skip-odds'])

    const opened = placePass(testSession('guide-dismiss'))
    const pointSet = roll(opened, [1, 1]).session
    const withIdea = stepFor(pointSet.state)
    expect(withIdea?.alt?.ideaId).toBe('skip-odds')
    const without = stepFor(pointSet.state, {
      selectedChip: null,
      chips: null,
      dismissedIdeas: store.getState().dismissedIdeas,
    })
    expect(without?.alt).toBeUndefined()
  })

  it('tracks advice dismissals, for-fun types and the toast budget through the pure helpers', () => {
    const store = createCoachMemoryStore()
    store.getState().dismissAdvice('same-event|place|4|')
    store.getState().dismissAdvice('same-event|place|4|')
    store.getState().markForFun('hard')
    store.getState().noteToast('edge-warning|any7||', 12)
    const memory = store.getState().memory
    expect(memory.dismissed['same-event|place|4|']).toBe(2)
    expect(memory.forFun).toStrictEqual(['hard'])
    expect(memory.shownAt['edge-warning|any7||']).toBe(12)
    expect(memory.lastToastRoll).toBe(12)
    store.getState().reset()
    expect(store.getState().memory.lastToastRoll).toBeNull()
    expect(store.getState().dismissedIdeas).toStrictEqual([])
  })
})
