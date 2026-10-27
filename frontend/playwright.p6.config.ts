import { defineConfig } from '@playwright/test'
import config from './playwright.config'

if (
  process.env.P6_ISOLATED_REGRESSION !== '1' ||
  process.env.E2E_BASE_URL !== 'http://localhost:8099'
)
  throw new Error('Requires the isolated wardrobe-p6-regression Fake stack at localhost:8099')

export default defineConfig({
  ...config,
  testMatch: ['*.spec.ts', '*-isolated.scenario.ts'],
  outputDir: '../data/acceptance/p6-regression/browser-results',
  globalSetup: './e2e/p6-preflight.ts',
  timeout: 120000,
})
