import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  testMatch: 'ui.spec.ts',
  timeout: 120000,
  outputDir: '../data/acceptance/ui-refresh/browser-results',
})
