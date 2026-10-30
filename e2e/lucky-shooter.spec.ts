import { expect, test, type Page } from '@playwright/test'
import { appUrl, chip, rollAndSettle, rollButton, zone } from './hooks.ts'

/**
 * The Lucky Shooter on the strict Interblock machine, the preset that offers it (plan §10 M11; the
 * M11 audit: no e2e covered it). $500 in, dice scripted 3-4, 2-2, 2-3, 3-3, 2-2. Pass $5 (the
 * round minimum) and the Lucky Shooter $1; a $100 chip on top is over its 100-credit maximum. The
 * come-out 7 wins the pass (the e2e machine returns it) and pushes the Lucky Shooter, which stays
 * up; with only the side bet left the roll is refused, and the refusal says side bets do not count
 * toward the minimum. Back on the pass line, 2-2 sets the bet's point (ringed on its track, a
 * contract from then on), 2-3 and 3-3 are two hits, lit, with the pay table marking the next step,
 * and the 4 made settles it at 2 for 1. Every amount here is a chip placed or the engine's pay. On
 * phones the side bets sit behind a tab (plan §6), so the sheet is opened for each look and closed
 * before each roll.
 */

const SCRIPT = '3-4,2-2,2-3,3-3,2-2'

/** The rack's $100 chip (the shared `chip` helper names the $1, $5 and $10 chips only). */
function chip100(page: Page) {
  return page.getByRole('button', { name: /\$100\.00 chip/ })
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

/** The one visible Lucky Shooter zone: the panel's on desktop, the sheet's on phones. */
function shooterZone(page: Page) {
  return page.locator('[data-zone="sideBet:luckyShooter"]:visible')
}

test('a Lucky Shooter pushes on the come-out 7, takes its point, collects hits and pays 2 for 1', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto(
    appUrl({
      seed: 'm11-lucky-shooter',
      preset: 'strictBubble',
      bankroll: '500',
      script: SCRIPT,
      dice: 'instant',
    }),
  )
  const credit = page.getByTestId('meter-credit')
  const strip = page.getByTestId('reason-strip')
  await expect(credit).toHaveText('$500.00')

  // Pass $5 meets the round minimum; the side bet does not count toward it.
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await expect(credit).toHaveText('$495.00')

  // The zone: the top of its table and the six box numbers, none hit.
  await chip(page, '$1.00').click()
  await openSideBets(page)
  await expect(shooterZone(page)).toContainText('up to 500 for 1')
  await expect(shooterZone(page).locator('.pip')).toHaveCount(6)
  await shooterZone(page).click()
  await expect(credit).toHaveText('$494.00')
  await expect(shooterZone(page).locator('.zone-amount')).toHaveText('$1')

  // $100 more would make $101: over the 100-credit maximum, refused in the engine's words.
  await closeSideBets(page)
  await chip100(page).click()
  await openSideBets(page)
  await shooterZone(page).click()
  await expect(strip).toHaveText('The largest Lucky Shooter bet is $100.00.')
  await expect(credit).toHaveText('$494.00')

  // 3-4 on the come-out: the pass wins (returned on the e2e machine), the Lucky Shooter pushes
  // and stays up for the next come-out.
  await closeSideBets(page)
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Come-out roll')
  await expect(credit).toHaveText('$504.00')
  const newest = page.locator('.history-newest')
  await expect(newest).toContainText('Lucky Shooter pushed — stays up for the next come-out')
  await expect(page.getByTestId('meter-bet')).toHaveText('$1.00')

  // Only the side bet is up: the roll is refused, and the refusal says why.
  await rollButton(page).click()
  await expect(strip).toHaveText(
    'BETS ARE NOT VALID YET! Must bet $5.00 (5 credits) more to roll. Side bets don’t count toward it.',
  )

  // Back on the pass line; 2-2 sets the point 4, the Lucky Shooter's point too, ringed on its track.
  await chip(page, '$5.00').click()
  await zone(page, 'line:pass').click()
  await expect(credit).toHaveText('$499.00')
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 4')
  await openSideBets(page)
  await expect(shooterZone(page).locator('.pip-point')).toHaveText('4')
  await expect(shooterZone(page).locator('.pip-lit')).toHaveCount(0)
  // With its point set it is a contract bet (forced tap: the zone is aria-disabled).
  await shooterZone(page).click({ force: true })
  await expect(strip).toHaveText(
    'Lucky Shooter cannot be added to now — a side bet is set before the dice roll.',
  )

  // 2-3: a hit on 5, lit, and listed in the history.
  await closeSideBets(page)
  await rollAndSettle(page)
  await openSideBets(page)
  await expect(shooterZone(page).locator('.zone-track')).toHaveAttribute('data-lit', '5')
  await expect(newest.getByTestId('roll-progress')).toHaveText('Lucky Shooter: point 4, 1 hit (5)')

  // The inspector: one hit pays nothing yet, so 2 hits is the next step.
  await shooterZone(page).click({ button: 'right', force: true })
  const dialog = page.getByRole('dialog')
  const progress = dialog.getByTestId('side-bet-progress')
  await expect(dialog.getByTestId('side-bet-words')).toHaveText('Point 4, 1 hit (5)')
  await expect(progress.locator('[data-pay-row="2"]')).toContainText('2 for 1')
  await expect(progress.locator('[data-pay-row="2"]')).toHaveClass(/is-next/)
  await expect(progress.locator('.is-reached')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // 3-3: a second hit, on 6.
  await closeSideBets(page)
  await rollAndSettle(page)
  await openSideBets(page)
  await expect(shooterZone(page).locator('.pip-lit')).toHaveText(['5', '6'])

  // 2-2 makes the point: two hits pay 2 for 1, and the pass wins again.
  await closeSideBets(page)
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Come-out roll')
  await expect(newest).toContainText('Lucky Shooter won $1.00 — 2 hits')
  await expect(credit).toHaveText('$511.00')
  await expect(page.getByTestId('meter-bet')).toHaveText('$0.00')
})
