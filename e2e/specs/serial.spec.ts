/**
 * Tests that change GLOBAL state and therefore run alone, after every other spec (project `serial`, one worker):
 *  - the server clock (/test/clock: lock expiry, token expiry, audit date boundary)
 *  - idle-timeout settings, system-role permissions, the number of owners
 *  - the per-IP registration rate limit (429)
 * Test ids belong to the requirement named in each title; the plan lists them under that requirement.
 * Every test restores what it changed (clock, settings, roles, owners) in `finally` / afterEach.
 */
import { request } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { SEED, passwordFor, userFor, type TerminalRecord } from '../fixtures/seed';
import { seedBrowserStorage } from '../fixtures/ui';
import { AppShell } from '../pages/shared';
import { ApiClient, type Schemas, expectProblem } from '../utils/api-client';
import {
  advanceClock,
  auditSearch,
  colomboDate,
  createRole,
  createUser,
  getRole,
  getUser,
  json,
  registerTerminalAs,
  resetClock,
  roleIdByKey,
  uniqueName,
} from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { EPM, createItem, getItem } from '../utils/menu-api';

const WRONG = 'Wrong#Password1';
const ownerCreds = () => ({ username: userFor('owner').username, password: passwordFor(userFor('owner')) });
const sorted = (a: readonly string[]) => [...a].sort();

test.describe.configure({ mode: 'default' });

/** Fresh login at the current (possibly moved) server clock: tokens issued earlier may have expired. */
async function api_login(base: ApiClient, role: 'owner' | 'cashier' = 'owner'): Promise<{ client: ApiClient }> {
  const u = userFor(role);
  const term = role === 'owner' ? base.terminal : base.terminal;
  const { client } = await base.withToken(undefined).withTerminal(term).loginAs(u.username, passwordFor(u));
  return { client };
}


test.afterEach(async ({ api }) => {
  await resetClock(api); // never leave the server clock moved
});

test.describe('P1-AUTH-01 / P1-AUTH-02 time-based rules (test clock)', { tag: '@api' }, () => {
  test('P1-AUTH-01-T07 an account lock lasts 15 minutes (still locked after 14, open after 15)', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 5; i++) await dev.login(u.username, WRONG);
    await expectProblem(await dev.login(u.username, u.password), 423, 'ACCOUNT_LOCKED');
    await advanceClock(api, 14);
    await expectProblem(await dev.login(u.username, u.password), 423, 'ACCOUNT_LOCKED');
    await advanceClock(api, 1); // 15 minutes plus the real time that has passed
    expect((await dev.login(u.username, u.password)).status()).toBe(200);
  });

  test('P1-AUTH-01-T07b after the lock expires the failure counter starts again from zero', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 5; i++) await dev.login(u.username, WRONG);
    await advanceClock(api, 16);
    for (let i = 0; i < 4; i++) await expectProblem(await dev.login(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    expect((await dev.login(u.username, u.password)).status()).toBe(200);
  });

  test('P1-AUTH-02-T04 an expired access token gets 401 TOKEN_EXPIRED while the refresh token still works', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { client, session } = await dev.loginAs(u.username, u.password);
    expect((await client.get(EP.me)).status()).toBe(200);
    await advanceClock(api, 14);
    expect((await client.get(EP.me)).status()).toBe(200); // 14 min: still valid
    await advanceClock(api, 2); // 16 min
    await expectProblem(await client.get(EP.me), 401, 'TOKEN_EXPIRED');
    const refreshed = await json<Schemas['AuthSession']>(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }));
    expect((await dev.withToken(refreshed.accessToken).get(EP.me)).status()).toBe(200);
  });

  test('P1-AUTH-02-T05 a refresh token unused for more than 12 hours is rejected; using it within 12 hours slides the window', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { session } = await dev.loginAs(u.username, u.password);
    await advanceClock(api, 11 * 60 + 50);
    const slid = await json<Schemas['AuthSession']>(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }));
    await advanceClock(api, 11 * 60 + 50); // 23h40 after login, 11h50 after the last refresh
    const again = await json<Schemas['AuthSession']>(await dev.post(EP.refresh, { body: { refreshToken: slid.refreshToken } }));
    await advanceClock(api, 12 * 60 + 5);
    await expectProblem(await dev.post(EP.refresh, { body: { refreshToken: again.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
  });

  test('P1-AUTH-02-T05b logout revokes the refresh token immediately even inside its 12 hours', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { client, session } = await dev.loginAs(u.username, u.password);
    expect((await client.post(EP.logout, { body: { refreshToken: session.refreshToken } })).status()).toBe(204);
    await advanceClock(api, 60);
    await expectProblem(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
  });
});

