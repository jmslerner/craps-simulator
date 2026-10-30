import type { Cents, MachineConfig } from '../../engine/index.ts'
import { distribution, paysExactly, typicalStart } from '../../exact/index.ts'
import type { BetSpec } from '../../exact/index.ts'

/**
 * Whether the machine pays `spec` exactly at `amount` — every settlement of its usual first
 * decision comes out the same rounded as unrounded, and no commission minimum sits above the rate
 * (`exact/amounts.ts` `paysExactly`, the predicate behind the catalog's exact unit). An advisor
 * that is about to say "at $X the machine pays it exactly" checks the stake it names with this,
 * never with "cheaper than the current stake": on a $5-increment machine the stake nearest a
 * $10,000 place 6 that prices cheaper is $9,995, which still loses a sliver to rounding, while the
 * exact stake is $9,990 (M9 audit).
 */
export function paysExactlyAt(spec: BetSpec, amount: Cents, cfg: MachineConfig): boolean {
  const labels = distribution(spec, typicalStart(spec, cfg), 'decision', cfg).labels
  return paysExactly(spec, labels, amount, cfg)
}
