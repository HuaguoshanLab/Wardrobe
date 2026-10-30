import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  testMatch: ['rotation-design.spec.ts', 'rotation-readonly.spec.ts'],
  outputDir: process.env.ROTATION_UI_RESULTS ?? '../data/acceptance/p7-2-ui/browser',
  timeout: 60000,
})
