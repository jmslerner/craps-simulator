import {
  Fraction,
  resolveBet,
  type MachineConfig,
  type Phase,
  type PointNumber,
} from '../engine/index.ts'
import {
  COME_OUT,
  ExactError,
  followsRound,
  type BetSpec,
  type StartContext,
  type WeightedPhase,
} from './chain.ts'
import { roundStats } from './roundStats.ts'

/**
 * Where an analysis starts. A bet on the table starts from the table (`equity.ts`); a bet being
 * considered starts from its **typical** placement, the long-run distribution of the phase in which
 * such a bet is made, new, with no toggles:
 *
 * - pass and don't pass on the line: the come-out; on point n: point n;
 * - come and don't come in the box: the point phase, each point weighted by its share of
 *   point-phase rolls (they are bet on any point-phase roll);
 * - a come or don't come bet on n, and odds behind one: the phase just after it travelled to n,
 *   which is the come-out when the travelling roll made the point (point n), else the same point;
 * - pass and don't pass odds on n: point n;
 * - number bets and hardways: any roll, so the long-run share π of every phase;
 * - one-roll bets and composites: no phase at all (`projection: none`);
 * - side bets (M11): the come-out, which is the phase their windows open in — after any 7 or at
 *   the cycle's start (Interblock's Lucky Roller), before a new hand's first roll (the Fire Bet, the
 *   Hot Shooter), before a point (the Lucky Shooter) — except Shoot To Win's Lucky Roller, taken
 *   before any roll while none of its type is active (`noneOfTypeActive`), so any phase by π.
 *   `start.test.ts` checks each window is open in its start phase, by the family's own `locate`.
 */

/** A start in one phase: a new bet, no toggles unless given. */
export function startAt(
  phase: Phase,
  options: Partial<
    Pick<StartContext, 'carried' | 'working' | 'globalOff' | 'held' | 'progress'>
  > = {},
): StartContext {
  const progress = options.progress ?? 0
  return {
    phases: [{ phase, weight: Fraction.ONE }],
    carried: options.carried ?? false,
    working: options.working ?? null,
    globalOff: options.globalOff ?? null,
    held: options.held ?? false,
    ...(progress === 0 ? {} : { progress }),
  }
}

/** The typical placement of `spec` (see the module comment), with `toggles` if given. */
export function typicalStart(
  spec: BetSpec,
  cfg: MachineConfig,
  toggles: Partial<Pick<StartContext, 'working' | 'globalOff'>> = {},
): StartContext {
  return {
    phases: typicalPhases(spec, cfg),
    carried: false,
    working: toggles.working ?? null,
    globalOff: toggles.globalOff ?? null,
  }
}

function typicalPhases(spec: BetSpec, cfg: MachineConfig): readonly WeightedPhase[] {
  const resolved = resolveBet(cfg, spec.typeId)
  if (resolved === null) {
    throw new ExactError('NOT_OFFERED', `${cfg.id} does not offer "${spec.typeId}"`)
  }
  const { type, family } = resolved
  const { number } = spec
  switch (type.family) {
    case 'odds': {
      const parent = cfg.catalog.get(type.parent)
      if (parent?.family !== 'line' || number === null) {
        throw new ExactError('BAD_SPEC', `${spec.typeId} needs a number and a line bet to back`)
      }
      return parent.window === 'comeOut' ? onPoint(number) : afterTravel(number, cfg)
    }
    case 'line':
      if (type.window === 'comeOut') return number === null ? only(COME_OUT) : onPoint(number)
      return number === null ? pointPhases(cfg) : afterTravel(number, cfg)
    case 'numberVsSeven':
    case 'hardway':
    case 'oneRoll':
    case 'composite':
      return family.projection === 'round' ? everyPhase(cfg) : only(COME_OUT)
    case 'collectSet':
      // After any 7 the next roll is a come-out (a come-out 7 is a natural, a point-phase 7 a
      // seven-out), and so is a hand's first roll; only Shoot To Win's window is any roll.
      return type.placement === 'noneOfTypeActive' ? everyPhase(cfg) : only(COME_OUT)
    case 'uniquePointsMade':
    case 'handLength':
    case 'pointRun':
      return only(COME_OUT)
  }
}

