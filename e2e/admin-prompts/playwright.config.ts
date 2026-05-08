/**
 * Standalone Playwright config for the UPE DoD specs.
 *
 * These specs target an EXTERNAL deployment (local docker-compose,
 * staging, or prod) — they do NOT spin up a webServer of their own
 * the way the upstream LibreChat e2e suite does.
 *
 * Run from the LibreChat worktree root:
 *
 *   npx playwright test \
 *     --config=e2e/admin-prompts/playwright.config.ts
 *
 * Required env:
 *   ADMIN_PROMPTS_URL=https://botnim.staging.build-up.team
 *   ADMIN_PROMPTS_USER=botnim.staging.admin@build-up.team
 *   ADMIN_PROMPTS_PASSWORD=$(aws secretsmanager get-secret-value …)
 *
 * Optional:
 *   ADMIN_PROMPTS_USER2 / ADMIN_PROMPTS_PASSWORD2  — for auth-gate spec
 *   ADMIN_PROMPTS_AGENT                            — default 'unified'
 *   ADMIN_PROMPTS_TOOL_NAME                        — default 'search_unified__legal_text'
 *   ADMIN_PROMPTS_TIMEOUT_MS                       — default 120000
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: __dirname,
  testMatch: ['*.spec.ts'],
  timeout: 240_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.ADMIN_PROMPTS_URL || 'https://botnim.staging.build-up.team',
    headless: process.env.HEADED ? false : true,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    timeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
