import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../engine/config/presets/index.ts'
import type { MachineConfigInput } from '../engine/config/schema.ts'
import { byEdge, catalogSpecs, catalogTable, type CatalogRow } from './catalog.ts'

/** A row as one line of exact text: a data change shows its effect on every number in review. */
function fingerprint(row: CatalogRow): string {
  return [
    row.label,
    `$${(row.amount / 100).toString()}`,
    row.payoutLabel,
    `edge ${row.edge.toString()}`,
    `nominal ${row.nominalEdge.toString()}`,
    `roll ${row.edgePerWorkingRoll.toString()}`,
    `win ${row.pWin.toString()}`,
    `push ${row.pPush.toString()}`,
    `rolls ${row.expectedRolls.toString()}`,
    `standing ${row.standingPerRoll === null ? 'per decision' : row.standingPerRoll.toString()}`,
    row.atMinimum === null
      ? ''
      : `min $${(row.atMinimum.amount / 100).toString()} ${row.atMinimum.edge.toString()}`,
    `assumed ${row.assumedPaths.length}`,
  ]
    .filter((part) => part !== '')
    .join(' | ')
}

describe('catalogTable', () => {
  it('has one row per offered bet and number, in config order, the side bets last (M11)', () => {
    const cfg = compileConfig(PRESETS.craplessBubble)
    const specs = catalogSpecs(cfg)
    expect(specs).toHaveLength(77)
    expect(specs.slice(0, 3)).toEqual([
      { typeId: 'pass', number: null },
      { typeId: 'come', number: null },
      { typeId: 'passOdds', number: 2 },
    ])
    expect(specs.slice(-3)).toEqual([
      { typeId: 'luckyRollerLow', number: null },
      { typeId: 'luckyRollerHigh', number: null },
      { typeId: 'luckyRollerAll', number: null },
    ])
    expect(catalogTable(cfg).map((row) => row.spec)).toEqual(specs)
  })

  it('sorts by edge for the cheat sheet, the free odds first', () => {
    const rows = byEdge(catalogTable(compileConfig(PRESETS.craplessBubble)))
    expect(rows[0]?.edge.isZero()).toBe(true)
    rows.slice(1).forEach((row, index) => {
      expect(rows[index]?.edge.compare(row.edge), row.label).not.toBe(1)
    })
    const place6 = rows.find((row) => row.label === 'Place 6')
    expect(place6?.edge.toString()).toBe('1/66')
  })

  it.each(PRESET_IDS)('fingerprints %s (plan §9 item 11)', (id) => {
    expect(catalogTable(compileConfig(PRESETS[id])).map(fingerprint)).toMatchSnapshot()
  })

  it('adds put rows where the machine allows them, priced per decision (rules spec §3.1)', () => {
    const live = compileConfig(PRESETS.traditionalLive345)
    const puts = catalogTable(live).filter(
      (row) => row.spec.typeId === 'pass' && row.spec.number !== null,
    )
    expect(puts.map((row) => [row.label, row.edge.toString(), row.standingPerRoll])).toEqual([
      ['Put 4', '1/3', null],
      ['Put 5', '1/5', null],
      ['Put 6', '1/11', null],
      ['Put 8', '1/11', null],
      ['Put 9', '1/5', null],
      ['Put 10', '1/3', null],
    ])
    // No puts on a machine that refuses them.
    const crapless = compileConfig(PRESETS.craplessBubble)
    expect(
      catalogSpecs(crapless).every((spec) => spec.typeId !== 'pass' || spec.number === null),
    ).toBe(true)
  })

  it('serves fresh assumed chips after a provenance-only edit (same config hash)', () => {
    const before = compileConfig(PRESETS.craplessBubble)
    const rows = catalogTable(before)
    const place6 = rows.find((row) => row.label === 'Place 6')
    expect(place6?.assumedPaths).toContain('/catalog/place/pays/6')
    const input = structuredClone(PRESETS.craplessBubble) as MachineConfigInput
    input.provenance = {
      ...input.provenance,
      // Deepest entry wins: the player verified this one pay on their machine (the M12 flow).
      '/catalog/place/pays/6': {
        status: 'verified',
        source: 'USER',
        note: 'checked on the machine',
      },
    }
    const after = compileConfig(input)
    expect(after.configHash).toBe(before.configHash)
    const verified = catalogTable(after).find((row) => row.label === 'Place 6')
    expect(verified?.assumedPaths).not.toContain('/catalog/place/pays/6')
    // The first config's rows are still served, from its own cache entry.
    expect(catalogTable(before)).toBe(rows)
  })
})