test.describe('P1-AUTH-02 session in the browser (test clock)', () => {
  test('P1-AUTH-02-T10 the browser refreshes silently when the access token expires while the user works', async ({ uiAs, api }) => {
    const page = await uiAs('owner');
    await page.goto('/admin');
    await expect(page.getByTestId('admin-home')).toBeVisible();
    await advanceClock(api, 16); // the access token the page holds is now expired
    await page.getByTestId('nav-admin-users').click();
    await expect(page.getByTestId('users-table')).toBeVisible();
    await expect(page.getByTestId('user-row-owner1')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/users$/);
  });

  test('P1-AUTH-02-T14 when the refresh token has expired too, the browser returns to login with a "session ended" notice', async ({ uiAs, api }) => {
    const page = await uiAs('owner');
    await page.goto('/admin');
    await expect(page.getByTestId('admin-home')).toBeVisible();
    await advanceClock(api, 13 * 60);
    await page.getByTestId('nav-admin-users').click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-notice')).toContainText(/session ended/i);
  });

  test('P1-AUTH-04-T06b a device whose terminal was deactivated returns to setup within one access-token lifetime', async ({ page, context, api, owner, makeUser }) => {
    const { identity, terminal } = await registerTerminalAs(api, ownerCreds(), uniqueName('QA dev gone'), 'ADMIN');
    const u = await makeUser({ role: 'manager' });
    const { session } = await api.withTerminal(identity).loginAs(u.username, u.password);
    const record: TerminalRecord = { ...identity, name: terminal.name, type: 'ADMIN' };
    await seedBrowserStorage(context, { terminal: record, session });
    await page.goto('/admin');
    await expect(page.getByTestId('admin-home')).toBeVisible();
    await json(await owner.post(EP.deactivateTerminal(terminal.id)));
    await advanceClock(api, 16);
    await page.getByTestId('nav-admin').first().click().catch(() => undefined);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    await page.getByTestId('login-username').fill(u.username);
    await page.getByTestId('login-password').fill(u.password);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('terminal-problem')).toBeVisible();
    await page.getByTestId('goto-setup').click();
    await expect(page).toHaveURL(/\/setup\/terminal/);
  });
});

test.describe('P1-AUD-03 audit date boundary (test clock)', { tag: '@api' }, () => {
  test('P1-AUD-03-T10 an entry at 23:59 Colombo belongs to that date, one at 00:00 to the next (not UTC dates)', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const hm = (iso: string) => {
      const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)).split(':').map(Number);
      return h * 60 + m;
    };
    const now0 = (await resetClock(api)).now;
    let minutes = 23 * 60 + 59 - hm(now0);
    if (minutes <= 0) minutes += 24 * 60;
    const at2359 = await advanceClock(api, minutes);
    expect(hm(at2359.now)).toBe(23 * 60 + 59);
    const dayD = colomboDate(at2359.now);
    await dev.loginAs(u.username, u.password); // entry E1 at 23:59:xx on day D
    const at0000 = await advanceClock(api, 1);
    const dayD1 = colomboDate(at0000.now);
    expect(dayD1).not.toBe(dayD);
    await dev.loginAs(u.username, u.password); // entry E2 at 00:00:xx on day D+1
    const owner = (await api.withTerminal(terminal('ADMIN')).loginAs(userFor('owner').username, passwordFor(userFor('owner')))).client;
    const count = async (from: string, to: string) => (await auditSearch(owner, { userId: u.id, action: 'LOGIN', from, to })).totalItems;
    expect(await count(dayD, dayD)).toBe(1);
    expect(await count(dayD1, dayD1)).toBe(1);
    expect(await count(dayD, dayD1)).toBe(2);
  });
});

