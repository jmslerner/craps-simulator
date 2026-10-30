import {
  Fraction,
  applyAction,
  cents,
  effectiveWorking,
  makeRoll,
  validateAction,
} from '../engine/index.ts'
import type {
  Action,
  BetId,
  Cents,
  Dice,
  LegalBet,
  MachineConfig,
  TableState,
} from '../engine/index.ts'
import {
  addCreditBody,
  betLineBody,
  chipBody,
  comeOutRollBody,
  comeOutWorkingIdeaBody,
  lineClosedBody,
  minTotalBody,
  minTotalNoCredit,
  needCreditForLine,
  oddsBody,
  pointRollBody,
  rollBlockedBody,
  sevenLine,
  skipOddsBody,
} from './content/guide.ts'
import { formatPart } from './format.ts'
import { coachCount, coachMoney, sourceOf } from './numbers.ts'
import type { CoachNumber, TemplateParts } from './types.ts'

/**
 * The next-step guide (plan §0 #18), M9c provider: the coach's replacement for the M8 shell in
 * `src/ui/state/nextStep.ts`, same `NextStep` contract (§13 M8 → M9 hand-off), now with the
 * deferred #18 lessons:
 *
 * - **Every number in the wording is a `CoachNumber`.** Amounts the guide offers come verbatim
 *   from `legalBets` (`minAdd`/`maxAdd`, §0 #18), chips from the rack the machine accepts, and the
 *   7-preview from the engine's own settlement — each carries its source so the audit harness can
 *   recompute it. Analysis numbers (edges, probabilities) are the advisors' job, computed in the
 *   worker; the guide stays engine-only so it never blocks the main thread.
 * - **Any step that says to roll states what a 7 would do to every bet on the table** — wins,
 *   losses, bets returned and the net — computed by the engine itself: the preview applies a
 *   scripted 7 to a copy of the shown table through `applyAction` and folds the settlement traces.
 *   The preview is never dispatched, logged or revealed; the real dice still come only from the
 *   engine RNG.
 * - **It never claims a bet plays while it is OFF:** the preview names OFF bets as sitting out,
 *   and the working idea only fires when Bets Off would actually change what the 7 takes.
 * - **Per-idea dismissal:** every optional idea carries an `ideaId`; ids in
 *   `settings.dismissedIdeas` never come back (the UI remembers them in the coach memory store).
 *
 * By construction it never suggests what the table would refuse: every amount comes from
 * `legalBets`, every action is checked with `validateAction` before it is offered, and a chip is
 * suggested only when a first tap with it would be accepted. It is consulted only in the `betting`
 * phase — the store's `selectNextStep` returns null in any other — so nothing it suggests runs
 * while a roll is settling.
 *
 * Targets name what to light up: `zone:<typeId>` for a layout zone, `control:roll`,
 * `control:add-credit`, `control:chip:<cents>` and `control:working` for controls.
 */

export interface GuideStep {
  readonly stepId: string
  readonly title: string
  readonly body: string
  readonly target: string
  /** A one-tap shortcut the table accepts now; absent when only the player can decide. */
  readonly action?: Action
  /** Set on optional ideas: dismissing the id hides that idea for good (plan §0 #18). */
  readonly ideaId?: string
  /** Every number the step's wording shows, traced to what computed it. */
  readonly numbers?: Readonly<Record<string, CoachNumber>>
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
  /** What a 7 would do to the table now; present on any step that offers a roll. */
  readonly seven?: SevenPreview
}

export interface NextStepSettings {
  /** The chip in hand, in cents; null means the machine's smallest. */
  readonly selectedChip: number | null
  /** The rack, in cents; null means the machine's own chips. */
  readonly chips: readonly number[] | null
  /** Idea ids the player dismissed (plan §0 #18): those ideas never come back. */
  readonly dismissedIdeas?: readonly string[]
}

// ---------------------------------------------------------------------------------------------
// The 7-preview (plan §0 #18 lessons)

/** The canonical seven the preview rolls; which 7 makes no difference to any modelled bet. */
export const SEVEN_DICE: Dice = makeRoll(3, 4)

