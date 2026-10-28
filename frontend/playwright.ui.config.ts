import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  testMatch: [
    'ui.spec.ts',
    'wardrobe-ui.spec.ts',
    'records-ui.spec.ts',
    'settings-ui.spec.ts',
    'imports-ui.spec.ts',
    'mobile-polish.spec.ts',
  ],
  timeout: 120000,
  outputDir: '../data/acceptance/ui-refresh/browser-results',
})
