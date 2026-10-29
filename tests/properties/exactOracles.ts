import fc from 'fast-check'
import { ConfigError, compileConfig, type MachineConfig } from '../../src/engine/config/compile.ts'
import { PRESETS, PRESET_IDS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { pruneProvenance } from '../../src/engine/config/provenance.ts'
import type { PointNumber } from '../../src/engine/config/rulesets.ts'
import type { MachineConfigInput } from '../../src/engine/config/schema.ts'
import { cents } from '../../src/engine/core/money.ts'
import { Fraction } from '../../src/engine/core/rational.ts'
import type { Phase } from '../../src/engine/round/round.ts'
import { analyzeBet, clearAnalysisCache, startAt, type BetSpec } from '../../src/exact/index.ts'
import { analyze } from '../oracle/closedForm.ts'
import { closedFormOf, machineBets, type MachineBet } from '../oracle/closedFormOf.ts'
import {
  dispatchAnalysis,
  dispatchBetOf,
  dispatchVariant,
  type DispatchBet,
} from '../oracle/dispatchChain.ts'
import { factsFrom, typeFacts, type MachineFacts } from '../oracle/machineFacts.ts'
import { edited, editArb } from '../oracle/randomMachine.ts'

/**
 * The exact analysis against the independent oracles (plan §9 items 3 and 4, M6 acceptance):
 *
 * - **Closed form** (`tests/oracle/closedForm.ts`, read for one bet by `closedFormOf`): for a bet the
 *   closed form models, `analyzeBet` must give exactly its edge as paid and its nominal edge, the
 *   first decision's chances and loss, the lifecycle's decisions, working rolls, loss and amount
 *   risked, the edge per working roll and the commission paid at placement; and, for a bet that
 *   works on every roll, the rolls per decision.
 * - **Dispatch chain** (`tests/oracle/dispatchChain.ts`: the bet's chain built by driving the real
 *   reducer and solved by `denseSolve.ts`): from the table the chain starts on, `analyzeBet` must
 *   give exactly its lifecycle (edge, loss, amount risked, decisions, rolls, working rolls, edge per
 *   working roll) and its first decision (chances, rolls, loss). Every bet the machine offers is
 *   compared, those the closed form leaves out (odds OFF on the come-out) included.
 *
 * Each comparison returns one line per metric that differs; the bar is none.
 */

/** A metric's two values, and its name. */
type Pair = readonly [string, Fraction, Fraction]

/** One line per pair whose values differ. */
function differing(at: string, left: string, right: string, pairs: readonly Pair[]): string[] {
  return pairs
    .filter(([, a, b]) => !a.equals(b))
    .map(([what, a, b]) => `${at} ${what}: ${left} ${a.toString()}, ${right} ${b.toString()}`)
}

/** The bet as `analyzeBet` names it. */
function specOf(bet: MachineBet): BetSpec {
  return { typeId: bet.typeId, number: bet.number as PointNumber | null }
}

/**
 * `analyzeBet` (from the bet's typical placement) against the closed form at `bet.amount`; null
 * when the closed form does not model the bet. `cfg` is `facts`' machine, compiled.
 */
export function closedFormMismatches(
  cfg: MachineConfig,
  facts: MachineFacts,
  bet: MachineBet,
): string[] | null {
  const form = closedFormOf(facts, bet)
  const nominalForm = closedFormOf(facts, bet, 'exact')
  if (form === null || nominalForm === null) return null
  const paid = analyze(form)
  const nominal = analyze(nominalForm)
  const exact = analyzeBet(specOf(bet), cents(bet.amount), 'typical', cfg)
  const pairs: Pair[] = [
    ['edge', exact.edge, paid.edge],
    ['nominalEdge', exact.nominalEdge, nominal.edge],
    ['pWin', exact.pWin, paid.pWin],
    ['pLose', exact.pLose, paid.pLose],
    ['pPush', exact.pPush, paid.pPush],
    ['edgePerWorkingRoll', exact.edgePerWorkingRoll, paid.edgePerWorkingRoll],
    ['lossPerDecision', exact.lossPerDecision, paid.perDecision.loss],
    ['decisions', exact.lifecycle.decisions, paid.decisions],
    ['workingRolls', exact.lifecycle.workingRolls, paid.workingRolls],
    ['loss', exact.lifecycle.loss, paid.loss],
    ['risked', exact.lifecycle.risked, paid.risked],
    ['placementVig', Fraction.of(exact.vig.placement), form.upfront],
  ]
  const family = typeFacts(facts, bet.typeId).family
  if (family === 'line' || family === 'oneRoll' || family === 'composite') {
    pairs.push(['rollsPerDecision', exact.expectedRolls, paid.workingRollsPerDecision])
  }
  const at = `${facts.id} ${bet.typeId}@${bet.number ?? '-'} ${bet.amount}¢`
  return differing(at, 'analyzeBet', 'closed form', pairs)
}

/**
 * The phase of the next roll on a dispatch table when the bet goes in: the come-out, or the point
 * the bet (a come or don't come bet) or its parent's travel was rolled under, or (pass and don't
 * pass odds) the parent's own point.
 */
export function dispatchPhase(bet: DispatchBet): Phase {
  const point = bet.point ?? bet.parent?.number ?? null
  return point === null ? { kind: 'comeOut' } : { kind: 'point', point: point as PointNumber }
}

/** `analyzeBet` against the dispatch chain of `bet` on `cfg` (a compiled `dispatchVariant`). */
export function dispatchMismatches(
  cfg: MachineConfig,
  facts: MachineFacts,
  bet: MachineBet,
): string[] {
  const placed = dispatchBetOf(facts, bet)
  const exact = analyzeBet(specOf(bet), cents(bet.amount), startAt(dispatchPhase(placed)), cfg)
  const life = dispatchAnalysis(cfg, placed, 'lifetime')
  const once = dispatchAnalysis(cfg, placed, 'decision')
  const outcome = (name: string) => once.outcomes.get(name) ?? Fraction.ZERO
  const stake = Fraction.of(bet.amount)
  const pairs: Pair[] = [
    ['edge', exact.edge, life.edge],
    ['loss', exact.lifecycle.loss, life.loss],
    ['risked', exact.lifecycle.risked, life.risked],
    ['wagered', exact.lifecycle.decisions.mul(stake), life.wagered],
    ['rolls', exact.lifecycle.rolls, life.expectedRolls],
    ['workingRolls', exact.lifecycle.workingRolls, life.expectedWorkingRolls],
    ['edgePerWorkingRoll', exact.edgePerWorkingRoll, life.edgePerWorkingRoll],
    ['pWin', exact.pWin, outcome('win')],
    ['pLose', exact.pLose, outcome('lose')],
    ['pPush', exact.pPush, outcome('push')],
    ['rollsPerDecision', exact.expectedRolls, once.expectedRolls],
    ['lossPerDecision', exact.lossPerDecision, once.loss],
    ['placementVig', Fraction.of(exact.vig.placement), Fraction.of(life.placementVig)],
  ]
  const at = `${facts.id} ${bet.typeId}@${bet.number ?? '-'} ${bet.amount}¢`
  return differing(at, 'analyzeBet', 'reducer', pairs)
}

/** What a sweep compared: bets, and the lines that differ. */
export interface SweepReport {
  readonly checked: number
  readonly mismatches: readonly string[]
}

/**
 * Every bet `input` offers, at each of `stakes`, through `analyzeBet` and the dispatch chain, on
 * its `dispatchVariant` (1¢ increments, no minimum total: plan §9 item 4). The exact module's
 * caches are emptied afterwards: no later machine shares their keys, and a long sweep stays small.
 */
export function dispatchSweep(
  input: MachineConfigInput,
  stakes: readonly number[],
  filter: (bet: MachineBet) => boolean = () => true,
): SweepReport {
  const variant = dispatchVariant(input)
  const cfg = compileConfig(variant)
  const facts = factsFrom(variant)
  const mismatches: string[] = []
  let checked = 0
  for (const stake of stakes) {
    for (const bet of machineBets(facts, stake).filter(filter)) {
      checked++
      mismatches.push(...dispatchMismatches(cfg, facts, bet))
    }
  }
  clearAnalysisCache()
  return { checked, mismatches }
}

/** Every bet `input` offers that the closed form models, at each of `stakes` (caches emptied after). */
export function closedFormSweep(input: MachineConfigInput, stakes: readonly number[]): SweepReport {
  const cfg = compileConfig(input)
  const facts = factsFrom(input)
  const mismatches: string[] = []
  let checked = 0
  for (const stake of stakes) {
    for (const bet of machineBets(facts, stake)) {
      const found = closedFormMismatches(cfg, facts, bet)
      if (found === null) continue
      checked++
      mismatches.push(...found)
    }
  }
  clearAnalysisCache()
  return { checked, mismatches }
}

// ---------------------------------------------------------------------------------------------
// Random machines for the closed-form fuzz (plan §9 item 3)
// ---------------------------------------------------------------------------------------------

/** A pay ratio as a machine writes it: "a:b", "a to b" or "a for b", paying more than nothing. */
const ratioArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 12 }), fc.boolean())
    .map(([a, b, colon]) => (colon ? `${a}:${b}` : `${a} to ${b}`)),
  fc
    .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 60 }))
    .map(([b, more]) => `${b + more} for ${b}`),
)

