/**
 * The engine driver for the side-bet differential (M11): one side bet played through the real
 * reducer, `applyAction`, roll by roll against the oracle's walker (tests/oracle/sideBets.ts). It
 * compares, on every roll, whether the bet may be placed (rules spec §2.6 windows), whether it may
 * be taken down (its lock), the settlement the roll produces (outcome, cash, whether the bet comes
 * down) and the bet's progress, plus the round itself (phase, point and `hand.rolls`), and re-places
 * the bet whenever its window opens again so one dice sequence exercises many bets.
 *
 * Machines are the presets, loosened by `dispatchVariant` (1¢ increments, no minimum total) so a
 * side bet alone can roll, plus variants that turn on the knobs no preset uses. This file lives in
 * tests/properties because it drives the engine; the oracle modules never import it.
 */
import fc from 'fast-check'
import { PRESETS, type PresetId } from '../../src/engine/config/presets/index.ts'
import { pruneProvenance } from '../../src/engine/config/provenance.ts'
import type { Total } from '../../src/engine/core/dice.ts'
import {
  applyAction,
  cents,
  compileConfig,
  makeRoll,
  newTable,
  pointRunState,
  totalsInMask,
  type Action,
  type BetId,
  type GameEvent,
  type MachineConfig,
  type MachineConfigInput,
  type TableState,
} from '../../src/engine/index.ts'
import { dispatchVariant } from '../oracle/dispatchChain.ts'
import {
  advanceRef,
  placeSideBet,
  removable,
  sideBetMachineFrom,
  START_ROUND,
  stepSideBet,
  windowOpen,
  type RefRound,
  type RefSettlement,
  type RefSideBet,
  type SideBetMachine,
  type SideBetRule,
} from '../oracle/sideBets.ts'

export interface SideBetDiffMachine {
  readonly id: string
  /** The knobs this variant turns on, for the report. */
  readonly knobs: readonly string[]
  readonly input: MachineConfigInput
  readonly cfg: MachineConfig
  readonly machine: SideBetMachine
}

type Edit = (input: MachineConfigInput) => void

/** A preset with `edit` applied, its provenance pruned, loosened for the dispatch table. */
function variant(
  id: PresetId,
  name: string,
  knobs: readonly string[],
  edit: Edit,
): SideBetDiffMachine {
  const copy = structuredClone(PRESETS[id]) as MachineConfigInput
  edit(copy)
  const input = dispatchVariant({ ...copy, provenance: pruneProvenance(copy) })
  return { id: name, knobs, input, cfg: compileConfig(input), machine: sideBetMachineFrom(input) }
}

function sideBet<F extends MachineConfigInput['sideBets'][string]['family']>(
  input: MachineConfigInput,
  typeId: string,
  family: F,
): Extract<MachineConfigInput['sideBets'][string], { family: F }> {
  const bet = input.sideBets[typeId]
  if (bet?.family !== family) throw new Error(`${input.id} has no ${family} ${typeId}`)
  return bet as Extract<MachineConfigInput['sideBets'][string], { family: F }>
}

/** The presets as they are. */
export const PRESET_SIDE_BET_MACHINES: readonly SideBetDiffMachine[] = (
  ['craplessBubble', 'traditionalBubble', 'strictBubble', 'traditionalLive345'] as const
).map((id) => variant(id, id, [], () => undefined))

