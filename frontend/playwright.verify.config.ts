import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  testMatch: [
    'wardrobe.spec.ts',
    'profile.spec.ts',
    'import-*-isolated.scenario.ts',
    'outfits.spec.ts',
    'collections.spec.ts',
    'restore-isolated.scenario.ts',
    'lifecycle-isolated.scenario.ts',
    'inventory-isolated.scenario.ts',
    'organization-isolated.scenario.ts',
    'seasonal-isolated.scenario.ts',
    'manual-outfits-isolated.scenario.ts',
    'rotation-isolated.scenario.ts',
    'feedback-isolated.scenario.ts',
    'usage-isolated.scenario.ts',
    'care-isolated.scenario.ts',
    'locations-isolated.scenario.ts',
    'templates-isolated.scenario.ts',
    'travel-isolated.scenario.ts',
    'reference-isolated.scenario.ts',
  ],
  outputDir: process.env.WARDROBE_VERIFY_RESULTS,
  globalSetup: './e2e/verify-preflight.ts',
  timeout: 240000,
})
