import { expect, test, type Locator } from '@playwright/test'
import { appUrl, chip, hookState, rollButton, zone } from './hooks.ts'

/**
 * The §10 M8 phone spec, on the mobile projects only: no horizontal scroll at 375 px, every
 * visible zone at least 44×44 px, the bottom-sheet tabs open, and a bet placed and rolled end to
 * end by touch. The roll is unscripted — the engine's own seeded dice — because the assertions
 * here are about the surface, not the outcome. Since the machine design (plan §0 #28) the tabs are
 * the station's — HARDWAYS, HOP BETS — with the side bets as a third on phones, and the Coach
 * drawer is a bottom sheet of its own.
 */

const PHONES = new Set(['pixel7', 'iphone15'])
const TOUCH_TARGET = 44

test.describe('phone layout at 375 px', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(!PHONES.has(info.project.name), 'phone projects only (§10 M8)')
    await page.setViewportSize({ width: 375, height: 720 })
    await page.goto(appUrl({ seed: 'm8-phone', bankroll: '500', dice: 'instant' }))
    await expect(page.getByTestId('meter-credit')).toHaveText('$500.00')
  })

  /** Asserts every visible zone in `scope` is a real touch target. */
  async function assertZoneBoxes(scope: Locator): Promise<number> {
    const zones = await scope.all()
    let checked = 0
    for (const spot of zones) {
      if (!(await spot.isVisible())) continue
      const key = (await spot.getAttribute('data-zone')) ?? '(unknown zone)'
      const box = await spot.boundingBox()
      if (box === null) throw new Error(`zone ${key} has no bounding box`)
      expect(box.width, `${key} is ${box.width}px wide`).toBeGreaterThanOrEqual(TOUCH_TARGET)
      expect(box.height, `${key} is ${box.height}px tall`).toBeGreaterThanOrEqual(TOUCH_TARGET)
      checked++
    }
    return checked
  }

  test('no horizontal scroll, and every zone is at least 44×44', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'the page scrolls horizontally at 375 px').toBeLessThanOrEqual(0)

    const onTable = await assertZoneBoxes(page.locator('[data-zone]'))
    expect(onTable).toBeGreaterThan(0)

    // The props live behind the station's tabs on phones; their zones must be touch targets too.
    const sheet = page.locator('.bottom-sheet')
    for (const name of ['Hardways', 'Hop bets', 'Side bets']) {
      await page.getByRole('tab', { name }).tap()
      await expect(sheet).toBeVisible()
      const inSheet = await assertZoneBoxes(sheet.locator('[data-zone]'))
      expect(inSheet, `the ${name} sheet`).toBeGreaterThan(0)
      await sheet.locator('.sheet-close').tap()
      await expect(sheet).toHaveCount(0)
    }
  })

  test('the bottom-sheet tabs open', async ({ page }) => {
    const sheet = page.locator('.bottom-sheet')
    for (const name of ['Hardways', 'Hop bets', 'Side bets']) {
      await page.getByRole('tab', { name }).tap()
      await expect(sheet).toBeVisible()
      await expect(sheet.locator('.panel-title')).toHaveText(name)
      await sheet.locator('.sheet-close').tap()
      await expect(sheet).toHaveCount(0)
    }
  })

  test('the Coach drawer opens as a bottom sheet and closes', async ({ page }) => {
    const toggle = page.getByTestId('coach-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('next-step')).toBeHidden()
    await toggle.tap()
    await expect(page.getByTestId('next-step')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'the open drawer scrolls the page sideways').toBeLessThanOrEqual(0)
    await page.getByRole('button', { name: 'Close the coach' }).tap()
    await expect(page.getByTestId('next-step')).toBeHidden()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('a bet is placed and rolled end to end by touch', async ({ page }) => {
    await chip(page, '$5.00').tap()
    await zone(page, 'line:pass').tap()
    await expect(page.getByTestId('meter-bet')).toHaveText('$5.00')
    await expect(page.getByTestId('meter-credit')).toHaveText('$495.00')

    await rollButton(page).tap()
    await expect
      .poll(
        async () => {
          const state = await hookState(page)
          return state === null ? null : { phase: state.phase, rollIndex: state.rollIndex }
        },
        { message: 'the touch roll never settled back to betting' },
      )
      .toEqual({ phase: 'betting', rollIndex: 1 })
    await expect(page.locator('.history-roll')).toHaveCount(1)
    await expect(page.getByTestId('dice-view')).toHaveAttribute('data-dice', /^[1-6]-[1-6]$/)
  })
})
