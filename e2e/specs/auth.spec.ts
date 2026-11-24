/**
 * Annex A §2 / §15 Security — login, lockout and tokens (P1-AUTH-01, P1-AUTH-02).
 * Test ids match docs/qa/phase-1/test-plan.md. Tests that need the server clock (lock expiry, token
 * expiry) are in serial.spec.ts. Throwaway users keep the seeded users unlocked.
 */
import { test, expect } from '../fixtures/test';
import { passwordFor, userFor } from '../fixtures/seed';
import { LoginPage } from '../pages/shared';
import { type AuthSession, expectProblem } from '../utils/api-client';
import { json } from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { lifetimeSeconds, tamperSignature } from '../utils/jwt';

const WRONG = 'Wrong#Password1';

test.describe('P1-AUTH-01 login and lockout', { tag: '@api' }, () => {
  test('P1-AUTH-01-T01 valid credentials on a registered terminal return tokens, user, permissions and terminal', async ({ api, terminal }) => {
    const u = userFor('cashier');
    const res = await api.withTerminal(terminal('CASHIER_POS')).login(u.username, passwordFor(u));
    expect(res.status()).toBe(200);
    const s = (await res.json()) as AuthSession;
    expect(s.accessToken).toEqual(expect.any(String));
    expect(s.refreshToken).toEqual(expect.any(String));
    expect(s.user.username).toBe(u.username);
    expect(s.permissions.length).toBeGreaterThan(0);
    expect(s.sessionType).toBe('TERMINAL');
    expect(s.terminal?.id).toBe(terminal('CASHIER_POS').terminalId);
  });

  test('P1-AUTH-01-T02 wrong password returns 401 INVALID_CREDENTIALS without saying which part was wrong', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const problem = await expectProblem(await api.withTerminal(terminal('CASHIER_POS')).login(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    expect(`${problem.title} ${problem.detail}`).not.toMatch(/password is (wrong|incorrect)|unknown user|no such user|user not found/i);
  });

  test('P1-AUTH-01-T03 unknown username gets the same status and body as a wrong password', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const a = await dev.login(u.username, WRONG);
    const b = await dev.login('qa-no-such-user', WRONG);
    expect(b.status()).toBe(a.status());
    const strip = (p: Record<string, unknown>) => ({ ...p, traceId: undefined, instance: undefined });
    expect(strip(await b.json())).toEqual(strip(await a.json()));
  });

  test('P1-AUTH-01-T04 missing username, password or deviceToken returns 422 VALIDATION_FAILED with field errors', async ({ api, terminal }) => {
    test.fail(true, 'BUG-1-009: with the X-Terminal-Id header and an empty body, fieldErrors list username and password but not deviceToken');
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const res = await dev.post(EP.login, { body: {} });
    const problem = await expectProblem(res, 422, 'VALIDATION_FAILED');
    expect((problem.fieldErrors ?? []).map((f) => f.field).sort()).toEqual(['deviceToken', 'password', 'username']);
  });

  test('P1-AUTH-01-T05 the 5th wrong password in a row locks the account: correct password then gets 423 ACCOUNT_LOCKED', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 1; i <= 4; i++) await expectProblem(await dev.login(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    await expectProblem(await dev.login(u.username, WRONG), 423, 'ACCOUNT_LOCKED'); // the 5th attempt locks
    await expectProblem(await dev.login(u.username, u.password), 423, 'ACCOUNT_LOCKED');
  });

  test('P1-AUTH-01-T06 a successful login before the 5th failure resets the counter', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 4; i++) await expectProblem(await dev.login(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    expect((await dev.login(u.username, u.password)).status()).toBe(200);
    for (let i = 0; i < 4; i++) await expectProblem(await dev.login(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    expect((await dev.login(u.username, u.password)).status()).toBe(200);
  });

  test('P1-AUTH-01-T08 owner unlocks a locked user (unlockUser), who can log in at once', async ({ api, terminal, owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 5; i++) await dev.login(u.username, WRONG);
    await expectProblem(await dev.login(u.username, u.password), 423, 'ACCOUNT_LOCKED');
    await json(await owner.post(EP.unlockUser(u.id)), [200, 204]);
    expect((await dev.login(u.username, u.password)).status()).toBe(200);
  });

  test('P1-AUTH-01-T09 roles other than owner cannot unlock a user (403 FORBIDDEN)', async ({ apiAs, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    for (const role of ['manager', 'cashier', 'receptionist'] as const) {
      const c = await apiAs(role);
      await expectProblem(await c.post(EP.unlockUser(u.id)), 403, 'FORBIDDEN');
    }
  });

  test('P1-AUTH-01-T12 lockout applies to the user on every terminal', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const a = api.withTerminal(terminal('CASHIER_POS'));
    const b = api.withTerminal(terminal('RECEPTION_POS'));
    for (let i = 0; i < 5; i++) await a.login(u.username, WRONG);
    await expectProblem(await b.login(u.username, u.password), 423, 'ACCOUNT_LOCKED');
  });

  test('P1-AUTH-01-T13 deactivated user gets 401 INVALID_CREDENTIALS and their refresh tokens stop working', async ({ api, terminal, owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { session } = await dev.loginAs(u.username, u.password);
    await json(await owner.post(EP.deactivateUser(u.id)));
    await expectProblem(await dev.login(u.username, u.password), 401, 'INVALID_CREDENTIALS');
    await expectProblem(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
  });

  test('P1-AUTH-01-T15 wrong current password in changeOwnPassword returns 422 on currentPassword and counts towards the lock', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { client } = await dev.loginAs(u.username, u.password);
    const body = { currentPassword: WRONG, newPassword: 'Another#Pass-2026' };
    for (let i = 0; i < 4; i++) {
      const p = await expectProblem(await client.post(EP.myPassword, { body }), 422);
      expect((p.fieldErrors ?? []).map((f) => f.field)).toContain('currentPassword');
    }
    await expectProblem(await client.post(EP.myPassword, { body }), 423, 'ACCOUNT_LOCKED');
    await expectProblem(await dev.login(u.username, u.password), 423, 'ACCOUNT_LOCKED');
  });

  test('P1-AUTH-01-T16 changing own password revokes the user\'s other sessions but keeps the calling one', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const first = await dev.loginAs(u.username, u.password);
    const second = await dev.loginAs(u.username, u.password);
    const newPassword = 'Changed#Pass-2026';
    await json(await second.client.post(EP.myPassword, { body: { currentPassword: u.password, newPassword } }), 204);
    await expectProblem(await dev.post(EP.refresh, { body: { refreshToken: first.session.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
    expect((await dev.post(EP.refresh, { body: { refreshToken: second.session.refreshToken } })).status()).toBe(200);
    expect((await dev.login(u.username, newPassword)).status()).toBe(200);
    expect((await dev.login(u.username, u.password)).status()).toBe(401);
  });

  test('P1-AUTH-01-T17 new password shorter than 8 characters or equal to the username is rejected with 422', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const { client } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    await expectProblem(await client.post(EP.myPassword, { body: { currentPassword: u.password, newPassword: 'short' } }), 422);
    await expectProblem(await client.post(EP.myPassword, { body: { currentPassword: u.password, newPassword: u.username } }), 422);
  });

  // Concurrency: found while running the permission matrix in parallel. See bugs.md. Races are probabilistic, so
  // each test makes up to 10 bursts with fresh users and fails as soon as one burst shows the defect.
  test('P1-AUTH-01-T18 concurrent logins of one valid user all succeed (no 409 VERSION_CONFLICT)', async ({ api, terminal, makeUser }) => {
    for (let burst = 0; burst < 10; burst++) {
      const u = await makeUser({ role: 'cashier' });
      const dev = api.withTerminal(terminal('CASHIER_POS'));
      const results = await Promise.all(Array.from({ length: 8 }, () => dev.loginRaw(u.username, u.password)));
      expect(results.map((r) => r.status()), `burst ${burst}`).toEqual(Array(8).fill(200));
    }
  });

  test('P1-AUTH-01-T19 5 failed attempts lock the account even when the attempts arrive in parallel', async ({ api, terminal, makeUser }) => {
    for (let burst = 0; burst < 10; burst++) {
      const u = await makeUser({ role: 'cashier' });
      const dev = api.withTerminal(terminal('CASHIER_POS'));
      const burst_ = await Promise.all(Array.from({ length: 60 }, () => dev.loginRaw(u.username, WRONG)));
      const statuses = burst_.map((r) => r.status());
      expect(statuses.filter((c) => c === 409), `burst ${burst}: wrong passwords must answer 401 / 423, never 409`).toEqual([]);
      const next = await dev.login(u.username, u.password);
      expect(next.status(), `burst ${burst}: correct password after 60 parallel wrong ones`).toBe(423);
    }
  });
});

test.describe('P1-AUTH-01 login screen', () => {
  test('P1-AUTH-01-T10 wrong password shows a generic error and clears the password; lock message after 5', async ({ freshDevice, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const page = await freshDevice('CASHIER_POS');
    const login = new LoginPage(page);
    await login.goto();
    await login.login(u.username, WRONG);
    await expect(login.error).toBeVisible();
    await expect(login.error).not.toContainText(/password is wrong|unknown user/i);
    await expect(login.password).toHaveValue('');
    for (let i = 0; i < 4; i++) {
      await login.login(u.username, WRONG);
      await expect(login.error).toBeVisible();
    }
    await login.login(u.username, u.password);
    await expect(login.error).toContainText(/lock/i);
    await expect(page).toHaveURL(/\/login/);
  });

  for (const [role, terminal, home] of [
    ['manager', 'ADMIN', /\/admin$/],
    ['cashier', 'CASHIER_POS', /\/pos$/],
    ['receptionist', 'RECEPTION_POS', /\/pos$/],
  ] as const) {
    test(`P1-AUTH-01-T11 [${role}] login on ${terminal} lands on the role home`, async ({ freshDevice, makeUser }) => {
      const u = await makeUser({ role });
      const page = await freshDevice(terminal);
      const login = new LoginPage(page);
      await login.goto();
      await login.login(u.username, u.password);
      await expect(page).toHaveURL(home);
    });
  }

  test('P1-AUTH-01-T11b the owner logs in on an admin device and lands on /admin', async ({ freshDevice }) => {
    const page = await freshDevice('ADMIN');
    const login = new LoginPage(page);
    await login.goto();
    const o = userFor('owner');
    await login.login(o.username, passwordFor(o));
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('P1-AUTH-01-T14 users screen shows the locked badge and the owner can unlock', async ({ uiAs, api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    for (let i = 0; i < 5; i++) await api.withTerminal(terminal('CASHIER_POS')).login(u.username, WRONG);
    const page = await uiAs('owner');
    await page.goto('/admin/users');
    await page.getByTestId('users-search').fill(u.username);
    await expect(page.getByTestId(`user-locked-${u.username}`)).toBeVisible();
    await page.getByTestId(`user-unlock-${u.username}`).click();
    await expect(page.getByTestId(`user-locked-${u.username}`)).toBeHidden();
    expect((await api.withTerminal(terminal('CASHIER_POS')).login(u.username, u.password)).status()).toBe(200);
  });
});

test.describe('P1-AUTH-02 tokens', { tag: '@api' }, () => {
  test('P1-AUTH-02-T01 access token lifetime is at most 15 minutes (expiresIn and JWT exp - iat)', async ({ api, terminal }) => {
    const u = userFor('cashier');
    const { session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, passwordFor(u));
    expect(session.expiresIn).toBeLessThanOrEqual(900);
    const life = lifetimeSeconds(session.accessToken);
    expect(life).toBeDefined();
    expect(life!).toBeLessThanOrEqual(15 * 60);
  });

  test('P1-AUTH-02-T02 refresh token lifetime is at most 12 hours (refreshExpiresIn)', async ({ api, terminal }) => {
    const u = userFor('cashier');
    const { session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, passwordFor(u));
    expect(session.refreshExpiresIn).toBeLessThanOrEqual(12 * 3600);
  });

  test('P1-AUTH-02-T03 refresh returns a new access token and a new refresh token (rotation)', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { session } = await dev.loginAs(u.username, u.password);
    const res = await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } });
    expect(res.status()).toBe(200);
    const next = (await res.json()) as AuthSession;
    expect(next.refreshToken).not.toBe(session.refreshToken);
    expect(next.user.username).toBe(u.username);
  });

  test('P1-AUTH-02-T06 logout revokes the refresh token; logging out again still returns 204', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { client, session } = await dev.loginAs(u.username, u.password);
    expect((await client.post(EP.logout, { body: { refreshToken: session.refreshToken, reason: 'USER' } })).status()).toBe(204);
    await expectProblem(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
    expect((await client.post(EP.logout, { body: { refreshToken: session.refreshToken } })).status()).toBe(204);
  });

  test('P1-AUTH-02-T07 tampered token is rejected with 401', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { session } = await dev.loginAs(u.username, u.password);
    const res = await dev.withToken(tamperSignature(session.accessToken)).get(EP.me);
    expect(res.status()).toBe(401);
    const unsigned = session.accessToken.split('.').slice(0, 2).join('.') + '.';
    expect((await dev.withToken(unsigned).get(EP.me)).status()).toBe(401);
    expect((await dev.withToken('not-a-jwt').get(EP.me)).status()).toBe(401);
  });

  test('P1-AUTH-02-T08 refresh token is not accepted as an access token', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { session } = await dev.loginAs(u.username, u.password);
    expect((await dev.withToken(session.refreshToken).get(EP.me)).status()).toBe(401);
  });

  test('P1-AUTH-02-T09 an already-used refresh token is rejected (rotation)', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { session } = await dev.loginAs(u.username, u.password);
    expect((await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } })).status()).toBe(200);
    await expectProblem(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
  });

  test('P1-AUTH-02-T12 refresh token presented from another terminal is rejected', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const { session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    await expectProblem(await api.withTerminal(terminal('RECEPTION_POS')).post(EP.refresh, { body: { refreshToken: session.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
  });

  test('P1-AUTH-02-T13 the session response and /auth/me agree on user, permissions and terminal', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'manager' });
    const { client, session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    const me = await json<{ user: { username: string }; permissions: string[]; terminal: { id: string } }>(await client.get(EP.me));
    expect(me.user.username).toBe(u.username);
    expect([...me.permissions].sort()).toEqual([...session.permissions].sort());
    expect(me.terminal.id).toBe(session.terminal?.id);
  });
});

test.describe('P1-AUTH-02 session in the browser', () => {
  test('P1-AUTH-02-T11 after logout the Back button does not restore the session', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin');
    await page.getByTestId('nav-admin-users').click();
    await expect(page.getByTestId('users-table')).toBeVisible();
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/login/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('users-table')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('rms.session'))).toBeNull();
  });
});
