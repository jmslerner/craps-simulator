import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS, compileConfig, validateConfig } from '../../../engine/index.ts'
import { sanityCheck } from '../../../exact/index.ts'
import { MATCH_NOTE, answersOf, applyAnswers, nearestPreset, sideBetLibrary } from './quickSetup.ts'

/** The pointers whose provenance is the player's after the answers. */
function mine(input: ReturnType<typeof applyAnswers>): string[] {
  return Object.entries(input.provenance)
    .filter(([, entry]) => entry.source === 'USER')
    .map(([pointer]) => pointer)
    .sort()
}

describe('how each preset answers the five questions', () => {
  it('reads them from the config', () => {
    expect(answersOf(PRESETS.craplessBubble)).toEqual({
      buyVig: 'upfrontRecollect',
      comeOut: 'on',
      oddsCaps: { '2/12': 2, '3/11': 2 },
      field: 'double',
      sideBets: ['luckyRollerLow', 'luckyRollerHigh', 'luckyRollerAll'],
    })
    expect(answersOf(PRESETS.traditionalBubble)).toMatchObject({
      buyVig: 'onWin',
      comeOut: 'off',
      oddsCaps: { '4/10': 2, '5/9': 2, '6/8': 2 },
      field: 'double',
    })
    expect(answersOf(PRESETS.traditionalLive345)).toEqual({
      buyVig: 'upfrontRecollect',
      comeOut: 'off',
      oddsCaps: { '4/10': 3, '5/9': 4, '6/8': 5 },
      field: 'tripleOn12',
      sideBets: ['fire'],
    })
  })

  it.each(PRESET_IDS)('%s is its own nearest machine, five of five', (id) => {
    const nearest = nearestPreset(PRESETS[id].variant, answersOf(PRESETS[id]), id)
    expect(nearest).toEqual({ id, matched: 5 })
  })

  it('picks the nearest machine by the answers: on-win vig and a Hot Shooter mean Shoot To Win', () => {
    const answers = {
      ...answersOf(PRESETS.strictBubble),
      buyVig: 'onWin' as const,
      comeOut: 'off' as const,
      sideBets: ['hotShooter'],
    }
    expect(nearestPreset('traditional', answers, 'strictBubble')).toEqual({
      id: 'traditionalBubble',
      matched: 4,
    })
  })
})

