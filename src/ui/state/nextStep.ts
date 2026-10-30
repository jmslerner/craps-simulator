import { formatCents, validateAction } from '../../engine/index.ts'
import type { Action, Cents, LegalBet, MachineConfig, TableState } from '../../engine/index.ts'

/**
 * The next-step guide's data (plan §0 #18), M8 shell: a pure function over the table, the machine,
 * `legalBets` and the player's settings, naming the one action to take now. M8's content is
 * mechanical and number-free — the only numbers are amounts taken verbatim from `legalBets`
 * (`minAdd`/`maxAdd`), formatted with `formatCents` — and M9 rewrites the wording in
 * `coach/nextStep.ts` with `CoachNumber`s. By construction it never suggests what the table would
 * refuse: every amount comes from `legalBets`, every action is checked with `validateAction`
 * before it is offered, and a chip is suggested only when a first tap with it would be accepted
 * (§0 #18 lessons). It is consulted only in the `betting` phase — the store's `selectNextStep`
 * returns null in any other — so nothing it suggests runs while a roll is settling. This module
 * stays pure over the engine (no store, no DOM), so the oracle-style tests in `tests/` can drive
 * it straight from replayed fixtures.
 *
 * Targets name what to light up: `zone:<typeId>` for a layout zone, `control:roll`,
 * `control:add-credit` and `control:chip:<cents>` for controls.
 */

export interface GuideStep {
  readonly stepId: string
  readonly title: string
  readonly body: string
  readonly target: string
  /** A one-tap shortcut the table accepts now; absent when only the player can decide. */
  readonly action?: Action
}

/** The basic round as a stepper (plan §0 #18). */
export const GUIDE_CYCLE = [
  { id: 'line', title: 'Bet the line' },
  { id: 'comeOutRoll', title: 'Come-out roll' },
  { id: 'odds', title: 'Add odds' },
  { id: 'pointRoll', title: 'Roll for the point' },
] as const

export type CycleStepId = (typeof GUIDE_CYCLE)[number]['id']

export interface NextStep extends GuideStep {
  readonly cycle: typeof GUIDE_CYCLE
  /** Which cycle step the table is on, 0–3, whatever `stepId` the moment needs. */
  readonly activeStep: number
  /** At most one optional idea (plan §0 #18), dismissible by the player. */
  readonly alt?: GuideStep
}

export interface NextStepSettings {
  /** The chip in hand, in cents; null means the machine's smallest. */
  readonly selectedChip: number | null
  /** The rack, in cents; null means the machine's own chips. */
  readonly chips: readonly number[] | null
}

/** The guide for the betting window on `state`; null when the machine has no come-out do line. */
export function nextStep(
  state: TableState,
  cfg: MachineConfig,
  legal: readonly LegalBet[],
  settings: NextStepSettings,
): NextStep | null {
  const line = doLineType(cfg)
  if (line === null) return null
  const lineSpot = legal.find((spot) => spot.typeId === line.typeId) ?? null
  if (lineSpot === null) return null
  const comeOut = state.round.phase.kind === 'comeOut'

  if (comeOut && lineSpot.betId === null) return lineStep(state, cfg, line, lineSpot, settings)

  const rollRefusal = validateAction(state, { type: 'roll' }, cfg)

  if (!comeOut) {
    const odds = oddsStep(state, cfg, legal, line, lineSpot, rollRefusal)
    if (odds !== null) return odds
    if (rollRefusal === null) {
      return at(3, {
        stepId: 'pointRoll',
        title: 'Roll for the point',
        body: 'Roll again: hit the point before a 7.',
        target: 'control:roll',
        action: { type: 'roll' },
      })
    }
    return blockedRoll(state, cfg, legal, rollRefusal, 3, 'Roll for the point')
  }

  if (rollRefusal === null) {
    return at(1, {
      stepId: 'comeOutRoll',
      title: 'Come-out roll',
      body: `Roll the dice to set the point for your ${line.label}.`,
      target: 'control:roll',
      action: { type: 'roll' },
    })
  }
  return blockedRoll(state, cfg, legal, rollRefusal, 1, 'Come-out roll')
}

// ---------------------------------------------------------------------------------------------

function at(activeStep: number, step: GuideStep, alt?: GuideStep): NextStep {
  return alt === undefined
    ? { cycle: GUIDE_CYCLE, activeStep, ...step }
    : { cycle: GUIDE_CYCLE, activeStep, ...step, alt }
}

/** The machine's come-out do line (pass): the bet the basic round starts with. */
function doLineType(cfg: MachineConfig) {
  for (const type of cfg.catalog.values()) {
    if (type.family === 'line' && type.side === 'do' && type.window === 'comeOut') return type
  }
  return null
}

/** Step 1: bet the line — or pick a chip that fits, or add credit, when the player cannot. */
function lineStep(
  state: TableState,
  cfg: MachineConfig,
  line: { readonly typeId: string; readonly label: string },
  spot: LegalBet,
  settings: NextStepSettings,
): NextStep {
  if (spot.canAdd === null) {
    const chip = chipStep(state, cfg, line, settings)
    if (chip !== null) return chip
    return at(0, {
      stepId: 'line',
      title: `Bet the ${line.label}`,
      body: `Tap the ${line.label} to start the round. Smallest bet: ${formatCents(spot.minAdd)}.`,
      target: `zone:${line.typeId}`,
      action: { type: 'place', typeId: line.typeId, amount: spot.minAdd },
    })
  }
  if (spot.canAdd.code === 'INSUFFICIENT_CREDIT') {
    return at(0, addCreditStep(state, cfg, `You need credit before you can bet the ${line.label}.`))
  }
  return at(0, {
    stepId: 'line',
    title: `Bet the ${line.label}`,
    body: `The ${line.label} is not open right now.`,
    target: `zone:${line.typeId}`,
  })
}

