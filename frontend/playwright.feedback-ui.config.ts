import { defineConfig } from '@playwright/test'
import config from './playwright.config'
export default defineConfig({
  ...config,
  testMatch: ['feedback-design.spec.ts', 'rotation-readonly.spec.ts'],
  outputDir: process.env.FEEDBACK_UI_RESULTS ?? '../data/acceptance/p7-3/design',
  timeout: 60000,
})
