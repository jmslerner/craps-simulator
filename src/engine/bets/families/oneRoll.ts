import type { CompositeBet, MachineConfig, OneRollBetType } from '../../config/compile.ts'
import type { Ratio } from '../../config/ratio.ts'
import type { PointNumber } from '../../config/rulesets.ts'
import type { Dice } from '../../core/dice.ts'
import type { TableState } from '../../table/state.ts'
import {
  reject,
  roundingPointer,
  type BetFamily,
  type BetInstance,
  type Decision,
  type Located,
  type Mutability,
  type PlaceRequest,
  type Rejection,
  type RollContext,
} from '../types.ts'

/**
 * One-roll bets: the field, any 7, any craps, C, E, the horn numbers 2, 3, 11 and 12, and the hops
 * (rules spec §3.4). The next roll decides them: an outcome listed in `/catalog/<t>/pays` wins at
 * its pay, and every other roll loses. Outcomes are totals ("7") when `/catalog/<t>/match` is
 * `total`, and dice, low face first, when it is `dice`: a hop on 1-2 wins on 1-2 and on 2-1, and a
 * hop on 3-3 only on the pair. Pays keep the machine's wording, so "16 for 1" pays 15:1 (§0.1).
 *
 * One-roll bets always work and cannot be switched OFF (§2.4), and they can be placed, changed or
 * taken down before any roll. A winner comes back, or stays up for the next roll where
 * `/catalog/<t>/afterWin` is `stay`: Shoot To Win re-bets winners automatically (CW §32), while
 * Interblock and live tables return them (§9 #19).
 *
 * The spot helpers here serve composites too (`bets/composites.ts`), which are one-roll bets
 * placed as one spot.
 */

/** A bet placed on a spot of its own: a one-roll bet or a composite. */
type SpotType = OneRollBetType | CompositeBet

const LOSE: Decision = Object.freeze({ kind: 'lose' })
const FREE: Mutability = Object.freeze({
  increase: true,
  decrease: true,
  remove: true,
  toggle: false,
})

/** The outcome key a roll gives: its total, or its dice with the low face first ("2-5"). */
export function outcomeKey(match: 'total' | 'dice', dice: Dice): string {
  if (match === 'total') return String(dice.d1 + dice.d2)
  return dice.d1 <= dice.d2 ? `${dice.d1}-${dice.d2}` : `${dice.d2}-${dice.d1}`
}

/** A spot bet names no number and no parent, and adds to the bet of its type already there. */
export function locateSpot(req: PlaceRequest<SpotType>): Located | Rejection {
  const { state, type } = req
  const at = { typeId: type.typeId }
  if (req.number !== null) return reject('BAD_PARAMS', { ...at, field: 'number' })
  if (req.parentId !== null) return reject('BAD_PARAMS', { ...at, field: 'parentId' })
  const existing = state.bets.find((b) => b.typeId === type.typeId) ?? null
  return { existing, number: null, parentId: null }
}

/** Spot bets can be pressed, reduced and taken down before any roll; they never switch OFF. */
export function spotMutability(): Mutability {
  return FREE
}

/** A decided spot bet that wins and stays is left as it is; anything else decided comes down. */
export function applySpot(bet: BetInstance, decision: Decision): BetInstance | null {
  switch (decision.kind) {
    case 'win':
      return decision.stake === 'stay' ? bet : null
    case 'push':
      return decision.reason === 'zeroNet' && decision.stake === 'stay' ? bet : null
    case 'lose':
      return null
    case 'none':
    case 'travel':
    case 'progress':
      return bet
  }
}

/**
 * A spot bet sits on no number and backs nothing. One whose winners come back cannot outlive the
 * roll it was placed for, since every roll decides it.
 */
export function spotInvariants(bet: BetInstance, state: TableState, type: SpotType): string[] {
  const problems: string[] = []
  const at = `${bet.id} (${type.typeId})`
  if (bet.number !== null) problems.push(`${at} is on ${bet.number}, but it takes no number`)
  if (bet.parentId !== null) problems.push(`${at} backs ${bet.parentId}`)
  if (type.afterWin === 'return' && bet.placedAtRoll < state.round.rollIndex) {
    problems.push(`${at} was placed for roll ${bet.placedAtRoll} and is still up after it`)
  }
  return problems
}

function decide(_bet: BetInstance, ctx: RollContext, type: OneRollBetType): Decision {
  const key = outcomeKey(type.match, ctx.dice)
  return type.pays.has(key) ? { kind: 'win', payKey: key, stake: type.afterWin } : LOSE
}

function payout(type: OneRollBetType, payKey: string): Ratio {
  const ratio = type.pays.get(payKey)
  if (ratio === undefined) throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  return ratio
}

function configPaths(type: OneRollBetType, _n: PointNumber | null, cfg: MachineConfig): string[] {
  const at = `/catalog/${type.typeId}`
  return [`${at}/match`, `${at}/pays`, `${at}/afterWin`, roundingPointer(cfg, type.typeId)]
}

export const oneRollFamily: BetFamily<OneRollBetType> = {
  projection: 'none',
  toggleable: false,
  decidesWhenOff: false,
  locate: locateSpot,
  canPlace: () => null,
  mutability: spotMutability,
  defaultWorking: () => true,
  decide,
  apply: applySpot,
  payout,
  configPaths,
  invariants: spotInvariants,
}
