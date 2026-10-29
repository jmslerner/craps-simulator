import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../engine/config/presets/index.ts'
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
    `standing ${row.standingPerRoll.toString()}`,
    row.atMinimum === null
      ? ''
      : `min $${(row.atMinimum.amount / 100).toString()} ${row.atMinimum.edge.toString()}`,
    `assumed ${row.assumedPaths.length}`,
  ]
    .filter((part) => part !== '')
    .join(' | ')
}

describe('catalogTable', () => {
  it('has one row per offered non-side bet and number, in config order', () => {
    const cfg = compileConfig(PRESETS.craplessBubble)
    const specs = catalogSpecs(cfg)
    expect(specs).toHaveLength(74)
    expect(specs.slice(0, 3)).toEqual([
      { typeId: 'pass', number: null },
      { typeId: 'come', number: null },
      { typeId: 'passOdds', number: 2 },
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
})