export interface SevenBetEffect {
  readonly betId: BetId
  /** The machine's name for the spot: "Place 6". */
  readonly name: string
  readonly what: 'wins' | 'loses' | 'returned' | 'off' | 'unaffected'
  /** What moves (winnings, the stake lost or returned), or the stake for off/unaffected bets. */
  readonly amount: Cents
}

export interface SevenPreview {
  /** Winnings a 7 pays out now (after any commission), in cents. */
  readonly wins: CoachNumber
  /** Stakes a 7 takes, in cents. */
  readonly takes: CoachNumber
  /** Stakes a 7 sends back to credit, in cents. */
  readonly returns: CoachNumber
  /** The change to bankroll + bets on the table: the honest net of the 7. */
  readonly net: CoachNumber
  /** How many bets are OFF and untouched by the 7. */
  readonly offCount: CoachNumber
  readonly byBet: readonly SevenBetEffect[]
}

/**
 * What a 7 would do to every bet on `state`, computed by the engine on a copy: `applyAction` with
 * a scripted 7, folded from its settlement traces. Null when the table has no bets or the machine
 * refuses the roll (the guide then shows the refusal, not a preview).
 */
export function sevenPreview(state: TableState, cfg: MachineConfig): SevenPreview | null {
  if (state.bets.length === 0) return null
  const result = applyAction(state, { type: 'roll', dice: SEVEN_DICE }, cfg, {
    checkInvariants: false,
  })
  if (!result.ok) return null

  const effects = new Map<BetId, SevenBetEffect>()
  let wins = 0
  let takes = 0
  let returns = 0
  for (const event of result.events) {
    if (event.type === 'betResolved') {
      const t = event.trace
      const name = spotName(cfg, t.typeId, t.number)
      if (t.outcome === 'win') {
        const won = t.winPaid - t.vigOnWin - t.vigRearm
        wins += won
        if (t.stakeDisposition === 'returned') returns += t.stake
        effects.set(t.betId, { betId: t.betId, name, what: 'wins', amount: cents(won) })
      } else if (t.outcome === 'lose') {
        takes += t.stake
        effects.set(t.betId, { betId: t.betId, name, what: 'loses', amount: t.stake })
      } else {
        if (t.stakeDisposition === 'returned') returns += t.stake
        effects.set(t.betId, { betId: t.betId, name, what: 'returned', amount: t.stake })
      }
    } else if (event.type === 'betRemoved') {
      returns += event.amount
      if (!effects.has(event.betId)) {
        effects.set(event.betId, {
          betId: event.betId,
          name: spotName(cfg, event.typeId, null),
          what: 'returned',
          amount: event.amount,
        })
      }
    }
  }
  let offCount = 0
  for (const bet of state.bets) {
    if (effects.has(bet.id)) continue
    const working = effectiveWorking(bet, state, cfg)
    if (!working) offCount += 1
    effects.set(bet.id, {
      betId: bet.id,
      name: spotName(cfg, bet.typeId, bet.number),
      what: working ? 'unaffected' : 'off',
      amount: bet.amount,
    })
  }
  const net = wealthOf(result.state) - wealthOf(state)
  const src = (part: string) =>
    sourceOf('sevenPreview', { dice: [SEVEN_DICE.d1, SEVEN_DICE.d2], part }, cfg)
  return {
    wins: coachMoney(cents(wins), src('wins')),
    takes: coachMoney(cents(takes), src('takes')),
    returns: coachMoney(cents(returns), src('returns')),
    net: coachMoney(cents(net), src('net')),
    offCount: coachCount(Fraction.of(offCount), src('off')),
    byBet: state.bets.flatMap((bet) => {
      const effect = effects.get(bet.id)
      return effect === undefined ? [] : [effect]
    }),
  }
}

/** Bankroll plus the stakes on the table: what the player would walk away with plus exposure. */
function wealthOf(state: TableState): number {
  let total: number = state.ledger.bankroll
  for (const bet of state.bets) total += bet.amount
  return total
}

