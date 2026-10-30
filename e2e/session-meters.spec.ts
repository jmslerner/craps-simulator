import { expect, test, type Page } from '@playwright/test'
import { appUrl, chip, rollAndSettle, waitForSaved, zone } from './hooks.ts'

/**
 * The session meters (rules spec §4.6) on the e2e preset (pass pinned to return after a win), $500
 * in, dice scripted 2-2, 1-3: Pass $10 → point 4; Place 4 $5 and $100 added (before roll 2) →
 * 1-3 makes the point: the pass wins $10 and comes down, Place 4 wins $9 at 9:5 and stays. Credit
 * added $600.00 in two deposits; total wagered $15.00 over two decisions; credit $614 with $5 up:
 * +$19.00. The figures must read the same after a reload (recomputed from the stored log), and
 * New game must show them in the ended session's summary and start the next session at the buy-in.
 */

interface Figures {
  readonly credit: string
  readonly wagered: string
  readonly result: string
}

async function expectMeters(page: Page, figures: Figures): Promise<void> {
  const meters = page.getByRole('region', { name: 'Session totals' })
  await expect(meters).toBeVisible()
  await expect(meters.getByTestId('meters-credit-added')).toHaveText(figures.credit)
  await expect(meters.getByTestId('meters-wagered')).toHaveText(figures.wagered)
  await expect(meters.getByTestId('meters-result')).toHaveText(figures.result)
}

async function expectDetails(page: Page): Promise<void> {
  await expect(page.getByTestId('money-credit-added')).toHaveText('$600.00')
  await expect(page.getByTestId('money-deposit-count')).toHaveText('2 deposits')
  await expect(page.getByTestId('money-deposit-list')).toContainText('Buy-in $500.00')
  await expect(page.getByTestId('money-deposit-list')).toContainText('$100.00 before roll 2')
  await expect(page.getByTestId('money-wagered')).toHaveText('$15.00')
  await expect(page.getByTestId('money-decisions')).toHaveText('2 decisions')
  await expect(page.getByTestId('money-commission')).toHaveText('$0.00')
  await expect(page.getByTestId('money-result')).toHaveText('+$19.00')
}

test('the meters track credit added and the total wagered through a reload and a new game', async ({
  page,
}) => {
  await page.goto(
    appUrl({ seed: 'meters-e2e', bankroll: '500', script: '2-2,1-3', dice: 'instant' }),
  )
  const credit = page.getByTestId('meter-credit')
  await expect(credit).toHaveText('$500.00')
  await expect
    .poll(() => page.evaluate(() => typeof __CRAPS_TEST__ !== 'undefined'), { timeout: 30_000 })
    .toBe(true)
  await expectMeters(page, { credit: '$500.00', wagered: '$0.00', result: '$0.00' })

  // Pass $10, then 2-2: the point is 4 and nothing is decided yet.
  await chip(page, '$10.00').click()
  await zone(page, 'line:pass').click()
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 4')
  await expectMeters(page, { credit: '$500.00', wagered: '$0.00', result: '$0.00' })

  // Place 4 $5 and $100 of credit before roll 2: a top-up is never a win.
  await chip(page, '$5.00').click()
  await zone(page, 'place:place:4').click()
  await page.getByRole('button', { name: '+ Add credit' }).click()
  const addCredit = page.getByRole('dialog', { name: 'Add credit' })
  await addCredit.getByRole('radio', { name: '$100', exact: true }).check()
  await addCredit.getByRole('button', { name: 'Add credit' }).click()
  await expect(addCredit).toHaveCount(0)
  await expect(credit).toHaveText('$585.00')
  await expectMeters(page, { credit: '$600.00', wagered: '$0.00', result: '$0.00' })

  // 1-3 makes the point: the pass ($10) and Place 4 ($5) are decided.
  await rollAndSettle(page)
  await expect(credit).toHaveText('$614.00')
  await expectMeters(page, { credit: '$600.00', wagered: '$15.00', result: '+$19.00' })
  await expectDetails(page)

  // A reload resumes the stored session: the same figures, from its whole log.
  await waitForSaved(page)
  await page.goto('/')
  await expect(credit).toHaveText('$614.00')
  await expectMeters(page, { credit: '$600.00', wagered: '$15.00', result: '+$19.00' })
  await expectDetails(page)

  // New game: the ended session's summary shows its figures; the new session starts at the buy-in.
  await page.getByRole('button', { name: 'New game' }).click()
  await page
    .getByRole('dialog', { name: 'New game' })
    .getByRole('button', { name: 'Start' })
    .click()
  const ended = page.getByRole('dialog', { name: 'Session ended' })
  await expect(ended.getByTestId('session-summary')).toBeVisible({ timeout: 30_000 })
  await expect(ended.getByTestId('summary-deposits')).toHaveText('$600.00')
  await expect(ended.getByTestId('summary-deposit-count')).toHaveText('2 deposits')
  await expect(ended.getByTestId('summary-wagered')).toHaveText('$15.00')
  await expect(ended.getByTestId('summary-decisions')).toHaveText('2 decisions')
  await ended.getByRole('button', { name: 'Close' }).click()
  await expect(ended).toHaveCount(0)
  await expect(credit).toHaveText('$500.00')
  await expectMeters(page, { credit: '$500.00', wagered: '$0.00', result: '$0.00' })
  await expect(page.getByTestId('money-deposit-count')).toHaveText('1 deposit: the buy-in')
})

test('at 375 px wide the meters fit the screen with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 })
  await page.goto(appUrl({ seed: 'meters-e2e-narrow', bankroll: '500', dice: 'instant' }))
  await expectMeters(page, { credit: '$500.00', wagered: '$0.00', result: '$0.00' })
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
  const box = await page.getByRole('region', { name: 'Session totals' }).boundingBox()
  expect(box).not.toBeNull()
  if (box !== null) expect(box.x + box.width).toBeLessThanOrEqual(375)
})
