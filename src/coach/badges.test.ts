import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../engine/config/presets/index.ts'
import { Fraction } from '../engine/core/rational.ts'
import { catalogTable } from '../exact/catalog.ts'
import { zoneBadges } from './badges.ts'
import { formatCoachNumber } from './format.ts'
import { gradeOf } from './policy.ts'
import { badgeKey } from './types.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

describe('zoneBadges', () => {
  it('builds one badge per catalog row, with the row’s edge, grade and provenance', () => {
    for (const id of PRESET_IDS) {
      const cfg = compileConfig(PRESETS[id])
      const rows = catalogTable(cfg)
      const badges = zoneBadges(cfg)
      expect(badges, id).toHaveLength(rows.length)
      rows.forEach((row, index) => {
        const badge = badges[index]
        expect(badge?.typeId).toBe(row.spec.typeId)
        expect(badge?.number).toBe(row.spec.number)
        expect(badge?.amount).toBe(row.amount)
        expect(badge?.edge.kind).toBe('percent')
        expect(badge !== undefined && (badge.edge.exact as Fraction).equals(row.edge)).toBe(true)
        expect(badge?.grade).toBe(gradeOf(row.edge))
        expect(badge?.edge.assumedPaths).toEqual(row.assumedPaths)
        expect(badge?.edge.source).toEqual({
          fn: 'catalogRow',
          args: { spec: row.spec, amount: row.amount },
          configHash: cfg.configHash,
        })
      })
    }
    // Every preset's whole catalog, priced cold (about a second alone; slower on a loaded machine).
  }, 30_000)

  it('prices place 6 at its exact unit: the published 1/66, shown "1.52%", graded good', () => {
    const badge = zoneBadges(crapless).find(
      (b) => badgeKey(b.typeId, b.number) === badgeKey('place', 6),
    )
    expect(badge).toBeDefined()
    expect(badge !== undefined && (badge.edge.exact as Fraction).equals(Fraction.of(1, 66))).toBe(
      true,
    )
    expect(badge === undefined ? '' : formatCoachNumber(badge.edge)).toBe('1.52%')
    expect(badge?.grade).toBe('good')
  })

  it('prices the crapless pass at the published 373/6930, shown "5.38%", graded fair', () => {
    const badge = zoneBadges(crapless).find(
      (b) => badgeKey(b.typeId, b.number) === badgeKey('pass', null),
    )
    expect(badge).toBeDefined()
    expect(
      badge !== undefined && (badge.edge.exact as Fraction).equals(Fraction.of(373, 6930)),
    ).toBe(true)
    expect(badge === undefined ? '' : formatCoachNumber(badge.edge)).toBe('5.38%')
    expect(badge?.grade).toBe('fair')
  })
})
