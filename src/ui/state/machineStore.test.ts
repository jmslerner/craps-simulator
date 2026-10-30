import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS } from '../../engine/index.ts'
import type { Cents } from '../../engine/index.ts'
import {
  COMPILED_PRESETS,
  createMachineStore,
  gameConfig,
  selectDefaultBankroll,
  selectMachine,
  selectNotModelled,
  selectSelectedId,
} from './machineStore.ts'

describe('compiled presets', () => {
  it('compiles every preset once at module scope and shares the objects', () => {
    for (const id of PRESET_IDS) {
      expect(COMPILED_PRESETS[id].id).toBe(id)
      // The same object on every read: nothing recompiles per render (M5/M6 → M8 hand-off).
      expect(selectMachine({ selectedId: id, select: () => undefined })).toBe(COMPILED_PRESETS[id])
    }
  })

  it('surfaces notModelled for the approximation note (plan §0 #23)', () => {
    // The default Interblock crapless machine is fully modelled; Shoot To Win's OFF-chip credit
    // rule is not (plan §0 #23), so its preset must carry the pointer.
    expect(COMPILED_PRESETS.craplessBubble.notModelled).toStrictEqual([])
    expect(COMPILED_PRESETS.traditionalBubble.notModelled).toStrictEqual(['/offBets/consumeCredit'])
    expect(selectNotModelled({ selectedId: 'traditionalBubble', select: () => undefined })).toEqual(
      ['/offBets/consumeCredit'],
    )
  })
})

describe('machine store', () => {
  it('selects the default machine and switches', () => {
    const store = createMachineStore()
    expect(selectSelectedId(store.getState())).toBe('craplessBubble')
    expect(selectMachine(store.getState())).toBe(COMPILED_PRESETS.craplessBubble)
    expect(selectDefaultBankroll(store.getState())).toBe(50_000)
    store.getState().select('strictBubble')
    expect(selectMachine(store.getState())).toBe(COMPILED_PRESETS.strictBubble)
  })
})

describe('gameConfig', () => {
  it('returns the shared preset when no buy-in is chosen', () => {
    expect(gameConfig('craplessBubble')).toBe(COMPILED_PRESETS.craplessBubble)
    expect(gameConfig('craplessBubble', null)).toBe(COMPILED_PRESETS.craplessBubble)
    expect(gameConfig('craplessBubble', 50_000 as Cents)).toBe(COMPILED_PRESETS.craplessBubble)
  })

  it('compiles a chosen buy-in once, marks it assumed, and leaves the preset untouched', () => {
    const chosen = gameConfig('craplessBubble', 60_000 as Cents)
    expect(chosen.startingBankroll).toBe(60_000)
    expect(chosen.input.provenance['/money/startingBankroll']?.status).toBe('assumed')
    // Cached: the same object comes back for the same (preset, amount).
    expect(gameConfig('craplessBubble', 60_000 as Cents)).toBe(chosen)
    // The preset itself is untouched, and the two compile to different machines.
    expect(PRESETS.craplessBubble.money.startingBankroll).toBe(50_000)
    expect(chosen.configHash).not.toBe(COMPILED_PRESETS.craplessBubble.configHash)
  })
})
