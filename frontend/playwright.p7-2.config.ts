import { defineConfig } from '@playwright/test'
import config from './playwright.config'

if (
  process.env.P7_ISOLATED_REGRESSION !== '1' ||
  process.env.E2E_BASE_URL !== 'http://localhost:8102'
)
  throw new Error('Requires the isolated wardrobe-p7-2 Fake stack at localhost:8102')

export default defineConfig({
  ...config,
  testMatch: [
    'manual-outfits-isolated.scenario.ts',
    'manual-outfits-ui.spec.ts',
    'manual-design.spec.ts',
    'rotation-isolated.scenario.ts',
    'collections.spec.ts',
    'outfits.spec.ts',
  ],
  outputDir: process.env.P7_BROWSER_RESULTS ?? '../data/acceptance/p7-2/browser-results',
  globalSetup: './e2e/p7-2-preflight.ts',
  timeout: 120000,
})