/** The knobs no preset turns on (rules spec §2.6, §6.2–§6.4, §6.6; §9 #10, #12). */
export const VARIANT_SIDE_BET_MACHINES: readonly SideBetDiffMachine[] = [
  variant(
    'craplessBubble',
    'craplessBubble+sevenOutOnly',
    ['collectSet endsOn sevenOut'],
    (input) => {
      for (const id of ['luckyRollerLow', 'luckyRollerHigh', 'luckyRollerAll']) {
        sideBet(input, id, 'collectSet').endsOn = 'sevenOut'
      }
    },
  ),
  variant('craplessBubble', 'craplessBubble+newHand', ['collectSet placement newHand'], (input) => {
    for (const id of ['luckyRollerLow', 'luckyRollerHigh', 'luckyRollerAll']) {
      sideBet(input, id, 'collectSet').placement = 'newHand'
    }
  }),
  variant('traditionalBubble', 'traditionalBubble+defB', ['handLength exceptSevenOut'], (input) => {
    sideBet(input, 'hotShooter', 'handLength').countDefinition = 'exceptSevenOut'
  }),
  variant(
    'traditionalBubble',
    'traditionalBubble+defC+anyComeOut',
    ['handLength exceptComeOutAndSevenOut', 'handLength placement anyComeOut'],
    (input) => {
      const hsj = sideBet(input, 'hotShooter', 'handLength')
      hsj.countDefinition = 'exceptComeOutAndSevenOut'
      hsj.placement = 'anyComeOut'
    },
  ),
  variant('traditionalBubble', 'traditionalBubble+grand51', ['handLength Grand at 51'], (input) => {
    const hsj = sideBet(input, 'hotShooter', 'handLength')
    hsj.tiers = hsj.tiers.map((tier) => (tier.minRolls === 50 ? { ...tier, minRolls: 51 } : tier))
  }),
  variant(
    'strictBubble',
    'strictBubble+repeatsContinue',
    ['pointRun repeatEndsBet false', 'pointRun removableBeforePoint false'],
    (input) => {
      const ls = sideBet(input, 'luckyShooter', 'pointRun')
      ls.repeatEndsBet = false
      ls.removableBeforePoint = false
    },
  ),
  variant('strictBubble', 'strictBubble+newHand', ['pointRun placement newHand'], (input) => {
    sideBet(input, 'luckyShooter', 'pointRun').placement = 'newHand'
  }),
  variant(
    'traditionalLive345',
    'traditionalLive345+payAt6',
    ['uniquePointsMade payImmediatelyAt 6'],
    (input) => {
      sideBet(input, 'fire', 'uniquePointsMade').payImmediatelyAt = 6
    },
  ),
  // A crapless Fire Bet (rules spec §0.2 #13, §6.6): the published 13.4152% counts all ten points
  // and pays 999 from the sixth (here: at once), 70.4488% counts only 4–10.
  variant(
    'craplessBubble',
    'craplessBubble+fireAllTen',
    ['uniquePointsMade on crapless, ten points, payImmediatelyAt 6'],
    (input) => {
      input.sideBets.fire = {
        family: 'uniquePointsMade',
        label: 'Fire Bet',
        countedPoints: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
        payTable: { '4': '24 to 1', '5': '249 to 1', '6': '999 to 1' },
        payImmediatelyAt: 6,
        placement: 'newHand',
      }
    },
  ),
  variant(
    'craplessBubble',
    'craplessBubble+fireBox',
    ['uniquePointsMade on crapless, 4–10 only'],
    (input) => {
      input.sideBets.fire = {
        family: 'uniquePointsMade',
        label: 'Fire Bet',
        countedPoints: [4, 5, 6, 8, 9, 10],
        payTable: { '4': '24 to 1', '5': '249 to 1', '6': '999 to 1' },
        payImmediatelyAt: null,
        placement: 'newHand',
      }
    },
  ),
]

export const SIDE_BET_MACHINES: readonly SideBetDiffMachine[] = [
  ...PRESET_SIDE_BET_MACHINES,
  ...VARIANT_SIDE_BET_MACHINES,
]

/** Every (machine, side bet) pair, for `describe.each`. */
export function sideBetCases(
  machines: readonly SideBetDiffMachine[] = SIDE_BET_MACHINES,
): readonly (readonly [string, SideBetDiffMachine, string])[] {
  return machines.flatMap((dm) =>
    [...dm.machine.rules.keys()].map((typeId) => [`${dm.id} ${typeId}`, dm, typeId] as const),
  )
}

// ---------------------------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------------------------

export type DicePair = readonly [number, number]

const FACES = [1, 2, 3, 4, 5, 6]
const PAIRS: readonly DicePair[] = FACES.flatMap((d1) => FACES.map((d2) => [d1, d2] as const))

/** Two dice showing `total`, the easy way where there is one. */
export function diceFor(total: number): DicePair {
  const d1 = total > 6 ? total - 6 : 1
  return [d1, total - d1]
}

/**
 * A dice sequence of 1 to `maxLength` rolls. `longHands` makes a 7 a twelfth as likely as fair
 * dice would, so hands run long enough to reach the Hot Shooter's high tiers and the Fire Bet's
 * high counts; the reference does not care how the dice are drawn.
 */
export function diceSequenceArb(maxLength: number, longHands = false): fc.Arbitrary<DicePair[]> {
  const fair = fc.constantFrom(...PAIRS)
  const sevens = PAIRS.filter(([a, b]) => a + b === 7)
  const others = PAIRS.filter(([a, b]) => a + b !== 7)
  const biased = fc.oneof(
    { arbitrary: fc.constantFrom(...others), weight: 59 },
    { arbitrary: fc.constantFrom(...sevens), weight: 1 },
  )
  return fc.array(longHands ? biased : fair, { minLength: 1, maxLength })
}

// ---------------------------------------------------------------------------------------------
// One session of one side bet
// ---------------------------------------------------------------------------------------------

export interface SideBetMismatch {
  readonly machine: string
  readonly typeId: string
  readonly stake: number
  /** The 0-based roll index at which the two parted, or −1 before any roll. */
  readonly roll: number
  readonly dice: string
  readonly what: 'placement' | 'removal' | 'settlement' | 'progress' | 'round'
  readonly engine: string
  readonly reference: string
}

