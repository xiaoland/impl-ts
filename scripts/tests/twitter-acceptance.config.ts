import { defineConfig } from '@playwright/test'
import baseConfig from '../../playwright.config'

export default defineConfig({
  ...baseConfig,
  testDir: '.',
  outputDir: '../../test-results/twitter-acceptance',
  retries: 0,
  projects: [
    {
      name: 'twitter-info-base',
      testMatch: 'twitter-info-base.spec.ts',
      use: {
        baseURL: process.env.INKCRE_E2E_WEB_URL,
        storageState: { cookies: [], origins: [] },
        // Connection inputs and signed credentials must not enter trace artifacts.
        trace: 'off',
      },
    },
  ],
})
