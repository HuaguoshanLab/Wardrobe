import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'content-audit.spec.ts',
  timeout: 30000,
  expect: { timeout: 2000 },
  workers: 1,
  outputDir: '../data/acceptance/content-audit/results',
  reporter: [['list'], ['json', { outputFile: '../data/acceptance/content-audit/results.json' }]],
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://localhost:8088',
    channel: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'narrow-320', use: { viewport: { width: 320, height: 667 } } },
    { name: 'mobile-375', use: { viewport: { width: 375, height: 812 } } },
    { name: 'mobile-430', use: { viewport: { width: 430, height: 932 } } },
    { name: 'landscape', use: { viewport: { width: 812, height: 375 } } },
  ],
})
