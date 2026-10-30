/**
 * WebGL availability (plan §7 Quality and fallbacks), decided in the initial bundle before the
 * three/R3F chunk is fetched: a device without WebGL never downloads it. The probe asks for a
 * context the way the renderer will — `failIfMajorPerformanceCaveat` on, so a software rasteriser
 * falls back to 2D rather than crawl — and releases it at once. The e2e builds pass `?force3d=1`
 * (plan §6 test hooks) to accept Chromium's SwiftShader and keep the drawn buffer for pixel
 * checks; production ignores the parameter. The quality tiers live in quality.ts.
 */

export interface WebGLOptions {
  /** Refuse a context the browser flags as slow (software rendering). */
  readonly failIfMajorPerformanceCaveat: boolean
  /** Keep the drawn buffer after compositing, so tests can read pixels back. */
  readonly preserveDrawingBuffer: boolean
}

/** Whether the e2e build was asked to accept any WebGL implementation. */
export function force3d(search: string = typeof location === 'undefined' ? '' : location.search) {
  if (import.meta.env.MODE !== 'e2e') return false
  return new URLSearchParams(search).get('force3d') === '1'
}

export function webglOptions(forced: boolean = force3d()): WebGLOptions {
  return {
    failIfMajorPerformanceCaveat: !forced,
    preserveDrawingBuffer: forced,
  }
}

interface ProbeDocument {
  createElement(tag: 'canvas'): {
    getContext(type: string, attributes?: object): unknown
  }
}

interface LosableContext {
  getExtension(name: 'WEBGL_lose_context'): { loseContext(): void } | null
}

/**
 * True when the browser hands out a WebGL 2 or WebGL 1 context under `options`. The scratch
 * context is lost again at once, so it costs the renderer nothing.
 */
export function probeWebGL(
  options: Pick<WebGLOptions, 'failIfMajorPerformanceCaveat'> = webglOptions(),
  documentLike: ProbeDocument | null = typeof document === 'undefined' ? null : document,
): boolean {
  if (documentLike === null) return false
  // jsdom and old browsers: no WebGL at all, and no context to even ask for.
  if (typeof WebGLRenderingContext === 'undefined') return false
  try {
    const canvas = documentLike.createElement('canvas')
    const attributes = {
      failIfMajorPerformanceCaveat: options.failIfMajorPerformanceCaveat,
      powerPreference: 'high-performance',
    }
    const context =
      canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes)
    if (context === null || context === undefined) return false
    const losable = context as Partial<LosableContext>
    if (typeof losable.getExtension === 'function') {
      losable.getExtension('WEBGL_lose_context')?.loseContext()
    }
    return true
  } catch {
    return false
  }
}