test.describe('P1-AUTH-03 idle timeout setting takes effect', () => {
  test('P1-AUTH-03-T06 owner sets the cashier POS idle timeout to 5 minutes; it applies at the next login and locks the screen after 5 minutes', async ({ owner, api, terminal, uiAs, makeUser }) => {
    const cur = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
    const rules = (cashier: number) => [
      { terminalType: 'CASHIER_POS', idleTimeoutMinutes: cashier },
      { terminalType: 'RECEPTION_POS', idleTimeoutMinutes: SEED.settings.idleTimeoutMinutes.RECEPTION_POS },
      { terminalType: 'ADMIN', idleTimeoutMinutes: SEED.settings.idleTimeoutMinutes.ADMIN },
    ];
    const set = await json<Schemas['IdleTimeoutSettings']>(await owner.put(EP.settings.idleTimeouts, { body: { rules: rules(5), version: cur.version } }));
    try {
      const u = await makeUser({ role: 'cashier' });
      const { session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
      expect(session.idleTimeoutMinutes).toBe(5);
      const reception = await api.withTerminal(terminal('RECEPTION_POS')).loginAs(u.username, u.password);
      expect(reception.session.idleTimeoutMinutes).toBe(10);
      const page = await uiAs('cashier', { terminal: 'CASHIER_POS', user: u });
      await page.clock.install();
      await page.goto('/pos');
      await expect(page.getByTestId('pos-home')).toBeVisible();
      await page.clock.fastForward('04:55');
      await expect(new AppShell(page).idleOverlay).toBeHidden();
      await page.clock.fastForward('00:10');
      await expect(new AppShell(page).idleOverlay).toBeVisible();
      await expect(new AppShell(page).idleOverlay).toContainText('5 minutes');
    } finally {
      await json(await owner.put(EP.settings.idleTimeouts, { body: { rules: rules(SEED.settings.idleTimeoutMinutes.CASHIER_POS), version: set.version } }));
    }
  });

  test('P1-AUTH-03-T06b a changed timeout reaches a logged-in terminal at its next token refresh', async ({ owner, api, terminal, makeUser }) => {
    const cur = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
    const body = (admin: number) => ({
      rules: [
        { terminalType: 'CASHIER_POS', idleTimeoutMinutes: 10 },
        { terminalType: 'RECEPTION_POS', idleTimeoutMinutes: 10 },
        { terminalType: 'ADMIN', idleTimeoutMinutes: admin },
      ],
    });
    const u = await makeUser({ role: 'manager' });
    const dev = api.withTerminal(terminal('ADMIN'));
    const { session } = await dev.loginAs(u.username, u.password);
    expect(session.idleTimeoutMinutes).toBe(30);
    const set = await json<Schemas['IdleTimeoutSettings']>(await owner.put(EP.settings.idleTimeouts, { body: { ...body(45), version: cur.version } }));
    try {
      const refreshed = await json<Schemas['AuthSession']>(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }));
      expect(refreshed.idleTimeoutMinutes).toBe(45);
    } finally {
      await json(await owner.put(EP.settings.idleTimeouts, { body: { ...body(30), version: set.version } }));
    }
  });
});

