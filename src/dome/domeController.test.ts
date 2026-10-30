import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeRoll } from '../engine/index.ts'
import { DEFAULT_PARAMS, paramsFingerprint } from '../physics/core/params.ts'
import { TUMBLE, createDice2D } from '../ui/dice2d/diceController.ts'
import type { DicePlayRequest } from '../ui/services/rollFlow.ts'
import { handlePhysicsRequest } from '../workers/physicsHandler.ts'
import type { Outgoing } from '../workers/physicsProtocol.ts'
import { createPhysicsClient, type PhysicsTransport } from './physicsClient.ts'
import { createDiceDome, WATCHDOG_FACTOR, WATCHDOG_SLACK_MS } from './domeController.ts'
import { MONITOR, QUALITY_KEY } from './quality.ts'

/**
 * The dome controller as the roll flow drives it: the 2D fallback until a renderer is live, the
 * prefetched plan played through `sample`, the hop when the worker is late, SKIP and an aborted
 * signal snapping to rest, the watchdog and the page hiding revealing anyway, and `showRest`
 * keeping a rest that already shows the engine's dice. The dice are always the request's. M10b
 * adds the handoff count, the quality tier dropping on slow frames, and a lost WebGL context
 * ending the throw at its rest, handing the slot to 2D and coming back on `retry`.
 */

const REQUEST: DicePlayRequest = { dice: makeRoll(4, 2), rollIndex: 0, physicsSeed: 12345 }

/** A transport that never answers a throw: the worker is "late" for good. */
const lateTransport: PhysicsTransport = (request) =>
  request.kind === 'ping'
    ? {
        response: {
          id: request.id,
          ok: true,
          kind: 'ready',
          paramsFingerprint: paramsFingerprint(DEFAULT_PARAMS),
        },
        transfer: [],
      }
    : new Promise<Outgoing>(() => undefined)

function dome(transport: PhysicsTransport = handlePhysicsRequest, takeTimeoutMs = 150) {
  const fallback = createDice2D()
  const client = createPhysicsClient({ transport })
  const renderer = { invalidate: vi.fn() }
  const controller = createDiceDome({
    fallback,
    client,
    takeTimeoutMs,
    probe: () => true,
    documentLike: null,
    quality: { storage: null, device: 'high', monitor: true },
  })
  return { controller, fallback, client, renderer }
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const kept = new Map<string, string>()
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value)
    },
  }
}

/** Drives the frame loop at 60 fps until the throw stops playing; returns the frames drawn. */
function drive(controller: ReturnType<typeof dome>['controller']): number {
  let now = 1000
  for (let frames = 1; frames < 5000; frames++) {
    now += 16
    if (!controller.sample(now).playing) return frames
  }
  throw new Error('the throw never finished')
}

const sortedFaces = (faces: readonly [number, number] | null) =>
  faces === null ? null : [...faces].sort()

