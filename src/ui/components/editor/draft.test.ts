import { describe, expect, it } from 'vitest'
import { PRESETS, compileConfig, validateConfig } from '../../../engine/index.ts'
import type { MachineConfigInput } from '../../../engine/index.ts'
import { editValue, getAt, placeIssues, provenanceAt, setAt } from './draft.ts'

const crapless = PRESETS.craplessBubble

describe('setAt and getAt', () => {
  it('copy the path they change and never touch the frozen original', () => {
    const changed = setAt(crapless, ['catalog', 'place', 'pays', '6'], '7:5')
    expect(getAt(changed, ['catalog', 'place', 'pays', '6'])).toBe('7:5')
    expect(getAt(crapless, ['catalog', 'place', 'pays', '6'])).toBe('7:6')
    expect(changed.catalog['pass']).toBe(crapless.catalog['pass']) // untouched branches shared
    expect(Object.isFrozen(crapless)).toBe(true)
  })

  it('remove a key or a list item with undefined', () => {
    const withoutTwo = setAt(crapless, ['catalog', 'place', 'pays', '2'], undefined)
    expect(getAt(withoutTwo, ['catalog', 'place', 'pays'])).not.toHaveProperty('2')
    const chips = setAt(crapless, ['chips', 0], undefined)
    expect(chips.chips).toEqual(crapless.chips.slice(1))
    expect(getAt(crapless, ['nope', 3])).toBeUndefined()
  })
})

describe('editValue keeps provenance honest', () => {
  it('records a value the player sets as theirs (USER), and gives the base its own back', () => {
    const path = ['catalog', 'field', 'pays', '12']
    const edited = editValue(crapless, crapless, path, '3:1')
    expect(edited.provenance['/catalog/field/pays/12']).toEqual({
      status: 'reported',
      source: 'USER',
      note: 'Set in the machine editor to match your machine.',
    })
    expect(provenanceAt(edited, '/catalog/field/pays/12')).toMatchObject({
      status: 'reported',
      mine: true,
    })
    // Set back to the machine's own value: the research governs it again.
    const reverted = editValue(edited, crapless, path, '2:1')
    expect(reverted.provenance).toEqual(crapless.provenance)
    expect(provenanceAt(reverted, '/catalog/field/pays/12').mine).toBe(false)
  })

  it('restores an entry the base kept at that very pointer', () => {
    const path = ['limits', 'minTotal', 'amount']
    expect(crapless.provenance['/limits/minTotal/amount']).toBeDefined()
    const edited = editValue(crapless, crapless, path, 1_000)
    expect(edited.provenance['/limits/minTotal/amount']?.source).toBe('USER')
    const reverted = editValue(edited, crapless, path, 500)
    expect(reverted.provenance['/limits/minTotal/amount']).toEqual(
      crapless.provenance['/limits/minTotal/amount'],
    )
  })

  it('prunes entries a removal leaves pointing at nothing, so the draft stays valid', () => {
    const withoutRoller = editValue(crapless, crapless, ['sideBets', 'luckyRollerAll'], undefined)
    expect(
      Object.keys(withoutRoller.provenance).some((p) => p.startsWith('/sideBets/luckyRollerAll')),
    ).toBe(false)
    expect(validateConfig(withoutRoller)).toEqual([])
    expect(() => compileConfig(withoutRoller)).not.toThrow()
  })

  it('works on a frozen, compiled config without changing it', () => {
    const draft = structuredClone(crapless) as MachineConfigInput
    compileConfig(draft) // freezes it
    const edited = editValue(draft, crapless, ['name'], 'Mine')
    expect(edited.name).toBe('Mine')
    expect(draft.name).toBe(crapless.name)
  })
})

describe('placeIssues', () => {
  it('shows each issue at the deepest shown pointer at or above its own', () => {
    const shown = new Set(['/catalog/place/pays', '/catalog/place/pays/6', '/limits'])
    const placed = placeIssues(
      ['/catalog/place/pays/6', '/catalog/place/pays/2', '/limits/perType/x/min', '/nowhere'],
      (pointer) => pointer,
      shown,
    )
    expect(placed.get('/catalog/place/pays/6')).toEqual(['/catalog/place/pays/6'])
    expect(placed.get('/catalog/place/pays')).toEqual(['/catalog/place/pays/2'])
    expect(placed.get('/limits')).toEqual(['/limits/perType/x/min'])
    expect(placed.get('')).toEqual(['/nowhere'])
  })
})