/**
 * A chip that fits (§0 #18): when the chip in hand cannot make the first line bet but another chip
 * in the rack can, the step points at the smallest such chip. Fit means the table would accept a
 * tap of it, checked with `validateAction`, so limits, increments and credit all apply.
 */
function chipStep(
  state: TableState,
  cfg: MachineConfig,
  line: { readonly typeId: string; readonly label: string },
  settings: NextStepSettings,
): NextStep | null {
  const rack = settings.chips ?? cfg.chips
  const inHand = settings.selectedChip ?? rack[0] ?? null
  if (inHand === null) return null
  const fits = (chip: number): boolean =>
    Number.isSafeInteger(chip) &&
    chip > 0 &&
    validateAction(state, { type: 'place', typeId: line.typeId, amount: chip as Cents }, cfg) ===
      null
  if (fits(inHand)) return null
  const smaller = rack.find(fits)
  if (smaller === undefined) return null
  return at(0, {
    stepId: 'chip',
    title: 'Pick a chip that fits',
    body: `The chip in hand is too big for the ${line.label} right now. Switch to the ${formatCents(smaller as Cents)} chip.`,
    target: `control:chip:${smaller}`,
  })
}

/** Step 3: back the line with odds, with the most the machine takes now (hand-off: `maxAdd`). */
function oddsStep(
  state: TableState,
  cfg: MachineConfig,
  legal: readonly LegalBet[],
  line: { readonly typeId: string; readonly label: string },
  lineSpot: LegalBet,
  rollRefusal: ReturnType<typeof validateAction>,
): NextStep | null {
  if (lineSpot.betId === null) return null
  const oddsId = cfg.oddsFor.get(line.typeId)
  if (oddsId === undefined) return null
  const spot = legal.find((s) => s.typeId === oddsId && s.parentId === lineSpot.betId)
  if (spot === undefined || spot.canAdd !== null || spot.maxAdd <= 0) return null
  const oddsLabel = cfg.catalog.get(oddsId)?.label ?? 'Odds'
  const action: Action = {
    type: 'place',
    typeId: oddsId,
    parentId: lineSpot.betId,
    amount: spot.maxAdd,
  }
  if (validateAction(state, action, cfg) !== null) return null
  const alt: GuideStep | undefined =
    rollRefusal === null
      ? {
          stepId: 'skipOdds',
          title: 'Or just roll',
          body: 'Odds are optional: you can roll for the point without them.',
          target: 'control:roll',
          action: { type: 'roll' },
        }
      : undefined
  return at(
    2,
    {
      stepId: 'odds',
      title: `Add odds behind your ${line.label}`,
      body: `Back your ${line.label} with ${oddsLabel}: the machine takes up to ${formatCents(spot.maxAdd)} more.`,
      target: `zone:${oddsId}`,
      action,
    },
    alt,
  )
}

/** The roll is refused: meet the machine's minimum, or add credit when nothing can be added. */
function blockedRoll(
  state: TableState,
  cfg: MachineConfig,
  legal: readonly LegalBet[],
  refusal: NonNullable<ReturnType<typeof validateAction>>,
  activeStep: number,
  title: string,
): NextStep {
  if (refusal.code !== 'BELOW_MIN_TOTAL') {
    return at(activeStep, {
      stepId: 'rollBlocked',
      title,
      body: 'The machine refuses the roll right now.',
      target: 'control:roll',
    })
  }
  const add = minimalAdd(state, cfg, legal)
  if (add !== null) {
    return at(activeStep, {
      stepId: 'minTotal',
      title: 'Meet the machine minimum',
      body: `Your working bets are under the machine's minimum, so the roll is refused. Add at least ${formatCents(add.amount)} on ${add.label}.`,
      target: add.target,
      action: add.action,
    })
  }
  return at(
    activeStep,
    addCreditStep(
      state,
      cfg,
      'Your working bets are under the machine minimum and your credit cannot cover more.',
    ),
  )
}

interface MinimalAdd {
  readonly amount: Cents
  readonly label: string
  readonly target: string
  readonly action: Action
}

/** The first spot that can take its smallest addition now, as `legalBets` lists them. */
function minimalAdd(
  state: TableState,
  cfg: MachineConfig,
  legal: readonly LegalBet[],
): MinimalAdd | null {
  for (const spot of legal) {
    if (spot.canAdd !== null || spot.minAdd <= 0) continue
    const action: Action = {
      type: 'place',
      typeId: spot.typeId,
      ...(spot.number === null ? {} : { number: spot.number }),
      ...(spot.parentId === null ? {} : { parentId: spot.parentId }),
      amount: spot.minAdd,
    }
    if (validateAction(state, action, cfg) !== null) continue
    const label =
      cfg.catalog.get(spot.typeId)?.label ?? cfg.composites.get(spot.typeId)?.label ?? spot.typeId
    return { amount: spot.minAdd, label, target: `zone:${spot.typeId}`, action }
  }
  return null
}

/** Add credit (plan §0 #19), offered only when the machine would take the deposit. */
function addCreditStep(state: TableState, cfg: MachineConfig, body: string): GuideStep {
  const action: Action = { type: 'deposit', amount: cfg.startingBankroll }
  const accepted = validateAction(state, action, cfg) === null
  return {
    stepId: 'addCredit',
    title: 'Add credit',
    body: `${body} Add credit like feeding a bill into the machine.`,
    target: 'control:add-credit',
    ...(accepted ? { action } : {}),
  }
}
