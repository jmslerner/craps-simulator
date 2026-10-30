import { defineConfig, devices } from '@playwright/test'

/** Fixed, and off Vite's 4173 default, so the e2e preview never meets a stray `vite preview`. */
const PORT = 4174
/** The dome specs need real WebGL; every other spec runs on the five browser/device projects. */
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
    // M14 cross-browser (plan §0 #26: current Chromium, Safari/WebKit and Firefox). Same specs as
    // desktop-chromium. Dice are 3D by default, so a spec that names no `dice=` meets whatever
    // WebGL the headless browser has: the dome when it gets a context, 2D when it does not.
    {
      name: 'desktop-firefox',
      testIgnore: DOME_SPECS,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-webkit',
      testIgnore: DOME_SPECS,
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Chromium dropped its automatic SwiftShader fallback, so headless WebGL must opt in.
      // Software WebGL saturates the CPU for minutes (the dome specs run one at a time), so this
      // project runs after the device projects instead of beside them, where it starved their
      // timing-sensitive specs (the coach's 50 ms long-task guard failed under it). To run the
      // dome specs alone: `npx playwright test --project chromium-3d --no-deps`.
      name: 'chromium-3d',
      testMatch: DOME_SPECS,
      dependencies: ['desktop-chromium', 'pixel7', 'iphone15', 'desktop-firefox', 'desktop-webkit'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
      },
    },
  ],
})
