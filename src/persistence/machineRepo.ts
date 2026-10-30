import { z } from 'zod'
import { validateConfig } from '../engine/index.ts'
import type { MachineConfigInput } from '../engine/index.ts'
import { MACHINE_CONFIG_HISTORY, migrate } from './migrations.ts'
import { isJsonObject } from './safeJson.ts'
import type { RepoWrite } from './sessionRepo.ts'
import { KEYS, safeGet, safeSet } from './storage.ts'

/**
 * The player's own machines (plan §8 `machines:v1`, M12): configs made in the machine editor or
 * Match My Machine, or imported from a file, kept in IndexedDB beside the session. Each is stored
 * whole, so a machine plays the same wherever it goes; a session started on one carries its own
 * copy of the config in its log, so editing or deleting a machine never touches a game in play.
 *
 * Reading checks every entry again — its shape, its config's version (`migrations.ts`) and the
 * config itself (`validateConfig`) — and leaves out any entry that no longer passes, counting it
 * in `dropped`; junk in the slot itself reads as no machines. Nothing here throws.
 */

/** One saved machine. Its id is its config's id, unique among saved machines and presets. */
export interface SavedMachine {
  readonly id: string
  /** When it was last saved (ms since the epoch), for ordering. */
  readonly savedAt: number
  /** The preset it was made from, if any: shown beside it and used to mark what changed. */
  readonly basedOn: string | null
  readonly config: MachineConfigInput
}

export const MACHINES_VERSION = 1

export type MachineList =
  | { readonly ok: true; readonly machines: readonly SavedMachine[]; readonly dropped: number }
  | { readonly ok: false; readonly error: string }

export interface MachineRepo {
  /** Every saved machine that still validates, newest first. */
  list(): Promise<MachineList>
  /** Adds the machine, or replaces the saved one with the same id. */
  save(machine: SavedMachine): Promise<RepoWrite>
  remove(id: string): Promise<RepoWrite>
}

const EntrySchema = z.object({
  id: z.string().min(1),
  savedAt: z.number(),
  basedOn: z.string().nullable(),
  config: z.unknown(),
})

/** The entries of a stored blob that still read as machines; the rest are counted, not thrown. */
export function readMachines(blob: unknown): { machines: SavedMachine[]; dropped: number } {
  if (!isJsonObject(blob) || blob['version'] !== MACHINES_VERSION) {
    return { machines: [], dropped: 0 }
  }
  const entries = Array.isArray(blob['machines']) ? (blob['machines'] as unknown[]) : []
  const machines: SavedMachine[] = []
  let dropped = 0
  for (const entry of entries) {
    const parsed = EntrySchema.safeParse(entry)
    const config = parsed.success ? migrate(parsed.data.config, MACHINE_CONFIG_HISTORY) : null
    if (!parsed.success || config === null || !config.ok) {
      dropped += 1
      continue
    }
    const input = config.data as unknown as MachineConfigInput
    if (validateConfig(input).length > 0 || input.id !== parsed.data.id) {
      dropped += 1
      continue
    }
    machines.push({
      id: parsed.data.id,
      savedAt: parsed.data.savedAt,
      basedOn: parsed.data.basedOn,
      config: input,
    })
  }
  machines.sort((a, b) => b.savedAt - a.savedAt)
  return { machines, dropped }
}

export function createMachineRepo(): MachineRepo {
  async function stored(): Promise<
    { ok: true; machines: SavedMachine[]; dropped: number } | { ok: false; error: string }
  > {
    const blob = await safeGet<unknown>(KEYS.machines)
    if (!blob.ok) return blob
    return { ok: true, ...readMachines(blob.value) }
  }

  async function write(machines: readonly SavedMachine[]): Promise<RepoWrite> {
    const written = await safeSet(KEYS.machines, { version: MACHINES_VERSION, machines })
    return written.ok ? { ok: true } : written
  }

  return {
    async list() {
      const read = await stored()
      return read.ok ? { ok: true, machines: read.machines, dropped: read.dropped } : read
    },
    async save(machine) {
      const read = await stored()
      if (!read.ok) return read
      return write([machine, ...read.machines.filter((saved) => saved.id !== machine.id)])
    },
    async remove(id) {
      const read = await stored()
      if (!read.ok) return read
      return write(read.machines.filter((saved) => saved.id !== id))
    },
  }
}

/** The app's machine repo; tests build their own over fake-indexeddb. */
export const machineRepo: MachineRepo = createMachineRepo()