/**
 * A composite part's pay: at least 4 to 1, so that no composite can lose part of its stake, which
 * config validation refuses (rules spec §5.3 #8).
 */
const partRatioArb: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 4, max: 40 }).map((a) => `${a}:1`),
  fc.integer({ min: 5, max: 41 }).map((a) => `${a} for 1`),
)

const DRAWS = 96

/**
 * Random pay ratios: each pay of every line bet, odds, number bet, hardway and one-roll bet is
 * replaced or kept by a coin, in catalog order.
 */
const payEditArb = fc
  .record({
    replace: fc.array(fc.boolean(), { minLength: DRAWS, maxLength: DRAWS }),
    ratios: fc.array(ratioArb, { minLength: DRAWS, maxLength: DRAWS }),
    partRatios: fc.array(partRatioArb, { minLength: DRAWS, maxLength: DRAWS }),
  })
  .map(({ replace, ratios, partRatios }) => (input: MachineConfigInput): void => {
    const parts = new Set(
      Object.values(input.composites).flatMap((c) => c.parts.map((p) => p.typeId)),
    )
    let draw = 0
    const next = (current: string, part: boolean): string => {
      const i = draw++ % DRAWS
      if (replace[i] !== true) return current
      return (part ? partRatios[i] : ratios[i]) ?? current
    }
    for (const [typeId, type] of Object.entries(input.catalog)) {
      if (type.family === 'line') {
        type.pays = next(type.pays, false)
        continue
      }
      const pays: Record<string, string> = {}
      for (const [key, text] of Object.entries(type.pays)) {
        if (text !== undefined) pays[key] = next(text, parts.has(typeId))
      }
      type.pays = pays
    }
  })