export interface SessionReport {
  readonly mismatches: readonly SideBetMismatch[]
  /** Bets placed on the engine. */
  readonly placed: number
  /** Placement attempts both refused. */
  readonly refused: number
  /** Settlements by coverage key (`outcome:detail`). */
  readonly settled: Readonly<Record<string, number>>
  readonly rolls: number
}

export function describeSideBetMismatch(m: SideBetMismatch): string {
  return (
    `${m.machine} ${m.typeId} ${m.stake}¢ roll #${m.roll} (${m.dice}) ${m.what}: ` +
    `engine ${m.engine}; reference ${m.reference}`
  )
}

/**
 * Plays `typeId` at `stake` cents through `dice` on `dm`, placing the bet whenever the oracle's
 * window is open (and checking that the engine agrees whether it is), probing its lock before each
 * roll, and comparing every settlement and the progress in between.
 */
export function runSideBetSession(
  dm: SideBetDiffMachine,
  typeId: string,
  stake: number,
  dice: readonly DicePair[],
): SessionReport {
  const { cfg, machine } = dm
  const rule = machine.rules.get(typeId)
  if (rule === undefined) throw new Error(`${dm.id} has no side bet ${typeId}`)
  const mismatches: SideBetMismatch[] = []
  const settled: Record<string, number> = {}
  let placed = 0
  let refused = 0
  let state: TableState = newTable(cfg, `side-bet ${dm.id} ${typeId}`)
  let round: RefRound = START_ROUND
  let refBet: RefSideBet | null = null
  let betId: BetId | null = null
  let wonSinceSeven = false

  const note = (
    roll: number,
    pair: DicePair | null,
    what: SideBetMismatch['what'],
    engine: string,
    reference: string,
  ) => {
    mismatches.push({
      machine: dm.id,
      typeId,
      stake,
      roll,
      dice: pair === null ? '-' : `${pair[0]}-${pair[1]}`,
      what,
      engine,
      reference,
    })
  }
  const act = (action: Action) => applyAction(state, action, cfg)
  const refusal = (result: ReturnType<typeof applyAction>) =>
    result.ok ? 'accepted' : `${result.rejection.code} ${JSON.stringify(result.rejection.details)}`

  for (const [index, pair] of dice.entries()) {
    const [d1, d2] = pair
    const total = (d1 + d2) as Total

    // The Hot Shooter's qualifier: a main-game bet on the come-out when none is up.
    if (rule.family === 'handLength' && round.phase === 'comeOut') {
      const main = mainGameStake(state, machine)
      if (main < rule.qualifyingBet) {
        const qualify = act({
          type: 'place',
          typeId: 'pass',
          amount: cents(rule.qualifyingBet - main),
        })
        if (!qualify.ok) throw new Error(`the qualifying pass bet was refused: ${refusal(qualify)}`)
        state = qualify.state
      }
    }

    if (refBet === null) {
      const window = windowOpen(rule, {
        round,
        sameTypeActive: false,
        wonSinceSeven,
        mainGameStake: mainGameStake(state, machine),
      })
      const result = act({ type: 'place', typeId, amount: cents(stake) })
      if (result.ok !== window.open) {
        note(index, pair, 'placement', refusal(result), window.open ? 'open' : window.why)
      }
      if (result.ok) {
        const event = result.events.find(
          (e): e is Extract<GameEvent, { type: 'betPlaced' }> =>
            e.type === 'betPlaced' && e.bet.typeId === typeId,
        )
        if (event === undefined) throw new Error('accepted without a betPlaced event')
        state = result.state
        betId = event.bet.id
        refBet = placeSideBet(rule, stake)
        placed++
      } else if (!window.open) refused++
    } else if (betId !== null) {
      // The lock: taking the bet down is refused once the dice have rolled on it (§2.6).
      const result = act({ type: 'setAmount', betId, amount: cents(0) })
      const allowed = removable(refBet)
      if (result.ok !== allowed) {
        note(index, pair, 'removal', refusal(result), allowed ? 'removable' : 'locked')
      }
    }

    const rolled = act({ type: 'roll', dice: makeRoll(d1, d2) })
    if (!rolled.ok) throw new Error(`roll ${d1}-${d2} refused: ${refusal(rolled)}`)
    const advanced = advanceRef(round, total, machine.variant)

    if (refBet !== null && betId !== null) {
      const step = stepSideBet(refBet, round, total, machine)
      const trace = rolled.events.find(
        (e): e is Extract<GameEvent, { type: 'betResolved' }> =>
          e.type === 'betResolved' && e.trace.betId === betId,
      )?.trace
      const after = rolled.state.bets.find((b) => b.id === betId)
      const engineSide = describeEngine(trace, after === undefined)
      const refSide = describeReference(step.settlement, step.bet === null)
      if (engineSide !== refSide) note(index, pair, 'settlement', engineSide, refSide)
      if (step.settlement !== null) {
        const key = coverageKey(rule, refBet, step.settlement, stake)
        settled[key] = (settled[key] ?? 0) + 1
        if (step.settlement.outcome === 'win' && rule.family === 'collectSet') wonSinceSeven = true
      }
      if (after !== undefined && step.bet !== null) {
        const engineProgress = describeEngineProgress(rule, after.progress)
        const refProgress = describeReferenceProgress(step.bet)
        if (engineProgress !== null && engineProgress !== refProgress) {
          note(index, pair, 'progress', engineProgress, refProgress)
        }
      }
      // Stay in step: follow the engine's table when the two part on whether the bet is up.
      refBet = after === undefined ? null : (step.bet ?? refBet)
      if (after === undefined) betId = null
    }
    if (total === 7) wonSinceSeven = false

    const enginePhase = rolled.state.round.phase
    const engineRound = JSON.stringify({
      phase: enginePhase.kind,
      point: enginePhase.kind === 'point' ? enginePhase.point : null,
      handRolls: rolled.state.round.hand.rolls,
    })
    const refRound = JSON.stringify({
      phase: advanced.round.phase,
      point: advanced.round.point,
      handRolls: advanced.round.handRolls,
    })
    if (engineRound !== refRound) note(index, pair, 'round', engineRound, refRound)

    state = rolled.state
    round = advanced.round
  }
  return { mismatches, placed, refused, settled, rolls: dice.length }
}

