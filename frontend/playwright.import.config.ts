import { defineConfig } from '@playwright/test'
import config from './playwright.config'

if (
  process.env.IMPORT_ISOLATED_REGRESSION !== '1' ||
  process.env.E2E_BASE_URL !== 'http://localhost:8100'
)
  throw new Error('Requires the isolated wardrobe-import-regression Fake stack at localhost:8100')

export default defineConfig({
  ...config,
  use: { ...config.use, actionTimeout: 15000 },
  testMatch: ['import-details-isolated.scenario.ts'],
  outputDir: '../data/acceptance/import-organization/browser-results',
  globalSetup: './e2e/import-preflight.ts',
  timeout: 120000,
})
