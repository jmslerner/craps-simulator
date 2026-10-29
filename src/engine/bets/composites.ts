import type { CompositeBet, MachineConfig } from '../config/compile.ts'
import type { Ratio } from '../config/ratio.ts'
import type { PointNumber } from '../config/rulesets.ts'
import {
  applySpot,
  locateSpot,
  outcomeKey,
  spotInvariants,
  spotMutability,
} from './families/oneRoll.ts'
import {
  roundingPointer,
  type BetFamily,
  type BetInstance,
  type Decision,
  type RollContext,
} from './types.ts'

/**
 * Composites: C&E, the horn, horn high X and the world bet (rules spec §3.4, §4.1; plan §0 #15).
 *
 * A composite is one bet, not a batch of its parts. It is placed, shown and taken down as one spot
 * whose type id is the composite's id (`/composites/<id>`), as on Interblock and Shoot To Win, and
 * limits, increments and minimums apply to its whole stake. The next roll decides it once, on the
 * net per unit its parts' catalog pays give: Σ(units of the winning parts × (pay + 1)) ÷ total
 * units − 1, worked out when the config is compiled (`CompositeBet`). So a $4 horn on a 2 wins
 * 27/4 × $4 = $27 and is settled with one rounding, as Interblock pays it ($100 on 6-6: +$675).
 * A roll that nets 0 pushes (the world bet on a 7), and every other roll loses the whole bet:
 * validation rejects a composite that could lose only part of it.
 *
 * Like its parts, a composite always works, and after a win (or a push) its whole stake comes back
 * or stays up as their shared `afterWin` says.
 */

const LOSE: Decision = Object.freeze({ kind: 'lose' })

function decide(_bet: BetInstance, ctx: RollContext, type: CompositeBet): Decision {
  const key = outcomeKey(type.match, ctx.dice)
  if (type.pays.has(key)) return { kind: 'win', payKey: key, stake: type.afterWin }
  if (type.pushes.has(key)) return { kind: 'push', reason: 'zeroNet', stake: type.afterWin }
  return LOSE
}

function payout(type: CompositeBet, payKey: string): Ratio {
  const ratio = type.pays.get(payKey)
  if (ratio === undefined) throw new RangeError(`${type.typeId} pays nothing at "${payKey}"`)
  return ratio
}

/** The composite's parts and units, what each part wins on and pays, and their rounding. */
function configPaths(type: CompositeBet, _n: PointNumber | null, cfg: MachineConfig): string[] {
  const parts = type.parts.flatMap(({ typeId }) =>
    ['match', 'pays', 'afterWin'].map((key) => `/catalog/${typeId}/${key}`),
  )
  const rounding = new Set(type.parts.map(({ typeId }) => roundingPointer(cfg, typeId)))
  return [`/composites/${type.typeId}`, ...parts, ...rounding]
}

export const compositeFamily: BetFamily<CompositeBet> = {
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
