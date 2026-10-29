import { defineConfig, devices } from '@playwright/test'

/** Fixed, and off Vite's 4173 default, so the e2e preview never meets a stray `vite preview`. */
const PORT = 4174
/** The dome specs need real WebGL; every other spec runs on the three device projects. */
const DOME_SPECS = /dome\.spec\.ts$/

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  // An e2e build: test hooks exist only when import.meta.env.MODE === 'e2e'.
  webServer: {
    command:
      'npx vite build --mode e2e --outDir dist-e2e && ' +
      `npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: DOME_SPECS,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'pixel7',
      testIgnore: DOME_SPECS,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'iphone15',
      testIgnore: DOME_SPECS,
      use: { ...devices['iPhone 15'] },
    },
    {
      // Chromium dropped its automatic SwiftShader fallback, so headless WebGL must opt in.
      name: 'chromium-3d',
      testMatch: DOME_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
      },
    },
  ],
})
