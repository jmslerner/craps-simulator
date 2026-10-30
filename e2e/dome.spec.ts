import { expect, test, type Locator, type Page } from '@playwright/test'
import { reservedZones } from '../src/dome/camera.ts'
import {
  appUrl,
  chip,
  domeReadout,
  hookState,
  rollAndSettle,
  rollButton,
  zone,
  type DomeReadout,
} from './hooks.ts'

/**
 * The §10 M10a and M10b dome specs, on the chromium-3d project only (SwiftShader WebGL; the other
 * projects ignore this file). `force3d=1` keeps the dome's drawn buffer so the pixel check can
 * read it back, takes the medium tier and turns the frame-time monitor off. Every roll is the
 * engine's own seeded dice; the dome must show exactly those — in `data-dice`, listed d1-d2 as the
 * engine rolled them, and in the pips counted off the drawn meshes by `domeReadout`, which never
 * uses the dome's remap tables — and the same seed must give the same dice in 3D and instant
 * modes. M10b adds: the quality tier and its pin, the handoff blend showing up over seeded rolls,
 * a reveal under 500 ms with reduced motion, and a lost WebGL context handing the slot to 2D with
 * play going on. The M10 audit fixes add: whatever mode rolled, the dome shows the last roll when
 * 3D comes on (2D → 3D, instant → 3D, 3D → 2D → 3D, a switch mid-tumble); both dice rest on the
 * canvas clear of the puck and the callout; no dice before the first
 * roll or after New game; and 3D is the default, a saved 2D choice kept. All waits are on
 * attributes and the hook, never sleeps.
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

/**
 * Rolls once and waits for betting to reopen. Software WebGL can hold the main thread for seconds
 * (building a context, the environment map), even in 2D mode while the dome loads or unloads, so
 * the poll is generous.
 */
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

/** The engine's last roll as "d1-d2". */
async function engineRoll(page: Page): Promise<string> {
  const dice = (await hookState(page))?.state?.lastRoll?.dice
  if (dice === null || dice === undefined) throw new Error('no dice in the hook state')
  return `${dice.d1}-${dice.d2}`
}

/** The readout once the frame loop is at rest with both dice drawn. */
async function settledReadout(page: Page): Promise<DomeReadout> {
  let readout: DomeReadout | null = null
  await expect
    .poll(
      async () => {
        readout = await domeReadout(page)
        return (
          readout !== null &&
          readout.state === 'settled' &&
          readout.still &&
          readout.dice.every((die) => die.visible)
        )
      },
      { message: 'the dome never came to rest with both dice drawn', timeout: 60_000 },
    )
    .toBe(true)
  if (readout === null) throw new Error('no readout')
  return readout
}

/** The pips drawn on top, counted off the meshes, in the engine's order: "d1-d2". */
function drawnRoll(readout: DomeReadout): string {
  const first = readout.dice[readout.d1Body]
  const second = readout.dice[readout.d1Body === 0 ? 1 : 0]
  return `${first.face}-${second.face}`
}

/**
 * The engine's last roll as the dome must show it: `data-dice` in d1-d2 order, and the same faces
 * counted off the drawn meshes.
 */
async function expectShowsEngineDice(page: Page, view: Locator, label: string): Promise<void> {
  const engine = await engineRoll(page)
  await expect(view).toHaveAttribute('data-state', 'settled')
  await expect(view, label).toHaveAttribute('data-dice', engine)
  expect(drawnRoll(await settledReadout(page)), `${label}: the drawn pips`).toBe(engine)
}

interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** The dome box's elements as the overlay check reads them in the page (no DOM lib in e2e/). */
interface BoxedElement {
  getBoundingClientRect(): Box
  querySelector(selector: string): BoxedElement | null
}

/**
 * The overlays drawn over the dome, in CSS px from the canvas's top-left corner. Since the machine
 * design (plan §0 #28) the recent rolls are the felt's history strip: the dome draws only the puck
 * and the callout.
 */
