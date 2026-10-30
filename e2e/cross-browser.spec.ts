import { expect, test, type Page } from '@playwright/test'
import { settledDiceMode } from './dicePath.ts'
import { appUrl, chip, hookState, rollAndSettle, zone } from './hooks.ts'

/**
 * The §10 M14 cross-browser checks (plan §0 #26: current Chromium, Safari/WebKit and Firefox, and
 * the phone projects), on every browser/device project. The functional specs already run on all
 * of them; these add what differs between engines: a boot with no page or console errors, the
 * self-hosted fonts in use, the CSS features the layout leans on (`:has()` and `dvh`), no
 * sideways scroll at the desktop widths, and the dice in the default 3D mode — the
 * live dome where the browser has WebGL, and with WebGL taken away the 2D dice with no 3D code
 * fetched — each showing exactly the engine's roll.
 */

/** Console noise that is not the app's: the browsers' own notices in headless runs. */
const FOREIGN_CONSOLE = [
  /GPU stall due to ReadPixels/i, // Chromium's SwiftShader, reading the canvas back
  /WebGL warning/i, // Firefox's driver notes about software WebGL
  /Download the React DevTools/i,
]

/** Collects page errors and console errors from here on. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (!FOREIGN_CONSOLE.some((pattern) => pattern.test(text))) errors.push(`console: ${text}`)
  })
  return errors
}

/** The page's own feature answers, typed for the evaluate (e2e/ compiles without the DOM lib). */
interface FeatureHost {
  readonly CSS: { supports(condition: string): boolean }
  readonly document: {
    readonly fonts: { readonly status: string; check(font: string): boolean }
    readonly documentElement: { readonly scrollWidth: number; readonly clientWidth: number }
  }
}

/** Places $5 on the pass line (the e2e machine's minimum total) so ROLL is accepted. */
async function passBet(page: Page): Promise<void> {
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await expect(page.getByTestId('meter-bet')).toHaveText('$5.00')
}

/** After a roll: the dice view at rest shows the engine's dice, listed d1-d2. */
async function expectEngineDice(page: Page): Promise<void> {
  const state = await hookState(page)
  const dice = state?.state?.lastRoll?.dice ?? null
  expect(dice, 'the engine rolled').not.toBeNull()
  await expect(page.getByTestId('dice-view')).toHaveAttribute(
    'data-dice',
    `${dice?.d1 ?? 0}-${dice?.d2 ?? 0}`,
    { timeout: 60_000 },
  )
}

test('boots without errors, with its fonts and the CSS it needs, and no sideways scroll', async ({
  page,
}, info) => {
  const errors = watchErrors(page)
  await page.goto(appUrl({ seed: 'm14-browsers', bankroll: '500', dice: '2d' }))
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00')
  await expect
    .poll(() => page.locator('[data-coach-badge]').count(), { message: 'no coach badges' })
    .toBeGreaterThan(10) // the module worker ran

  const features = await page.evaluate(async () => {
    const host = globalThis as unknown as FeatureHost
    const fonts = host.document.fonts
    // Wait for the faces in use to load (font-display: swap paints the fallback first).
    for (let tries = 0; tries < 50 && fonts.status !== 'loaded'; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return {
      has: host.CSS.supports('selector(:has(a))'),
      dvh: host.CSS.supports('height: 100dvh'),
      barlow: fonts.check('15px Barlow'),
      layout: fonts.check('800 13px "Big Shoulders Display"'),
    }
  })
  info.annotations.push({ type: 'features', description: JSON.stringify(features) })
  // Every supported browser (docs/manual-checks.md, "Supported browsers") has all of these.
  expect(features).toEqual({ has: true, dvh: true, barlow: true, layout: true })

  const phone = info.project.name === 'pixel7' || info.project.name === 'iphone15'
  for (const width of phone ? [] : [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(() => {
      const root = (globalThis as unknown as FeatureHost).document.documentElement
      return root.scrollWidth - root.clientWidth
    })
    expect(overflow, `sideways scroll at ${width} px`).toBeLessThanOrEqual(0)
  }

  await passBet(page)
  await rollAndSettle(page)
  await expectEngineDice(page)
  expect(errors).toEqual([])
})

test('the default 3D mode takes the path this browser supports and shows the engine’s roll', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  const errors = watchErrors(page)
  // No dice parameter: 3D by default (plan §0 #27).
  await page.goto(appUrl({ seed: 'm14-browsers-3d', bankroll: '500' }))
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00', { timeout: 60_000 })
  const mode = await settledDiceMode(page)
  info.annotations.push({ type: 'dice path', description: mode })
  await passBet(page)
  const before = (await hookState(page))?.rollIndex ?? 0
  await page.getByRole('button', { name: 'ROLL', exact: true }).click()
  await expect
    .poll(
      async () => {
        const state = await hookState(page)
        return state === null ? null : { phase: state.phase, rollIndex: state.rollIndex }
      },
      { timeout: 60_000, message: 'the 3D roll never settled' },
    )
    .toEqual({ phase: 'betting', rollIndex: before + 1 })
  await expectEngineDice(page)
  await expect(page.getByTestId('dice-view')).toHaveAttribute('data-mode', mode)
  expect(errors).toEqual([])
})

test('without WebGL the dice fall back to 2D cleanly: no 3D code fetched, the engine’s roll shown', async ({
  page,
}) => {
  const errors = watchErrors(page)
  const fetched: string[] = []
  page.on('request', (request) => {
    if (/\/assets\/(DomeView|physics\.worker)[-.]/.test(request.url())) fetched.push(request.url())
  })
  // This browser refuses every WebGL context, as one without WebGL would.
  await page.addInitScript(() => {
    type GetContext = (this: unknown, type: string, ...rest: unknown[]) => unknown
    const host = globalThis as unknown as {
      HTMLCanvasElement: { prototype: { getContext: GetContext } }
    }
    const original = host.HTMLCanvasElement.prototype.getContext
    host.HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/i.test(type)) return null
      return original.call(this, type, ...rest)
    }
  })
  await page.goto(appUrl({ seed: 'm14-browsers-2d', bankroll: '500' }))
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00')
  expect(await settledDiceMode(page)).toBe('2d')
  // The 2D/3D switch still reads 3D: the player's choice is kept, only the drawing falls back.
  await expect(page.getByRole('button', { name: '3D dice' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await passBet(page)
  await rollAndSettle(page)
  await expectEngineDice(page)
  await expect(page.getByTestId('dice-view')).toHaveAttribute('data-mode', '2d')
  expect(fetched, 'no dome chunk or physics worker for a browser without WebGL').toEqual([])
  expect(errors).toEqual([])
})
