import type { FullConfig } from '@playwright/test';
import { ApiClient } from '../utils/api-client';
import { env } from '../utils/env';
import { seedViaApi, writeSeedState } from './seed';

/**
 * Seeds once per run when RMS_SEED=1 (needs the backend running and the bootstrap-owner env vars).
 * Without it this is a no-op, so the unit project and `--list` work with no backend.
 * RMS_TEST_RESET=1 first calls POST /test/reset (backend `test` profile; wipes ALL data). Without it the seed is re-runnable.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (!env.seed) return;
  const api = await ApiClient.create();
  try {
    // Test profile only (404 elsewhere): wipes every table, re-creates the bootstrap owner, resets clock + rate limits.
    if (env.testReset) {
      const res = await api.post('test/reset');
      if (res.status() !== 200 && res.status() !== 204) throw new Error(`test/reset failed: ${res.status()} ${await res.text()}`);
    }
    writeSeedState(await seedViaApi(api));
  } finally {
    await api.ctx.dispose();
  }
}
