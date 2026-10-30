import { canonicalJson } from '../../../engine/index.ts'
import type { MachineConfigInput } from '../../../engine/index.ts'
import type { ConfigIssue } from '../../../engine/config/issues.ts'
import {
  governingEntry,
  pruneProvenance,
  resolvePointer,
  toPointer,
  type ProvenanceEntry,
} from '../../../engine/config/provenance.ts'

/**
 * The machine editor's draft (M12): a plain copy of a `MachineConfigInput` changed one value at a
 * time, never in place (a compiled config freezes its input, so the editor always works on a
 * copy). Every change also keeps the provenance honest: a value the player sets is recorded as
 * reported by them (`USER`, rules spec §5.4: "the player's own observation of a machine"), a value
 * set back to the machine it started from gets that machine's provenance back, and entries left
 * pointing at nothing are pruned, as validation requires.
 */

export type Path = readonly (string | number)[]

/** The provenance the editor records for a value the player set. */
export function playerEntry(note: string): ProvenanceEntry {
  return { status: 'reported', source: 'USER', note }
}

/** Whether `entry` records the player's own observation. */
export function isPlayerEntry(entry: ProvenanceEntry | undefined): boolean {
  return entry?.source !== undefined && entry.source.trim().startsWith('USER')
}

/** The value at `path`, or undefined. */
export function getAt(root: unknown, path: Path): unknown {
  let current: unknown = root
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    if (Array.isArray(current)) {
      current = typeof key === 'number' ? current[key] : undefined
    } else {
      const record = current as Record<string, unknown>
      current = Object.hasOwn(record, String(key)) ? record[String(key)] : undefined
    }
  }
  return current
}

/** A copy of `root` with `path` set to `value`, or removed when `value` is undefined. */
export function setAt<T>(root: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T
  const [key, ...rest] = path
  if (key === undefined) return root
  if (Array.isArray(root)) {
    const copy = [...(root as unknown[])]
    const index = Number(key)
    if (rest.length === 0 && value === undefined) copy.splice(index, 1)
    else copy[index] = setAt(copy[index], rest, value)
    return copy as T
  }
  const record = { ...((root ?? {}) as Record<string, unknown>) }
  const name = String(key)
  if (rest.length === 0 && value === undefined) {
    delete record[name]
  } else {
    record[name] = setAt(Object.hasOwn(record, name) ? record[name] : undefined, rest, value)
  }
  return record as T
}

/** Whether two JSON values are the same, key order aside. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return canonicalJson(a) === canonicalJson(b)
}

/**
 * The draft with `path` set to `value` (undefined removes it), its provenance updated: the
 * player's entry at the value's pointer, or, when the value is the base machine's again, the base
 * machine's own entry there (if it had one) — then pruned.
 */
export function editValue(
  draft: MachineConfigInput,
  base: MachineConfigInput | null,
  path: Path,
  value: unknown,
  note = 'Set in the machine editor to match your machine.',
): MachineConfigInput {
  const pointer = toPointer(path)
  const changed = setAt(draft, path, value)
  // The machine's name and id describe the config, not a machine value: no provenance.
  if (path.length === 1 && (path[0] === 'name' || path[0] === 'id')) return changed
  const provenance = { ...changed.provenance }
  const baseEntry =
    base !== null && Object.hasOwn(base.provenance, pointer) ? base.provenance[pointer] : undefined
  const asBase = base !== null && value !== undefined && sameJson(value, getAt(base, path))
  if (asBase && baseEntry !== undefined) {
    provenance[pointer] = baseEntry
  } else if (asBase || value === undefined) {
    delete provenance[pointer]
  } else {
    provenance[pointer] = playerEntry(note)
  }
  const next = { ...changed, provenance }
  return { ...next, provenance: pruneProvenance(next) }
}

/** The provenance shown for `pointer`: its status, and the entry that governs it, if any. */
export function provenanceAt(
  draft: MachineConfigInput,
  pointer: string,
): {
  readonly status: 'verified' | 'reported' | 'assumed'
  readonly entry: ProvenanceEntry | null
  readonly mine: boolean
} {
  const governing = governingEntry(draft.provenance, pointer)
  if (governing === null) return { status: 'assumed', entry: null, mine: false }
  return {
    status: governing.entry.status,
    entry: governing.entry,
    mine: isPlayerEntry(governing.entry),
  }
}

/**
 * Where each issue shows: at the deepest pointer among `shown` that is the issue's own pointer or
 * one above it. An issue about a value the editor shows no field for (a pay missing for a number,
 * say) lands on the group that holds it; one above every shown pointer lands on the root ('').
 */
export function placeIssues<T>(
  issues: readonly T[],
  pointerOf: (issue: T) => string,
  shown: ReadonlySet<string>,
): Map<string, T[]> {
  const placed = new Map<string, T[]>()
  for (const issue of issues) {
    let at = pointerOf(issue)
    while (at !== '' && !shown.has(at)) at = at.slice(0, at.lastIndexOf('/'))
    const list = placed.get(at) ?? []
    list.push(issue)
    placed.set(at, list)
  }
  return placed
}

/** A config issue's pointer. */
export function issuePointer(issue: ConfigIssue): string {
  return toPointer(issue.path)
}

/** Whether `pointer` names a value in `root`. */
export function exists(root: unknown, pointer: string): boolean {
  return pointer === '' || resolvePointer(root, pointer).found
}
