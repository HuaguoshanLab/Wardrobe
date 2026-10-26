import { defineConfig, devices } from '@playwright/test'

if (process.env.P5_ISOLATED_RESTORE !== '1')
  throw new Error('Requires P5_ISOLATED_RESTORE=1 and the isolated wardrobe-p5-restore stack')
export default defineConfig({
  testDir: './e2e',
  outputDir: './restore-test-results',
  testMatch: 'restore-isolated.scenario.ts',
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8099',
    channel: 'chromium',
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
})