// ---------------------------------------------------------------------------------------------

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
  const seven = rollRefusal === null ? sevenPreview(state, cfg) : null
  const dismissed = settings.dismissedIdeas ?? []

  if (!comeOut) {
    const odds = oddsStep(state, cfg, legal, line, lineSpot, rollRefusal, seven, dismissed)
    if (odds !== null) return odds
    if (rollRefusal === null) {
      return at(
        3,
        withSeven(
          {
            stepId: 'pointRoll',
            title: 'Roll for the point',
            body: text(pointRollBody()),
            target: 'control:roll',
            action: { type: 'roll' },
          },
          seven,
        ),
        seven,
      )
    }
    return blockedRoll(state, cfg, legal, rollRefusal, 3, 'Roll for the point')
  }

  if (rollRefusal === null) {
    return at(
      1,
      withSeven(
        {
          stepId: 'comeOutRoll',
          title: 'Come-out roll',
          body: text(comeOutRollBody(line.label)),
          target: 'control:roll',
          action: { type: 'roll' },
        },
        seven,
      ),
      seven,
      comeOutIdea(state, cfg, seven, dismissed),
    )
  }
  return blockedRoll(state, cfg, legal, rollRefusal, 1, 'Come-out roll')
}

// ---------------------------------------------------------------------------------------------

function at(
  activeStep: number,
  step: GuideStep,
  seven?: SevenPreview | null,
  alt?: GuideStep,
): NextStep {
  return {
    cycle: GUIDE_CYCLE,
    activeStep,
    ...step,
    ...(alt === undefined ? {} : { alt }),
    ...(seven === null || seven === undefined ? {} : { seven }),
  }
}

/** Renders template parts to the step's plain-text body. */
function text(parts: TemplateParts): string {
  return parts.map((part) => formatPart(part)).join('')
}

