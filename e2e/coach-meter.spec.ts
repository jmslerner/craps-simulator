import { expect, test } from '@playwright/test'
import { appUrl, zone } from './hooks.ts'

/**
 * The §10 M9d smoke: the layout meter prices a placed bet per roll with the hourly line over the
 * 60–150 range and the machine's own pace; the cheat sheet lists every catalog row sorted by edge,
 * each equal to `__CRAPS_TEST__.analyze` for its spot; and the Buy 4 badge moves with the buy-vig
 * rules across machines — upfront + recollect against the refundable live pricing.
 */

test('the meter prices a place 4 per roll and per hour at 60, the machine pace and 150', async ({
  page,
}) => {
  await page.goto(appUrl({ seed: 'm9d-meter', dice: 'instant' }))
  await expect(page.getByTestId('meter-empty')).toBeVisible()

  await zone(page, 'place:place:4').click()
  await expect(zone(page, 'place:place:4').locator('.zone-amount')).toHaveText('$1')

  const headline = page.getByTestId('meter-per-roll')
  await expect(headline).toBeVisible()
  await expect(headline).toContainText('a roll')
  await expect(headline).toContainText('$')

  const paces = page.getByTestId('meter-hourly').locator('li')
  await expect(paces).toHaveCount(3)
  await expect(paces.first()).toHaveAttribute('data-pace', '60')
  await expect(paces.last()).toHaveAttribute('data-pace', '150')
  await expect(page.locator('[data-testid="meter-hourly"] li[data-machine]')).toHaveText(
    /this machine/,
  )
})

test('the cheat sheet lists the catalog by edge and each shown edge equals analyze', async ({
  page,
}) => {
  await page.goto(appUrl({ seed: 'm9d-sheet', dice: 'instant' }))
  await page.getByRole('button', { name: /Cheat sheet/ }).click()

  const rows = page.locator('[data-sheet-row]')
  await expect
    .poll(() => rows.count(), { message: 'no cheat sheet rows rendered' })
    .toBeGreaterThan(50)

  // Crapless free odds price best; the worst seats are at the bottom.
  await expect(rows.first()).toHaveAttribute('data-sheet-row', /odds/i)

  // Spot-check three rows against the main-thread analyze hook, character for character.
  for (const key of ['place|6', 'buy|4', 'pass|']) {
    const row = page.locator(`[data-sheet-row="${key}"]`)
    const edge = await row.locator('.sheet-edge').textContent()
    const [typeId = '', numberText = ''] = key.split('|')
    const expected = await page.evaluate(
      ([t, n]) => __CRAPS_TEST__?.analyze(t, n === '' ? null : Number(n))?.badge ?? null,
      [typeId, numberText] as const,
    )
    expect(expected, `analyze(${key}) answers for a sheet row`).not.toBeNull()
    expect(`${key} ${edge ?? ''}`).toBe(`${key} ${expected ?? ''}`)
  }

  // The open sheet keeps the page inside the viewport (plan §6: no horizontal scroll at 375 px).
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
})

test('the Buy 4 badge follows the buy-vig rules: upfront + recollect against live pricing', async ({
  page,
}) => {
  await page.goto(appUrl({ seed: 'm9d-vig', dice: 'instant' }))
  // Crapless bubble charges the buy vig up front and collects it again on a winner that stays.
  await expect(page.locator('[data-coach-badge="buy|4"]')).toHaveText('4.76%')

  // The live reference table floors the vig to whole dollars and refunds it: the on-win price.
  await page.getByRole('button', { name: 'New game' }).click()
  await page.getByRole('radio', { name: /Generous live table/ }).check()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.locator('[data-coach-badge="buy|4"]')).toHaveText('1.67%')
})
