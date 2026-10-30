import { expect, test } from '@playwright/test'
import { appUrl, chip, zone } from './hooks.ts'

/**
 * The coach-mode control (plan §5.6 Off / Quiet / Coach; M9 audit MAJOR-2/3): the topbar group
 * writes the setting, each change is announced, Quiet keeps only the poor/awful badges and a
 * compact meter, Off hides every coach surface (badges, meter, cheat sheet), and the choice is
 * remembered across a reload.
 */

test('Quiet keeps poor/awful badges and a compact meter; Off hides every coach surface; the mode is remembered', async ({
  page,
}) => {
  await page.goto(
    appUrl({ seed: 'm9-mode', preset: 'traditionalBubble', dice: 'instant', bankroll: '500' }),
  )
  const badges = page.locator('[data-coach-badge]')
  await expect
    .poll(() => badges.count(), { message: 'no coach badges rendered' })
    .toBeGreaterThan(10)
  const allBadges = await badges.count()
  await expect(page.getByRole('button', { name: 'Coach on' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Quiet: the poor/awful subset only, announced.
  await page.getByRole('button', { name: 'Coach quiet' }).click()
  await expect(page.getByTestId('announcer')).toContainText('Coach quiet:')
  await expect.poll(() => badges.count()).toBeLessThan(allBadges)
  const grades = await page
    .locator('.zone-coach')
    .evaluateAll((els) =>
      els.map((el) => [...el.classList].find((name) => name.startsWith('grade-')) ?? ''),
    )
  expect(grades.length).toBeGreaterThan(0)
  expect(grades.every((grade) => grade === 'grade-poor' || grade === 'grade-awful')).toBe(true)

  // Quiet's meter is compact: the headline alone, no hourly line.
  await chip(page, '$5.00').click()
  await zone(page, 'place:place:4').click()
  await expect(page.getByTestId('meter-per-roll')).toContainText('a roll')
  await expect(page.getByTestId('layout-meter')).toHaveAttribute('data-compact', 'true')
  await expect(page.getByTestId('meter-hourly')).toHaveCount(0)

  // Off: no badges, no meter, no cheat sheet.
  await page.getByRole('button', { name: 'Coach off' }).click()
  await expect(page.getByTestId('announcer')).toContainText('Coach off:')
  await expect(badges).toHaveCount(0)
  await expect(page.getByTestId('layout-meter')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Cheat sheet/ })).toHaveCount(0)

  // Remembered: the reload boots with the coach still off.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Coach off' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByTestId('layout-meter')).toHaveCount(0)

  // Back on: every badge returns.
  await page.getByRole('button', { name: 'Coach on' }).click()
  await expect.poll(() => badges.count()).toBe(allBadges)
  await expect(page.getByTestId('layout-meter')).toHaveCount(1)
})
