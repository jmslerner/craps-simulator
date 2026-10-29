import type { MachineConfigInput, OneRollTypeConfig } from '../schema.ts'

type ProvenanceEntry = MachineConfigInput['provenance'][string]

/** Every hop: the 15 easy (unpaired) and 6 hard (paired) combinations, low face first. */
export const ALL_HOPS = [
  '1-1',
  '1-2',
  '1-3',
  '1-4',
  '1-5',
  '1-6',
  '2-2',
  '2-3',
  '2-4',
  '2-5',
  '2-6',
  '3-3',
  '3-4',
  '3-5',
  '3-6',
  '4-4',
  '4-5',
  '4-6',
  '5-5',
  '5-6',
  '6-6',
] as const

/**
 * Interblock's hop panel: 13 easy hops and the hard hops 2-2 to 5-5. 1-1, 1-2, 5-6 and 6-6 are
 * the horn singles instead (rules spec §3.4).
 */
export const INTERBLOCK_HOPS = ALL_HOPS.filter(
  (combo) => !['1-1', '1-2', '5-6', '6-6'].includes(combo),
)

/** The type id of a hop: "hop25" for 2-5. */
export function hopId(combo: string): string {
  return `hop${combo.replace('-', '')}`
}

/** One-roll hop types for `combos`, paying `easy` on unpaired dice and `hard` on pairs. */
export function hopTypes(
  combos: readonly string[],
  pays: { readonly easy: string; readonly hard: string },
  afterWin: OneRollTypeConfig['afterWin'],
): Record<string, OneRollTypeConfig> {
  return Object.fromEntries(
    combos.map((combo): [string, OneRollTypeConfig] => [
      hopId(combo),
      {
        family: 'oneRoll',
        label: `Hop ${combo}`,
        match: 'dice',
        pays: { [combo]: combo[0] === combo[2] ? pays.hard : pays.easy },
        afterWin,
      },
    ]),
  )
}

/** The same provenance entry for `/catalog/<id>` of every hop in `combos`. */
export function hopProvenance(
  combos: readonly string[],
  entry: ProvenanceEntry,
): Record<string, ProvenanceEntry> {
  return Object.fromEntries(combos.map((combo) => [`/catalog/${hopId(combo)}`, entry]))
}
