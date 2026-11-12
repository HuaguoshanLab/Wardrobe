import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  testMatch: 'travel-ui.spec.ts',
  workers: 1,
  timeout: 30000,
  outputDir: process.env.TRAVEL_UI_RESULTS ?? '../data/acceptance/p7-8/design',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8108',
    channel: 'chromium',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
