import { describe, expect, it } from 'vitest'
import {
  Fraction,
  compileConfig,
  pointRunProgress,
  seedRng,
  totalBit,
  type MachineConfig,
  type Phase,
} from '../../src/engine/index.ts'
import { PRESETS } from '../../src/engine/config/presets/index.ts'
import { COME_OUT, catalogRow, startAt, type BetSpec } from '../../src/exact/index.ts'
import { decisionExpectation, sampleDecisions } from '../../src/sim/index.ts'
import { checkDecisionSample } from '../properties/mc.ts'

// The side-bet Monte Carlo (plan §10 M11, §9 item 9): every side bet of every distinct preset rule
// set, started from the progress states the coach prices — a Lucky Roller part-way through its
// set, a Fire Bet with points made, a Hot Shooter at each tier boundary (and past the top tier,
// where the solver lumps the count and the sampler does not), a Lucky Shooter before its point,
// with hits and with every other box number hit — sampled through the engine's own decide/settle
// with dice from the engine RNG, then held to 4σ on the mean loss, a χ² at α = 10⁻³ on the
// settlement labels and exact per-label cash (tests/properties/mc.ts); a state with one possible
// ending (the Hot Shooter at 49 rolls and beyond under definition A) must end that one way every
// time, which is exactly what the solver's lumping claims. The typical (new) starts are already in
// mc.decisions.slow's sweep of the whole catalog.

const DECISIONS = 50_000
const SEED_TAG = 'mc:side:v1'

interface ProgressStart {
  readonly name: string
  readonly phase: Phase
  readonly progress: number
}

const mask = (...totals: number[]) => totals.reduce((bits, total) => bits | totalBit(total as 2), 0)

/** The progress states worth sampling for each side bet of a machine. */
function startsFor(cfg: MachineConfig, typeId: string): ProgressStart[] {
  const type = cfg.sideBets.get(typeId)
  if (type === undefined) throw new Error(`${cfg.id} has no side bet ${typeId}`)
  const point = (n: number): Phase => ({ kind: 'point', point: n as 4 })
  switch (type.family) {
    case 'collectSet': {
      const [first, ...rest] = type.targets
      if (first === undefined) return []
      return [
        { name: 'first target rolled', phase: COME_OUT, progress: mask(first) },
        {
          name: 'all but the last target',
          phase: point(5),
          progress: mask(first, ...rest.slice(0, -1)),
        },
      ]
    }
    case 'uniquePointsMade':
      return [
        { name: 'three points made', phase: point(8), progress: mask(4, 5, 6) },
        { name: 'five points made', phase: point(10), progress: mask(4, 5, 6, 8, 9) },
      ]
    case 'handLength':
      return [7, 15, 16, 44, 49, 50, 60].map((rolls) => ({
        name: `${rolls} rolls counted`,
        phase: point(6),
        progress: rolls,
      }))
    case 'pointRun':
      return [
        { name: 'point 6, no hits', phase: point(6), progress: pointRunProgress(6, 0) },
        { name: 'point 6, two hits', phase: point(6), progress: pointRunProgress(6, mask(4, 9)) },
        {
          name: 'point 6, every other box number hit',
          phase: point(6),
          progress: pointRunProgress(6, mask(4, 5, 8, 9, 10)),
        },
      ]
  }
}

const MACHINES = [
  'craplessBubble',
  'traditionalBubble',
  'strictBubble',
  'traditionalLive345',
] as const

describe.each(MACHINES)('side bets on %s from their progress states (slow)', (id) => {
  const cfg = compileConfig(PRESETS[id])
  const cases = [...cfg.sideBets.keys()].flatMap((typeId) =>
    startsFor(cfg, typeId).map((start) => [`${typeId}: ${start.name}`, typeId, start] as const),
  )

  it.each(cases)(
    '%s: 5×10⁴ sampled decisions match the exact distribution',
    (name, typeId, start) => {
      const spec: BetSpec = { typeId, number: null }
      const amount = catalogRow(spec, cfg).amount
      const from = startAt(start.phase, { carried: true, progress: start.progress })
      const exp = decisionExpectation(spec, from, amount, cfg)
      const sample = sampleDecisions(
        spec,
        from,
        amount,
        cfg,
        DECISIONS,
        seedRng(`${SEED_TAG}:${id}:${typeId}:${start.progress}`),
      )
      expect(sample.decisions).toBe(DECISIONS)
      if (exp.variance.isZero()) {
        // One possible ending: every sampled decision is that label, at the solver's cash.
        const certain = exp.labels.filter(({ probability }) => probability.equals(Fraction.ONE))
        expect(certain).toHaveLength(1)
        const [only] = certain
        if (only === undefined) throw new Error('no certain label')
        expect([...sample.counts.entries()]).toEqual([[only.key, DECISIONS]])
        expect(Fraction.of(sample.totalCash).equals(only.cash.mul(Fraction.of(DECISIONS)))).toBe(
          true,
        )
        return
      }
      const check = checkDecisionSample(`${id} ${name} at ${amount}¢`, sample, exp)
      expect(check.sigmas).toBeLessThanOrEqual(4)
      // Every other state here has two or more outcomes, so the χ² always runs.
      expect(check.chi2).not.toBeNull()
    },
  )
})
