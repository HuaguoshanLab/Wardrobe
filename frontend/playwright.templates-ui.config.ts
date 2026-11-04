import { defineConfig } from '@playwright/test'
import config from './playwright.config'
export default defineConfig({
  ...config,
  testMatch: [
    'templates-ui.spec.ts',
    'templates-readonly.spec.ts',
    'templates-interaction-ui.spec.ts',
  ],
  outputDir: process.env.TEMPLATE_UI_RESULTS ?? '../data/acceptance/p7-7/design',
  timeout: 60000,
})