test.describe('P1-RBAC-01 / P1-RBAC-02 roles and owners that change global state', { tag: '@api' }, () => {
  test('P1-RBAC-01-T06 system role permissions (not Owner) can be edited and restored; changes are audited and reach users at refresh', async ({ owner, api, terminal }) => {
    const id = await roleIdByKey(owner, 'rider');
    const before = await getRole(owner, id);
    expect(before.permissionCodes).toEqual([]);
    const rider = userFor('rider');
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    try {
      const edited = await json<Schemas['Role']>(await owner.put(EP.role(id), { body: { name: before.name, permissionCodes: ['ORDER_VIEW'], version: before.version } }));
      expect(edited.permissionCodes).toEqual(['ORDER_VIEW']);
      const { session } = await dev.loginAs(rider.username, passwordFor(rider));
      expect(session.permissions).toEqual(['ORDER_VIEW']);
      const entries = (await auditSearch(owner, { entityId: id, entityType: 'ROLE' })).items;
      expect(entries.some((e) => e.action === 'UPDATE' && JSON.stringify(e.after).includes('ORDER_VIEW'))).toBe(true);
    } finally {
      const cur = await getRole(owner, id);
      await json(await owner.put(EP.role(id), { body: { name: cur.name, permissionCodes: [], version: cur.version } }));
    }
    expect((await getRole(owner, id)).permissionCodes).toEqual([]);
    expect((await dev.loginAs(rider.username, passwordFor(rider))).session.permissions).toEqual([]);
  });

  test('P1-RBAC-01-T06b a system role keeps its name and key after its permissions were edited', async ({ owner }) => {
    const id = await roleIdByKey(owner, 'inventory');
    const before = await getRole(owner, id);
    const edited = await json<Schemas['Role']>(await owner.put(EP.role(id), { body: { name: before.name, permissionCodes: ['ORDER_VIEW', 'MENU_AVAILABILITY'], version: before.version } }));
    try {
      expect(edited).toMatchObject({ name: 'Inventory', key: 'INVENTORY', system: true });
    } finally {
      await json(await owner.put(EP.role(id), { body: { name: before.name, permissionCodes: before.permissionCodes, version: edited.version } }));
    }
    expect(sorted((await getRole(owner, id)).permissionCodes)).toEqual(sorted(before.permissionCodes));
  });

  test('P1-RBAC-02-T11 removing the Owner role from, or deactivating, the last active owner gets 409 LAST_OWNER', async ({ owner, api, terminal }) => {
    const ownerId = owner.session!.user.id;
    const manager = await createRole(owner, ['USER_MANAGE']);
    const m = await createUser(owner, { roleIds: [manager.id] });
    const { client: mc } = await api.withTerminal(terminal('ADMIN')).loginAs(m.username, m.password);
    const cashier = await roleIdByKey(owner, 'cashier');
    const ownerUser = await getUser(owner, ownerId);
    await expectProblem(await mc.post(EP.deactivateUser(ownerId)), 409, 'LAST_OWNER');
    await expectProblem(await mc.put(EP.userRoles(ownerId), { body: { roleIds: [cashier], version: ownerUser.version } }), 409, 'LAST_OWNER');
    expect((await getUser(owner, ownerId)).active).toBe(true);
    expect((await getUser(owner, ownerId)).roles.map((r) => r.key)).toContain('OWNER');
  });

  test('P1-RBAC-02-T11b with a second active owner, the first can be deactivated and reactivated; the second then becomes the last owner', async ({ owner, api, terminal }) => {
    const ownerId = owner.session!.user.id;
    const ownerRole = await roleIdByKey(owner, 'owner');
    const second = await createUser(owner, { roleIds: [ownerRole] });
    const manager = await createRole(owner, ['USER_MANAGE']);
    const m = await createUser(owner, { roleIds: [manager.id] });
    const { client: mc } = await api.withTerminal(terminal('ADMIN')).loginAs(m.username, m.password);
    try {
      await json(await mc.post(EP.deactivateUser(ownerId)));
      expect((await getUser(owner, second.id)).active).toBe(true);
      await expectProblem(await mc.post(EP.deactivateUser(second.id)), 409, 'LAST_OWNER');
      await json(await mc.post(EP.activateUser(ownerId)));
    } finally {
      await json(await mc.post(EP.activateUser(ownerId)));
      await json(await mc.post(EP.deactivateUser(second.id)));
    }
    expect((await getUser(owner, ownerId)).active).toBe(true);
  });
});

