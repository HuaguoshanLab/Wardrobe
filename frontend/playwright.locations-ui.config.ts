import { defineConfig } from '@playwright/test'
import config from './playwright.config'
export default defineConfig({
  ...config,
  testMatch: ['locations-ui.spec.ts', 'locations-readonly.spec.ts', 'locations-polish.spec.ts'],
  outputDir: process.env.LOCATIONS_UI_RESULTS ?? '../data/acceptance/p7-6/design',
  timeout: 60000,
})
