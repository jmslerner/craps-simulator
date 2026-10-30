import { expect, test, type Page } from '@playwright/test'
import { appUrl, chip, rollAndSettle } from './hooks.ts'

/**
 * The Fire Bet on the live reference table, the preset that offers it (plan §10 M11; the M11
 * audit: no e2e covered it). $500 in, dice scripted 2-2, 2-2, 3-3, 3-3, 2-3, 3-4: the 4 made, the 6
 * made, a 5 set, the seven-out. The live table has no round minimum, so the Fire Bet plays alone.
 * Its $5 maximum (Maryland's posted limits, `/limits/perType/fire`) refuses a $25 chip in the
 * engine's words; $1 goes up, locks once the dice roll, lights 4 and then 6 on its track as the
 * points are made, marks the 4-point row next in the inspector's pay table, and loses at the
 * seven-out with two points, the history saying so; the new hand opens its window again. Every
 * amount here is a chip placed and every lit number a point the dice made. On phones the side bets
 * sit behind a tab (plan §6), so the sheet is opened for each look and closed before each roll.
 */

const SCRIPT = '2-2,2-2,3-3,3-3,2-3,3-4'

/** The rack's $25 chip (the shared `chip` helper names the $1, $5 and $10 chips only). */
function chip25(page: Page) {
  return page.getByRole('button', { name: /\$25\.00 chip/ })
}

/** The side-bet panel: open on desktop, behind the "Side bets" tab (a bottom sheet) on phones. */
async function openSideBets(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Side bets' })
  if (!(await tab.isVisible())) return
  const sheet = page.locator('.bottom-sheet')
  if (!(await sheet.isVisible())) await tab.click()
  await expect(sheet).toBeVisible()
}

async function closeSideBets(page: Page): Promise<void> {
  const close = page.locator('.bottom-sheet .sheet-close')
  if (await close.isVisible()) await close.click()
  await expect(page.locator('.bottom-sheet')).toHaveCount(0)
}

/** The one visible Fire Bet zone: the panel's on desktop, the sheet's on phones. */
function fireZone(page: Page) {
  return page.locator('[data-zone="sideBet:fire"]:visible')
}

test('a Fire Bet takes $1 to $5, lights the points made and settles at the seven-out', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto(
    appUrl({
      seed: 'm11-fire',
      preset: 'traditionalLive345',
      bankroll: '500',
      script: SCRIPT,
      dice: 'instant',
    }),
  )
  const credit = page.getByTestId('meter-credit')
  const strip = page.getByTestId('reason-strip')
  await expect(credit).toHaveText('$500.00')

  // The zone: the top of its pay table and the six points it counts, none made.
  await openSideBets(page)
  await expect(fireZone(page)).toContainText('up to 999 to 1')
  await expect(fireZone(page).locator('.pip')).toHaveCount(6)
  await expect(fireZone(page).locator('.pip-lit')).toHaveCount(0)

  // $25 is over the Fire Bet's $5 maximum: refused in the engine's words, nothing taken.
  await closeSideBets(page)
  await chip25(page).click()
  await openSideBets(page)
  await fireZone(page).click()
  await expect(strip).toHaveText('The largest Fire Bet bet is $5.00.')
  await expect(credit).toHaveText('$500.00')

  // $1 goes up before the hand's first roll.
  await closeSideBets(page)
  await chip(page, '$1.00').click()
  await openSideBets(page)
  await fireZone(page).click()
  await expect(credit).toHaveText('$499.00')
  await expect(fireZone(page).locator('.zone-amount')).toHaveText('$1')

  // 2-2 sets the 4: no point made yet. The bet is now a contract (forced tap: aria-disabled).
  await closeSideBets(page)
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 4')
  await openSideBets(page)
  await expect(fireZone(page).locator('.pip-lit')).toHaveCount(0)
  await fireZone(page).click({ force: true })
  await expect(strip).toHaveText(
    'Fire Bet cannot be added to now — a side bet is set before the dice roll.',
  )
  await expect(credit).toHaveText('$499.00')

  // 2-2 makes the 4: it lights, and the history lists the progress.
  await closeSideBets(page)
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Come-out roll')
  await openSideBets(page)
  await expect(fireZone(page).locator('.zone-track')).toHaveAttribute('data-lit', '4')
  const newest = page.locator('.history-newest')
  await expect(newest.getByTestId('roll-progress')).toHaveText('Fire Bet: 1 point made (4)')

  // The inspector: one point made settles for nothing yet, so the 4-point row is the next step.
  await fireZone(page).click({ button: 'right', force: true })
  const dialog = page.getByRole('dialog')
  const progress = dialog.getByTestId('side-bet-progress')
  await expect(dialog.getByTestId('side-bet-words')).toHaveText('1 point made (4)')
  await expect(progress.locator('[data-pay-row="4"]')).toContainText('24 to 1')
  await expect(progress.locator('[data-pay-row="4"]')).toHaveClass(/is-next/)
  await expect(progress.locator('.is-reached')).toHaveCount(0)
  await expect(dialog.getByTestId('side-bet-status')).toHaveText(
    'Fire Bet is locked once the dice roll — it stays up until it wins or loses.',
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // 3-3, 3-3: the 6 is set and made; it lights beside the 4.
  await closeSideBets(page)
  await rollAndSettle(page)
  await rollAndSettle(page)
  await openSideBets(page)
  await expect(fireZone(page).locator('.zone-track')).toHaveAttribute('data-lit', '4 6')
  await expect(fireZone(page).locator('.pip-lit')).toHaveText(['4', '6'])

  // 2-3 sets the 5, 3-4 sevens out: two points pay nothing, and the history says what it had.
  await closeSideBets(page)
  await rollAndSettle(page)
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Come-out roll')
  await expect(credit).toHaveText('$499.00')
  await expect(page.getByTestId('meter-bet')).toHaveText('$0.00')
  await expect(newest).toContainText('Fire Bet lost $1.00 — 2 points made (4 and 6)')

  // The new hand opens the window again: the same tap places a fresh Fire Bet.
  await openSideBets(page)
  await expect(fireZone(page).locator('.pip-lit')).toHaveCount(0)
  await fireZone(page).click()
  await expect(fireZone(page).locator('.zone-amount')).toHaveText('$1')
  await expect(credit).toHaveText('$498.00')
  await expect(strip).toBeEmpty()
})