/** The stakes of the main game's bets on the table, ON or OFF, in cents. */
function mainGameStake(state: TableState, machine: SideBetMachine): number {
  return state.bets.reduce(
    (sum, bet) => (machine.rules.has(bet.typeId) ? sum : sum + bet.amount),
    0,
  )
}

function describeEngine(
  trace: Extract<GameEvent, { type: 'betResolved' }>['trace'] | undefined,
  gone: boolean,
): string {
  if (trace === undefined) return gone ? 'removed without a settlement' : 'no settlement'
  return `${trace.outcome} credited ${trace.credited} (win ${trace.winPaid}), ${gone ? 'down' : 'stays'}`
}

function describeReference(settlement: RefSettlement | null, gone: boolean): string {
  if (settlement === null) return gone ? 'removed without a settlement' : 'no settlement'
  const { outcome, credited, winPaid, ends } = settlement
  return `${outcome} credited ${credited} (win ${winPaid}), ${ends ? 'down' : 'stays'}`
}

/** The engine's progress decoded through its public API; null for a family compared elsewhere. */
function describeEngineProgress(rule: SideBetRule, progress: number): string | null {
  switch (rule.family) {
    case 'collectSet':
      return `hit ${totalsInMask(progress).join(',')}`
    case 'uniquePointsMade':
      return `made ${totalsInMask(progress).join(',')}`
    case 'handLength':
      // The count is the hand's; the round comparison covers it.
      return null
    case 'pointRun': {
      const { point, hits } = pointRunState(progress)
      return `point ${point ?? '-'} hits ${totalsInMask(hits).join(',')}`
    }
  }
}

function describeReferenceProgress(bet: RefSideBet): string {
  const sorted = (totals: readonly Total[]) => [...totals].sort((a, b) => a - b).join(',')
  switch (bet.progress.family) {
    case 'collectSet':
      return `hit ${sorted(bet.progress.hit)}`
    case 'uniquePointsMade':
      return `made ${sorted(bet.progress.made)}`
    case 'handLength':
      return 'hand'
    case 'pointRun':
      return `point ${bet.progress.point ?? '-'} hits ${sorted(bet.progress.hits)}`
  }
}

/** `outcome:detail`, the detail being what the pay hinged on, for coverage counts. */
function coverageKey(
  rule: SideBetRule,
  before: RefSideBet,
  settlement: RefSettlement,
  stake: number,
): string {
  switch (rule.family) {
    case 'collectSet':
      return settlement.outcome
    case 'uniquePointsMade':
      return `${settlement.outcome}:${settlement.why.replace(/\D+/g, '')}pts`
    case 'handLength':
      return `${settlement.outcome}:x${settlement.credited / stake}`
    case 'pointRun': {
      if (before.progress.family !== 'pointRun') return settlement.outcome
      if (before.progress.point === null) return `${settlement.outcome}:comeOut`
      if (settlement.why.startsWith('every hit')) return 'win:top'
      return `${settlement.outcome}:${before.progress.hits.length}hits`
    }
  }
}

/** Merges per-key counts. */
export function mergeCounts(
  into: Record<string, number>,
  more: Readonly<Record<string, number>>,
): void {
  for (const [key, n] of Object.entries(more)) into[key] = (into[key] ?? 0) + n
}