/** Appends the 7-line (plan §0 #18) and its numbers to a step that offers a roll. */
function withSeven(step: GuideStep, seven: SevenPreview | null): GuideStep {
  if (seven === null) return step
  const numbers = {
    ...step.numbers,
    sevenWins: seven.wins,
    sevenTakes: seven.takes,
    sevenReturns: seven.returns,
    sevenNet: seven.net,
    sevenOff: seven.offCount,
  }
  return {
    ...step,
    numbers,
    body: `${step.body} ${text(
      sevenLine({
        wins: seven.wins,
        takes: seven.takes,
        returns: seven.returns,
        net: seven.net,
        off: seven.offCount,
      }),
    )}`,
  }
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
    const min = coachMoney(
      spot.minAdd,
      sourceOf('legalBets', { typeId: line.typeId, field: 'minAdd' }, cfg),
    )
    return at(0, {
      stepId: 'line',
      title: `Bet the ${line.label}`,
      body: text(betLineBody({ min }, line.label)),
      target: `zone:${line.typeId}`,
      action: { type: 'place', typeId: line.typeId, amount: spot.minAdd },
      numbers: { min },
    })
  }
  if (spot.canAdd.code === 'INSUFFICIENT_CREDIT') {
    return at(0, addCreditStep(state, cfg, needCreditForLine(line.label)))
  }
  return at(0, {
    stepId: 'line',
    title: `Bet the ${line.label}`,
    body: text(lineClosedBody(line.label)),
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
  // The claim "this chip fits" is re-verifiable: the audit replays the tap through validateAction.
  const chip = coachMoney(
    cents(smaller),
    sourceOf('chipFits', { typeId: line.typeId, chip: smaller }, cfg),
  )
  return at(0, {
    stepId: 'chip',
    title: 'Pick a chip that fits',
    body: text(chipBody({ chip }, line.label)),
    target: `control:chip:${smaller}`,
    numbers: { chip },
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
  seven: SevenPreview | null,
  dismissed: readonly string[],
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
    rollRefusal === null && !dismissed.includes('skip-odds')
      ? {
          stepId: 'skipOdds',
          ideaId: 'skip-odds',
          title: 'Or just roll',
          body: text(skipOddsBody()),
          target: 'control:roll',
          action: { type: 'roll' },
        }
      : undefined
  const most = coachMoney(
    spot.maxAdd,
    sourceOf('legalBets', { typeId: oddsId, parentId: lineSpot.betId, field: 'maxAdd' }, cfg),
  )
  return at(
    2,
    withSeven(
      {
        stepId: 'odds',
        title: `Add odds behind your ${line.label}`,
        body: text(oddsBody({ most }, line.label, oddsLabel)),
        target: `zone:${oddsId}`,
        action,
        numbers: { most },
      },
      seven,
    ),
    seven,
    alt,
  )
}

/**
 * The come-out idea (plan §0 #18): working number bets a 7 would take can sit the come-out roll
 * out. Offered only when Bets Off is legal now and the engine's own preview says it saves money.
 */
function comeOutIdea(
  state: TableState,
  cfg: MachineConfig,
  seven: SevenPreview | null,
  dismissed: readonly string[],
): GuideStep | undefined {
  if (seven === null || dismissed.includes('come-out-working')) return undefined
  const takesNow = moneyOf(seven.takes)
  if (takesNow <= 0 || !cfg.working.toggle.global) return undefined
  if (state.globalOff === true) return undefined
  const action: Action = { type: 'setGlobalWorking', off: true }
  if (validateAction(state, action, cfg) !== null) return undefined
  const toggled = applyAction(state, action, cfg, { checkInvariants: false })
  if (!toggled.ok) return undefined
  const after = sevenPreview(toggled.state, cfg)
  const takesThen = after === null ? 0 : moneyOf(after.takes)
  if (takesThen >= takesNow) return undefined
  const atRisk = coachMoney(
    cents(takesNow - takesThen),
    sourceOf('sevenPreview', { dice: [SEVEN_DICE.d1, SEVEN_DICE.d2], part: 'betsOffSaves' }, cfg),
  )
  return {
    stepId: 'comeOutWorking',
    ideaId: 'come-out-working',
    title: 'Bets Off for the come-out',
    body: text(comeOutWorkingIdeaBody({ atRisk })),
    target: 'control:working',
    action,
    numbers: { atRisk },
  }
}

/** A money `CoachNumber`'s cents; the preview only carries whole cents. */
function moneyOf(n: CoachNumber): number {
  return typeof n.exact === 'number' ? n.exact : 0
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
      body: text(rollBlockedBody()),
      target: 'control:roll',
    })
  }
  const add = minimalAdd(state, cfg, legal)
  if (add !== null) {
    const amount = coachMoney(
      add.amount,
      sourceOf(
        'legalBets',
        { typeId: add.typeId, number: add.number, parentId: add.parentId, field: 'minAdd' },
        cfg,
      ),
    )
    return at(activeStep, {
      stepId: 'minTotal',
      title: 'Meet the machine minimum',
      body: text(minTotalBody({ add: amount }, add.label)),
      target: add.target,
      action: add.action,
      numbers: { add: amount },
    })
  }
  return at(activeStep, addCreditStep(state, cfg, minTotalNoCredit()))
}

interface MinimalAdd {
  readonly amount: Cents
  readonly label: string
  readonly typeId: string
  readonly number: number | null
  readonly parentId: string | null
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
    return {
      amount: spot.minAdd,
      label: spotName(cfg, spot.typeId, spot.number),
      typeId: spot.typeId,
      number: spot.number,
      parentId: spot.parentId,
      target: `zone:${spot.typeId}`,
      action,
    }
  }
  return null
}

/** Add credit (plan §0 #19), offered only when the machine would take the deposit. */
function addCreditStep(state: TableState, cfg: MachineConfig, reason: TemplateParts): GuideStep {
  const action: Action = { type: 'deposit', amount: cfg.startingBankroll }
  const accepted = validateAction(state, action, cfg) === null
  return {
    stepId: 'addCredit',
    title: 'Add credit',
    body: text(addCreditBody(reason)),
    target: 'control:add-credit',
    ...(accepted ? { action } : {}),
  }
}

/** The machine's name for a spot: "Place 6". */
function spotName(cfg: MachineConfig, typeId: string, number: number | null): string {
  const label = cfg.catalog.get(typeId)?.label ?? cfg.composites.get(typeId)?.label ?? typeId
  return number === null ? label : `${label} ${number}`
}
