import { expect, test } from '@playwright/test'

test('loads the trainer', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Bubble Craps Trainer')
  await expect(page.getByRole('heading', { level: 1, name: 'Bubble Craps Trainer' })).toBeVisible()
})
