import { afterEach, describe, expect, it, vi } from 'vitest'
import { cents, hashJson } from '../../engine/index.ts'
import { CRAPLESS, dice } from '../test/game.ts'
import { createGameStore } from '../state/gameStore.ts'
import {
  analyzeZone,
  installTestHooks,
  isE2EMode,
  parseDiceScript,
  readTestParams,
  type InstallTarget,
} from './testHooks.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseDiceScript', () => {
  it('parses "1-1,3-3" into dice pairs', () => {
    expect(parseDiceScript('1-1,3-3')).toStrictEqual([dice(1, 1), dice(3, 3)])
  })

  it('tolerates spaces and a trailing comma', () => {
    expect(parseDiceScript('2-5, 6-6,')).toStrictEqual([dice(2, 5), dice(6, 6)])
  })

  it('returns null on junk, never a throw', () => {
    expect(parseDiceScript('')).toBeNull()
    expect(parseDiceScript('7-1')).toBeNull()
    expect(parseDiceScript('1')).toBeNull()
    expect(parseDiceScript('one-two')).toBeNull()
  })
})

describe('readTestParams', () => {
  it('reads ?seed=&preset=&dice=&script=&bankroll= (bankroll in dollars)', () => {
    const params = readTestParams(
      '?seed=e2e-1&preset=strictBubble&dice=instant&script=1-1,3-3&bankroll=600.50',
    )
    expect(params).toStrictEqual({
      seed: 'e2e-1',
      presetId: 'strictBubble',
      diceMode: 'instant',
      script: [dice(1, 1), dice(3, 3)],
      bankroll: 60_050,
    })
  })

  it('nulls junk fields one by one', () => {
    const params = readTestParams('?preset=notAMachine&dice=4d&script=9-9&bankroll=lots&seed=')
    expect(params).toStrictEqual({
      seed: null,
      presetId: null,
      diceMode: null,
      script: null,
      bankroll: null,
    })
  })
})

describe('installTestHooks', () => {
  it('installs nothing outside e2e mode', () => {
    expect(isE2EMode()).toBe(false)
    const target: InstallTarget = {}
    expect(installTestHooks(createGameStore(), target)).toBe(false)
    expect(target.__CRAPS_TEST__).toBeUndefined()
  })

  it('installs getState, sessionHash and queueDice over the store in e2e mode', () => {
    vi.stubEnv('MODE', 'e2e')
    expect(isE2EMode()).toBe(true)
    const store = createGameStore()
    store.getState().startGame(CRAPLESS, 'hooks-seed')
    const target: InstallTarget = {}
    expect(installTestHooks(store, target)).toBe(true)
    const api = target.__CRAPS_TEST__
    expect(api).toBeDefined()
    if (api === undefined) return

    expect(api.getState()).toMatchObject({
      phase: 'betting',
      bankroll: 50_000,
      rollIndex: 0,
      committedRolls: 0,
      machineId: 'craplessBubble',
    })
    expect(api.sessionHash()).toBe(hashJson(store.getState().session!.state))

    // Scripted dice go only through the store's queue, which rollWindow plays.
    expect(api.queueDice('1-1')).toBe(true)
    expect(api.queueDice([[3, 3]])).toBe(true)
    expect(api.queueDice('junk')).toBe(false)
    store.getState().dispatch({ type: 'place', typeId: 'pass', amount: cents(500) })
    const rolled = store.getState().beginRoll()
    expect(rolled.ok && rolled.dice).toStrictEqual(dice(1, 1))
    expect(api.getState().phase).toBe('rolling')
    expect(api.getState().committedRolls).toBe(1)

    // analyze (plan §10 M9a): the badge-equality hook answers from the live session's config.
    expect(api.analyze('place', 6)).toEqual(analyzeZone(CRAPLESS, 'place', 6))
    expect(api.analyze('no-such-zone')).toBeNull()
  })
})

describe('analyzeZone', () => {
  it('recomputes a zone badge through the coach pipeline: place 6 reads "1.52%", graded good', () => {
    const probe = analyzeZone(CRAPLESS, 'place', 6)
    expect(probe?.badge).toBe('1.52%')
    expect(probe?.grade).toBe('good')
    expect(probe !== null && probe !== undefined && probe.amount > 0).toBe(true)
  })

  it('answers null for a spot with no catalog row', () => {
    expect(analyzeZone(CRAPLESS, 'passOdds', null)).toBeNull()
    expect(analyzeZone(CRAPLESS, 'nope', 4)).toBeNull()
  })
})
