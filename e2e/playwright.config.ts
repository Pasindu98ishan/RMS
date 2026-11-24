import { defineConfig, devices } from '@playwright/test';
import { env } from './utils/env';

/**
 * Projects
 *  - unit:             Node-only tests of the QA tooling itself (permission-matrix generator). No browser, no backend.
 *  - chromium-desktop: POS / admin flows and API acceptance at the POS target size 1366×768 (P1-NFR-02).
 *  - kds-tablet:       Kitchen display flows at 1280×800 landscape with touch (P1-NFR-02). Tag tests `@kds`.
 *  - edge-desktop:     opt-in smoke run (specs/smoke.spec.ts) in installed Microsoft Edge, P1-NFR-02.
 *  - serial:           specs/serial.spec.ts only, one worker, runs AFTER the two projects above. Holds the tests that
 *                      change global state: the server clock (/test/clock), idle-timeout settings, system roles,
 *                      the owner count, the per-IP registration rate limit. Run it with `--project=serial --no-deps`
 *                      when you only want those (`npm run test:serial`); `npm run test:all` runs both phases.
 *
 * Env: RMS_BASE_URL (frontend, default http://localhost:3000), RMS_API_URL (default
 * http://localhost:8080/api/v1), RMS_OPENAPI_BUNDLE, RMS_SEED=1 to seed in global setup.
 */
export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry everywhere: a test that needs it is reported as "flaky" (never silently green). The suite runs a Vite dev
  // server, a backend and a database on one machine, so first loads under 4 workers can exceed short timeouts.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  globalSetup: './fixtures/global-setup.ts',
  use: {
    baseURL: env.baseUrl,
    // The restaurant's devices run in Sri Lanka; NFR-07 tests override this to prove the app
    // converts to Asia/Colombo itself rather than relying on the device clock.
    timezoneId: 'Asia/Colombo',
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'unit',
      testDir: './utils/__tests__',
      testMatch: /.*\.test\.ts$/,
    },
    {
      name: 'chromium-desktop',
      testDir: './specs',
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /(serial|tier1-smoke)\.spec\.ts$/,
      grepInvert: /@kds/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: 'kds-tablet',
      testDir: './specs',
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /(serial|tier1-smoke)\.spec\.ts$/,
      grep: /@kds/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        hasTouch: true,
      },
    },
    {
      // Tier 1 (docs/qa/test-strategy.md 2a): API only, under 3 minutes: npm run test:smoke
      name: 'smoke',
      testDir: './specs',
      testMatch: /tier1-smoke\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Microsoft Edge (installed with Windows). Opt-in: npx playwright test --project=edge-desktop
      name: 'edge-desktop',
      testDir: './specs',
      testMatch: /(^|[\/])smoke\.spec\.ts$/,
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: 'serial',
      testDir: './specs',
      testMatch: /serial\.spec\.ts$/,
      fullyParallel: false,
      dependencies: ['chromium-desktop', 'kds-tablet'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 },
      },
    },
  ],
});
