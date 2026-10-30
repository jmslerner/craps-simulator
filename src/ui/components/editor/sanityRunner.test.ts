import { describe, expect, it } from 'vitest'
import { PRESETS, compileConfig } from '../../../engine/index.ts'
import type { MachineConfigInput } from '../../../engine/index.ts'
import { sanityCheck } from '../../../exact/index.ts'
import { blocks, cachedSanity, runSanity } from './sanityRunner.ts'

/** The editor's sanity run: the same findings as `sanityCheck`, a bet at a time, cancellable. */

function sevenFor(pay: string) {
  const input = structuredClone(PRESETS.craplessBubble) as MachineConfigInput
  const seven = input.catalog['any7']
  if (seven?.family !== 'oneRoll') throw new Error('no any 7')
  seven.pays = { '7': pay }
  return compileConfig({ ...input, id: `seven-${pay.replace(/\W+/g, '-')}` })
}

describe('runSanity', () => {
  it('finds what sanityCheck finds, reports progress, and remembers the run by config hash', async () => {
    const cfg = sevenFor('2 for 1')
    const steps: number[] = []
    const issues = await runSanity(cfg, new AbortController().signal, (step) =>
      steps.push(step.checked),
    )
    expect(issues).toEqual(sanityCheck(cfg))
    expect(issues?.map((issue) => issue.code)).toEqual(['highEdge'])
    expect(steps.at(-1)).toBe(steps.length)
    expect(cachedSanity(cfg)).toBe(issues)
    expect(await runSanity(cfg, new AbortController().signal)).toBe(issues)
    expect(blocks(issues ?? [])).toBe(false)
  }, 30_000)

  it('stops when a newer draft aborts it, keeping nothing', async () => {
    const cfg = sevenFor('5 to 1')
    const controller = new AbortController()
    const run = runSanity(cfg, controller.signal)
    controller.abort()
    expect(await run).toBeNull()
    expect(cachedSanity(cfg)).toBeNull()
  })

  it('blocks on an error: a dead-even "for 1" pay typed as "to 1"', async () => {
    const issues = await runSanity(sevenFor('5 to 1'), new AbortController().signal)
    expect(issues?.map((issue) => [issue.severity, issue.code])).toEqual([['error', 'playerEven']])
    expect(blocks(issues ?? [])).toBe(true)
  }, 30_000)
})
