import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { DiceView2D } from '../ui/dice2d/DiceView2D.tsx'
import type { DiceDomeController } from './domeController.ts'
import './dome.css'

/**
 * The dome slot's content in 3D mode (plan §7 Quality and fallbacks), from the initial bundle:
 * probe WebGL, fetch the lazy dome chunk (three, R3F, the scene) only when it is available, and
 * show the 2D dice until the renderer is live — so a device without WebGL never downloads the
 * chunk, and a player who rolls while it loads sees the 2D tumble. A render error in the chunk
 * (the renderer refusing a context) lands in the boundary, which sends the view back to 2D for
 * good. A lost WebGL context (M10b) also shows the 2D dice, with a "Retry 3D" toast: play goes on
 * in 2D, and the retry probes again and remounts the already-loaded chunk. The wrapper carries
 * the plan §7 DOM contract: `data-mode` (`3d` only while a renderer is live), `data-state`,
 * `data-dice` read off the drawn meshes, plus `data-shown` (plan / hop / rest: how the dice got
 * there), `data-ready` (the next throw is pre-simulated), `data-tier` (the quality tier drawn at)
 * and `data-handoff` (how many dice blend their face change over a handoff window) for the e2e.
 * `nextSeed` is the next roll's physics seed, prefetched from the dice at rest while the player
 * bets; null while no roll can come.
 */

export type DomeComponent = ComponentType<{ controller: DiceDomeController }>
export type DomeLoader = () => Promise<{ default: DomeComponent }>

/** The lazy chunk: three, R3F and the scene, split by Vite at this import. */
const loadDomeView: DomeLoader = () => import('./DomeView.tsx')

export interface DiceDomeProps {
  readonly controller: DiceDomeController
  readonly nextSeed: number | null
  /** Injectable for tests; the default loads the real chunk. */
  readonly load?: DomeLoader
}

export function DiceDome({ controller, nextSeed, load = loadDomeView }: DiceDomeProps) {
  const snapshot = useStore(controller.store)
  const tier = useStore(controller.quality, (quality) => quality.tier)
  const [Dome, setDome] = useState<DomeComponent | null>(null)

  useEffect(() => {
    controller.probe()
  }, [controller])

  // Prefetch the next throw as soon as WebGL is known to work (the worker loads meanwhile).
  useEffect(() => {
    if (snapshot.webgl === 'ok') controller.prefetch(nextSeed)
  }, [controller, nextSeed, snapshot.webgl])

  useEffect(() => {
    if (snapshot.webgl !== 'ok' || Dome !== null) return
    let cancelled = false
    load()
      .then((module) => {
        if (!cancelled) setDome(() => module.default)
      })
      .catch(() => {
        if (!cancelled) controller.markUnavailable()
      })
    return () => {
      cancelled = true
    }
  }, [snapshot.webgl, Dome, load, controller])

  if (snapshot.webgl === 'lost') {
    return (
      <>
        <DiceView2D controller={controller.fallback} mode="2d" />
        <div className="dome-toast" role="status" data-testid="dome-toast">
          <span>3D paused: the graphics context was lost.</span>
          <button type="button" className="dome-retry" onClick={() => controller.retry()}>
            Retry 3D
          </button>
        </div>
      </>
    )
  }
  if (snapshot.webgl !== 'ok' || Dome === null) {
    return <DiceView2D controller={controller.fallback} mode="2d" />
  }
  const { state, faces, shown, handoff, ready, live } = snapshot
  return (
    <div
      className="dice-view dice-view-3d"
      data-testid="dice-view"
      data-mode={live ? '3d' : '2d'}
      data-state={state}
      data-dice={state === 'settled' && faces !== null ? `${faces[0]}-${faces[1]}` : ''}
      data-shown={shown ?? ''}
      data-handoff={handoff}
      data-ready={ready ? 'true' : 'false'}
      data-tier={tier}
    >
      <DomeBoundary onError={() => controller.markUnavailable()}>
        <Dome controller={controller} />
      </DomeBoundary>
    </div>
  )
}

interface BoundaryProps {
  readonly children: ReactNode
  readonly onError: () => void
}

/** Catches a render error in the dome chunk and hands the slot back to the 2D dice. */
class DomeBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(): void {
    this.props.onError()
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
