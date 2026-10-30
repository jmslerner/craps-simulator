import { afterEach, describe, expect, it, vi } from 'vitest'
import { force3d, probeWebGL, webglOptions } from './webgl.ts'

/**
 * WebGL availability (M10 audit MINOR-3): a software rasteriser is accepted — the comment and the
 * behaviour agree — and cost is left to the quality tiers; `force3d` only matters in e2e builds.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('webglOptions', () => {
  it('never refuses a context the browser flags as slow; the tiers handle cost', () => {
    expect(webglOptions(false)).toStrictEqual({
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: false,
    })
    // force3d (e2e builds) keeps the drawn buffer for the pixel checks.
    expect(webglOptions(true)).toStrictEqual({
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: true,
    })
  })

  it('reads force3d only in e2e builds', () => {
    expect(force3d('?force3d=1')).toBe(false)
    vi.stubEnv('MODE', 'e2e')
    expect(force3d('?force3d=1')).toBe(true)
    expect(force3d('?seed=x')).toBe(false)
  })
})

describe('probeWebGL', () => {
  it('asks for the context the renderer will use, accepting software, and releases it', () => {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
    const asked: { type: string; attributes: unknown }[] = []
    const loseContext = vi.fn()
    const documentLike = {
      createElement: () => ({
        getContext: (type: string, attributes?: object) => {
          asked.push({ type, attributes })
          return { getExtension: () => ({ loseContext }) }
        },
      }),
    }
    expect(probeWebGL(webglOptions(false), documentLike)).toBe(true)
    expect(asked).toStrictEqual([
      {
        type: 'webgl2',
        attributes: { failIfMajorPerformanceCaveat: false, powerPreference: 'high-performance' },
      },
    ])
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('says no without WebGL at all, so the dome stays 2D', () => {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
    const documentLike = { createElement: () => ({ getContext: () => null }) }
    expect(probeWebGL(webglOptions(false), documentLike)).toBe(false)
    expect(probeWebGL(webglOptions(false), null)).toBe(false)
  })
})
