import { expect, test, type Page } from '@playwright/test'
import { appUrl, chip, rollAndSettle, zone } from './hooks.ts'

/**
 * The §10 M11 side-bet flow on the e2e crapless machine (the same preset and pin as the §10 M8
 * run): $500 in, dice scripted 1-1, 2-2, 3-4. Pass $5 (the round minimum), Low Rolls $1. The 1-1
 * makes 2 the point and lights the 2 on the Low Rolls zone; a re-tap and a tap on High Rolls show
 * the engine's refusals in words (locked once the dice roll; the window reopens after a 7); the
 * inspector's progress section shows the lit track, the pay table and the lock; 2-2 lights the 4
 * and the history lists the progress; the 3-4 seven-out loses it, the history says what it had,
 * and the window is open again. Every number here is the engine's: the amounts are chips placed,
 * the lit numbers are the dice rolled. On phones the side bets sit behind a tab (plan §6), so the
 * sheet is opened for each look and closed before each roll.
 */

const SCRIPT = '1-1,2-2,3-4'

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

/** The one visible zone for a side-bet key: the panel's on desktop, the sheet's on phones. */
function sideZone(page: Page, key: string) {
  return page.locator(`[data-zone="${key}"]:visible`)
}

test('a Lucky Roller bet lights its progress after each roll and settles with its history', async ({
  page,
}) => {
  // Three rolls, an inspector and the sheet on phones: more steps than the §10 M8 run.
  test.setTimeout(60_000)
  await page.goto(
    appUrl({ seed: 'm11-side-bets', bankroll: '500', script: SCRIPT, dice: 'instant' }),
  )
  const credit = page.getByTestId('meter-credit')
  const strip = page.getByTestId('reason-strip')
  await expect(credit).toHaveText('$500.00')

  // Pass $5 meets the machine's round minimum; the side bet does not count toward it.
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await expect(credit).toHaveText('$495.00')

  // Low Rolls $1: the zone takes the chip, shows it, and draws its five targets unlit.
  await chip(page, '$1.00').click()
  await openSideBets(page)
  const low = () => sideZone(page, 'sideBet:luckyRollerLow')
  await expect(low()).toContainText('31 for 1')
  await low().click()
  await expect(credit).toHaveText('$494.00')
  await expect(low().locator('.zone-amount')).toHaveText('$1')
  await expect(low().locator('.pip')).toHaveCount(5)
  await expect(low().locator('.pip-lit')).toHaveCount(0)
  await expect(low().locator('.zone-track')).toHaveAttribute('data-lit', '')

  // 1-1: the point is 2, and the 2 lights up on the Low Rolls zone.
  await closeSideBets(page)
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 2')
  await openSideBets(page)
  await expect(low().locator('.zone-track')).toHaveAttribute('data-lit', '2')
  await expect(low().locator('.pip-lit')).toHaveText(['2'])
  // The zone's name says everything it shows (M14), its coach badge included, word for word.
  const badge = await page.evaluate(() => __CRAPS_TEST__?.analyze('luckyRollerLow') ?? null)
  const coach =
    badge === null ? '' : `, house edge ${badge.badge.replace('%', ' percent')}, ${badge.grade}`
  await expect(low()).toHaveAccessibleName(
    `Low Rolls, $1.00, pays 31 for 1, any 7 loses, 2 rolled, needs 3, 4, 5 and 6${coach}`,
  )

  // The engine's refusals, in words: a side bet is locked once the dice roll, and the Lucky
  // Roller window opens only right after a 7. A zone that cannot take the tap is `aria-disabled`,
  // never `disabled`, so the tap still asks (plan §6) — Playwright reads aria-disabled as not
  // actionable, so these taps are forced, exactly as a player's finger would land.
  await expect(low()).toHaveAttribute('aria-disabled', 'true')
  await low().click({ force: true })
  await expect(strip).toHaveText(
    'Low Rolls cannot be added to now — a side bet is set before the dice roll.',
  )
  await sideZone(page, 'sideBet:luckyRollerHigh').click({ force: true })
  await expect(strip).toHaveText(
    'High Rolls can only be bet right after a 7 or before the first roll — it opens again after the next 7.',
  )
  await expect(credit).toHaveText('$494.00')

  // The inspector's progress section: the lit track, the machine's pay table, the lock status.
  await low().click({ button: 'right', force: true })
  const dialog = page.getByRole('dialog')
  const progress = dialog.getByTestId('side-bet-progress')
  await expect(progress.locator('.zone-track')).toHaveAttribute('data-lit', '2')
  await expect(dialog.getByTestId('side-bet-words')).toHaveText('2 rolled, needs 3, 4, 5 and 6')
  await expect(progress.locator('[data-pay-row="set"]')).toContainText('all of 2, 3, 4, 5 and 6')
  await expect(progress.locator('[data-pay-row="set"]')).toContainText('31 for 1')
  await expect(dialog.getByTestId('side-bet-status')).toHaveText(
    'Low Rolls is locked once the dice roll — it stays up until it wins or loses.',
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // 2-2: the 4 lights, and the history lists the progress the roll made.
  await closeSideBets(page)
  await rollAndSettle(page)
  await openSideBets(page)
  await expect(low().locator('.zone-track')).toHaveAttribute('data-lit', '2 4')
  await expect(low().locator('.pip-lit')).toHaveText(['2', '4'])
  const newest = page.locator('.history-newest')
  await expect(newest.getByTestId('roll-progress')).toHaveText(
    'Low Rolls: 2 and 4 rolled, needs 3, 5 and 6',
  )

  // 3-4: the seven-out takes the pass and the Low Rolls; the history says what it had.
  await closeSideBets(page)
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Come-out roll')
  await expect(credit).toHaveText('$494.00')
  await expect(page.getByTestId('meter-bet')).toHaveText('$0.00')
  await expect(newest).toContainText('Low Rolls lost $1.00 — had 2 and 4, needed 3, 5 and 6')
  await expect(newest).toContainText('Pass Line 2 lost $5.00')

  // Right after the 7 the window is open again: the same tap places a fresh Low Rolls.
  await openSideBets(page)
  await expect(low().locator('.zone-amount')).toHaveCount(0)
  await expect(low().locator('.pip-lit')).toHaveCount(0)
  await low().click()
  await expect(low().locator('.zone-amount')).toHaveText('$1')
  await expect(credit).toHaveText('$493.00')
  await expect(strip).toBeEmpty()
})