test.describe('P1-AUTH-04 registration rate limit (per IP, no account lock)', { tag: '@api' }, () => {
  test('P1-AUTH-04-T13 wrong credentials get 401 INVALID_CREDENTIALS, never lock the owner, and 5 failures from one IP in 15 minutes get 429 TOO_MANY_ATTEMPTS with Retry-After', async ({ api, terminal }) => {
    // Start from a clean window (earlier tests may have failed a registration): +16 min expires it.
    await advanceClock(api, 16);
    await resetClock(api);
    const creds = (i: number) => ({ username: ownerCreds().username, password: `Wrong#${i}-Password` });
    for (let i = 0; i < 5; i++) {
      await expectProblem(await api.registerTerminal(creds(i), { name: uniqueName('QA rl'), type: 'ADMIN' }), 401, 'INVALID_CREDENTIALS');
    }
    const limited = await api.registerTerminal(creds(6), { name: uniqueName('QA rl'), type: 'ADMIN' });
    await expectProblem(limited, 429, 'TOO_MANY_ATTEMPTS');
    expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers()['retry-after'])).toBeLessThanOrEqual(900);
    // Blocked even with the right credentials while the window is open ...
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA rl ok'), type: 'ADMIN' }), 429, 'TOO_MANY_ATTEMPTS');
    // ... but the owner account is NOT locked: a normal login still works.
    const o = userFor('owner');
    expect((await api.withTerminal(terminal('ADMIN')).login(o.username, passwordFor(o))).status()).toBe(200);
    // The window expires after 15 minutes.
    await advanceClock(api, 16);
    expect((await api.registerTerminal(ownerCreds(), { name: uniqueName('QA rl ok'), type: 'ADMIN' })).status()).toBe(201);
  });

  test('P1-AUTH-04-T26 wrong credentials on the token-less setup-options call count towards the same per-IP limit (5 in 15 min, then 429) but never lock the owner', async ({ api, terminal }) => {
    await advanceClock(api, 16);
    await resetClock(api);
    const dev = api.withToken(undefined).withTerminal(undefined);
    for (let i = 0; i < 5; i++) {
      await expectProblem(await dev.post(EPM.setupOptions, { body: { username: ownerCreds().username, password: `Wrong#${i}-Password` } }), 401, 'INVALID_CREDENTIALS');
    }
    const limited = await dev.post(EPM.setupOptions, { body: { username: ownerCreds().username, password: 'Wrong#6-Password' } });
    await expectProblem(limited, 429, 'TOO_MANY_ATTEMPTS');
    expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0);
    // the same window blocks registration too, even with the right password
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA rl2'), type: 'ADMIN' }), 429, 'TOO_MANY_ATTEMPTS');
    await expectProblem(await dev.post(EPM.setupOptions, { body: ownerCreds() }), 429, 'TOO_MANY_ATTEMPTS');
    const o = userFor('owner');
    expect((await api.withTerminal(terminal('ADMIN')).login(o.username, passwordFor(o))).status()).toBe(200);
    await advanceClock(api, 16);
    expect((await dev.post(EPM.setupOptions, { body: ownerCreds() })).status()).toBe(200);
  });

  test('P1-AUTH-04-T16 the unregistered-device setup screen shows the wait time when registration is rate limited', async ({ page, api }) => {
    await advanceClock(api, 16);
    await resetClock(api);
    for (let i = 0; i < 5; i++) await api.registerTerminal({ username: ownerCreds().username, password: `Wrong#${i}-Password` }, { name: uniqueName('QA rl'), type: 'ADMIN' });
    await page.goto('/setup/terminal');
    await page.getByTestId('setup-username').fill(ownerCreds().username);
    await page.getByTestId('setup-password').fill(ownerCreds().password);
    await page.getByTestId('terminal-name').fill(uniqueName('QA rl ui'));
    await page.getByTestId('terminal-type').click();
    await page.getByRole('option', { name: 'Admin', exact: true }).click();
    await page.getByTestId('terminal-register').click();
    await expect(page.getByTestId('terminal-error')).toBeVisible();
    await expect(page.getByTestId('terminal-retry-after')).toBeVisible();
    await advanceClock(api, 16); // leave the limiter clean for whoever runs next
  });
});

