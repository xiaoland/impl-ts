import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  globalTimeout: 300_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: 'test-results/playwright',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'web-database',
      testMatch: 'peer-database.spec.ts',
      use: {
        baseURL: process.env.INKCRE_E2E_WEB_URL,
      },
    },
    {
      name: 'mail-info-base',
      testMatch: 'mail-info-base.spec.ts',
      use: {
        baseURL: process.env.INKCRE_E2E_WEB_URL,
      },
    },
    {
      name: 'browser-extension',
      testMatch: 'browser-extension.spec.ts',
    },
  ],
})
