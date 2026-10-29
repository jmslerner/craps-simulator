import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Inline projects inherit this root config (and so the app's Vite plugins) in Vitest 5.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          test: {
            name: 'core',
            environment: 'node',
            include: ['src/{engine,exact,coach,sim}/**/*.test.ts', 'tests/**/*.test.ts'],
            exclude: [...configDefaults.exclude, 'tests/slow/**'],
          },
        },
        {
          test: {
            name: 'physics',
            environment: 'node',
            include: ['src/physics/**/*.test.ts'],
            testTimeout: 60_000,
          },
        },
        {
          test: {
            name: 'ui',
            environment: 'jsdom',
            include: ['src/{ui,dome,persistence}/**/*.test.{ts,tsx}'],
            setupFiles: ['src/ui/test/setup.ts'],
          },
        },
        {
          test: {
            name: 'slow',
            environment: 'node',
            include: ['tests/slow/**/*.test.ts'],
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        // Reported for all code, gated only on the engine (§9).
        thresholds: { 'src/engine/**': { lines: 90, branches: 85 } },
      },
    },
  }),
)
