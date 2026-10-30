import { describe, expect, it } from 'vitest'
import { COMPILED_PRESETS } from '../state/machineStore.ts'
import { layoutSpec, numberName, vigBadge } from './layoutSpec.ts'

const crapless = layoutSpec(COMPILED_PRESETS.craplessBubble)
const traditional = layoutSpec(COMPILED_PRESETS.traditionalBubble)

describe('layoutSpec on the crapless machine', () => {
  it('builds one column per ruleset point, in config order', () => {
    expect(crapless.numbers.map((column) => column.number)).toStrictEqual([
      2, 3, 4, 5, 6, 8, 9, 10, 11, 12,
    ])
  })

  it('spells SIX and NINE as on the felt', () => {
    const names = new Map(crapless.numbers.map((column) => [column.number, column.name]))
    expect(names.get(6)).toBe('SIX')
    expect(names.get(9)).toBe('NINE')
    expect(names.get(10)).toBe('10')
    expect(numberName(2)).toBe('2')
  })

  it('shows the machine payout wording on each place cell', () => {
    const place = (n: number) =>
      crapless.numbers
        .find((column) => column.number === n)
        ?.cells.find((cell) => cell.kind === 'place')
    expect(place(2)?.payLabel).toBe('11:2')
    expect(place(3)?.payLabel).toBe('11:4')
    expect(place(6)?.payLabel).toBe('7:6')
    expect(place(10)?.payLabel).toBe('9:5')
  })

  it('offers a buy strip on every point, badged from the commission config', () => {
    for (const column of crapless.numbers) {
      const buy = column.cells.find((cell) => cell.kind === 'buy')
      expect(buy, `buy on ${column.number}`).toBeDefined()
      expect(buy?.badge).toBe('5% now') // upfront vig at 1:20
    }
    const buyFour = crapless.numbers
      .find((column) => column.number === 4)
      ?.cells.find((cell) => cell.kind === 'buy')
    expect(buyFour?.payLabel).toBe('2:1') // true odds, as the machine writes them
  })

  it('has no lay strips and no don’t bar on a crapless machine', () => {
    expect(crapless.hasDont).toBe(false)
    const kinds = crapless.numbers.flatMap((column) => column.cells.map((cell) => cell.kind))
    expect(kinds).not.toContain('lay')
    expect(crapless.lines.map((zone) => zone.typeId)).toStrictEqual(['pass', 'passOdds'])
  })

  it('gives each column a come strip for the travelling line', () => {
    const six = crapless.numbers.find((column) => column.number === 6)
    const strip = six?.cells.find((cell) => cell.kind === 'comeSpot')
    expect(strip?.typeId).toBe('come')
    expect(strip?.oddsTypeId).toBe('comeOdds')
  })

  it('badges the odds bar with the cap from the config', () => {
    const odds = crapless.lines.find((zone) => zone.kind === 'odds')
    expect(odds?.typeId).toBe('passOdds')
    expect(odds?.badge).toBe('2x odds')
  })

  it('words the field bar from its pay table', () => {
    const field = crapless.center.find((zone) => zone.kind === 'field')
    expect(field?.label).toBe('Field')
    expect(field?.payLabel).toBe('1:1')
    expect(field?.badge).toBe('2 and 12 pay 2:1')
    expect(field?.detail).toBe('2 3 4 9 10 11 12')
  })

  it('puts composites on the props panel as single buttons', () => {
    const ids = crapless.props.map((zone) => zone.typeId)
    expect(ids).toContain('ce')
    expect(ids).toContain('horn')
    const horn = crapless.props.find((zone) => zone.typeId === 'horn')
    expect(horn?.kind).toBe('composite')
    expect(horn?.modelled).toBe(true)
  })

  it('shows prop pays as the machine writes them', () => {
    const any7 = crapless.props.find((zone) => zone.typeId === 'any7')
    expect(any7?.payLabel).toBe('5 for 1')
    const yo = crapless.props.find((zone) => zone.typeId === 'yo')
    expect(yo?.payLabel).toBe('16 for 1')
  })

  it('lists hardways with their own pays', () => {
    expect(crapless.hardways.map((zone) => zone.number)).toStrictEqual([4, 6, 8, 10])
    expect(crapless.hardways.find((zone) => zone.number === 6)?.payLabel).toBe('9:1')
    expect(crapless.hardways.find((zone) => zone.number === 10)?.payLabel).toBe('7:1')
  })

  it('offers the side bets as live zones with their track and the machine pays (M11)', () => {
    expect(crapless.sideBets.map((zone) => zone.typeId)).toStrictEqual([
      'luckyRollerLow',
      'luckyRollerHigh',
      'luckyRollerAll',
    ])
    for (const zone of crapless.sideBets) {
      expect(zone.modelled).toBe(true)
      expect(zone.kind).toBe('sideBet')
      expect(zone.detail).toBe('any 7 loses')
    }
    // The machine's pays as written (IB screen: 30/30/155 to 1, shown "for 1").
    expect(crapless.sideBets.map((zone) => zone.payLabel)).toStrictEqual([
      '31 for 1',
      '31 for 1',
      '156 for 1',
    ])
    expect(crapless.sideBets[0]?.label).toBe('Low Rolls')
    expect(crapless.sideBets[0]?.track).toStrictEqual([2, 3, 4, 5, 6])
    expect(crapless.sideBets[1]?.track).toStrictEqual([8, 9, 10, 11, 12])
    expect(crapless.sideBets[2]?.track).toStrictEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12])
  })

  it('words the other families from their configs: qualifier badge, top pay, track', () => {
    const hot = traditional.sideBets.find((zone) => zone.typeId === 'hotShooter')
    expect(hot?.track).toBeNull()
    expect(hot?.payLabel).toBeNull()
    expect(hot?.badge).toBe('needs $3 in play')
    expect(hot?.detail).toBe('up to 100 for 1')
    const fire = layoutSpec(COMPILED_PRESETS.traditionalLive345).sideBets[0]
    expect(fire?.label).toBe('Fire Bet')
    expect(fire?.track).toStrictEqual([4, 5, 6, 8, 9, 10])
    expect(fire?.detail).toBe('up to 999 to 1')
    const shooter = layoutSpec(COMPILED_PRESETS.strictBubble).sideBets.find(
      (zone) => zone.typeId === 'luckyShooter',
    )
    expect(shooter?.track).toStrictEqual([4, 5, 6, 8, 9, 10])
    expect(shooter?.detail).toBe('up to 500 for 1')
    // Every zone that is not a side bet has no track.
    for (const zone of [...crapless.lines, ...crapless.center, ...crapless.props]) {
      expect(zone.track).toBeNull()
    }
  })

  it('covers every catalog type with a zone', () => {
    const covered = new Set<string>()
    const all = [
      ...crapless.lines,
      ...crapless.center,
      ...crapless.hardways,
      ...crapless.props,
      ...crapless.numbers.flatMap((column) => column.cells),
    ]
    for (const zone of all) {
      covered.add(zone.typeId)
      if (zone.oddsTypeId !== null) covered.add(zone.oddsTypeId)
    }
    for (const typeId of COMPILED_PRESETS.craplessBubble.catalog.keys()) {
      expect(covered, `zone for ${typeId}`).toContain(typeId)
    }
  })

  it('gives every zone a unique key and a zone target', () => {
    const all = [
      ...crapless.lines,
      ...crapless.center,
      ...crapless.hardways,
      ...crapless.props,
      ...crapless.sideBets,
      ...crapless.numbers.flatMap((column) => column.cells),
    ]
    const keys = all.map((zone) => zone.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const zone of all) expect(zone.target).toBe(`zone:${zone.typeId}`)
  })

  it('memoizes per config', () => {
    expect(layoutSpec(COMPILED_PRESETS.craplessBubble)).toBe(crapless)
  })
})

