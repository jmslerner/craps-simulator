import { expect, test, type Locator, type Page } from '@playwright/test'
import { appUrl, chip, hookState, rollAndSettle, rollButton, zone } from './hooks.ts'

/**
 * The §10 M10a and M10b dome specs, on the chromium-3d project only (SwiftShader WebGL; the other
 * projects ignore this file). `force3d=1` makes the dome accept the software rasteriser, keep its
 * drawn buffer so the pixel check can read it back, take the medium tier and turn the frame-time
 * monitor off. Every roll is the engine's own seeded dice; the dome must show exactly those, read
 * off its meshes into `data-dice`, and the same seed must give the same dice in 3D and instant
 * modes. M10b adds: the quality tier and its pin, the handoff blend showing up over seeded rolls,
 * a reveal under 500 ms with reduced motion, and a lost WebGL context handing the slot to 2D with
 * play going on. All waits are on attributes and the hook, never sleeps.
 */

/** The WebGL context as the pixel check and the context-loss spec read it (e2e/ has no DOM lib). */
interface GLLike {
  isContextLost(): boolean
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void
  getExtension(name: string): { loseContext(): void } | null
  readonly RGBA: number
  readonly UNSIGNED_BYTE: number
  readonly drawingBufferWidth: number
  readonly drawingBufferHeight: number
}

interface CanvasLike {
  getContext(type: string): GLLike | null
}

/** The dice view and the ROLL button as the reduced-motion timer reads them in the page. */
interface ElementLike {
  getAttribute(name: string): string | null
  addEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void
  readonly ownerDocument: { querySelectorAll(selector: string): ArrayLike<ElementLike> }
  readonly textContent: string | null
}

declare global {
  // Overridden by the WebGL-failure spec to refuse every WebGL context.
  const HTMLCanvasElement: {
    prototype: { getContext: (this: unknown, type: string, ...rest: unknown[]) => unknown }
  }
  // Used in the page by the reduced-motion timer.
  const MutationObserver: new (callback: () => void) => {
    observe(target: ElementLike, options: { attributes: boolean; attributeFilter: string[] }): void
  }
}

const DOME = { seed: 'm10a-dome', bankroll: '500', dice: '3d', force3d: '1' }
const ROLLS = 10
/** Plan §10 M10b: with reduced motion the reveal takes under this. */
const REDUCED_MOTION_REVEAL_MS = 500

/**
 * The boot is done (the hook is installed) once the credit meter shows the buy-in. Software WebGL
 * blocks the main thread for seconds while contexts and the environment map are built, and the
 * boot's IndexedDB writes queue behind that, so this wait is as generous as the dome's own.
 */
async function booted(page: Page): Promise<void> {
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00', { timeout: 60_000 })
}

/**
 * $5 on the pass line whenever the table is empty: the machine refuses a roll under its $5
 * minimum total, and a resolved pass comes back to the player on the e2e preset.
 */
async function ensureBet(page: Page): Promise<void> {
  const bet = page.getByTestId('meter-bet')
  if ((await bet.textContent())?.trim() !== '$0.00') return
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await expect(bet).toHaveText('$5.00')
}

/** The dome live in 3D with its first throw pre-simulated. */
async function waitForDome(page: Page): Promise<Locator> {
  const view = page.getByTestId('dice-view')
  await expect(view).toHaveAttribute('data-mode', '3d', { timeout: 60_000 })
  await expect(view).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
  return view
}

/** Both dice as "a-b", smaller first: the dome may show either die on either body. */
function sorted(dice: { readonly d1: number; readonly d2: number } | null | undefined): string {
  if (dice === null || dice === undefined) throw new Error('no dice in the hook state')
  return [dice.d1, dice.d2].sort((a, b) => a - b).join('-')
}

/** Rolls once in 3D (software rendering is slow, so the poll is generous) and settles. */
async function roll3d(page: Page): Promise<void> {
  const before = (await hookState(page))?.rollIndex ?? 0
  await rollButton(page).click()
  await expect
    .poll(
      async () => {
        const state = await hookState(page)
        return state === null ? null : { phase: state.phase, rollIndex: state.rollIndex }
      },
      { message: `3D roll ${before + 1} never settled back to betting`, timeout: 60_000 },
    )
    .toEqual({ phase: 'betting', rollIndex: before + 1 })
}

