import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { legalBets } from '../../src/engine/bets/legal.ts'
import { validateAction } from '../../src/engine/table/reducer.ts'
import { headerConfig, replayHistory } from '../../src/engine/session/replay.ts'
import { parseSessionLog } from '../../src/engine/session/serialize.ts'
import type { TableState } from '../../src/engine/table/state.ts'
import { nextStep, type NextStepSettings } from '../../src/ui/state/nextStep.ts'

/**
 * The next-step guide over the fixture (plan §0 #18): on every reachable betting state of the
 * crapless-200 log — each window as it opens and again as its roll is made — any action the guide
 * suggests must pass `validateAction`. The random-short-session half of the property runs in
 * `src/ui/state/nextStep.test.ts` with the pinned fast-check seed; this half drives the recorded
 * play, bets, deposits, presses, vigs, holds and all.
 */

const FIXTURE = new URL('../replay/fixtures/crapless-200.json', import.meta.url)

const SETTINGS: readonly NextStepSettings[] = [
  { selectedChip: null, chips: null },
  { selectedChip: 10_000, chips: null },
  { selectedChip: 100, chips: [100, 500] },
]

describe('nextStep on every betting state of the crapless-200 fixture', () => {
  const parsed = parseSessionLog(readFileSync(FIXTURE, 'utf8'))
  if (!parsed.ok) throw new Error(`the fixture does not parse: ${JSON.stringify(parsed.error)}`)
  const cfg = headerConfig(parsed.log.header)
  const windows = replayHistory(parsed.log.header, parsed.log.windows)

  it('never suggests an action the table refuses', () => {
    let states = 0
    let suggested = 0
    const check = (state: TableState, where: string) => {
      states += 1
      const step = nextStep(state, cfg, legalBets(state, cfg), SETTINGS[states % SETTINGS.length]!)
      if (step === null) return
      expect(step.activeStep, where).toBeGreaterThanOrEqual(0)
      expect(step.activeStep, where).toBeLessThan(step.cycle.length)
      for (const offered of [step.action, step.alt?.action]) {
        if (offered === undefined) continue
        suggested += 1
        expect(validateAction(state, offered, cfg), `${where}: ${step.stepId}`).toBeNull()
      }
    }
    for (const window of windows) {
      check(window.start, `window ${window.index} start`)
      check(window.atRoll, `window ${window.index} atRoll`)
    }
    expect(states).toBe(400)
    // The guide is not vacuous: most recorded states carry a one-tap suggestion.
    expect(suggested).toBeGreaterThan(300)
  })
})
