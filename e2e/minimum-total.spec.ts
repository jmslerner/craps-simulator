import { expect, test } from '@playwright/test'
import { appUrl, chip, hookState, rollAndSettle, rollButton, zone } from './hooks.ts'

/**
 * The §10 M8 minimum-total flow (plan §0 #12, M4 → M8 hand-off): with no working bets that meet
 * crapless's $5 round minimum, ROLL is refused and the strip shows Interblock's wording with N
 * taken from the rejection's `details.short` (formatted through the config's credit value — two
 * different table states prove it is the engine's number, not a constant); betting $5 clears it.
 */

test('ROLL under the machine minimum is refused with the machine wording', async ({ page }) => {
  await page.goto(appUrl({ seed: 'm8-min', bankroll: '500', dice: 'instant' }))
  await expect(page.getByTestId('meter-credit')).toHaveText('$500.00')
  const strip = page.getByTestId('reason-strip')

  // No bets at all: the whole $5.00 minimum is missing.
  await rollButton(page).click()
  await expect(strip).toHaveText('BETS ARE NOT VALID YET! Must bet $5.00 (5 credits) more to roll.')
  expect((await hookState(page))?.rollIndex).toBe(0)

  // $1 on the pass line: the shortfall is now the rejection's own $4.00.
  await chip(page, '$1.00').click()
  await zone(page, 'line:pass').click()
  await rollButton(page).click()
  await expect(strip).toHaveText('BETS ARE NOT VALID YET! Must bet $4.00 (4 credits) more to roll.')
  expect((await hookState(page))?.rollIndex).toBe(0)

  // Betting up to $5 clears it: the roll is accepted and the strip empties.
  for (let tap = 0; tap < 4; tap++) await zone(page, 'line:pass').click()
  await expect(page.getByTestId('meter-bet')).toHaveText('$5.00')
  await rollAndSettle(page)
  await expect(strip).toBeEmpty()
  await expect(page.locator('.history-roll')).toHaveCount(1)
})
