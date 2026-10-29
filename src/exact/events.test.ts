import { describe, expect, it } from 'vitest'
import { compileConfig } from '../engine/config/compile.ts'
import { PRESETS, type PresetId } from '../engine/config/presets/index.ts'
import type { BetSpec } from './chain.ts'
import { sameEvents } from './events.ts'

const cfgOf = (id: PresetId) => compileConfig(PRESETS[id])
const same = (id: PresetId, a: BetSpec, b: BetSpec) => sameEvents(a, b, 'typical', cfgOf(id))

describe('sameEvents', () => {
  it('pairs place N and buy N on every machine that has both', () => {
    for (const id of [
      'craplessBubble',
      'traditionalBubble',
      'strictBubble',
      'traditionalLive345',
    ] as const) {
      const cfg = cfgOf(id)
      for (const n of cfg.ruleset.points) {
        expect(
          same(id, { typeId: 'place', number: n }, { typeId: 'buy', number: n }),
          `${id} ${n}`,
        ).toBe(true)
      }
    }
  })

  it('pairs big 6 and place 6 only where both work on the come-out alike', () => {
    const big6: BetSpec = { typeId: 'big', number: 6 }
    const place6: BetSpec = { typeId: 'place', number: 6 }
    // Shoot To Win switches both OFF on the come-out; Interblock leaves both ON.
    expect(same('traditionalBubble', big6, place6)).toBe(true)
    expect(same('strictBubble', big6, place6)).toBe(true)
    // A live table works big 6 on the come-out but not place 6.
    expect(same('traditionalLive345', big6, place6)).toBe(false)
  })

  it('never pairs hard 6 with place 6, nor bets that win on different rolls', () => {
    expect(
      same('craplessBubble', { typeId: 'hard', number: 6 }, { typeId: 'place', number: 6 }),
    ).toBe(false)
    expect(
      same('craplessBubble', { typeId: 'field', number: null }, { typeId: 'any7', number: null }),
    ).toBe(false)
    expect(
      same('craplessBubble', { typeId: 'place', number: 6 }, { typeId: 'place', number: 8 }),
    ).toBe(false)
  })

  it('pairs one-roll bets on the same outcomes, and lays with place-to-lose', () => {
    expect(
      same('craplessBubble', { typeId: 'c', number: null }, { typeId: 'anyCraps', number: null }),
    ).toBe(true)
    expect(
      same('craplessBubble', { typeId: 'e', number: null }, { typeId: 'yo', number: null }),
    ).toBe(true)
    expect(
      same('traditionalBubble', { typeId: 'lay', number: 4 }, { typeId: 'placeToLose', number: 4 }),
    ).toBe(true)
  })

  it('compares line bets and odds only with themselves', () => {
    const pass: BetSpec = { typeId: 'pass', number: null }
    expect(same('craplessBubble', pass, pass)).toBe(true)
    expect(same('craplessBubble', pass, { typeId: 'come', number: null })).toBe(false)
  })
})
