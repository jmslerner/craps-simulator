import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { createDice2D } from '../ui/dice2d/diceController.ts'
import { createDiceDome } from './domeController.ts'
import { createPhysicsClient } from './physicsClient.ts'
import { QualityControl } from './QualityControl.tsx'

/** The quality pin over the dome's quality store: shown while WebGL works, auto names its tier. */

function controller(webgl: boolean) {
  return createDiceDome({
    fallback: createDice2D(),
    client: createPhysicsClient({ spawn: () => null }),
    probe: () => webgl,
    documentLike: null,
    quality: { storage: null, device: 'high', monitor: true },
  })
}

describe('QualityControl', () => {
  it('is absent until WebGL is known to work', () => {
    const dome = controller(false)
    render(<QualityControl controller={dome} />)
    expect(screen.queryByLabelText('3D quality')).toBeNull()
    act(() => {
      dome.probe()
    })
    expect(screen.queryByLabelText('3D quality')).toBeNull()
  })

  it('names the automatic tier and pins a chosen one', () => {
    const dome = controller(true)
    act(() => {
      dome.probe()
    })
    render(<QualityControl controller={dome} />)
    const select = screen.getByLabelText('3D quality')
    expect(select).toHaveValue('auto')
    expect(screen.getByRole('option', { name: 'Auto (High)' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'low' } })
    expect(dome.quality.getState()).toMatchObject({ override: 'low', tier: 'low' })
    expect(select).toHaveValue('low')
    fireEvent.change(select, { target: { value: 'auto' } })
    expect(dome.quality.getState()).toMatchObject({ override: 'auto', tier: 'high' })
    // A drop while on auto shows in the label.
    act(() => {
      dome.quality.getState().drop()
    })
    expect(screen.getByRole('option', { name: 'Auto (Medium)' })).toBeInTheDocument()
  })
})
