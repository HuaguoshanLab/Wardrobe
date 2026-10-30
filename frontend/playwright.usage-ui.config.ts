import { defineConfig } from '@playwright/test'
import config from './playwright.config'
export default defineConfig({
  ...config,
  testMatch: ['usage-design.spec.ts', 'usage-anchor-design.spec.ts'],
  outputDir: process.env.USAGE_UI_RESULTS ?? '../data/acceptance/p7-4/design',
  timeout: 60000,
})