/**
 * Whether `spec`'s typical placement is weighted by the round's long-run shares (π from
 * `roundStats`): number bets and hardways that follow the round (`everyPhase`), come-type line
 * bets (`pointPhases`) and the odds behind them (`afterTravel`), and a Lucky Roller taken before
 * any roll (`noneOfTypeActive`) whose chain follows the round. Those weights, and so every number
 * derived from them, depend on `/variant` and the `/rules` lists that drive the round;
 * `configPathsOf` adds those pointers for such bets (M5/M6 audit). A pass-type bet or its odds
 * starts in one fixed phase, so it is not π-weighted; nor is a side bet made at the come-out, or a
 * Lucky Roller whose chain reads nothing of the round (`followsRound`), where the phase weights
 * collapse into one state.
 */
export function roundWeightedStart(spec: BetSpec, cfg: MachineConfig): boolean {
  const resolved = resolveBet(cfg, spec.typeId)
  if (resolved === null) return false
  const { type, family } = resolved
  switch (type.family) {
    case 'odds': {
      const parent = cfg.catalog.get(type.parent)
      return parent?.family === 'line' && parent.window === 'point'
    }
    case 'line':
      return type.window === 'point'
    case 'numberVsSeven':
    case 'hardway':
    case 'oneRoll':
    case 'composite':
      return family.projection === 'round'
    case 'collectSet':
      return type.placement === 'noneOfTypeActive' && followsRound(resolved)
    case 'uniquePointsMade':
    case 'handLength':
    case 'pointRun':
      return false
  }
}

/**
 * Whether analysing `spec` from `start` prices a put bet: a new pass-type bet placed straight on a
 * point, where the machine allows it (`/rules/allowPutBets`). A put's lifecycle ends at its first
 * decision — a winner that stays goes back to the line as a new line bet, not a put (rules spec
 * §3.1) — where a carried line bet on its point (equity of a bet that travelled there) is followed
 * through the wins that leave it up.
 */
export function isPutStart(spec: BetSpec, start: StartContext, cfg: MachineConfig): boolean {
  if (spec.number === null || start.carried || !cfg.input.rules.allowPutBets) return false
  const type = cfg.catalog.get(spec.typeId)
  return type?.family === 'line' && type.window === 'comeOut' && type.side === 'do'
}

/** The long-run share of every phase. */
export function everyPhase(cfg: MachineConfig): readonly WeightedPhase[] {
  return roundStats(cfg).phases.map(({ phase, share }) => ({ phase, weight: share }))
}

/** The point phase, each point weighted by its share of point-phase rolls. */
export function pointPhases(cfg: MachineConfig): readonly WeightedPhase[] {
  const stats = roundStats(cfg)
  return stats.phases
    .filter(({ phase }) => phase.kind === 'point')
    .map(({ phase, share }) => ({ phase, weight: share.div(stats.pointShare) }))
}

/**
 * The phase right after a bet made in the point phase travelled to `n`: the point the travelling
 * roll was made under is distributed as in `pointPhases`, and rolling n under point n made it.
 */
export function afterTravel(n: PointNumber, cfg: MachineConfig): readonly WeightedPhase[] {
  return pointPhases(cfg).map(({ phase, weight }) => ({
    phase: phase.kind === 'point' && phase.point === n ? COME_OUT : phase,
    weight,
  }))
}

/** A canonical string for a start, for cache keys. */
export function startKey(start: StartContext): string {
  const phases = start.phases
    .map(({ phase, weight }) => {
      const at = phase.kind === 'comeOut' ? 'co' : `p${phase.point}`
      return `${at}=${weight.toString()}`
    })
    .join(',')
  const inputs = [start.carried, start.working, start.globalOff].map(String).join('|')
  const progress = start.progress ?? 0
  return `${phases}|${inputs}${start.held === true ? '|held' : ''}${progress === 0 ? '' : `|g${progress}`}`
}

function only(phase: Phase): readonly WeightedPhase[] {
  return [{ phase, weight: Fraction.ONE }]
}

function onPoint(point: PointNumber): readonly WeightedPhase[] {
  return only({ kind: 'point', point })
}
