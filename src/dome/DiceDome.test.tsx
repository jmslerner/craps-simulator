import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeRoll } from '../engine/index.ts'
import { DEFAULT_PARAMS, paramsFingerprint } from '../physics/core/params.ts'
import { createDice2D } from '../ui/dice2d/diceController.ts'
import type { Outgoing, PhysicsRequest } from '../workers/physicsProtocol.ts'
import { DiceDome, type DomeComponent } from './DiceDome.tsx'
import { createDiceDome } from './domeController.ts'
import { createPhysicsClient, type PhysicsTransport } from './physicsClient.ts'

/**
 * The dome slot's wrapper under jsdom (no WebGL, no chunk): the 2D dice until the renderer is
 * live, the lazy load only once WebGL is known to work, the plan §7 DOM contract once the chunk
 * is up, and the fall back to 2D for good when the chunk fails to load or to render.
 */

/** Records the worker requests and answers only pings. */
function recordingTransport(): { transport: PhysicsTransport; requests: PhysicsRequest[] } {
  const requests: PhysicsRequest[] = []
  const transport: PhysicsTransport = (request) => {
    requests.push(request)
    if (request.kind === 'ping') {
      return {
        response: {
          id: request.id,
          ok: true,
          kind: 'ready',
          paramsFingerprint: paramsFingerprint(DEFAULT_PARAMS),
        },
        transfer: [],
      }
    }
    return new Promise<Outgoing>(() => undefined)
  }
  return { transport, requests }
}

function controllerWith(webgl: boolean | (() => boolean)) {
  const recorder = recordingTransport()
  const controller = createDiceDome({
    fallback: createDice2D(),
    client: createPhysicsClient({ transport: recorder.transport }),
    probe: typeof webgl === 'function' ? webgl : () => webgl,
    documentLike: null,
    quality: { storage: null, device: 'medium', monitor: true },
  })
  return { controller, requests: recorder.requests }
}

/** A stand-in for the lazy chunk: attaches a renderer, draws a canvas. */
const FakeDome: DomeComponent = ({ controller }) => {
  useEffect(() => controller.attach({ invalidate: () => undefined }), [controller])
  return <canvas data-testid="fake-canvas" />
}

