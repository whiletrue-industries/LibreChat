import { defineConfig, devices } from '@playwright/test';

/**
 * Phoenix admin trace panel — DoD config.
 *
 * Runs against the local docker-compose stack (nginx on :80 fronting
 * LibreChat-API on :3080). Does NOT spin up its own webServer — assumes
 * `docker compose -f docker-compose.aurora-local.yml up -d` is healthy.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'phoenix-trace-report', open: 'never' }]],
  use: {
    baseURL: process.env.LIBRECHAT_URL || 'http://localhost:3080',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