test.describe('P1-MENU-06 daily sold-out reset (test clock)', { tag: '@api' }, () => {
  /** Minutes until the next business-day start (06:00 Asia/Colombo by default) plus 2 minutes, from the server's clock. */
  async function minutesPastNextDayStart(api: ApiClient, dayStart = '06:00'): Promise<number> {
    const now = (await resetClock(api)).now;
    const [h, m] = dayStart.split(':').map(Number);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now)).split(':').map(Number);
    const nowMin = parts[0] * 60 + parts[1];
    let delta = h * 60 + m - nowMin;
    if (delta <= 0) delta += 24 * 60;
    return delta + 2;
  }

  test('P1-MENU-06-T10 sold-out items become available again at the start of the next business day (daily reset on by default)', async ({ owner, apiAs }) => {
    const settings = await json<Schemas['MenuSettings']>(await owner.get(EPM.menuSettings));
    expect(settings.resetAvailabilityDaily).toBe(true);
    const sold = await createItem(owner);
    const stays = await createItem(owner);
    const cashier = await apiAs('cashier');
    await json(await cashier.put(EPM.availability(sold.id), { body: { available: false } }));
    await json(await cashier.put(EPM.availability(stays.id), { body: { available: true } }));
    const minutes = await minutesPastNextDayStart(owner);
    await advanceClock(owner, minutes - 5); // still before the next business day starts
    const midway = (await api_login(owner)).client;
    expect((await getItem(midway, sold.id)).available).toBe(false);
    await advanceClock(owner, 5);
    test.setTimeout(180_000);
    const after = (await api_login(owner)).client;
    // the reset runs from a scheduler once a minute: allow for the next tick
    await expect.poll(async () => (await getItem(after, sold.id)).available, { timeout: 100_000, intervals: [3_000] }).toBe(true);
    expect((await getItem(after, stays.id)).available).toBe(true);
  });

  test('P1-MENU-06-T11 with the daily reset switched off a sold-out item stays sold out across the business-day start', async ({ owner, apiAs }) => {
    test.setTimeout(180_000);
    const settings = await json<Schemas['MenuSettings']>(await owner.get(EPM.menuSettings));
    const off = await json<Schemas['MenuSettings']>(await owner.put(EPM.menuSettings, { body: { resetAvailabilityDaily: false, version: settings.version } }));
    try {
      const item = await createItem(owner);
      await json(await (await apiAs('cashier')).put(EPM.availability(item.id), { body: { available: false } }));
      await advanceClock(owner, await minutesPastNextDayStart(owner));
      await new Promise((r) => setTimeout(r, 70_000)); // let the once-a-minute scheduler tick at least once
      const later = (await api_login(owner)).client;
      expect((await getItem(later, item.id)).available).toBe(false);
    } finally {
      await resetClock(owner);
      const fresh = (await api_login(owner)).client;
      const cur = await json<Schemas['MenuSettings']>(await fresh.get(EPM.menuSettings));
      await json(await fresh.put(EPM.menuSettings, { body: { resetAvailabilityDaily: true, version: cur.version } }));
      expect(off.resetAvailabilityDaily).toBe(false);
    }
  });

  test('P1-MENU-06-T12 an item sold out after the business-day start stays sold out for the rest of that day', async ({ owner, apiAs }) => {
    test.setTimeout(180_000);
    const item = await createItem(owner);
    await advanceClock(owner, await minutesPastNextDayStart(owner) + 30); // 30 minutes into a new business day
    const cashier = (await api_login(owner, 'cashier')).client;
    await json(await cashier.put(EPM.availability(item.id), { body: { available: false } }));
    await advanceClock(owner, 6 * 60); // later the same business day
    await new Promise((r) => setTimeout(r, 70_000)); // a scheduler tick must not reset it again
    const later = (await api_login(owner)).client;
    expect((await getItem(later, item.id)).available).toBe(false);
  });

  test('P1-MENU-06-T13 changing the business-day start time moves the reset: a sold-out item is available after the new start, not before', async ({ owner, apiAs }) => {
    test.setTimeout(240_000);
    const bd = await json<Schemas['BusinessDaySettings']>(await owner.get(EP.settings.businessDay));
    const moved = await json<Schemas['BusinessDaySettings']>(await owner.put(EP.settings.businessDay, { body: { dayStartTime: '03:00', version: bd.version } }));
    const toNextStart = (nowIso: string, start: string) => {
      const [h, m] = start.split(':').map(Number);
      const [ch, cm] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(nowIso)).split(':').map(Number);
      let delta = h * 60 + m - (ch * 60 + cm);
      if (delta <= 0) delta += 24 * 60;
      return delta;
    };
    try {
      // 1. move two business days ahead so earlier tests' reset marker is in the past, and let one tick pass
      const t0 = (await resetClock(owner)).now;
      await advanceClock(owner, toNextStart(t0, '03:00') + 24 * 60 + 30);
      await new Promise((r) => setTimeout(r, 70_000));
      // 2. sell an item out now (business day D), then walk to just before the next start
      const o1 = (await api_login(owner)).client;
      const item = await createItem(o1);
      const cashier = (await api_login(owner, 'cashier')).client;
      await json(await cashier.put(EPM.availability(item.id), { body: { available: false } }));
      const now = (await advanceClock(owner, 1)).now;
      await advanceClock(owner, toNextStart(now, '03:00') - 6);
      await new Promise((r) => setTimeout(r, 70_000)); // a tick before the new start must not reset it
      expect((await getItem((await api_login(owner)).client, item.id)).available).toBe(false);
      // 3. pass the new start: the next tick resets it
      await advanceClock(owner, 8);
      const after = (await api_login(owner)).client;
      await expect.poll(async () => (await getItem(after, item.id)).available, { timeout: 100_000, intervals: [3_000] }).toBe(true);
    } finally {
      await resetClock(owner);
      const fresh = (await api_login(owner)).client;
      const cur = await json<Schemas['BusinessDaySettings']>(await fresh.get(EP.settings.businessDay));
      await json(await fresh.put(EP.settings.businessDay, { body: { dayStartTime: bd.dayStartTime, version: cur.version } }));
      expect(moved.dayStartTime).toBe('03:00');
    }
    void apiAs;
  });
});

