import { existsSync } from 'node:fs';
import path from 'node:path';

// Optional e2e/.env (git-ignored): process.env wins, so CI / shell values override the file.
const envFile = path.resolve(__dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** All environment-dependent settings for the suite. Override via env vars (see .env.example). */
export const env = {
  /** Frontend (Vite dev server or staging). */
  baseUrl: trimSlash(process.env.RMS_BASE_URL ?? 'http://localhost:3000'),
  /** Backend REST base, including /api/v1. */
  apiUrl: trimSlash(process.env.RMS_API_URL ?? 'http://localhost:8080/api/v1'),
  /** Bundled contract: `npx @redocly/cli@2.82.0 bundle docs/api/openapi.yaml -o build/openapi.bundled.yaml`. */
  openapiBundle: process.env.RMS_OPENAPI_BUNDLE ?? path.resolve(__dirname, '..', '..', 'build', 'openapi.bundled.yaml'),
  /** Run the API seed in global setup. */
  seed: process.env.RMS_SEED === '1',
  /** Call POST /test/reset (backend `test` profile) before seeding. Wipes ALL data: only on a disposable database. */
  testReset: process.env.RMS_TEST_RESET === '1',
  /**
   * The owner account the backend creates on first start (no terminal can exist before it).
   * Seeding registers the first terminal with these credentials (registerTerminal, inline credentials).
   */
  bootstrapOwner: {
    username: process.env.RMS_BOOTSTRAP_OWNER_USERNAME ?? '',
    password: process.env.RMS_BOOTSTRAP_OWNER_PASSWORD ?? '',
    pin: process.env.RMS_BOOTSTRAP_OWNER_PIN ?? '',
  },
  /** Password the seed sets on every other seeded user. Test value only (8–72 chars, not the username). */
  seedPassword: process.env.RMS_SEED_PASSWORD ?? 'Rms#E2e-2026',
  /** Where global setup writes ids and device tokens created by the seed. Git-ignored. */
  seedStateFile: process.env.RMS_SEED_STATE ?? path.resolve(__dirname, '..', '.seed-state.json'),
  /** Suffix that keeps terminal names unique across seed runs (terminals are never deleted). */
  runId: process.env.RMS_RUN_ID ?? Date.now().toString(36),
} as const;

export function requireBootstrapOwner(): { username: string; password: string; pin: string } {
  const o = env.bootstrapOwner;
  if (!o.username || !o.password) {
    throw new Error('Set RMS_BOOTSTRAP_OWNER_USERNAME and RMS_BOOTSTRAP_OWNER_PASSWORD (and _PIN) to seed the test data.');
  }
  return o;
}
