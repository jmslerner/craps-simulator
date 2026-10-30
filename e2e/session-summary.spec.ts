import { expect, test, type Page } from '@playwright/test'
import { appUrl, chip, openCoach, rollAndSettle, zone } from './hooks.ts'

/**
 * The session summary (plan §5.7, §10 M13) on the e2e preset (pass pinned to return after a win):
 * $500 in, dice scripted 2-2, 1-3. Pass $10 → point 4 → Place 4 $5 → 1-3 makes the point: the pass
 * pays $10 and returns, Place 4 pays $9 at 9:5 and stays up. Credit 500 − 15 + 20 + 9 = $514 with
 * the $5 Place 4 still up: +$19.00 against $500 put in. Place 4 at 9:5 has a cheaper same-event
 * twin, Buy 4 (5% up front), so the summary names one leak decision. Every device project checks
 * the summary fits the screen with no sideways scroll.
 */

async function playPointMade(page: Page): Promise<void> {
  await page.goto(
    appUrl({ seed: 'm13-summary', bankroll: '500', script: '2-2,1-3', dice: 'instant' }),
  )
  const credit = page.getByTestId('meter-credit')
  await expect(credit).toHaveText('$500.00')
  // The boot installs the test hooks after its first IndexedDB write, which can trail the table.
  await expect
    .poll(() => page.evaluate(() => typeof __CRAPS_TEST__ !== 'undefined'), { timeout: 30_000 })
    .toBe(true)
  await chip(page, '$10.00').click()
  await zone(page, 'line:pass').click()
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 4')
  await chip(page, '$5.00').click()
  await zone(page, 'place:place:4').click()
  await expect(credit).toHaveText('$485.00')
  await rollAndSettle(page)
  await expect(credit).toHaveText('$514.00')
}

test('the Summary control shows the session so far, and fits the screen', async ({ page }) => {
  await playPointMade(page)
  // The control sits in the Coach drawer's session section (plan §0 #28).
  await openCoach(page)
  await page.getByRole('button', { name: 'Session summary' }).click()
  const dialog = page.getByRole('dialog', { name: 'Session summary' })
  await expect(dialog.getByTestId('session-summary')).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByTestId('summary-facts')).toHaveText(
    'Crapless bubble craps · 2 rolls · 0 seven-outs',
  )
  await expect(dialog.getByTestId('summary-deposits')).toHaveText('$500.00')
  await expect(dialog.getByTestId('summary-result-cash')).toHaveText('+$19.00')
  await expect(dialog.getByTestId('summary-leaks')).toHaveText(
    'Place 4 instead of Buy: ≈ -$0.08 over 1 decision',
  )
  await expect(dialog.getByTestId('summary-focus')).toContainText('Switch Place 4 to Buy: saves')

  // No sideways scroll: neither the page nor the dialog is wider than the screen.
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
  const box = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (box !== null && viewport !== null) {
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  }

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
})

test('New game shows the summary of the session it ended', async ({ page }) => {
  await playPointMade(page)
  await page.getByRole('button', { name: 'New game' }).click()
  await page
    .getByRole('dialog', { name: 'New game' })
    .getByRole('button', { name: 'Start' })
    .click()
  const ended = page.getByRole('dialog', { name: 'Session ended' })
  await expect(ended.getByTestId('session-summary')).toBeVisible({ timeout: 30_000 })
  await expect(ended.getByTestId('summary-result-cash')).toHaveText('+$19.00')
  await ended.getByRole('button', { name: 'Close' }).click()
  await expect(ended).toHaveCount(0)
  // The table is the new game's.
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00')
})

test('at 375 px wide the summary fits the screen with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 })
  await playPointMade(page)
  await openCoach(page)
  await page.getByRole('button', { name: 'Session summary' }).click()
  const dialog = page.getByRole('dialog', { name: 'Session summary' })
  await expect(dialog.getByTestId('session-summary')).toBeVisible({ timeout: 30_000 })
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  if (box !== null) {
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
  }
  // The Close button stays reachable: the dialog scrolls inside the screen's height.
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
})
