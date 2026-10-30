import { expect, test } from '@playwright/test'
import { appUrl, sessionHash, storedHead, waitForSaved, zone } from './hooks.ts'

/**
 * The §10 M8 next-step spec (plan §0 #18): a new game with the guide on shows step 1 pointing at
 * the pass line; Go places the line bet and announces it; Hide hides the bar, moves focus to the
 * guide toggle, and the setting sticks across a reload (localStorage) while the session resumes.
 */

test('a new game shows step 1 at the pass line; Go bets it; Hide sticks', async ({ page }) => {
  await page.goto(appUrl({ seed: 'm8-guide', bankroll: '500', dice: 'instant' }))
  const bar = page.getByTestId('next-step')
  await expect(bar).toBeVisible()

  // Step 1 of the cycle is current and points at the pass line.
  await expect(bar.locator('.guide-stepper [aria-current="step"]')).toHaveText('Bet the line')
  await expect(bar.locator('.guide-title')).toHaveText('Bet the Pass Line')
  await expect(zone(page, 'line:pass')).toHaveClass(/guide-target/)

  // Go places the line bet. A Go within 350 ms of a step change is ignored by design (the
  // double-tap guard), so the click retries until the bet lands — a wait on state, not a sleep.
  const go = page.getByTestId('guide-go')
  await expect(async () => {
    await go.click()
    await expect(zone(page, 'line:pass').locator('.zone-amount')).toHaveText('$1', {
      timeout: 250,
    })
  }).toPass()
  await expect(page.getByTestId('meter-bet')).toHaveText('$1.00')

  // The action is announced together with the step that follows (plan §0 #18 lessons).
  await expect(page.getByTestId('announcer')).toContainText('Bet the Pass Line: done.')

  // Hide hides the bar and parks focus on the Guide toggle.
  await bar.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(page.getByTestId('next-step')).toHaveCount(0)
  await expect(page.locator('#guide-toggle')).toBeFocused()
  await expect(page.locator('#guide-toggle')).toHaveAttribute('aria-pressed', 'false')

  // The setting sticks across a reload, and the session (with its $1 pass) resumes.
  await waitForSaved(page)
  const before = await sessionHash(page)
  await page.goto('/')
  await expect(page.getByTestId('meter-credit')).toHaveText('$499.00')
  await expect(page.getByTestId('next-step')).toHaveCount(0)
  await expect(page.locator('#guide-toggle')).toHaveAttribute('aria-pressed', 'false')
  expect(await sessionHash(page)).toBe(before)
  expect((await storedHead(page))?.pendingReveal).toBe(false)
})
