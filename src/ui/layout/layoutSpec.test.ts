import { describe, expect, it } from 'vitest'
import { COMPILED_PRESETS } from '../state/machineStore.ts'
import { feltPay, layoutSpec, numberName, vigBadge } from './layoutSpec.ts'

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

describe('the station’s grouping and pay notation (plan §0 #28)', () => {
  const all = (spec: typeof crapless) => [
    ...spec.lines,
    ...spec.center,
    ...spec.hardways,
    ...spec.props,
    ...spec.sideBets,
    ...spec.numbers.flatMap((column) => column.cells),
  ]
  const place = (spec: typeof crapless, n: number) =>
    spec.numbers.find((column) => column.number === n)?.cells.find((cell) => cell.kind === 'place')

  it('prints pays in the crapless station’s "for" notation, computed from the ratios', () => {
    expect(COMPILED_PRESETS.craplessBubble.payLabelStyle).toBe('for')
    // The photo: "PLACE 12 FOR 5" under NINE; 7:6 adds the stake back to "13 for 6".
    expect(place(crapless, 9)?.payText).toBe('12 for 5')
    expect(place(crapless, 6)?.payText).toBe('13 for 6')
    expect(place(crapless, 2)?.payText).toBe('13 for 2')
    expect(place(crapless, 3)?.payText).toBe('15 for 4')
    expect(crapless.hardways.find((zone) => zone.number === 6)?.payText).toBe('10 for 1')
    expect(crapless.sideBets.map((zone) => zone.payText)).toStrictEqual([
      '31 for 1',
      '31 for 1',
      '156 for 1',
    ])
    // The spoken wording stays as written, for the zones' names.
    expect(place(crapless, 9)?.payLabel).toBe('7:5')
  })

  it('keeps each machine’s own wording under asWritten, and the net ratio under to', () => {
    expect(COMPILED_PRESETS.traditionalBubble.payLabelStyle).toBe('asWritten')
    expect(place(traditional, 6)?.payText).toBe(place(traditional, 6)?.payLabel)
    const any7 = COMPILED_PRESETS.craplessBubble.catalog.get('any7')
    const six = COMPILED_PRESETS.craplessBubble.catalog.get('place')
    if (any7?.family !== 'oneRoll' || six?.family !== 'numberVsSeven') throw new Error('types')
    const five = any7.pays.get('7')
    const seven = six.pays.get(6)
    if (five === undefined || seven === undefined) throw new Error('pays')
    expect(feltPay(five, 'to')).toBe('4 to 1')
    expect(feltPay(five, 'for')).toBe('5 for 1')
    expect(feltPay(five, 'asWritten')).toBe('5 for 1')
    expect(feltPay(seven, 'to')).toBe('7 to 6')
  })

  it('draws C, C&E and E as circles: the two-part composite between its parts', () => {
    expect(crapless.circles?.map((zone) => zone.typeId)).toStrictEqual(['c', 'ce', 'e'])
    expect(traditional.circles?.map((zone) => zone.typeId)).toStrictEqual(['c', 'ce', 'e'])
    // The circles leave the tabs; the horn composite stays on the HARDWAYS tab.
    const tabbed = crapless.propTabs.flatMap((tab) =>
      tab.sections.flatMap((section) => section.zones.map((zone) => zone.typeId)),
    )
    expect(tabbed).not.toContain('ce')
    expect(tabbed).not.toContain('c')
    expect(tabbed).toContain('horn')
  })

  it('splits the props into HARDWAYS and HOP BETS, each hop section headed by its shared pay', () => {
    expect(crapless.propTabs.map((tab) => [tab.id, tab.title])).toStrictEqual([
      ['hardways', 'Hardways'],
      ['hops', 'Hop bets'],
    ])
    const [hard, hops] = crapless.propTabs
    expect(hard?.sections.map((section) => section.id)).toStrictEqual(['hardways', 'props'])
    expect(hard?.sections[0]?.zones.map((zone) => zone.number)).toStrictEqual([4, 6, 8, 10])
    // The photo: "31 FOR 1 • HOPPING HARD WAYS" over 2-2 to 5-5, "16 FOR 1 • HOP BETS" over 13.
    expect(hops?.sections.map((s) => [s.id, s.title, s.pay, s.zones.length])).toStrictEqual([
      ['hopsHard', 'Hopping hard ways', '31 for 1', 4],
      ['hopsEasy', 'Hop bets', '16 for 1', 13],
    ])
    expect(hops?.sections[0]?.zones.map((zone) => zone.dice)).toStrictEqual([
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ])
    // A live table books all 21 hops, 1-1 and 6-6 among the hard ones.
    const live = layoutSpec(COMPILED_PRESETS.traditionalLive345).propTabs.find(
      (t) => t.id === 'hops',
    )
    expect(live?.sections.map((section) => section.zones.length)).toStrictEqual([6, 15])
    // The station's hop columns: under 7, the 7s, over 7 (the photo: 2-2 and 3-3 beside 4-4 and
    // 5-5; 1-3 down to the 6s, then 1-6, 2-5 and 3-4, then 2-6 down to 4-6). Grids elsewhere.
    const pairs = (zones: readonly { readonly dice: readonly number[] | null }[] | undefined) =>
      zones?.map((zone) => zone.dice?.join('-'))
    expect(hops?.sections[0]?.columns?.map(pairs)).toStrictEqual([
      ['2-2', '3-3'],
      ['4-4', '5-5'],
    ])
    expect(hops?.sections[1]?.columns?.map(pairs)).toStrictEqual([
      ['1-3', '1-4', '2-3', '1-5', '2-4'],
      ['1-6', '2-5', '3-4'],
      ['2-6', '3-5', '3-6', '4-5', '4-6'],
    ])
    expect(hard?.sections.map((section) => section.columns)).toStrictEqual([null, null])
    for (const section of [...(hops?.sections ?? []), ...(live?.sections ?? [])]) {
      expect(
        section.columns
          ?.flat()
          .map((zone) => zone.key)
          .sort(),
      ).toStrictEqual(section.zones.map((zone) => zone.key).sort())
    }
    expect(live?.sections[0]?.columns?.map(pairs)).toStrictEqual([
      ['1-1', '2-2', '3-3'],
      ['4-4', '5-5', '6-6'],
    ])
    // Every zone on a tab or a circle is a prop the layout already lists.
    for (const spec of [crapless, traditional]) {
      const listed = new Set([...spec.hardways, ...spec.props].map((zone) => zone.key))
      const placed = [
        ...(spec.circles ?? []),
        ...spec.propTabs.flatMap((tab) => tab.sections.flatMap((section) => section.zones)),
      ]
      expect(placed.map((zone) => zone.key).sort()).toStrictEqual([...listed].sort())
    }
  })

  it('orders the side-bet box as the station does: ROLL ’EM ALL between LOW and HIGH ROLLS', () => {
    // Config order stays Low, High, All; the box puts the set that covers both in the middle.
    expect(crapless.sideBets.map((zone) => zone.typeId)).toStrictEqual([
      'luckyRollerLow',
      'luckyRollerHigh',
      'luckyRollerAll',
    ])
    expect(crapless.sideBox.map((zone) => zone.typeId)).toStrictEqual([
      'luckyRollerLow',
      'luckyRollerAll',
      'luckyRollerHigh',
    ])
    // Other side bets keep their places (Shoot To Win's Hot Shooter first, then the trio).
    const shootToWin = layoutSpec(COMPILED_PRESETS.traditionalBubble)
    expect(shootToWin.sideBets.map((zone) => zone.typeId)).toStrictEqual([
      'hotShooter',
      'luckyRollerLow',
      'luckyRollerHigh',
      'luckyRollerAll',
    ])
    expect(shootToWin.sideBox.map((zone) => zone.typeId)).toStrictEqual([
      'hotShooter',
      'luckyRollerLow',
      'luckyRollerAll',
      'luckyRollerHigh',
    ])
    expect(
      layoutSpec(COMPILED_PRESETS.strictBubble).sideBox.map((zone) => zone.typeId),
    ).toStrictEqual(['luckyRollerLow', 'luckyRollerAll', 'luckyRollerHigh', 'luckyShooter'])
    // A machine without such a set keeps config order (the live table's Fire Bet alone).
    const live = layoutSpec(COMPILED_PRESETS.traditionalLive345)
    expect(live.sideBox).toStrictEqual(live.sideBets)
  })

  it('lays the bands top to bottom: come box, field (and big 6/8), each line bar with its odds', () => {
    expect(crapless.bands.map((band) => band.map((zone) => zone.typeId))).toStrictEqual([
      ['come'],
      ['field'],
      ['pass', 'passOdds'],
    ])
    // Shoot To Win: both come boxes, big 6 and 8 beside the field, then each line with its odds.
    expect(traditional.bands.map((band) => band.map((zone) => zone.key))).toStrictEqual([
      ['comeBox:come', 'comeBox:dontCome'],
      ['big:big:6', 'big:big:8', 'field:field'],
      ['line:pass', 'odds:passOdds'],
      ['line:dontPass', 'odds:dontPassOdds'],
    ])
    expect(crapless.lines.find((zone) => zone.typeId === 'pass')?.side).toBe('do')
    expect(traditional.lines.find((zone) => zone.typeId === 'dontPass')?.side).toBe('dont')
  })

  it('prints the field’s totals with "pays double" under the ones that pay 2:1', () => {
    const field = crapless.center.find((zone) => zone.kind === 'field')
    expect(field?.totals).toStrictEqual([
      { total: 2, caption: 'pays double' },
      { total: 3, caption: null },
      { total: 4, caption: null },
      { total: 9, caption: null },
      { total: 10, caption: null },
      { total: 11, caption: null },
      { total: 12, caption: 'pays double' },
    ])
    const live = layoutSpec(COMPILED_PRESETS.traditionalLive345).center.find(
      (zone) => zone.kind === 'field',
    )
    expect(live?.totals?.find((t) => t.total === 12)?.caption).toBe('pays triple')
    // No other zone carries totals or dice.
    for (const zone of all(crapless)) {
      if (zone.kind !== 'field') expect(zone.totals).toBeNull()
      if (zone.kind !== 'prop') expect(zone.dice).toBeNull()
    }
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
