import { expect, type Page } from '@playwright/test'

/**
 * The dice path a browser takes in the default 3D mode (plan §0 #27; M14 cross-browser): the live
 * dome where the browser has WebGL, the 2D dice where it has none. Shared by the a11y and
 * cross-browser specs, which assert whichever path the browser under test must take.
 */

/** The page's document, typed for the one probe below (e2e/ compiles without the DOM lib). */
interface ProbeHost {
  readonly document: {
    createElement(tag: 'canvas'): { getContext(type: string, attributes?: object): unknown }
  }
}

/**
 * The dice path this browser must take, then waits for it: '3d' when the browser hands out a
 * WebGL context the way the dome's probe asks (src/dome/webgl.ts) — the dome must then come up
 * live and ready — and '2d' when it does not, where the 2D dice stay (no dome chunk is fetched).
 * Software WebGL can take many seconds to come up, hence the long wait.
 */
export async function settledDiceMode(page: Page): Promise<'3d' | '2d'> {
  const webgl = await page.evaluate(() => {
    const canvas = (globalThis as unknown as ProbeHost).document.createElement('canvas')
    const attributes = { failIfMajorPerformanceCaveat: false, powerPreference: 'high-performance' }
    try {
      const context =
        canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes)
      return context !== null && context !== undefined
    } catch {
      return false
    }
  })
  const view = page.getByTestId('dice-view')
  if (webgl) {
    await expect(view).toHaveAttribute('data-mode', '3d', { timeout: 60_000 })
    await expect(view).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
    return '3d'
  }
  await expect(view).toHaveAttribute('data-mode', '2d')
  await expect(page.locator('.dice-view-3d')).toHaveCount(0)
  return '2d'
}
