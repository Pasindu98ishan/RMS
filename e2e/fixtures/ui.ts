/**
 * Browser helpers. The frontend keeps the device registration (`rms.terminal`) and the session tokens
 * (`rms.session`) in localStorage; tests start on a registered / logged-in device by writing those keys
 * before the first page load, so only the specs about login and setup walk through those screens.
 * The one-time flag keeps the init script from restoring a session after the app logs out.
 */
import type { BrowserContext } from '@playwright/test';
import type { AuthSession } from '../utils/api-client';
import type { TerminalRecord } from './seed';

const TERMINAL_KEY = 'rms.terminal';
const SESSION_KEY = 'rms.session';
const FLAG = '__qa_seeded';

export async function seedBrowserStorage(
  context: BrowserContext,
  opts: { terminal?: TerminalRecord; session?: Pick<AuthSession, 'accessToken' | 'refreshToken'> & Partial<Pick<AuthSession, 'sessionType'>> },
): Promise<void> {
  const items: Record<string, string> = {};
  if (opts.terminal) {
    const t = opts.terminal;
    items[TERMINAL_KEY] = JSON.stringify({
      terminalId: t.terminalId,
      deviceToken: t.deviceToken,
      terminal: { id: t.terminalId, name: t.name, type: t.type, active: true },
      registeredAt: new Date().toISOString(),
    });
  }
  if (opts.session) {
    // sessionType (ADR-008): the frontend treats a stored session without it as a TERMINAL session.
    items[SESSION_KEY] = JSON.stringify({ accessToken: opts.session.accessToken, refreshToken: opts.session.refreshToken, sessionType: opts.session.sessionType ?? 'TERMINAL' });
  }
  await context.addInitScript(
    ([flag, data]) => {
      try {
        if (localStorage.getItem(flag as string)) return;
        for (const [k, v] of Object.entries(data as Record<string, string>)) localStorage.setItem(k, v);
        localStorage.setItem(flag as string, '1');
      } catch {
        /* storage blocked */
      }
    },
    [FLAG, items] as const,
  );
}
