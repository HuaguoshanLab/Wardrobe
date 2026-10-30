import { defineConfig } from '@playwright/test'
import config from './playwright.config'

if (
  process.env.P7_ISOLATED_REGRESSION !== '1' ||
  process.env.E2E_BASE_URL !== 'http://localhost:8103'
)
  throw new Error('Requires the isolated wardrobe-p7-3 Fake stack at localhost:8103')

export default defineConfig({
  ...config,
  testMatch: [
    'feedback-isolated.scenario.ts',
    'manual-outfits-isolated.scenario.ts',
    'manual-outfits-ui.spec.ts',
    'manual-design.spec.ts',
    'rotation-isolated.scenario.ts',
    'collections.spec.ts',
    'outfits.spec.ts',
  ],
  outputDir: process.env.P7_BROWSER_RESULTS ?? '../data/acceptance/p7-3/browser-results',
  globalSetup: './e2e/p7-3-preflight.ts',
  timeout: 120000,
})
