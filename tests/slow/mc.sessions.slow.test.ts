import { describe, expect, it } from 'vitest'
import { compileConfig, seedRng } from '../../src/engine/index.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { typicalStart } from '../../src/exact/index.ts'
import { decisionExpectation, playFlatBet, playRandomRolls } from '../../src/sim/index.ts'
import { flatSpec, flatStake } from '../properties/mc.ts'

// Full-reducer Monte Carlo sessions (plan §9 item 9, M7): 500 sessions × 200 rolls through
// `applyAction` with the invariants ON (the reducer's default — src/sim/drive.ts never opts out),
// so every action re-proves the ledger identity `deposits = bankroll + Σ bets + houseNet`, and any
// wiring bug throws. Two runs:
//
// - **Random legal actions** (the 500): up to three random placements, presses, toggles,
//   take-downs and deposits between rolls, dice from each table's own seeded stream. No house-net
//   bound here: under random toggling and take-downs, each placed bet's exact expectation depends
//   on the phase it was placed in, its toggle history and when it was pulled down, so a per-bet
//   expectation is impractical — that is the documented weaker bound of plan §9 item 9.
// - **Flat strategies** carry the exact house-net bound instead: pass-only and field-only sessions
//   (always working, no commission, placed fresh whenever the spot is empty), where every decision
//   is an independent draw from the bet's typical-start decision distribution. Each session rolls
//   200 times and then drains until the open decision resolves, so no decision is censored
//   mid-flight; the number of decisions K is then a stopping time on decision boundaries, and the
//   total house net is a sum of K complete i.i.d. decision losses: |net − K·μ| ≤ 4σ√K with μ and σ
//   exact from src/exact. House net equals that sum exactly because a settlement moves
//   `stake − credited` (a stays-up stake counting as returned and re-wagered) and nothing else
//   moves houseNet in these sessions.

const RANDOM_RUNS: Record<PresetId, number> = {
  craplessBubble: 200,
  // The high-limit preset shares craplessBubble's rules: the default machine keeps the deep run.
  craplessBubbleHighLimit: 100,
  traditionalBubble: 100,
  strictBubble: 100,
  traditionalLive345: 100,
}
const ROLLS = 200
const FLAT_RUNS = 60

describe.each(PRESET_IDS)('Monte Carlo sessions on %s (slow)', (id) => {
  const cfg = compileConfig(PRESETS[id])

  it(`plays ${RANDOM_RUNS[id]} random sessions of ${ROLLS} rolls with invariants on`, () => {
    const started = Date.now()
    let choices = seedRng(`mc-choices:${id}`)
    let rolls = 0
    let accepted = 0
    let rejected = 0
    let settlements = 0
    let deposits = 0
    for (let run = 0; run < RANDOM_RUNS[id]; run++) {
      const [tally, next] = playRandomRolls(cfg, `mc-random:${id}:${run}`, ROLLS, choices)
      choices = next
      expect(tally.finalImbalance, `session ${run}: the final ledger must balance`).toBe(0)
      rolls += tally.rolls
      accepted += tally.accepted
      rejected += tally.rejected
      settlements += tally.settlements
      deposits += tally.deposits
    }
    expect(rolls).toBe(RANDOM_RUNS[id] * ROLLS)
    // The sessions must actually exercise the reducer: bets up and settling all along.
    expect(settlements).toBeGreaterThan(RANDOM_RUNS[id] * 80)
    expect(accepted).toBeGreaterThan(RANDOM_RUNS[id] * 100)
    console.log(
      `${id}: ${RANDOM_RUNS[id]} sessions × ${ROLLS} rolls, ${accepted} actions accepted ` +
        `(${rejected} refused, ${deposits} deposits), ${settlements} settlements, ` +
        `${Date.now() - started} ms`,
    )
  }, 240_000)

  describe.each(['pass', 'field'] as const)('flat %s sessions', (typeId) => {
    it(`keeps total house net within 4σ of the exact mean over ${FLAT_RUNS} sessions`, () => {
      const started = Date.now()
      const spec = flatSpec(typeId)
      const amount = flatStake(cfg, typeId)
      const exp = decisionExpectation(spec, typicalStart(spec, cfg), amount, cfg)
      let decisions = 0
      let net = 0
      let rolls = 0
      for (let run = 0; run < FLAT_RUNS; run++) {
        const tally = playFlatBet(cfg, typeId, amount, `mc-flat:${id}:${typeId}:${run}`, ROLLS)
        decisions += tally.decisions
        net += tally.houseNet
        rolls += tally.rolls
      }
      expect(decisions).toBeGreaterThan(FLAT_RUNS * 20)
      const mean = exp.meanLoss.toNumber()
      const sigma = Math.sqrt(exp.variance.toNumber())
      const sigmas = Math.abs(net - decisions * mean) / (sigma * Math.sqrt(decisions))
      expect(
        sigmas,
        `${id} ${typeId} at ${amount}¢: house net ${net}¢ over ${decisions} decisions vs exact ` +
          `${(decisions * mean).toFixed(0)}¢ (${sigmas.toFixed(2)}σ)`,
      ).toBeLessThanOrEqual(4)
      console.log(
        `${id} flat ${typeId}: ${decisions} decisions in ${rolls} rolls, net ${net}¢ vs ` +
          `${(decisions * mean).toFixed(0)}¢ exact (${sigmas.toFixed(2)}σ), ` +
          `${Date.now() - started} ms`,
      )
    }, 240_000)
  })
})
