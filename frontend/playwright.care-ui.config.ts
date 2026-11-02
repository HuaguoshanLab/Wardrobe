import { defineConfig } from '@playwright/test'
import config from './playwright.config'
export default defineConfig({
  ...config,
  testMatch: ['care-design.spec.ts', 'care-readonly.spec.ts', 'care-polish.spec.ts'],
  outputDir: process.env.CARE_UI_RESULTS ?? '../data/acceptance/p7-5/design',
  timeout: 60000,
})
