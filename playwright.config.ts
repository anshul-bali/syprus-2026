import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  globalSetup: './tests/global-setup',
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 60_000, navigationTimeout: 60_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  // Playwright owns the application under test. It runs the *production* build,
  // because that is what would actually be deployed: the dev server re-compiles
  // and hot-reloads underneath a journey, which turns a slow page into a
  // detached-element timeout and tells you nothing about the product.
  webServer: {
    command: 'npx tsx scripts/qa.ts start',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
