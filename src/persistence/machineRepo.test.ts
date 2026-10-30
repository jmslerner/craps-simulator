import { beforeEach, describe, expect, it } from 'vitest'
import { PRESETS } from '../engine/index.ts'
import type { MachineConfigInput } from '../engine/index.ts'
import { createMachineRepo, readMachines, type SavedMachine } from './machineRepo.ts'
import { KEYS, safeDel, safeGet, safeSet } from './storage.ts'

/** The saved machines on fake-indexeddb (the ui test setup loads it). */

const repo = createMachineRepo()

function mine(id: string, savedAt: number): SavedMachine {
  const config = { ...structuredClone(PRESETS.craplessBubble), id, name: `Mine ${id}` }
  return { id, savedAt, basedOn: 'craplessBubble', config: config as MachineConfigInput }
}

beforeEach(async () => {
  await safeDel(KEYS.machines)
})

describe('the machine repo', () => {
  it('lists nothing at first, then what was saved, newest first', async () => {
    expect(await repo.list()).toEqual({ ok: true, machines: [], dropped: 0 })
    await repo.save(mine('red-rock', 1))
    await repo.save(mine('fremont', 2))
    const listed = await repo.list()
    expect(listed.ok && listed.machines.map((m) => m.id)).toEqual(['fremont', 'red-rock'])
    expect(listed.ok && listed.machines[0]?.config.name).toBe('Mine fremont')
  })

  it('replaces a machine saved again under its id, and removes one', async () => {
    await repo.save(mine('red-rock', 1))
    await repo.save({ ...mine('red-rock', 5), basedOn: null })
    let listed = await repo.list()
    expect(listed.ok && listed.machines).toHaveLength(1)
    expect(listed.ok && listed.machines[0]?.basedOn).toBeNull()
    await repo.remove('red-rock')
    listed = await repo.list()
    expect(listed.ok && listed.machines).toEqual([])
  })

  it('leaves out entries that no longer validate, counting them, and reads junk as none', async () => {
    const broken = mine('broken', 3)
    const config = structuredClone(broken.config) as MachineConfigInput
    config.limits.min = -5
    await safeSet(KEYS.machines, {
      version: 1,
      machines: [mine('good', 1), { ...broken, config }, { id: 'shapeless' }, 'junk'],
    })
    const listed = await repo.list()
    expect(listed.ok && listed.machines.map((m) => m.id)).toEqual(['good'])
    expect(listed.ok && listed.dropped).toBe(3)
    expect(readMachines('junk')).toEqual({ machines: [], dropped: 0 })
    expect(readMachines({ version: 2, machines: [] })).toEqual({ machines: [], dropped: 0 })
    // An entry whose id disagrees with its config's is not trusted either.
    expect(readMachines({ version: 1, machines: [{ ...mine('a', 1), id: 'b' }] }).dropped).toBe(1)
  })

  it('stores under machines:v1 (plan §8)', async () => {
    await repo.save(mine('kept', 1))
    const blob = await safeGet<{ version: number }>(KEYS.machines)
    expect(KEYS.machines).toBe('machines:v1')
    expect(blob.ok && blob.value?.version).toBe(1)
  })
})
