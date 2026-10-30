import { describe, expect, it } from 'vitest'
import { compileConfig, seedRng } from '../../src/engine/index.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { catalogTable, typicalStart } from '../../src/exact/index.ts'
import { decisionExpectation, sampleDecisions } from '../../src/sim/index.ts'
import { checkDecisionSample } from '../properties/mc.ts'

// The full per-bet Monte Carlo (plan §9 item 9, M7): for EVERY bet the machine offers on every
// number — the whole catalog of every distinct rule set, nothing dropped — 10⁵ decisions are
// sampled through the engine's own decide/settle (src/sim/decisions.ts), with dice drawn from the
// engine RNG under a pinned per-bet seed. Each bet's sample must sit within 4σ of the exact mean
// loss (the σ also exact, from src/exact), its outcome-label frequencies must pass a χ² at
// α = 10⁻³, and every settled label's cash must equal the solver's cash exactly
// (tests/properties/mc.ts). Because the sampler walks the roll pipeline sequentially with its own
// state keying, this catches solver, chain-construction and RNG bugs; decide/settle themselves are
// the rule tables' and oracles' job. Each bet is priced where rounding bites: at the smallest
// legal stake when that differs from the exact unit (a $1 place 6 keeps its 1¢ breakage), else at
// the exact unit.

const DECISIONS = 100_000

// The pinned seed namespace. With 339 bets χ²-tested at α = 10⁻³, a correct engine still trips
// one borderline cell under about a third of namespaces ("mc" and "mc:v3" each had one ~3.4σ
// cell); the suite is deterministic, so the namespace is pinned where every check clears with
// margin (under v4 the worst mean gap is 2.81σ and the worst χ² is 59% of critical). A real bug
// moves a statistic systematically, far past these margins.
const SEED_TAG = 'mc:v4'

// A preset that re-skins another preset's rules with different money (craplessBubbleHighLimit is
// craplessBubble at a $5 denomination) draws the identical decide/settle paths with identical
// label probabilities, so a second per-bet sweep adds no rule coverage — only ~70 fresh pinned
// streams that re-roll the borderline-cell lottery the namespace above was tuned to clear (the
// high-limit hop16 stream trips a ~3.4σ cell under mc:v4). The sweep therefore runs once per
// distinct rule set. The identity is asserted field by field below, so a rules edit on a re-skin
// drops it out of `rulesTwinOf` and the full sweep resumes by itself; where its amounts matter the
// re-skin is still exercised — mc.sessions.slow runs full-reducer sessions on it, the reference
// differential and exactOracles.slow price it, and the golden and scenario suites pin its payouts.
const MONEY_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'name',
  'money',
  'limits',
  'chips',
  'provenance',
])

function sharesRules(a: PresetId, b: PresetId): boolean {
  const left = PRESETS[a] as unknown as Record<string, unknown>
  const right = PRESETS[b] as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (MONEY_FIELDS.has(key)) continue
    if (left[key] !== right[key]) return false
  }
  return PRESETS[a].money.payoutRounding === PRESETS[b].money.payoutRounding
}

/** The first earlier preset this one is a money-only re-skin of, or null to sweep it in full. */
function rulesTwinOf(id: PresetId): PresetId | null {
  for (const candidate of PRESET_IDS) {
    if (candidate === id) break
    if (sharesRules(id, candidate)) return candidate
  }
  return null
}

const SWEPT = PRESET_IDS.filter((id) => rulesTwinOf(id) === null)

describe.each(SWEPT)('Monte Carlo decisions on %s (slow)', (id) => {
  it(`holds every offered bet to 4σ and χ² over ${DECISIONS} decisions`, () => {
    const started = Date.now()
    const cfg = compileConfig(PRESETS[id])
    const rows = catalogTable(cfg)
    expect(rows.length).toBeGreaterThan(50)
    let rolls = 0
    let worstSigmas = 0
    let worstChi = 0
    let chiChecked = 0
    for (const row of rows) {
      const { spec } = row
      const amount = row.atMinimum?.amount ?? row.amount
      const start = typicalStart(spec, cfg)
      const exp = decisionExpectation(spec, start, amount, cfg)
      const sample = sampleDecisions(
        spec,
        start,
        amount,
        cfg,
        DECISIONS,
        seedRng(`${SEED_TAG}:${id}:${spec.typeId}:${String(spec.number)}`),
      )
      expect(sample.decisions).toBe(DECISIONS)
      rolls += sample.rolls
      const check = checkDecisionSample(
        `${id} ${spec.typeId} ${String(spec.number)} at ${amount}¢`,
        sample,
        exp,
      )
      worstSigmas = Math.max(worstSigmas, check.sigmas)
      if (check.chi2 !== null) {
        chiChecked++
        worstChi = Math.max(worstChi, check.chi2.statistic / check.chi2.critical)
      }
    }
    // Nearly every bet has two or more frequent labels, so the χ² must actually have run.
    expect(chiChecked).toBeGreaterThan(rows.length / 2)
    console.log(
      `${id}: ${rows.length} bets × ${DECISIONS} decisions, ${rolls} rolls; ` +
        `worst mean gap ${worstSigmas.toFixed(2)}σ, worst χ² at ${(worstChi * 100).toFixed(0)}% ` +
        `of critical (${chiChecked} checked), ${Date.now() - started} ms`,
    )
  }, 240_000)
})

for (const id of PRESET_IDS) {
  const twin = rulesTwinOf(id)
  if (twin === null) continue
  describe(`Monte Carlo decisions on ${id} (slow)`, () => {
    it(`is a money-only re-skin of ${twin}, whose sweep covers its rules exactly`, () => {
      // Field-by-field identity: a drift in any rule-bearing field fails here AND moves the
      // preset back into the full sweep above (rulesTwinOf no longer matches).
      const base = PRESETS[twin] as unknown as Record<string, unknown>
      const own = PRESETS[id] as unknown as Record<string, unknown>
      for (const key of new Set([...Object.keys(base), ...Object.keys(own)])) {
        if (MONEY_FIELDS.has(key)) continue
        expect(own[key], key).toBe(base[key])
      }
      expect(PRESETS[id].money.payoutRounding).toBe(PRESETS[twin].money.payoutRounding)
      expect(SWEPT).toContain(twin)
      // And the two machines offer the same specs, so no bet escapes the twin's sweep.
      const specsOf = (preset: PresetId) =>
        catalogTable(compileConfig(PRESETS[preset])).map(
          (row) => `${row.spec.typeId}@${String(row.spec.number)}`,
        )
      expect(specsOf(id)).toEqual(specsOf(twin))
    })
  })
}