describe('DiceDome', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the 2D dice when WebGL is unavailable, and never fetches the chunk', async () => {
    const { controller, requests } = controllerWith(false)
    const load = vi.fn(async () => ({ default: FakeDome }))
    render(<DiceDome controller={controller} nextSeed={7} load={load} />)
    const view = screen.getByTestId('dice-view')
    expect(view).toHaveAttribute('data-mode', '2d')
    await act(async () => undefined)
    expect(load).not.toHaveBeenCalled()
    expect(controller.store.getState().webgl).toBe('unavailable')
    // No worker work either: there is nothing to play it on.
    expect(requests.filter((request) => request.kind === 'throw')).toHaveLength(0)
    act(() => controller.view().showRest(makeRoll(2, 5)))
    expect(view).toHaveAttribute('data-state', 'settled')
    expect(view).toHaveAttribute('data-dice', '2-5')
  })

  it('loads the chunk once WebGL works and carries the DOM contract when the renderer is live', async () => {
    const { controller, requests } = controllerWith(true)
    const load = vi.fn(async () => ({ default: FakeDome }))
    render(<DiceDome controller={controller} nextSeed={7} load={load} />)
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-mode', '2d')
    await waitFor(() => expect(screen.getByTestId('fake-canvas')).toBeInTheDocument())
    expect(load).toHaveBeenCalledTimes(1)
    const view = screen.getByTestId('dice-view')
    expect(screen.getAllByTestId('dice-view')).toHaveLength(1)
    expect(view).toHaveAttribute('data-mode', '3d')
    expect(view).toHaveAttribute('data-state', 'idle')
    expect(view).toHaveAttribute('data-dice', '')
    expect(view).toHaveAttribute('data-ready', 'false')
    expect(view).toHaveAttribute('data-tier', 'medium')
    expect(view).toHaveAttribute('data-handoff', '0')
    expect(controller.view().mode).toBe('3d')
    act(() => controller.quality.getState().setOverride('low'))
    expect(view).toHaveAttribute('data-tier', 'low')
    // The next throw was asked for as soon as WebGL was known to work.
    const throws = requests.filter((request) => request.kind === 'throw')
    expect(throws).toHaveLength(1)
    expect(throws[0]).toMatchObject({ kind: 'throw', seed: 7 })

    act(() => controller.view().showRest(makeRoll(6, 6)))
    expect(view).toHaveAttribute('data-state', 'settled')
    expect(view).toHaveAttribute('data-dice', '6-6')
    expect(view).toHaveAttribute('data-shown', 'rest')
  })

  it('asks the worker for a new seed when the next roll changes', async () => {
    const { controller, requests } = controllerWith(true)
    const load = vi.fn(async () => ({ default: FakeDome }))
    const { rerender } = render(<DiceDome controller={controller} nextSeed={7} load={load} />)
    await waitFor(() => expect(requests.some((r) => r.kind === 'throw')).toBe(true))
    rerender(<DiceDome controller={controller} nextSeed={8} load={load} />)
    await waitFor(() =>
      expect(requests.filter((r) => r.kind === 'throw').map((r) => r.seed)).toStrictEqual([7, 8]),
    )
  })

  it('shows the 2D dice with a Retry 3D toast after a lost context, and remounts on retry', async () => {
    const probe = vi.fn(() => true)
    const { controller } = controllerWith(probe)
    const load = vi.fn(async () => ({ default: FakeDome }))
    render(<DiceDome controller={controller} nextSeed={3} load={load} />)
    await waitFor(() => expect(screen.getByTestId('fake-canvas')).toBeInTheDocument())
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-mode', '3d')

    act(() => controller.contextLost())
    const view = screen.getByTestId('dice-view')
    expect(view).toHaveAttribute('data-mode', '2d')
    expect(screen.queryByTestId('fake-canvas')).toBeNull()
    expect(screen.getByTestId('dome-toast')).toHaveTextContent('3D paused')
    const retry = screen.getByRole('button', { name: 'Retry 3D' })
    // Play goes on in 2D meanwhile.
    act(() => controller.view().showRest(makeRoll(4, 4)))
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-dice', '4-4')

    fireEvent.click(retry)
    expect(probe).toHaveBeenCalledTimes(2)
    // The chunk is already loaded: no second fetch, the renderer mounts and attaches again.
    await waitFor(() => expect(screen.getByTestId('fake-canvas')).toBeInTheDocument())
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-mode', '3d')
    expect(screen.queryByTestId('dome-toast')).toBeNull()
    expect(controller.view().mode).toBe('3d')
  })

  it('falls back to 2D for good when the chunk throws while rendering', async () => {
    const { controller } = controllerWith(true)
    const Broken: DomeComponent = () => {
      throw new Error('THREE.WebGLRenderer: Error creating WebGL context.')
    }
    const load = vi.fn(async () => ({ default: Broken }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<DiceDome controller={controller} nextSeed={null} load={load} />)
    await waitFor(() => expect(controller.store.getState().webgl).toBe('unavailable'))
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-mode', '2d')
    expect(controller.view().mode).toBe('2d')
    expect(screen.queryByTestId('fake-canvas')).toBeNull()
  })

  it('falls back to 2D when the chunk cannot be fetched', async () => {
    const { controller } = controllerWith(true)
    const load = vi.fn(async (): Promise<{ default: DomeComponent }> => {
      throw new Error('offline')
    })
    render(<DiceDome controller={controller} nextSeed={null} load={load} />)
    await waitFor(() => expect(controller.store.getState().webgl).toBe('unavailable'))
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-mode', '2d')
    act(() => controller.view().showRest(makeRoll(1, 3)))
    expect(screen.getByTestId('dice-view')).toHaveAttribute('data-dice', '1-3')
  })
})