async function overlayBoxes(page: Page): Promise<Record<'puck' | 'callout', Box | null>> {
  return page.locator('.dome').evaluate((element) => {
    const dome = element as unknown as BoxedElement
    const origin = dome.querySelector('[data-testid="dice-view"] canvas')?.getBoundingClientRect()
    const box = (selector: string): Box | null => {
      const found = dome.querySelector(selector)
      if (found === null || origin === undefined) return null
      const r = found.getBoundingClientRect()
      return {
        left: r.left - origin.left,
        top: r.top - origin.top,
        right: r.right - origin.left,
        bottom: r.bottom - origin.top,
      }
    }
    return { puck: box('.dome-puck'), callout: box('.callout') }
  })
}

const overlaps = (a: Box, b: Box): boolean =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom

const inside = (a: Box, b: Box, slack = 0.5): boolean =>
  a.left >= b.left - slack &&
  a.top >= b.top - slack &&
  a.right <= b.right + slack &&
  a.bottom <= b.bottom + slack

/**
 * Both drawn top faces are on the canvas and clear of every overlay, and each overlay sits inside
 * the zone the camera keeps the dice out of (src/dome/camera.ts), so the Node framing test's
 * model is the page's.
 */
async function expectFramed(page: Page, readout: DomeReadout, label: string): Promise<void> {
  const canvas = { left: 0, top: 0, right: readout.canvas.width, bottom: readout.canvas.height }
  const boxes = await overlayBoxes(page)
  const [puckZone, bottomBand] = reservedZones(readout.canvas)
  const zones = { puck: puckZone, callout: bottomBand }
  for (const [name, box] of Object.entries(boxes) as [keyof typeof zones, Box | null][]) {
    const zone = zones[name]
    if (box === null || zone === undefined) continue
    expect(inside(box, zone), `${label}: the ${name} outside its reserved zone`).toBe(true)
  }
  readout.dice.forEach((die, body) => {
    const xs = die.corners.map(([x]) => x)
    const ys = die.corners.map(([, y]) => y)
    const face = {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    }
    expect(inside(face, canvas, 0), `${label}: die ${body}'s top face off the canvas`).toBe(true)
    for (const [name, box] of Object.entries(boxes)) {
      if (box === null) continue
      expect(overlaps(face, box), `${label}: die ${body}'s top face under the ${name}`).toBe(false)
    }
  })
}

/** Turns the 3D dice on or off with the dome's switch. */
async function toggleDice(page: Page): Promise<void> {
  await page.getByRole('button', { name: '3D dice' }).click()
}

