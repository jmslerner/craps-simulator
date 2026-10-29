import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS } from '../engine/config/presets/index.ts'
import { cents } from '../engine/core/money.ts'
import { Fraction } from '../engine/core/rational.ts'
import { analyzeBet, type BetAnalysis } from './analyze.ts'
import { catalogTable, type CatalogRow } from './catalog.ts'
import { fromWire, toWire } from './wire.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

describe('wire', () => {
  it('round-trips an analysis through JSON and a structured clone, fractions exact', () => {
    const analysis = analyzeBet({ typeId: 'place', number: 6 }, cents(500), 'typical', crapless)
    const viaJson = fromWire<BetAnalysis>(JSON.parse(JSON.stringify(toWire(analysis))))
    expect(viaJson.edge).toBeInstanceOf(Fraction)
    expect(viaJson.edge.equals(analysis.edge)).toBe(true)
    expect(viaJson.payouts[0]?.winExact.toString()).toBe('1750/3')
    expect(viaJson.winPaid).toBe(583)
    expect(JSON.stringify(toWire(viaJson))).toBe(JSON.stringify(toWire(analysis)))
    const viaClone = fromWire<BetAnalysis>(structuredClone(toWire(analysis)))
    expect(viaClone.lifecycle.risked.equals(analysis.lifecycle.risked)).toBe(true)
  })

  it('round-trips a whole catalog', () => {
    const rows = catalogTable(crapless)
    const back = fromWire<readonly CatalogRow[]>(JSON.parse(JSON.stringify(toWire(rows))))
    expect(back.map((row) => row.edge.toString())).toEqual(rows.map((row) => row.edge.toString()))
  })

  it('refuses values that are not plain JSON, and malformed fractions', () => {
    expect(() => toWire({ big: 1n })).toThrow(/bigint/)
    expect(() => toWire({ map: new Map() })).toThrow(/Map/)
    expect(() => toWire({ n: Number.NaN })).toThrow(/finite/)
    expect(() => fromWire({ $fraction: ['1', '0'] } as never)).toThrow(TypeError)
    expect(() => fromWire({ $fraction: ['1.5', '2'] } as never)).toThrow(TypeError)
  })
})
