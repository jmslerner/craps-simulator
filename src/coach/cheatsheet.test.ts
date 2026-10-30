import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, PRESET_IDS } from '../engine/config/presets/index.ts'
import { Fraction } from '../engine/core/rational.ts'
import { byEdge, catalogTable } from '../exact/index.ts'
import { sheetFromRows } from './cheatsheet.ts'
import { formatCoachNumber, formatPart } from './format.ts'
import { gradeOf } from './policy.ts'
import { badgeKey } from './types.ts'
import type { CoachNumber, TemplateParts } from './types.ts'

const crapless = compileConfig(PRESETS.craplessBubble)

function text(parts: TemplateParts): string {
  return parts.map((part) => formatPart(part)).join('')
}

/** The one probability number in a line's parts (the "wins … of decisions" chance). */
function chanceOf(parts: TemplateParts): CoachNumber {
  for (const part of parts) {
    if (typeof part === 'string') continue
    const n = 'style' in part ? part.n : part
    if (n.kind === 'probability') return n
  }
  throw new Error('no probability part')
}

describe('sheetFromRows', () => {
  it('equals catalogTable sorted by edge, on every preset (§10 M9d acceptance)', () => {
    for (const id of PRESET_IDS) {
      const cfg = compileConfig(PRESETS[id])
      const rows = catalogTable(cfg)
      const sorted = byEdge(rows)
      const sheet = sheetFromRows(rows, cfg)
      expect(sheet.rows, id).toHaveLength(sorted.length)
      sorted.forEach((row, index) => {
        const made = sheet.rows[index]
        expect(made?.key, id).toBe(badgeKey(row.spec.typeId, row.spec.number))
        expect(made?.label, id).toBe(row.label)
        expect(made?.amount, id).toBe(row.amount)
        expect(made !== undefined && (made.edge.exact as Fraction).equals(row.edge), id).toBe(true)
        expect(made?.grade, id).toBe(gradeOf(row.edge))
        expect(made?.assumedPaths, id).toEqual(row.assumedPaths)
        expect(made?.edge.source, id).toEqual({
          fn: 'catalogRow',
          args: { spec: row.spec, amount: row.amount },
          configHash: cfg.configHash,
        })
      })
    }
  })

  it('sorts for itself: the sheet from config-ordered rows equals the sheet from sorted rows', () => {
    const rows = catalogTable(crapless)
    const fromRaw = sheetFromRows(rows, crapless).rows.map((row) => row.key)
    const fromSorted = sheetFromRows(byEdge(rows), crapless).rows.map((row) => row.key)
    expect(fromRaw).toEqual(fromSorted)
  })

  it('prices place 6 at its exact unit with the machine pay label and the at-minimum warning', () => {
    const sheet = sheetFromRows(catalogTable(crapless), crapless)
    const row = sheet.rows.find((r) => r.key === 'place|6')
    expect(row).toBeDefined()
    if (row === undefined) throw new Error('no place 6 row')
    expect(row.label).toBe('Place 6')
    expect(row.amount).toBe(300)
    expect(formatCoachNumber(row.edge)).toBe('1.52%')
    expect(row.grade).toBe('good')
    expect(text(row.detail.parts)).toBe(
      'pays 7:6 · at $3.00 · wins 45.5% of decisions · decides in 3.3 rolls',
    )
    expect(text(row.cost.parts)).toBe('per working roll 0.46% · standing ≈ $0.01 a roll')
    expect(row.atMinimum !== null && text(row.atMinimum.parts)).toBe(
      'At the minimum $1.00 this worsens to 1.82%.',
    )
  })

  it('come odds win "of decisions" conditioned on being played (spec §0.1 [M]): 14.3% on the 2, like pass odds', () => {
    const sheet = sheetFromRows(catalogTable(crapless), crapless)
    const comeOdds = sheet.rows.find((r) => r.key === 'comeOdds|2')
    const passOdds = sheet.rows.find((r) => r.key === 'passOdds|2')
    if (comeOdds === undefined || passOdds === undefined) throw new Error('missing odds rows')
    // The raw row's pWin (97430423/755108291 ≈ 12.9%) counts the ~9.7% returned-unplayed mass.
    const raw = catalogTable(crapless).find(
      (row) => row.spec.typeId === 'comeOdds' && row.spec.number === 2,
    )
    if (raw === undefined) throw new Error('no raw come odds 2 row')
    expect(raw.pPush.isZero()).toBe(false)
    expect(raw.pWin.div(raw.pWin.add(raw.pLose)).equals(Fraction.of(1, 7))).toBe(true)
    expect(text(comeOdds.detail.parts)).toContain('wins 14.3% of decisions')
    expect(text(passOdds.detail.parts)).toContain('wins 14.3% of decisions')
    expect(chanceOf(comeOdds.detail.parts).source).toEqual({
      fn: 'catalogRow',
      args: { spec: raw.spec, amount: raw.amount, field: 'pWinDecided' },
      configHash: crapless.configHash,
    })
  })

  it("a don't pass bar-12 push IS a decision: its chance stays the plain pWin (ties counted)", () => {
    const traditional = compileConfig(PRESETS.traditionalBubble)
    const sheet = sheetFromRows(catalogTable(traditional), traditional)
    const dontPass = sheet.rows.find((r) => r.key === 'dontPass|')
    const raw = catalogTable(traditional).find((row) => row.spec.typeId === 'dontPass')
    if (dontPass === undefined || raw === undefined) throw new Error('no dont pass row')
    expect(raw.pPush.equals(Fraction.of(1, 36))).toBe(true)
    expect((chanceOf(dontPass.detail.parts).exact as Fraction).equals(raw.pWin)).toBe(true)
    expect(chanceOf(dontPass.detail.parts).source.args).toEqual({
      spec: raw.spec,
      amount: raw.amount,
    })
  })

  it('gives side-bet rows a note on how the family settles, and none to the main game (M11)', () => {
    const sheet = sheetFromRows(catalogTable(crapless), crapless)
    const low = sheet.rows.find((r) => r.key === 'luckyRollerLow|')
    if (low === undefined) throw new Error('no Low Rolls row')
    expect(low.label).toBe('Low Rolls')
    expect(low.family).toBe('collectSet')
    expect(low.amount).toBe(100)
    expect(formatCoachNumber(low.edge)).toBe('18.30%')
    expect(low.grade).toBe('awful')
    expect(text(low.detail.parts)).toBe(
      'pays 31 for 1 · at $1.00 · wins 2.6% of decisions · decides in 5.8 rolls',
    )
    expect(text(low.cost.parts)).toBe('per working roll 3.13% · standing ≈ $0.03 a roll')
    expect(low.note !== null && text(low.note.parts)).toBe(
      'Side bet: every target total must roll before any seven, repeats and order aside; it locks once the dice roll.',
    )
    expect(sheet.rows.find((r) => r.key === 'place|6')?.note).toBeNull()
    // The side bets sit at the costly end of the sheet, after every main-game bet but the props.
    const keys = sheet.rows.map((r) => r.key)
    expect(keys.indexOf('luckyRollerLow|')).toBeGreaterThan(keys.indexOf('field|'))
    const stw = compileConfig(PRESETS.traditionalBubble)
    const hot = sheetFromRows(catalogTable(stw), stw).rows.find((r) => r.key === 'hotShooter|')
    expect(hot?.note !== null && hot !== undefined && text(hot.note.parts)).toBe(
      'Side bet on the whole hand: paid at the seven-out by how many rolls the hand lasted.',
    )
    expect(formatCoachNumber(hot!.edge)).toBe('9.07%')
  })

  it('says nothing about unmodelled options where the machine sets none, and names them where it does', () => {
    expect(sheetFromRows(catalogTable(crapless), crapless).notModelled).toBeNull()
    const traditional = compileConfig(PRESETS.traditionalBubble)
    const sheet = sheetFromRows(catalogTable(traditional), traditional)
    expect(sheet.notModelled !== null && text(sheet.notModelled.parts)).toContain(
      '/offBets/consumeCredit',
    )
  })
})