describe('layoutSpec on the traditional machine', () => {
  it('adds the don’t bar and its odds to the lines', () => {
    expect(traditional.hasDont).toBe(true)
    const ids = traditional.lines.map((zone) => zone.typeId)
    expect(ids).toContain('dontPass')
    expect(ids).toContain('dontPassOdds')
  })

  it('adds a lay strip per box number, badged from the on-win commission', () => {
    const four = traditional.numbers.find((column) => column.number === 4)
    const lay = four?.cells.find((cell) => cell.kind === 'lay')
    expect(lay).toBeDefined()
    expect(lay?.badge).toBe('5% on win')
  })

  it('keeps columns to the traditional box numbers', () => {
    expect(traditional.numbers.map((column) => column.number)).toStrictEqual([4, 5, 6, 8, 9, 10])
  })

  it('puts big 6/8 in the center with their own wording', () => {
    const bigs = traditional.center.filter((zone) => zone.kind === 'big')
    expect(bigs.map((zone) => zone.number)).toStrictEqual([6, 8])
    expect(bigs[0]?.payLabel).toBe('1 to 1')
  })

  it('words a field that pays triple on 12 from the config', () => {
    const field = traditional.center.find((zone) => zone.kind === 'field')
    expect(field?.badge).toContain('2')
    expect(field?.badge).toContain('12')
  })
})

describe('vigBadge', () => {
  it('trims whole percents and keeps fractional ones', () => {
    const buy = COMPILED_PRESETS.craplessBubble.catalog.get('buy')
    if (buy?.family !== 'numberVsSeven' || buy.commission === null) throw new Error('buy expected')
    const rule = buy.commission.get(4)
    if (rule === undefined) throw new Error('commission on 4 expected')
    expect(vigBadge(rule)).toBe('5% now')
  })
})