/** The dome is in 3D, at rest, showing the engine's last roll, drawn and framed. */
async function expectDomeOnLastRoll(page: Page, label: string): Promise<void> {
  const view = page.getByTestId('dice-view')
  await expect(view).toHaveAttribute('data-mode', '3d', { timeout: 60_000 })
  await expectShowsEngineDice(page, view, label)
  await expectFramed(page, await settledReadout(page), label)
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

  test(`${ROLLS} seeded rolls land showing the engine's dice, framed, blending faces where they can`, async ({
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
      // The read framing: both top faces on the canvas, clear of the puck and the callout.
      await expectFramed(page, await settledReadout(page), `roll ${roll + 1}`)
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

  for (const mode of ['2d', 'instant'] as const) {
    test(`${mode} → 3D: the dome shows the last ${mode} roll`, async ({ page }) => {
      await page.goto(appUrl({ ...DOME, dice: mode, seed: `fix-dome-${mode}-to-3d` }))
      await booted(page)
      const view = page.getByTestId('dice-view')
      await expect(view).toHaveAttribute('data-mode', mode)
      for (let roll = 0; roll < 3; roll++) {
        await ensureBet(page)
        await roll3d(page)
      }
      await expect(view).toHaveAttribute('data-dice', await engineRoll(page))
      await toggleDice(page)
      await expectDomeOnLastRoll(page, `${mode} → 3D`)
    })
  }

  test('3D → 2D → 3D: the dome comes back on the last 2D roll', async ({ page }) => {
    await page.goto(appUrl({ ...DOME, seed: 'fix-dome-3d-2d-3d' }))
    await booted(page)
    const view = await waitForDome(page)
    for (let roll = 0; roll < 2; roll++) {
      await ensureBet(page)
      await roll3d(page)
    }
    await toggleDice(page)
    await expect(view).toHaveAttribute('data-mode', '2d')
    for (let roll = 0; roll < 2; roll++) {
      await ensureBet(page)
      await roll3d(page)
    }
    await toggleDice(page)
    await expectDomeOnLastRoll(page, '3D → 2D → 3D')
  })

  test('a switch to 3D during a 2D tumble shows the new roll once it lands', async ({ page }) => {
    await page.goto(appUrl({ ...DOME, dice: '2d', seed: 'fix-dome-mid-tumble' }))
    await booted(page)
    await ensureBet(page)
    await roll3d(page)
    await ensureBet(page)
    const before = (await hookState(page))?.rollIndex ?? 0
    await rollButton(page).click()
    // The switch is clicked in the page while the 700 ms tumble runs, and says when it landed.
    const phaseAtSwitch = await page.locator('.dome-mode').evaluate((element) => {
      ;(element as unknown as { click(): void }).click()
      return __CRAPS_TEST__?.getState().phase ?? null
    })
    expect(phaseAtSwitch, 'the switch came after the tumble').toBe('rolling')
    await expect
      .poll(async () => (await hookState(page))?.rollIndex, { timeout: 60_000 })
      .toBe(before + 1)
    // Mounting the dome on software WebGL can hold the main thread (and the reveal hold) for a
    // few seconds, so this wait is as generous as the dome's own.
    await expect
      .poll(async () => (await hookState(page))?.phase, { timeout: 60_000 })
      .toBe('betting')
    await expectDomeOnLastRoll(page, '2D tumble → 3D')
  })

  test('draws no dice before the first roll or after New game, and says to press ROLL', async ({
    page,
  }) => {
    await page.goto(appUrl({ ...DOME, seed: 'fix-dome-idle' }))
    await booted(page)
    const view = await waitForDome(page)
    const idle = async (label: string) => {
      await expect(view, label).toHaveAttribute('data-state', 'idle')
      await expect(view, label).toHaveAttribute('data-dice', '')
      await expect(page.getByText('Press ROLL to throw')).toBeVisible()
      await expect
        .poll(async () => (await domeReadout(page))?.dice.map((die) => die.visible), {
          message: `${label}: dice drawn while idle`,
          timeout: 60_000,
        })
        .toStrictEqual([false, false])
    }
    await idle('before the first roll')
    await ensureBet(page)
    await roll3d(page)
    await expectShowsEngineDice(page, view, 'the first roll')
    await expect(page.getByText('Press ROLL to throw')).toHaveCount(0)
    await page.getByRole('button', { name: 'New game' }).click()
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(page.getByTestId('meter-bet')).toHaveText('$0.00')
    await idle('after New game')
  })

  test('3D is the default, and a saved 2D choice is kept', async ({ page }) => {
    // No `dice` parameter and no force3d: the player's first visit.
    await page.goto(appUrl({ seed: 'fix-dome-default', bankroll: '500' }))
    await booted(page)
    const view = page.getByTestId('dice-view')
    await expect(view).toHaveAttribute('data-mode', '3d', { timeout: 60_000 })
    const toggle = page.getByRole('button', { name: '3D dice' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await toggle.click()
    await expect(view).toHaveAttribute('data-mode', '2d')
    // A plain reload resumes the session with the saved choice.
    await page.goto('/')
    await expect(page.getByTestId('meter-credit')).toHaveText('$500.00', { timeout: 60_000 })
    await expect(page.getByTestId('dice-view')).toHaveAttribute('data-mode', '2d')
    await expect(page.getByRole('button', { name: '3D dice' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
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
