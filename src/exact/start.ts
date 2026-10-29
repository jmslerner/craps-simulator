import {
  Fraction,
  resolveType,
  type MachineConfig,
  type Phase,
  type PointNumber,
} from '../engine/index.ts'
import {
  COME_OUT,
  ExactError,
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
 * - one-roll bets and composites: no phase at all (`projection: none`).
 */

/** A start in one phase: a new bet, no toggles unless given. */
export function startAt(
  phase: Phase,
  options: Partial<Pick<StartContext, 'carried' | 'working' | 'globalOff' | 'held'>> = {},
): StartContext {
  return {
    phases: [{ phase, weight: Fraction.ONE }],
    carried: options.carried ?? false,
    working: options.working ?? null,
    globalOff: options.globalOff ?? null,
    held: options.held ?? false,
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
  const resolved = resolveType(cfg, spec.typeId)
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
  }
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
  return `${phases}|${inputs}${start.held === true ? '|held' : ''}`
}

function only(phase: Phase): readonly WeightedPhase[] {
  return [{ phase, weight: Fraction.ONE }]
}

function onPoint(point: PointNumber): readonly WeightedPhase[] {
  return only({ kind: 'point', point })
}
