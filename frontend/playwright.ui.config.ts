import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  testMatch: [
    'ui.spec.ts',
    'wardrobe-ui.spec.ts',
    'lifecycle-ui.spec.ts',
    'inventory-ui.spec.ts',
    'organization-ui.spec.ts',
    'seasonal-ui.spec.ts',
    'seasonal-design.spec.ts',
    'organization-design.spec.ts',
    'inventory-design.spec.ts',
    'records-ui.spec.ts',
    'settings-ui.spec.ts',
    'imports-ui.spec.ts',
    'mobile-polish.spec.ts',
  ],
  timeout: 120000,
  outputDir: '../data/acceptance/ui-refresh/browser-results',
})