describe('the dice dome controller', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is the 2D view until a renderer attaches, and keeps both views in step', async () => {
    vi.useFakeTimers()
    const { controller, fallback } = dome(lateTransport)
    const view = controller.view()
    expect(view.mode).toBe('2d')
    const played = view.play(REQUEST, new AbortController().signal)
    expect(fallback.store.getState().state).toBe('playing')
    await vi.advanceTimersByTimeAsync(TUMBLE.durationMs)
    await played
    expect(fallback.store.getState().faces).toStrictEqual({ d1: 4, d2: 2 })
    view.showRest(REQUEST.dice)
    expect(controller.store.getState()).toMatchObject({ state: 'settled', shown: 'rest' })
    expect(sortedFaces(controller.store.getState().faces)).toStrictEqual([2, 4])
    expect(fallback.store.getState().faces).toStrictEqual({ d1: 4, d2: 2 })
  })

  it('plays the prefetched throw through the frame loop and lands on the engine’s dice', async () => {
    const { controller, renderer, client } = dome()
    controller.prefetch(REQUEST.physicsSeed)
    await vi.waitFor(() => expect(controller.store.getState().ready).toBe(true), {
      timeout: 20_000,
    })
    expect(client.has(REQUEST.physicsSeed, controller.rest)).toBe(true)
    const detach = controller.attach(renderer)
    expect(controller.store.getState().live).toBe(true)
    const view = controller.view()
    expect(view.mode).toBe('3d')

    const before = controller.rest
    const played = view.play(REQUEST, new AbortController().signal)
    await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
    expect(controller.store.getState().shown).toBe('plan')
    expect(controller.store.getState().ready).toBe(false)
    const frames = drive(controller)
    await played
    expect(frames).toBeGreaterThan(10)
    expect(controller.store.getState().state).toBe('settled')
    expect(sortedFaces(controller.store.getState().faces)).toStrictEqual([2, 4])
    expect(controller.rest).not.toBe(before)
    expect(renderer.invalidate).toHaveBeenCalled()
    // At rest the frame loop draws the rest and asks for no more frames.
    expect(controller.sample(99_999).playing).toBe(false)
    detach()
    expect(controller.view().mode).toBe('2d')
  }, 30_000)

  it('plays the hop when no throw is ready within the timeout', async () => {
    const { controller, renderer } = dome(lateTransport, 10)
    controller.attach(renderer)
    const view = controller.view('fast')
    const played = view.play(REQUEST, new AbortController().signal)
    await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
    expect(controller.store.getState().shown).toBe('hop')
    drive(controller)
    await played
    expect(controller.store.getState()).toMatchObject({ state: 'settled', shown: 'hop' })
    expect(sortedFaces(controller.store.getState().faces)).toStrictEqual([2, 4])
  })

  it('SKIP jumps to the rest at once, showing the engine’s dice', async () => {
    const { controller, renderer } = dome(lateTransport, 10)
    controller.attach(renderer)
    const abort = new AbortController()
    const played = controller.view().play(REQUEST, abort.signal)
    await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
    controller.sample(1000)
    controller.sample(1016)
    abort.abort()
    await played
    expect(controller.store.getState().state).toBe('settled')
    expect(sortedFaces(controller.store.getState().faces)).toStrictEqual([2, 4])
    expect(controller.sample(2000).playing).toBe(false)
  })

  it('snaps to rest on an already-aborted signal without playing', async () => {
    const { controller, renderer } = dome(lateTransport, 10)
    controller.attach(renderer)
    const abort = new AbortController()
    abort.abort()
    await controller.view().play(REQUEST, abort.signal)
    expect(controller.store.getState()).toMatchObject({ state: 'settled', shown: 'rest' })
    expect(sortedFaces(controller.store.getState().faces)).toStrictEqual([2, 4])
  })

  it('rejects when the renderer goes away while waiting for the throw, so showRest reveals', async () => {
    const { controller, renderer } = dome(lateTransport, 50)
    const detach = controller.attach(renderer)
    const view = controller.view()
    const played = view.play(REQUEST, new AbortController().signal)
    detach()
    await expect(played).rejects.toThrow('not attached')
    view.showRest(REQUEST.dice)
    expect(sortedFaces(controller.store.getState().faces)).toStrictEqual([2, 4])
  })

  it('the watchdog reveals when frames stop coming', async () => {
    vi.useFakeTimers()
    const { controller, renderer } = dome(lateTransport, 10)
    controller.attach(renderer)
    const played = controller.view().play(REQUEST, new AbortController().signal)
    const settled = vi.fn()
    void played.then(settled)
    // The take gives up after its 10 ms and the hop starts; no frame is ever drawn.
    await vi.advanceTimersByTimeAsync(20)
    expect(controller.store.getState().state).toBe('playing')
    // Within the slack nothing fires; the hop plays in under 5 s even stretched by the factor.
    await vi.advanceTimersByTimeAsync(WATCHDOG_SLACK_MS - 1)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000 * WATCHDOG_FACTOR)
    expect(settled).toHaveBeenCalled()
    expect(controller.store.getState().state).toBe('settled')
    expect(sortedFaces(controller.store.getState().faces)).toStrictEqual([2, 4])
  })

  it('the page hiding mid-throw reveals at once', async () => {
    const listeners = new Set<() => void>()
    const documentLike = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as () => void)
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as () => void)
      },
    }
    const fallback = createDice2D()
    const controller = createDiceDome({
      fallback,
      client: createPhysicsClient({ transport: lateTransport }),
      takeTimeoutMs: 10,
      probe: () => true,
      documentLike,
      quality: { storage: null, device: 'high', monitor: true },
    })
    controller.attach({ invalidate: () => undefined })
    const played = controller.view().play(REQUEST, new AbortController().signal)
    await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
    expect(listeners.size).toBe(1)
    documentLike.visibilityState = 'hidden'
    for (const listener of listeners) listener()
    await played
    expect(controller.store.getState().state).toBe('settled')
    expect(listeners.size).toBe(0)
  })

  it('showRest keeps a rest that already shows the dice and synthesises one otherwise', async () => {
    const { controller, renderer } = dome(lateTransport, 10)
    controller.attach(renderer)
    const view = controller.view()
    const played = view.play(REQUEST, new AbortController().signal)
    await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
    drive(controller)
    await played
    const landed = controller.rest
    view.showRest(makeRoll(2, 4))
    expect(controller.rest).toBe(landed)
    expect(controller.store.getState().shown).toBe('hop')
    view.showRest(makeRoll(1, 1))
    expect(controller.rest).not.toBe(landed)
    expect(controller.store.getState()).toMatchObject({ state: 'settled', shown: 'rest' })
    expect(controller.store.getState().faces).toStrictEqual([1, 1])
  })

  it('prefetch tracks readiness for the next seed from the current rest', async () => {
    const { controller, client } = dome()
    expect(controller.store.getState().ready).toBe(false)
    controller.prefetch(777)
    await vi.waitFor(() => expect(controller.store.getState().ready).toBe(true), {
      timeout: 20_000,
    })
    expect(client.has(777, controller.rest)).toBe(true)
    // A new rest (a snap elsewhere) makes the held throw stale, so it is asked for again from
    // the new rest without waiting for the roll.
    controller.view().showRest(makeRoll(6, 6))
    expect(controller.store.getState().ready).toBe(false)
    await vi.waitFor(() => expect(controller.store.getState().ready).toBe(true), {
      timeout: 20_000,
    })
    expect(client.has(777, controller.rest)).toBe(true)
    controller.prefetch(null)
    expect(controller.store.getState().ready).toBe(false)
  }, 30_000)

  it('takes what the renderer read off the meshes as the shown faces, once settled', () => {
    const { controller } = dome(lateTransport)
    controller.view().showRest(makeRoll(5, 1))
    expect(controller.store.getState().faces).toStrictEqual([5, 1])
    controller.reportFaces([1, 5])
    expect(controller.store.getState().faces).toStrictEqual([1, 5])
  })

  it('counts the dice whose face change blends over a handoff window', async () => {
    const { controller, renderer } = dome(lateTransport, 10)
    controller.attach(renderer)
    expect(controller.store.getState().handoff).toBe(0)
    // From the idle 3-4 to 4-2 at least one die changes face, and the hop gives every changing
    // die a window (handoff.test.ts), so the count is 1 or 2 — never a snap.
    const played = controller.view().play(REQUEST, new AbortController().signal)
    await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
    expect(controller.store.getState().handoff).toBeGreaterThanOrEqual(1)
    drive(controller)
    await played
    const landed = controller.store.getState().handoff
    expect(landed).toBeGreaterThanOrEqual(1)
    expect(landed).toBeLessThanOrEqual(2)
    // A rest that already shows the dice keeps the count; a fresh rest has nothing to blend.
    controller.view().showRest(makeRoll(2, 4))
    expect(controller.store.getState().handoff).toBe(landed)
    controller.view().showRest(makeRoll(1, 1))
    expect(controller.store.getState().handoff).toBe(0)
  })

  it('drops a quality tier when the median frame while playing runs over 22 ms, and keeps it', async () => {
    const storage = memoryStorage()
    const fallback = createDice2D()
    const controller = createDiceDome({
      fallback,
      client: createPhysicsClient({ transport: lateTransport }),
      takeTimeoutMs: 10,
      probe: () => true,
      documentLike: null,
      quality: { storage, device: 'high', monitor: true },
    })
    controller.attach({ invalidate: () => undefined })
    expect(controller.quality.getState().tier).toBe('high')
    // 30 ms frames: one hop is shorter than the 60-frame window, so the verdict spans throws.
    let now = 1000
    let throws = 0
    while (controller.quality.getState().tier === 'high' && throws < 6) {
      const played = controller.view().play(REQUEST, new AbortController().signal)
      await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
      now += 5000
      for (let frames = 0; frames < 500; frames++) {
        now += 30
        if (!controller.sample(now).playing) break
      }
      await played
      throws++
    }
    expect(throws).toBeLessThanOrEqual(3)
    expect(controller.quality.getState()).toMatchObject({ tier: 'medium', measured: 'medium' })
    expect(JSON.parse(storage.getItem(QUALITY_KEY) ?? '')).toStrictEqual({
      override: 'auto',
      measured: 'medium',
    })
    expect(MONITOR.thresholdMs).toBe(22)
  })

  it('leaves the tier alone at 60 fps, and when the monitor is off', async () => {
    const { controller, renderer } = dome(lateTransport, 10)
    controller.attach(renderer)
    for (let k = 0; k < 3; k++) {
      const played = controller.view().play(REQUEST, new AbortController().signal)
      await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
      drive(controller)
      await played
    }
    expect(controller.quality.getState().tier).toBe('high')
    const fallback = createDice2D()
    const unmonitored = createDiceDome({
      fallback,
      client: createPhysicsClient({ transport: lateTransport }),
      takeTimeoutMs: 10,
      probe: () => true,
      documentLike: null,
      quality: { storage: null, device: 'high', monitor: false },
    })
    unmonitored.attach({ invalidate: () => undefined })
    let now = 1000
    for (let k = 0; k < 4; k++) {
      const played = unmonitored.view().play(REQUEST, new AbortController().signal)
      await vi.waitFor(() => expect(unmonitored.store.getState().state).toBe('playing'))
      for (let frames = 0; frames < 500; frames++) {
        now += 40
        if (!unmonitored.sample(now).playing) break
      }
      await played
    }
    expect(unmonitored.quality.getState().tier).toBe('high')
  })

  it('a lost context mid-throw ends it at rest, plays on in 2D, and retry brings 3D back', async () => {
    const probe = vi.fn(() => true)
    const fallback = createDice2D()
    const controller = createDiceDome({
      fallback,
      client: createPhysicsClient({ transport: lateTransport }),
      takeTimeoutMs: 10,
      probe,
      documentLike: null,
      quality: { storage: null, device: 'high', monitor: true },
    })
    const renderer = { invalidate: vi.fn() }
    // Before the probe says ok there is no context to lose.
    controller.contextLost()
    expect(controller.store.getState().webgl).toBe('unknown')
    expect(controller.probe()).toBe('ok')
    const detach = controller.attach(renderer)
    const played = controller.view().play(REQUEST, new AbortController().signal)
    await vi.waitFor(() => expect(controller.store.getState().state).toBe('playing'))
    controller.sample(1000)
    controller.sample(1016)
    controller.contextLost()
    await played
    expect(controller.store.getState()).toMatchObject({
      state: 'settled',
      webgl: 'lost',
      live: false,
    })
    expect(sortedFaces(controller.store.getState().faces)).toStrictEqual([2, 4])
    expect(controller.view().mode).toBe('2d')
    // The renderer's own detach, when the dome unmounts, changes nothing more.
    detach()
    expect(controller.store.getState().webgl).toBe('lost')
    // Play goes on in 2D: the fallback view takes the next roll.
    const aborted = new AbortController()
    aborted.abort()
    await controller.view().play({ ...REQUEST, dice: makeRoll(6, 1) }, aborted.signal)
    expect(fallback.store.getState().faces).toStrictEqual({ d1: 6, d2: 1 })
    // Retry probes again; with WebGL back the renderer attaches and the view is 3D again.
    controller.retry()
    expect(probe).toHaveBeenCalledTimes(2)
    expect(controller.store.getState().webgl).toBe('ok')
    controller.attach(renderer)
    expect(controller.view().mode).toBe('3d')
    expect(controller.store.getState().live).toBe(true)
    // Retry is only for a lost context.
    controller.retry()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('a retry whose probe fails goes to 2D for good', () => {
    const probe = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    const controller = createDiceDome({
      fallback: createDice2D(),
      client: createPhysicsClient({ transport: lateTransport }),
      probe,
      documentLike: null,
      quality: { storage: null, device: 'high', monitor: true },
    })
    controller.probe()
    controller.attach({ invalidate: () => undefined })
    controller.contextLost()
    expect(controller.store.getState().webgl).toBe('lost')
    controller.retry()
    expect(controller.store.getState().webgl).toBe('unavailable')
    expect(controller.view().mode).toBe('2d')
    controller.retry()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('probes WebGL once, and markUnavailable sends the view back to 2D for good', () => {
    const probe = vi.fn(() => true)
    const fallback = createDice2D()
    const controller = createDiceDome({
      fallback,
      client: createPhysicsClient({ transport: lateTransport }),
      probe,
      documentLike: null,
      quality: { storage: null, device: 'high', monitor: true },
    })
    expect(controller.probe()).toBe('ok')
    expect(controller.probe()).toBe('ok')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(controller.store.getState().webgl).toBe('ok')
    controller.attach({ invalidate: () => undefined })
    expect(controller.view().mode).toBe('3d')
    controller.markUnavailable()
    expect(controller.view().mode).toBe('2d')
    expect(controller.store.getState()).toMatchObject({ webgl: 'unavailable', live: false })
    expect(controller.probe()).toBe('unavailable')
  })
})