test.describe('P1-IMP-01 import size and speed (alone: validation keeps the backend busy for minutes)', { tag: '@api' }, () => {
  const csvOf = (rows: string[]) => ['name,sort_order', ...rows, ''].join(String.fromCharCode(13, 10));
  const upload = async (c: ApiClient, content: string, dry = true) => {
    const res = await c.call('POST', EPM.importData('CATEGORIES'), { query: { dryRun: dry }, multipart: { file: { name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(content) } } });
    return { status: res.status(), report: (await res.json()) as Schemas['ImportReport'] };
  };
  const tag = () => uniqueName('big').replace(/-/g, '');

  test('P1-IMP-01-T12b a file with exactly 5000 rows (the documented limit) is accepted and validated within 60 seconds (dry run)', async ({ owner }) => {
    test.setTimeout(600_000);
    const t = tag();
    const started = Date.now();
    const ok = await upload(owner, csvOf(Array.from({ length: 5000 }, (_, i) => `BIG ${t} ${i},${i}`)));
    const seconds = Math.round((Date.now() - started) / 1000);
    test.info().annotations.push({ type: 'timing', description: `5000-row dry run: ${seconds} s` });
    expect(ok.report).toMatchObject({ ok: true, rowsRead: 5000, counts: { created: 5000 } }); // accepted: passes
    expect(seconds).toBeLessThan(60); // a typical reverse-proxy timeout: fails
  });
  test('P1-IMP-01-T12c a dry run of 5000 rows writes nothing; the real import of 5000 rows completes within 60 seconds and a re-import changes nothing', async ({ owner }) => {
    test.setTimeout(300_000);
    const content = csvOf(Array.from({ length: 5000 }, (_, i) => `BIG ${tag()} ${i},${i}`));
    const dry1 = await upload(owner, content, true);
    const dry2 = await upload(owner, content, true);
    expect(dry1.report.counts.created).toBe(5000);
    expect(dry2.report.counts.created).toBe(5000); // still 5000 new rows: the first dry run wrote nothing
    const started = Date.now();
    const real = await upload(owner, content, false);
    const seconds = Math.round((Date.now() - started) / 1000);
    test.info().annotations.push({ type: 'timing', description: `5000-row real import: ${seconds} s` });
    expect(real.report).toMatchObject({ ok: true, rowsRead: 5000, counts: { created: 5000 } });
    expect(seconds).toBeLessThan(60);
    const again = await upload(owner, content, false);
    expect(again.report.counts).toEqual({ created: 0, updated: 0, unchanged: 5000 });
  });
});

test.describe('P1-AUD-03 export limit (second backend with a low limit)', { tag: '@api' }, () => {
  const lowUrl = process.env.RMS_API_URL_LOW_EXPORT;
  test('P1-AUD-03-T12 an export of more rows than the configured maximum gets 422 EXPORT_TOO_LARGE; a narrower filter works', async ({ seedState, makeUser }) => {
    test.skip(!lowUrl, 'Set RMS_API_URL_LOW_EXPORT to a second backend instance started with RMS_AUDIT_EXPORT_MAX_ROWS=30 (default limit is 50,000 rows)');
    const t = seedState!.terminals.ADMIN!;
    const u = await makeUser({ role: 'cashier' });
    const ctx = await request.newContext({ baseURL: `${lowUrl!.replace(/\/+$/, '')}/` });
    try {
      const low = new ApiClient(ctx, undefined, t);
      const { client } = await low.loginAs(userFor('owner').username, passwordFor(userFor('owner')));
      const total = (await auditSearch(client, { size: 1 })).totalItems;
      expect(total).toBeGreaterThan(30);
      await expectProblem(await client.get(EP.auditExport), 422, 'EXPORT_TOO_LARGE');
      expect((await client.get(EP.auditExport, { query: { userId: u.id } })).status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });
});