/** One case of the closed-form fuzz: a random machine, a bet on it, a stake. */
export interface FuzzCase {
  readonly preset: PresetId
  readonly input: MachineConfigInput
  readonly cfg: MachineConfig
  readonly facts: MachineFacts
  readonly bet: MachineBet
}

/** Whether a bet of `typeId` charges commission: a buy or a lay (rules spec §4.3). */
function chargesCommission(facts: MachineFacts, typeId: string): boolean {
  const type = typeFacts(facts, typeId)
  return type.family === 'numberVsSeven' && type.commission.size > 0
}

/**
 * A random machine (commission basis, timing, rounding, minimum and re-arm on buy and lay, payout
 * roundings, after-win rules and pay ratios: `editArb` and the pays above), a bet it offers and a
 * stake from 1¢ to $50; null when config validation refuses the machine (a test skips it). Half
 * the cases pick a bet that charges commission, where those rules meet.
 */
export const fuzzCaseArb: fc.Arbitrary<FuzzCase | null> = fc
  .record({
    preset: fc.constantFrom(...PRESET_IDS),
    edit: editArb,
    pays: payEditArb,
    commission: fc.boolean(),
    pick: fc.nat(),
    stake: fc.integer({ min: 1, max: 5_000 }),
  })
  .map(({ preset, edit, pays, commission, pick, stake }) => {
    const changed = edited(edited(PRESETS[preset], edit), pays)
    const input = { ...changed, provenance: pruneProvenance(changed) }
    let cfg: MachineConfig
    try {
      cfg = compileConfig(input)
    } catch (error) {
      if (error instanceof ConfigError) return null
      throw error
    }
    const facts = factsFrom(input)
    const all = machineBets(facts, stake)
    const charged = all.filter((bet) => chargesCommission(facts, bet.typeId))
    const bets = commission && charged.length > 0 ? charged : all
    const bet = bets[pick % bets.length]
    return bet === undefined ? null : { preset, input, cfg, facts, bet }
  })