/** The engine's last roll as the dome must show it. */
async function expectShowsEngineDice(page: Page, view: Locator, label: string): Promise<void> {
  const engine = (await hookState(page))?.state?.lastRoll?.dice
  await expect(view).toHaveAttribute('data-state', 'settled')
  await expect(view).toHaveAttribute('data-dice', /^[1-6]-[1-6]$/)
  const shown = (await view.getAttribute('data-dice')) ?? ''
  const faces = shown.split('-').map(Number)
  expect(sorted({ d1: faces[0] ?? 0, d2: faces[1] ?? 0 }), label).toBe(sorted(engine))
}

/** Loses the dome canvas's WebGL context through the WEBGL_lose_context extension. */
async function loseContext(canvas: Locator): Promise<boolean> {
  return canvas.evaluate((element) => {
    const target = element as unknown as CanvasLike
    const gl = target.getContext('webgl2') ?? target.getContext('webgl')
    const extension = gl?.getExtension('WEBGL_lose_context') ?? null
    if (extension === null) return false
    extension.loseContext()
    return true
  })
}

test.describe('the 3D dome', () => {
  // One SwiftShader browser at a time: in parallel they starve each other of CPU.
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  test('plays in 3D on a live WebGL context with a painted canvas, on the medium tier', async ({
    page,
  }) => {
    await page.goto(appUrl(DOME))
    await booted(page)
    const view = await waitForDome(page)
    const canvas = view.locator('canvas')
    await expect(canvas).toBeVisible()
    const probe = await canvas.evaluate((element) => {
      const target = element as unknown as CanvasLike
      const gl = target.getContext('webgl2') ?? target.getContext('webgl')
      if (gl === null) return null
      const width = gl.drawingBufferWidth
      const height = gl.drawingBufferHeight
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let painted = 0
      const colours = new Set<number>()
      for (let i = 0; i + 3 < pixels.length; i += 4) {
        if ((pixels[i + 3] ?? 0) === 0) continue
        painted++
        colours.add(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0))
      }
      return { lost: gl.isContextLost(), width, height, painted, colours: colours.size }
    })
    expect(probe, 'the dome canvas has no WebGL context').not.toBeNull()
    expect(probe?.lost).toBe(false)
    expect(probe?.width).toBeGreaterThan(0)
    expect(probe?.height).toBeGreaterThan(0)
    // Not blank: a good share of the buffer is painted, in many colours (felt, brass, dice).
    expect(probe?.painted).toBeGreaterThan(((probe?.width ?? 0) * (probe?.height ?? 0)) / 20)
    expect(probe?.colours).toBeGreaterThan(16)

    // Quality (M10b): forced software WebGL takes the medium tier; the pin overrides it.
    await expect(view).toHaveAttribute('data-tier', 'medium')
    const quality = page.getByLabel('3D quality')
    await expect(quality).toHaveValue('auto')
    await quality.selectOption('low')
    await expect(view).toHaveAttribute('data-tier', 'low')
    await expect(canvas).toBeVisible()
    await quality.selectOption('auto')
    await expect(view).toHaveAttribute('data-tier', 'medium')
  })

  test(`${ROLLS} seeded rolls land showing the engine's dice, blending faces where they can`, async ({
    page,
  }) => {
    await page.goto(appUrl(DOME))
    await booted(page)
    const view = await waitForDome(page)
    let blended = 0
    for (let roll = 0; roll < ROLLS; roll++) {
      await ensureBet(page)
      // The next throw is pre-simulated before the roll, so every roll plays a worker plan.
      await expect(view).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
      await roll3d(page)
      await expect(view).toHaveAttribute('data-mode', '3d')
      await expect(view).toHaveAttribute('data-shown', 'plan')
      await expectShowsEngineDice(page, view, `roll ${roll + 1}`)
      await expect(view).toHaveAttribute('data-handoff', /^[0-2]$/)
      blended += Number(await view.getAttribute('data-handoff'))
    }
    // About two changing dice in three get a handoff window (handoff.test.ts); over 10 rolls
    // the chance that none did is negligible.
    expect(blended, 'no die blended its face change in 10 rolls').toBeGreaterThan(0)
  })

  test('3D and instant modes roll the same dice from the same seed', async ({ page }) => {
    const seed = 'm10a-same-dice'
    const sequence = async (dice: '3d' | 'instant'): Promise<string[]> => {
      await page.goto(appUrl({ seed, bankroll: '500', dice, force3d: '1' }))
      await booted(page)
      if (dice === '3d') await waitForDome(page)
      else await expect(page.getByTestId('dice-view')).toHaveAttribute('data-mode', 'instant')
      const rolled: string[] = []
      for (let roll = 0; roll < 5; roll++) {
        await ensureBet(page)
        if (dice === '3d') await roll3d(page)
        else await rollAndSettle(page)
        rolled.push(sorted((await hookState(page))?.state?.lastRoll?.dice))
      }
      return rolled
    }
    const threeD = await sequence('3d')
    const instant = await sequence('instant')
    expect(threeD).toStrictEqual(instant)
    expect(new Set(threeD).size).toBeGreaterThan(1)
  })

  test('reveals in under 500 ms with reduced motion, in 3D', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(appUrl({ ...DOME, seed: 'm10b-reduced-motion' }))
    await booted(page)
    const view = await waitForDome(page)
    await ensureBet(page)
    // Timed in the page: from the ROLL click to `data-dice` first showing a result (the dome is
    // idle before the first roll, so the attribute goes from empty to the dice at the reveal).
    const timing = view.evaluate(
      (element) =>
        new Promise<{ clickMs: number; revealMs: number }>((resolve) => {
          const target = element as unknown as ElementLike
          const buttons = target.ownerDocument.querySelectorAll('button')
          const roll = Array.from(buttons).find((b) => b.textContent?.trim() === 'ROLL')
          if (roll === undefined) throw new Error('no ROLL button in the page')
          let clickMs = Number.NaN
          roll.addEventListener(
            'click',
            () => {
              clickMs = performance.now()
            },
            { capture: true },
          )
          const observer = new MutationObserver(() => {
            if ((target.getAttribute('data-dice') ?? '') !== '') {
              resolve({ clickMs, revealMs: performance.now() })
            }
          })
          observer.observe(target, { attributes: true, attributeFilter: ['data-dice'] })
        }),
    )
    await rollButton(page).click()
    const { clickMs, revealMs } = await timing
    expect(Number.isFinite(clickMs)).toBe(true)
    expect(revealMs - clickMs, 'the reduced-motion reveal took too long').toBeLessThan(
      REDUCED_MOTION_REVEAL_MS,
    )
    // Nothing was animated: the dome snapped straight to a rest showing the engine's dice.
    await expect(view).toHaveAttribute('data-shown', 'rest')
    await expectShowsEngineDice(page, view, 'reduced-motion roll')
    await expect
      .poll(async () => (await hookState(page))?.phase, { timeout: 60_000 })
      .toBe('betting')
  })

  test('a lost WebGL context switches to 2D, play goes on, and Retry 3D brings the dome back', async ({
    page,
  }) => {
    await page.goto(appUrl({ ...DOME, seed: 'm10b-context-loss' }))
    await booted(page)
    const view = await waitForDome(page)
    expect(await loseContext(view.locator('canvas')), 'WEBGL_lose_context is unavailable').toBe(
      true,
    )
    await expect(view).toHaveAttribute('data-mode', '2d', { timeout: 60_000 })
    await expect(page.locator('canvas')).toHaveCount(0)
    const retry = page.getByRole('button', { name: 'Retry 3D' })
    await expect(retry).toBeVisible()

    // Play continues on the 2D dice with the engine's roll.
    await ensureBet(page)
    await rollAndSettle(page)
    await expect(view).toHaveAttribute('data-mode', '2d')
    const engine = (await hookState(page))?.state?.lastRoll?.dice
    await expect(view).toHaveAttribute('data-dice', `${engine?.d1}-${engine?.d2}`)

    // Retry: WebGL is back, so the dome remounts and the next roll plays in 3D again.
    await retry.click()
    await expect(view).toHaveAttribute('data-mode', '3d', { timeout: 60_000 })
    await expect(page.locator('canvas')).toHaveCount(1)
    await expect(view).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
    await ensureBet(page)
    await roll3d(page)
    await expect(view).toHaveAttribute('data-mode', '3d')
    await expect(view).toHaveAttribute('data-shown', /^(plan|hop)$/)
    await expectShowsEngineDice(page, view, 'roll after the retry')
  })

  test('falls back to 2D when WebGL is unavailable, and play goes on', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (typeof type === 'string' && type.startsWith('webgl')) return null
        return original.call(this, type, ...rest)
      }
    })
    await page.goto(appUrl({ ...DOME, seed: 'm10a-no-webgl' }))
    await booted(page)
    const view = page.getByTestId('dice-view')
    await expect(view).toHaveAttribute('data-mode', '2d')
    await expect(page.locator('canvas')).toHaveCount(0)
    await ensureBet(page)
    await rollAndSettle(page)
    await expect(view).toHaveAttribute('data-mode', '2d')
    await expect(view).toHaveAttribute('data-state', 'settled')
    const engine = (await hookState(page))?.state?.lastRoll?.dice
    await expect(view).toHaveAttribute('data-dice', `${engine?.d1}-${engine?.d2}`)
  })
})
