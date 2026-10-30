import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS } from '../../../engine/index.ts'
import { leafPointers } from '../../../engine/config/provenance.ts'
import {
  editorSections,
  isMoneyPath,
  sectionOf,
  shownPointers,
  type EditorNode,
  type FieldNode,
} from './fields.ts'

/** Every node of the sections, depth first. */
function allNodes(id: (typeof PRESET_IDS)[number]): EditorNode[] {
  const nodes: EditorNode[] = []
  const visit = (node: EditorNode): void => {
    nodes.push(node)
    if (node.type === 'group') node.children.forEach(visit)
  }
  editorSections(PRESETS[id]).forEach((section) => section.nodes.forEach(visit))
  return nodes
}

function field(id: (typeof PRESET_IDS)[number], pointer: string): FieldNode {
  const node = allNodes(id).find((candidate) => candidate.pointer === pointer)
  if (node?.type !== 'field') throw new Error(`no field at ${pointer}`)
  return node
}

/** List-valued fields show their items in one input; their item pointers are covered by it. */
const LIST_ITEM =
  /\/(?:naturals|craps|points|numbers|targets|countedPoints|chips|types|carried|newlyPlaced|buttons|macros)\/\d+$/

describe('the editor covers every value of every preset (M12)', () => {
  it.each(PRESET_IDS)('%s: every leaf has a field, side bets included', (id) => {
    const preset = PRESETS[id]
    const shown = shownPointers(editorSections(preset))
    const { provenance, schemaVersion, id: own, ...values } = preset
    void provenance
    void schemaVersion
    void own
    const missing = leafPointers(values)
      .filter((pointer) => !pointer.endsWith('/family'))
      .filter((pointer) => !shown.has(pointer))
      .filter((pointer) => !(LIST_ITEM.test(pointer) && shown.has(pointer.replace(/\/\d+$/, ''))))
    expect(missing).toEqual([])
  })

  it('shows the side-bet pointers the hand-off names: placement, endsOn, payImmediatelyAt, pay tables', () => {
    const live = shownPointers(editorSections(PRESETS.traditionalLive345))
    for (const pointer of [
      '/sideBets/fire/placement',
      '/sideBets/fire/payImmediatelyAt',
      '/sideBets/fire/payTable',
      '/sideBets/fire/payTable/6',
    ]) {
      expect(live.has(pointer), pointer).toBe(true)
    }
    const crapless = shownPointers(editorSections(PRESETS.craplessBubble))
    expect(crapless.has('/sideBets/luckyRollerAll/endsOn')).toBe(true)
    expect(crapless.has('/sideBets/luckyRollerAll/placement')).toBe(true)
    const stw = shownPointers(editorSections(PRESETS.traditionalBubble))
    expect(stw.has('/sideBets/hotShooter/tiers/0/pays')).toBe(true)
    const strict = shownPointers(editorSections(PRESETS.strictBubble))
    expect(strict.has('/sideBets/luckyShooter/topAward')).toBe(true)
  })
})

describe('widgets follow the schema', () => {
  it('reads cents as dollars, pays as ratios, enums as choices', () => {
    expect(field('craplessBubble', '/limits/min').widget).toEqual({
      kind: 'money',
      nullable: false,
    })
    expect(field('craplessBubble', '/catalog/place/pays/6').widget).toEqual({ kind: 'ratio' })
    expect(field('craplessBubble', '/catalog/buy/commission/timing').widget).toMatchObject({
      kind: 'choice',
      options: [
        { value: 'upfront', label: 'upfront' },
        { value: 'onWin', label: 'onWin' },
      ],
    })
    expect(field('craplessBubble', '/catalog/passOdds/limit/multiple/2').widget).toEqual({
      kind: 'integer',
      nullable: false,
    })
    expect(field('traditionalLive345', '/sideBets/fire/payImmediatelyAt').widget).toEqual({
      kind: 'integer',
      nullable: true,
    })
    expect(field('traditionalLive345', '/rules/dontBar').widget).toMatchObject({
      kind: 'choice',
      options: [{ value: 2 }, { value: 12 }, { value: null, label: 'none' }],
    })
    expect(field('craplessBubble', '/chips').widget).toEqual({
      kind: 'list',
      money: true,
      numeric: true,
    })
  })

  it('keeps a bet’s identity read-only: its variant, kind, side and parent', () => {
    expect(field('craplessBubble', '/variant').widget.kind).toBe('fixed')
    expect(field('craplessBubble', '/catalog/place/kind').widget.kind).toBe('fixed')
    expect(field('craplessBubble', '/catalog/pass/side').widget.kind).toBe('fixed')
    expect(field('craplessBubble', '/catalog/passOdds/parent').widget.kind).toBe('fixed')
  })

  it('shows every point of the variant in a by-number record, empty where unset', () => {
    const nodes = allNodes('traditionalLive345')
    const mins = nodes.find((node) => node.pointer === '/limits/perType/lay/minByNumber')
    expect(mins?.type === 'group' && mins.grid).toBe(true)
    if (mins?.type !== 'group') throw new Error('no grid')
    expect(
      mins.children.map((child) => [child.label, child.type === 'field' && child.value]),
    ).toEqual([
      ['4', 4_000],
      ['5', 3_000],
      ['6', undefined],
      ['8', undefined],
      ['9', 3_000],
      ['10', 4_000],
    ])
    const crapless = allNodes('craplessBubble').find(
      (node) => node.pointer === '/catalog/place/pays',
    )
    expect(crapless?.type === 'group' && crapless.children.map((child) => child.label)).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
      '8',
      '9',
      '10',
      '11',
      '12',
    ])
  })

  it('offers what a group may add: a missing optional value, a list item, limits for a bet', () => {
    const limits = allNodes('craplessBubble').find((node) => node.pointer === '/limits')
    expect(limits?.type === 'group' && limits.add.map((add) => add.label)).toEqual([
      'Add table maximum',
      'Add limits by bet',
    ])
    const tiers = allNodes('traditionalBubble').find(
      (node) => node.pointer === '/sideBets/hotShooter/tiers',
    )
    expect(tiers?.type === 'group' && tiers.add[0]).toMatchObject({
      label: 'Add tier',
      value: { minRolls: 1, pays: 'push' },
    })
    const minTotal = allNodes('traditionalLive345').find(
      (node) => node.pointer === '/limits/minTotal',
    )
    expect(minTotal?.type === 'group' && minTotal.toggle).toMatchObject({ on: false })
  })

  it('names money paths', () => {
    expect(isMoneyPath(['limits', 'perType', 'lay', 'minByNumber', '4'])).toBe(true)
    expect(isMoneyPath(['catalog', 'buy', 'commission', 'minimum'])).toBe(true)
    expect(isMoneyPath(['catalog', 'passOdds', 'limit', 'multiple', '4'])).toBe(false)
    expect(isMoneyPath(['sideBets', 'hotShooter', 'tiers', 0, 'minRolls'])).toBe(false)
  })

  it('finds the section a pointer lives in', () => {
    const sections = editorSections(PRESETS.craplessBubble)
    expect(sectionOf(sections, '/catalog/place/pays/6')?.title).toBe('Place')
    expect(sectionOf(sections, '/limits/min')?.title).toBe('Money and limits')
    expect(sectionOf(sections, '/sideBets/luckyRollerAll/pays')?.title).toContain('Side bet')
  })
})
