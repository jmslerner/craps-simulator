import { expect, test } from '@playwright/test'
import {
  appUrl,
  closeCoachSheet,
  openCoach,
  sessionHash,
  storedHead,
  waitForSaved,
  zone,
} from './hooks.ts'

/**
 * The §10 M8 next-step spec (plan §0 #18): a new game with the guide on shows step 1 pointing at
 * the pass line; Go places the line bet and announces it; Hide hides the guide, moves focus to the
 * guide toggle, and the setting sticks across a reload (localStorage) while the session resumes.
 * Since the machine design (plan §0 #28) the step and its Go ride in the status banner and the
 * guide's detail (stepper, words, Hide) in the Coach drawer, which a phone opens as a bottom sheet
 * over the felt: the spec opens it to read the detail and closes it to tap the felt.
 */

test('a new game shows step 1 at the pass line; Go bets it; Hide sticks', async ({ page }) => {
  await page.goto(appUrl({ seed: 'm8-guide', bankroll: '500', dice: 'instant' }))
  const bar = page.getByTestId('next-step')
  await openCoach(page)
  await expect(bar).toBeVisible()

  // Step 1 of the cycle is current and points at the pass line; the banner says it too.
  await expect(bar.locator('.guide-stepper [aria-current="step"]')).toHaveText('Bet the line')
  await expect(bar.locator('.guide-title')).toHaveText('Bet the Pass Line')
  await expect(page.locator('.banner-step')).toHaveText('Bet the Pass Line')
  await expect(zone(page, 'line:pass')).toHaveClass(/guide-target/)
  await closeCoachSheet(page)

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

  // Hide hides the guide and parks focus on the Guide toggle.
  await openCoach(page)
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
