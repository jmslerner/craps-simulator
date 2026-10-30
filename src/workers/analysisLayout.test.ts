import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import { applyAction } from '../engine/table/reducer.ts'
import { newTable, type TableState } from '../engine/table/state.ts'
import { byEdge, catalogTable, fromWire } from '../exact/index.ts'
import type { CatalogRow } from '../exact/index.ts'
import { layoutMeter, type LayoutMeter } from '../coach/meter.ts'
import { handleAnalysisRequest } from './analysisHandler.ts'

/**
 * The M9d additions to the worker protocol: the catalog response carries the raw `byEdge`-sorted
 * rows beside the badges (cache included), and a `layout` request prices the exact table it was
 * sent — byte-equal to `layoutMeter` run directly.
 */

const crapless = compileConfig(PRESETS.craplessBubble)

function placeFour(): TableState {
  const result = applyAction(
    newTable(crapless, 'worker-layout'),
    { type: 'place', typeId: 'place', number: 4, amount: cents(500) },
    crapless,
  )
  if (!result.ok) throw new Error(result.rejection.code)
  return result.state
}

describe('handleAnalysisRequest: catalog rows (§10 M9d cheat sheet)', () => {
  it('sends the byEdge-sorted raw rows, identically on the compute and cache paths', async () => {
    const request = {
      kind: 'catalog',
      configHash: crapless.configHash,
      input: crapless.input,
    } as const
    const first = await handleAnalysisRequest({ id: 1, ...request })
    if (!first.ok || first.kind !== 'catalog') throw new Error('first catalog request failed')
    expect(first.fromCache).toBe(false)
    const expected = byEdge(catalogTable(crapless))
    expect(first.rows).toHaveLength(expected.length)
    const decoded = first.rows.map((wired) => fromWire<CatalogRow>(wired))
    decoded.forEach((row, index) => {
      expect(row.spec).toEqual(expected[index]?.spec)
      expect(row.edge.equals(expected[index]?.edge ?? Fraction.of(-1))).toBe(true)
      expect(row.amount).toBe(expected[index]?.amount)
    })

    const second = await handleAnalysisRequest({ id: 2, ...request })
    if (!second.ok || second.kind !== 'catalog') throw new Error('second catalog request failed')
    expect(second.fromCache).toBe(true)
    expect(second.rows).toEqual(first.rows)
    expect(second.badges).toEqual(first.badges)
  })
})

describe('handleAnalysisRequest: layout (§10 M9d meter)', () => {
  it('prices the sent table equal to layoutMeter run directly, toggle included', async () => {
    const state = placeFour()
    const toggle = { action: { type: 'setGlobalWorking', off: true }, showSetOn: false } as const
    const response = await handleAnalysisRequest({
      id: 3,
      kind: 'layout',
      configHash: crapless.configHash,
      input: crapless.input,
      state,
      toggle,
    })
    if (!response.ok || response.kind !== 'layout') throw new Error('layout request failed')
    const meter = fromWire<LayoutMeter>(response.meter)
    const direct = layoutMeter(state, crapless, toggle)
    expect(
      meter.perRoll.exact instanceof Fraction &&
        direct.perRoll.exact instanceof Fraction &&
        meter.perRoll.exact.equals(direct.perRoll.exact),
    ).toBe(true)
    expect(meter.headline).toEqual(direct.headline)
    expect(meter.hourly).toEqual(direct.hourly)
    expect(meter.byBet).toEqual(direct.byBet)
    expect(meter.toggled).toEqual(direct.toggled)
    expect(meter.alternative).toEqual(direct.alternative)
  })

  it('answers a table from another config with a failure response, never a throw', async () => {
    const strict = compileConfig(PRESETS.strictBubble)
    const response = await handleAnalysisRequest({
      id: 4,
      kind: 'layout',
      configHash: crapless.configHash,
      input: crapless.input,
      state: newTable(strict, 'other-config'),
      toggle: null,
    })
    expect(response.ok).toBe(false)
  })
})