describe('applying the answers (the quick-setup mapping)', () => {
  it('changes nothing but the name when the answers are the machine’s own', () => {
    for (const id of PRESET_IDS) {
      const applied = applyAnswers(id, answersOf(PRESETS[id]))
      expect({ ...applied, name: PRESETS[id].name }, id).toEqual(PRESETS[id])
    }
  })

  it('1. buy vig: timing, re-collection and refund on the commission and every override', () => {
    const onWin = applyAnswers('craplessBubble', {
      ...answersOf(PRESETS.craplessBubble),
      buyVig: 'onWin',
    })
    const buy = onWin.catalog['buy']
    expect(buy?.family === 'numberVsSeven' && buy.commission).toMatchObject({
      timing: 'onWin',
      rearm: 'none',
      refundOnTakeDown: false,
    })
    expect(mine(onWin)).toEqual(['/catalog/buy/commission/rearm', '/catalog/buy/commission/timing'])
    expect(onWin.provenance['/catalog/buy/commission/timing']).toEqual({
      status: 'reported',
      source: 'USER',
      note: MATCH_NOTE,
    })
    // The live table's 4 and 10 override the commission: the answer reaches them too.
    const once = applyAnswers('traditionalLive345', {
      ...answersOf(PRESETS.traditionalLive345),
      buyVig: 'upfrontOnce',
    })
    const liveBuy = once.catalog['buy']
    if (liveBuy?.family !== 'numberVsSeven') throw new Error('no buy')
    expect(liveBuy.commission).toMatchObject({ timing: 'upfront', rearm: 'none' })
    expect(liveBuy.commissionByNumber?.['4']).toMatchObject({ timing: 'upfront', rearm: 'none' })
    expect(validateConfig(once)).toEqual([])
  })

  it('2. place and buy on the come-out, off Shoot To Win’s switch-off lists when working', () => {
    const on = applyAnswers('traditionalBubble', {
      ...answersOf(PRESETS.traditionalBubble),
      comeOut: 'on',
    })
    for (const typeId of ['place', 'buy']) {
      const type = on.catalog[typeId]
      expect(type?.family === 'numberVsSeven' && type.comeOutDefault, typeId).toBe('on')
    }
    expect(on.comeOut.autoOff?.carried).toEqual(['comeOdds', 'hard', 'big'])
    expect(on.comeOut.autoOff?.newlyPlaced).toEqual(['comeOdds', 'hard', 'big'])
    expect(mine(on)).toEqual([
      '/catalog/buy/comeOutDefault',
      '/catalog/place/comeOutDefault',
      '/comeOut/autoOff/carried',
      '/comeOut/autoOff/newlyPlaced',
    ])
    expect(validateConfig(on)).toEqual([])
  })

  it('3. odds caps on 2/12 and 3/11, on pass and come odds', () => {
    const capped = applyAnswers('craplessBubble', {
      ...answersOf(PRESETS.craplessBubble),
      oddsCaps: { '2/12': 1, '3/11': 3 },
    })
    for (const typeId of ['passOdds', 'comeOdds']) {
      const odds = capped.catalog[typeId]
      if (odds?.family !== 'odds') throw new Error(`no ${typeId}`)
      expect([odds.limit.multiple['2'], odds.limit.multiple['12']]).toEqual([1, 1])
      expect([odds.limit.multiple['3'], odds.limit.multiple['11']]).toEqual([3, 3])
      expect(odds.limit.multiple['6']).toBe(2)
    }
    expect(mine(capped)).toHaveLength(8)
  })

  it('4. field pays on 2 and 12, in the machine’s own wording', () => {
    const crapless = applyAnswers('craplessBubble', {
      ...answersOf(PRESETS.craplessBubble),
      field: 'tripleOn12',
    })
    const field = crapless.catalog['field']
    expect(field?.family === 'oneRoll' && [field.pays['2'], field.pays['12']]).toEqual([
      '2:1',
      '3:1',
    ])
    const live = applyAnswers('traditionalLive345', {
      ...answersOf(PRESETS.traditionalLive345),
      field: 'double',
    })
    const liveField = live.catalog['field']
    expect(liveField?.family === 'oneRoll' && liveField.pays['12']).toBe('2 to 1')
  })

  it('5. side bets: removed whole, or copied whole with their research from the machine that has them', () => {
    const fewer = applyAnswers('craplessBubble', {
      ...answersOf(PRESETS.craplessBubble),
      sideBets: ['luckyRollerLow'],
    })
    expect(Object.keys(fewer.sideBets)).toEqual(['luckyRollerLow'])
    expect(
      Object.keys(fewer.provenance).some((p) => p.startsWith('/sideBets/luckyRollerAll')),
    ).toBe(false)
    const more = applyAnswers('traditionalBubble', {
      ...answersOf(PRESETS.traditionalBubble),
      sideBets: ['hotShooter', 'luckyShooter', 'fire'],
    })
    expect(Object.keys(more.sideBets).sort()).toEqual(['fire', 'hotShooter', 'luckyShooter'])
    expect(more.sideBets['luckyShooter']).toEqual(PRESETS.strictBubble.sideBets['luckyShooter'])
    expect(more.limits.perType?.['fire']).toEqual(
      PRESETS.traditionalLive345.limits.perType?.['fire'],
    )
    expect(more.provenance['/limits/perType/fire']).toEqual(
      PRESETS.traditionalLive345.provenance['/limits/perType/fire'],
    )
    expect(validateConfig(more)).toEqual([])
    expect(sideBetLibrary('crapless').map((bet) => bet.id)).toEqual([
      'luckyRollerLow',
      'luckyRollerHigh',
      'luckyRollerAll',
    ])
  })

  it('makes machines the sanity check passes, every answer changed at once', () => {
    const everything = applyAnswers('craplessBubble', {
      buyVig: 'onWin',
      comeOut: 'off',
      oddsCaps: { '2/12': 1, '3/11': 1 },
      field: 'tripleOn2',
      sideBets: [],
    })
    expect(validateConfig(everything)).toEqual([])
    expect(sanityCheck(compileConfig(everything))).toEqual([])
  }, 30_000)
})
