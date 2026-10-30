import { expect, test } from '@playwright/test'
import { appUrl, chip, rollAndSettle, zone } from './hooks.ts'

/**
 * The §10 M8 scripted crapless run, on the e2e preset (pass pinned to return-after-win, M4 → M8
 * hand-off): $500 in, dice scripted 1-1, 3-3, 1-1. Pass $10 → point 2 → 2x odds ($20) → Place 6 $6
 * → 3-3 pays $7.00 at 7:6 → 1-1 makes the point: pass pays $10 and returns, odds pay 6:1 ($120)
 * and return. 500 − 10 − 20 − 6 + 7 = 471 before the last roll; 471 + 20 + 140 = 631. The bankroll
 * must read EXACTLY $631.00 with the Place 6 still up, and the history must show all three rolls
 * with their events and the newest entry's arithmetic.
 */

test('the scripted crapless run banks exactly $631.00 with Place 6 still up', async ({ page }) => {
  await page.goto(
    appUrl({ seed: 'm8-run', bankroll: '500', script: '1-1,3-3,1-1', dice: 'instant' }),
  )
  const credit = page.getByTestId('meter-credit')
  await expect(credit).toHaveText('$500.00')

  // Pass $10: the $10 chip onto the pass line.
  await chip(page, '$10.00').click()
  await zone(page, 'line:pass').click()
  await expect(credit).toHaveText('$490.00')

  // Come-out 1-1: the point is 2.
  await rollAndSettle(page)
  await expect(page.getByTestId('round-chip')).toHaveText('Point is 2')

  // 2x odds behind the $10 pass: two $10 taps up to the $20 cap.
  await zone(page, 'odds:passOdds').click()
  await zone(page, 'odds:passOdds').click()
  await expect(credit).toHaveText('$470.00')

  // Place 6 for $6: a $5 chip plus a $1 chip.
  await chip(page, '$5.00').click()
  await zone(page, 'place:place:6').click()
  await chip(page, '$1.00').click()
  await zone(page, 'place:place:6').click()
  await expect(credit).toHaveText('$464.00')
  await expect(page.getByTestId('meter-bet')).toHaveText('$36.00')

  // 3-3: Place 6 pays $7.00 at 7:6 — on the WIN meter and in the history with its arithmetic.
  await rollAndSettle(page)
  await expect(credit).toHaveText('$471.00')
  await expect(page.getByTestId('meter-win')).toHaveText('$7.00')
  const newest = page.locator('.history-newest')
  await expect(newest).toContainText('Place 6 won $7.00')
  await expect(newest).toContainText('+$7.00')
  await expect(newest.getByTestId('roll-math')).toHaveText(
    '($6 × 7/6 = $7.00 → paid $7.00, +$7.00 to credit, stake stays up)',
  )

  // 1-1 again: point 2 made. Pass pays 1:1 and returns; odds pay 6:1 and return.
  await rollAndSettle(page)
  await expect(credit).toHaveText('$631.00')

  // Place 6 is still on the table — and it is the only bet left.
  await expect(page.getByTestId('meter-bet')).toHaveText('$6.00')
  await expect(zone(page, 'place:place:6').locator('.zone-amount')).toHaveText('$6')
  await expect(zone(page, 'line:pass').locator('.zone-amount')).toHaveCount(0)
  await expect(page.getByTestId('round-chip')).toHaveText('Come-out roll')

  // The history shows the three rolls, newest first, with the right events.
  const rolls = page.locator('.history-roll')
  await expect(rolls).toHaveCount(3)
  await expect(rolls.nth(0).locator('.roll-total')).toHaveText('2')
  await expect(rolls.nth(0)).toContainText('point 2 made')
  await expect(rolls.nth(1).locator('.roll-total')).toHaveText('6')
  await expect(rolls.nth(1)).toContainText('Place 6 won $7.00')
  await expect(rolls.nth(2).locator('.roll-total')).toHaveText('2')
  await expect(rolls.nth(2)).toContainText('the point is 2')

  // The newest entry's arithmetic: both wins traced stake × ratio = paid, and the credit after.
  // The history names a line bet with its point ("Pass Line 2"), as traceName writes it.
  await expect(rolls.nth(0)).toContainText('Pass Line 2 won $10.00')
  await expect(rolls.nth(0)).toContainText('Pass Odds 2 won $120.00')
  await expect(rolls.nth(0)).toContainText('+$130.00')
  await expect(rolls.nth(0)).toContainText('credit $631.00')
  const math = rolls.nth(0).getByTestId('roll-math')
  await expect(math.filter({ hasText: '$10 × 1 = $10.00 → paid $10.00' })).toHaveCount(1)
  await expect(math.filter({ hasText: '$20 × 6 = $120.00 → paid $120.00' })).toHaveCount(1)
})
