/**
 * Annex A §15 Security "automatic logout on idle terminals" (P1-AUTH-03).
 * page.clock makes a 10/30-minute timeout run in milliseconds (the browser clock only; the server clock is
 * untouched, so tokens stay valid). The timeout for a terminal comes from AuthSession.idleTimeoutMinutes
 * (absent for KITCHEN / DISPLAY). Changing the configured value (T06) is in serial.spec.ts.
 */
import { test, expect } from '../fixtures/test';
import { AppShell } from '../pages/shared';
import { expectProblem } from '../utils/api-client';
import { auditFor } from '../utils/admin-api';
import { EP } from '../utils/endpoints';

test.describe('P1-AUTH-03 idle logout on POS and admin terminals', () => {
  test('P1-AUTH-03-T01 cashier POS locks after 10 idle minutes and returns to login', async ({ uiAs, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const page = await uiAs('cashier', { terminal: 'CASHIER_POS', user: u });
    await page.clock.install();
    await page.goto('/pos');
    const shell = new AppShell(page);
    await expect(page.getByTestId('pos-home')).toBeVisible();
    await page.clock.fastForward('09:58');
    await expect(shell.idleOverlay).toBeHidden();
    await page.clock.fastForward('00:04');
    await expect(shell.idleOverlay).toBeVisible();
    await expect(shell.idleOverlay).toContainText('10 minutes');
    await page.getByTestId('idle-unlock').click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-notice')).toContainText(/idle/i);
    expect(await page.evaluate(() => localStorage.getItem('rms.session'))).toBeNull();
  });

  test('P1-AUTH-03-T02 input at 9:59 resets the idle timer', async ({ uiAs, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const page = await uiAs('cashier', { terminal: 'CASHIER_POS', user: u });
    await page.clock.install();
    await page.goto('/pos');
    const shell = new AppShell(page);
    await expect(page.getByTestId('pos-home')).toBeVisible();
    await page.clock.fastForward('09:59');
    await page.mouse.move(120, 140);
    await page.mouse.move(160, 180);
    await page.clock.fastForward('09:58');
    await expect(shell.idleOverlay).toBeHidden();
    await page.clock.fastForward('00:04');
    await expect(shell.idleOverlay).toBeVisible();
  });

  for (const [name, act] of [
    ['a key press', async (p: import('@playwright/test').Page) => p.keyboard.press('a')],
    ['a mouse wheel scroll', async (p: import('@playwright/test').Page) => p.mouse.wheel(0, 40)],
    ['a mouse click', async (p: import('@playwright/test').Page) => p.mouse.click(200, 200)],
  ] as const) {
    test(`P1-AUTH-03-T02b ${name} counts as activity`, async ({ uiAs, makeUser }) => {
      const u = await makeUser({ role: 'cashier' });
      const page = await uiAs('cashier', { terminal: 'CASHIER_POS', user: u });
      await page.clock.install();
      await page.goto('/pos');
      await expect(page.getByTestId('pos-home')).toBeVisible();
      await page.clock.fastForward('09:00');
      await act(page);
      await page.waitForTimeout(250); // let the browser handle the real input event before the fake clock moves on
      await page.clock.fastForward('09:00');
      await expect(new AppShell(page).idleOverlay).toBeHidden();
      await page.clock.fastForward('01:30');
      await expect(new AppShell(page).idleOverlay).toBeVisible();
    });
  }

  test('P1-AUTH-03-T03 reception POS also locks after 10 idle minutes', async ({ uiAs, makeUser }) => {
    const u = await makeUser({ role: 'receptionist' });
    const page = await uiAs('receptionist', { terminal: 'RECEPTION_POS', user: u });
    await page.clock.install();
    await page.goto('/pos');
    const shell = new AppShell(page);
    await expect(page.getByTestId('pos-home')).toBeVisible();
    await page.clock.fastForward('09:58');
    await expect(shell.idleOverlay).toBeHidden();
    await page.clock.fastForward('00:04');
    await expect(shell.idleOverlay).toBeVisible();
  });

  test('P1-AUTH-03-T04 admin terminal keeps the session at 29:58 and locks after 30 minutes', async ({ uiAs, makeUser }) => {
    const u = await makeUser({ role: 'manager' });
    const page = await uiAs('manager', { terminal: 'ADMIN', user: u });
    await page.clock.install();
    await page.goto('/admin');
    const shell = new AppShell(page);
    await expect(page.getByTestId('admin-home')).toBeVisible();
    await page.clock.fastForward('29:58');
    await expect(shell.idleOverlay).toBeHidden();
    await page.clock.fastForward('00:04');
    await expect(shell.idleOverlay).toBeVisible();
    await expect(shell.idleOverlay).toContainText('30 minutes');
  });

  test('P1-AUTH-03-T08 idle logout revokes the refresh token and writes LOGOUT (IDLE_TIMEOUT) to the audit log', async ({ uiAs, api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const page = await uiAs('cashier', { terminal: 'CASHIER_POS', user: u });
    await page.clock.install();
    await page.goto('/pos');
    await expect(page.getByTestId('pos-home')).toBeVisible();
    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('rms.session'))) ?? '{}') as { refreshToken?: string };
    expect(stored.refreshToken).toBeTruthy();
    await page.clock.fastForward('10:05');
    await expect(new AppShell(page).idleOverlay).toBeVisible();
    await expect
      .poll(async () => (await auditFor(owner, u.id, { action: 'LOGOUT' })).length)
      .toBeGreaterThan(0);
    const entry = (await auditFor(owner, u.id, { action: 'LOGOUT' }))[0];
    expect(JSON.stringify(entry)).toContain('IDLE_TIMEOUT');
    await expectProblem(await api.withTerminal(terminal('CASHIER_POS')).post(EP.refresh, { body: { refreshToken: stored.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
  });

  test('P1-AUTH-03-T13 after idle logout the next user logs in on the same terminal and gets a fresh timer', async ({ uiAs, makeUser }) => {
    const a = await makeUser({ role: 'cashier' });
    const b = await makeUser({ role: 'cashier' });
    const page = await uiAs('cashier', { terminal: 'CASHIER_POS', user: a });
    await page.clock.install();
    await page.goto('/pos');
    await expect(page.getByTestId('pos-home')).toBeVisible();
    await page.clock.fastForward('10:05');
    await page.getByTestId('idle-unlock').click();
    await page.getByTestId('login-username').fill(b.username);
    await page.getByTestId('login-password').fill(b.password);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/pos$/);
    await page.clock.fastForward('09:00');
    await expect(new AppShell(page).idleOverlay).toBeHidden();
  });
});

test.describe('P1-AUTH-03 idle timeout in the session response', { tag: '@api' }, () => {
  test('P1-AUTH-03-T14 the session carries the idle timeout of its terminal type (POS 10, reception 10, admin 30)', async ({ apiAs }) => {
    expect((await apiAs('cashier', { terminal: 'CASHIER_POS' })).session!.idleTimeoutMinutes).toBe(10);
    expect((await apiAs('receptionist', { terminal: 'RECEPTION_POS' })).session!.idleTimeoutMinutes).toBe(10);
    expect((await apiAs('owner', { terminal: 'ADMIN' })).session!.idleTimeoutMinutes).toBe(30);
  });

  test('P1-AUTH-03-T09 idle logout is audited as LOGOUT with reason IDLE_TIMEOUT', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const { client, session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    await client.post(EP.logout, { body: { refreshToken: session.refreshToken, reason: 'IDLE_TIMEOUT' } });
    const e = (await auditFor(owner, u.id, { action: 'LOGOUT' }))[0];
    expect(JSON.stringify(e)).toContain('IDLE_TIMEOUT');
  });
});
