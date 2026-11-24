/**
 * Personal login without a terminal (client decision #9, ADR-008, contract 0.3.0): P1-AUTH-04 (amended), P1-AUTH-01
 * (lockout), P1-AUTH-02 (refresh), P1-AUD-01 / P1-AUTH-04 (audit clientInfo). API level.
 *
 * Two kinds of session:
 *  - TERMINAL: X-Terminal-Id header + deviceToken (unchanged from ADR-006);
 *  - PERSONAL: neither; only for users holding LOGIN_ANY_DEVICE (seeded: owner, manager, rider, inventory, HR).
 * The personal idle timeout (idleTimeoutPersonalMinutes) is in settings.spec.ts; the personal-session permission
 * matrix in permission-matrix.spec.ts; the browser flow in auth-personal-ui.spec.ts.
 */
import { test, expect } from '../fixtures/test';
import { UNKNOWN_USER, passwordFor, userFor } from '../fixtures/seed';
import { type AuthSession, type Schemas, expectProblem } from '../utils/api-client';
import { auditFor, auditSearch, createRole, createUser, getRole, json } from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { EPM } from '../utils/menu-api';
import { PERSONAL_LOGIN_ROLES, SEEDED_ROLES } from '../utils/role-grants';

const WRONG = 'Wrong-password-9';

test.describe('P1-AUTH-04 login with and without a terminal, per seeded role', { tag: '@api' }, () => {
  for (const role of SEEDED_ROLES) {
    const personal = PERSONAL_LOGIN_ROLES.includes(role);

    test(`P1-AUTH-04-T40 [${role}] login on its registered terminal is a TERMINAL session with the terminal`, async ({ api, terminal, seedState }) => {
      const u = userFor(role);
      const key = seedState?.terminals[u.terminal] ? u.terminal : 'CASHIER_POS';
      const s = await json<AuthSession>(await api.withTerminal(terminal(key)).login(u.username, passwordFor(u)));
      expect(s.sessionType).toBe('TERMINAL');
      expect(s.terminal?.id).toBe(terminal(key).terminalId);
    });

    test(`P1-AUTH-04-T41 [${role}] login without a terminal -> ${personal ? '200 PERSONAL session, no terminal' : '403 TERMINAL_REQUIRED_FOR_USER'}`, async ({ api }) => {
      const u = userFor(role);
      const res = await api.loginPersonal(u.username, passwordFor(u));
      if (personal) {
        const s = await json<AuthSession>(res);
        expect(s.sessionType).toBe('PERSONAL');
        expect(s.terminal).toBeUndefined();
        expect(s.permissions).toContain('LOGIN_ANY_DEVICE');
        expect(s.idleTimeoutMinutes).toEqual(expect.any(Number)); // value checked in settings.spec.ts (P1-AUTH-03-T20)
      } else {
        const p = await expectProblem(res, 403, 'TERMINAL_REQUIRED_FOR_USER');
        expect(JSON.stringify(p)).not.toContain('accessToken');
      }
    });
  }

  test('P1-AUTH-04-T42 a custom role holding LOGIN_ANY_DEVICE may log in without a terminal; the same role without it may not', async ({ owner, api }) => {
    const withIt = await createUser(owner, { roleIds: [(await createRole(owner, ['LOGIN_ANY_DEVICE', 'ORDER_VIEW'])).id] });
    const without = await createUser(owner, { roleIds: [(await createRole(owner, ['ORDER_VIEW'])).id] });
    expect((await json<AuthSession>(await api.loginPersonal(withIt.username, withIt.password))).sessionType).toBe('PERSONAL');
    await expectProblem(await api.loginPersonal(without.username, without.password), 403, 'TERMINAL_REQUIRED_FOR_USER');
  });
});

test.describe('P1-AUTH-04 request shape', { tag: '@api' }, () => {
  test('P1-AUTH-04-T43 X-Terminal-Id without deviceToken is 422 (field deviceToken)', async ({ api, terminal }) => {
    const m = userFor('manager');
    const p = await expectProblem(await api.withTerminal(terminal('ADMIN')).login(m.username, passwordFor(m), null), 422);
    expect(JSON.stringify(p)).toContain('deviceToken');
  });

  test('P1-AUTH-04-T44 deviceToken without X-Terminal-Id is 422 (field deviceToken), even for a user allowed a personal login', async ({ api, terminal }) => {
    const m = userFor('manager');
    const p = await expectProblem(await api.withTerminal(undefined).login(m.username, passwordFor(m), terminal('ADMIN').deviceToken), 422);
    expect(JSON.stringify(p)).toContain('deviceToken');
  });

  test('P1-AUTH-04-T45 unknown user or wrong password without a terminal is 401 INVALID_CREDENTIALS (not 403), for any role', async ({ api, makeUser }) => {
    await expectProblem(await api.loginPersonal(UNKNOWN_USER.username, UNKNOWN_USER.password), 401, 'INVALID_CREDENTIALS');
    for (const role of ['cashier', 'manager'] as const) {
      const u = await makeUser({ role });
      await expectProblem(await api.loginPersonal(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    }
  });
});

test.describe('P1-AUTH-01 lockout and personal login', { tag: '@api' }, () => {
  test('P1-AUTH-01-T40 a refused personal login with the right password (403 TERMINAL_REQUIRED_FOR_USER) does not count towards the lock', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    for (let i = 0; i < 7; i++) await expectProblem(await api.loginPersonal(u.username, u.password), 403, 'TERMINAL_REQUIRED_FOR_USER');
    expect((await api.withTerminal(terminal('CASHIER_POS')).login(u.username, u.password)).status()).toBe(200);
  });

  test('P1-AUTH-01-T43 a refused personal login with the right password resets the failed-attempt counter (Q39: lead 2026-11-24)', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 4; i++) await expectProblem(await dev.login(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    await expectProblem(await api.loginPersonal(u.username, u.password), 403, 'TERMINAL_REQUIRED_FOR_USER');
    for (let i = 0; i < 4; i++) await expectProblem(await dev.login(u.username, WRONG), 401, 'INVALID_CREDENTIALS'); // 8 wrong in all, no lock
    expect((await dev.login(u.username, u.password)).status()).toBe(200);
  });

  test('P1-AUTH-01-T41 wrong passwords without a terminal count: the 5th locks the account (423), also for a terminal login', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    for (let i = 1; i <= 4; i++) await expectProblem(await api.loginPersonal(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    await expectProblem(await api.loginPersonal(u.username, WRONG), 423, 'ACCOUNT_LOCKED');
    await expectProblem(await api.withTerminal(terminal('CASHIER_POS')).login(u.username, u.password), 423, 'ACCOUNT_LOCKED');
  });

  test('P1-AUTH-01-T42 wrong passwords on a terminal and without one add up for a user allowed personal login', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'manager' });
    const dev = api.withTerminal(terminal('ADMIN'));
    for (let i = 0; i < 2; i++) await expectProblem(await dev.login(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    for (let i = 0; i < 2; i++) await expectProblem(await api.loginPersonal(u.username, WRONG), 401, 'INVALID_CREDENTIALS');
    await expectProblem(await dev.login(u.username, WRONG), 423, 'ACCOUNT_LOCKED');
    await expectProblem(await api.loginPersonal(u.username, u.password), 423, 'ACCOUNT_LOCKED');
  });
});

test.describe('P1-AUTH-04 sessionType and the X-Terminal-Id header', { tag: '@api' }, () => {
  test('P1-AUTH-04-T46 GET /auth/me reports sessionType PERSONAL and no terminal in a personal session, TERMINAL and the terminal in a terminal session', async ({ apiPersonal, apiAs, terminal }) => {
    const p = await json<Schemas['CurrentUserProfile']>(await (await apiPersonal('manager')).get(EP.me));
    expect(p.sessionType).toBe('PERSONAL');
    expect(p.terminal).toBeUndefined();
    const t = await json<Schemas['CurrentUserProfile']>(await (await apiAs('manager', { terminal: 'ADMIN' })).get(EP.me));
    expect(t.sessionType).toBe('TERMINAL');
    expect(t.terminal?.id).toBe(terminal('ADMIN').terminalId);
  });

  test('P1-AUTH-04-T47 in a personal session any X-Terminal-Id header is refused with 403 TERMINAL_MISMATCH', async ({ apiPersonal, terminal }) => {
    const c = await apiPersonal('owner');
    expect((await c.get(EP.me)).status()).toBe(200);
    await expectProblem(await c.withTerminal(terminal('ADMIN')).get(EP.me), 403, 'TERMINAL_MISMATCH');
    await expectProblem(await c.withTerminal(terminal('CASHIER_POS')).get(EP.users), 403, 'TERMINAL_MISMATCH');
  });

  test('P1-AUTH-04-T48 in a terminal session the header must be present and match (403 TERMINAL_MISMATCH otherwise)', async ({ apiAs, terminal }) => {
    const c = await apiAs('owner', { terminal: 'ADMIN' });
    expect((await c.get(EP.me)).status()).toBe(200);
    await expectProblem(await c.withTerminal(undefined).get(EP.me), 403, 'TERMINAL_MISMATCH');
    await expectProblem(await c.withTerminal(terminal('CASHIER_POS')).get(EP.me), 403, 'TERMINAL_MISMATCH');
  });

  test('P1-AUTH-04-T49 a personal-session token works on admin, menu and settings operations (no operation is x-terminal: REQUIRED before M1.2)', async ({ apiPersonal }) => {
    const o = await apiPersonal('owner');
    for (const path of [EP.users, EP.roles, EP.terminals, EP.auditLog, EP.settings.idleTimeouts, EPM.items, EPM.stations, EPM.tables]) {
      expect((await o.get(path)).status(), path).toBe(200);
    }
  });
});

test.describe('P1-AUTH-02 refresh by session kind', { tag: '@api' }, () => {
  test('P1-AUTH-04-T50 a personal session refreshes without a header and stays PERSONAL', async ({ api }) => {
    const m = userFor('manager');
    const s = await json<AuthSession>(await api.loginPersonal(m.username, passwordFor(m)));
    const next = await json<AuthSession>(await api.withTerminal(undefined).post(EP.refresh, { body: { refreshToken: s.refreshToken } }));
    expect(next.sessionType).toBe('PERSONAL');
    expect(next.terminal).toBeUndefined();
    expect(next.refreshToken).not.toBe(s.refreshToken);
  });

  test('P1-AUTH-04-T51 refreshing a personal session with an X-Terminal-Id header is 401 REFRESH_TOKEN_INVALID and does not revoke the token (Q41)', async ({ api, terminal }) => {
    const m = userFor('manager');
    const s = await json<AuthSession>(await api.loginPersonal(m.username, passwordFor(m)));
    await expectProblem(await api.withTerminal(terminal('ADMIN')).post(EP.refresh, { body: { refreshToken: s.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
    const ok = await json<AuthSession>(await api.withTerminal(undefined).post(EP.refresh, { body: { refreshToken: s.refreshToken } }));
    expect(ok.sessionType).toBe('PERSONAL');
  });

  test('P1-AUTH-04-T52 refreshing a terminal session without the header, or with another terminal, is 401 REFRESH_TOKEN_INVALID', async ({ api, terminal }) => {
    const m = userFor('manager');
    const a = await json<AuthSession>(await api.withTerminal(terminal('ADMIN')).login(m.username, passwordFor(m)));
    await expectProblem(await api.withTerminal(undefined).post(EP.refresh, { body: { refreshToken: a.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
    // Q41: a header mismatch does not revoke the token; the right header still refreshes it
    expect((await json<AuthSession>(await api.withTerminal(terminal('ADMIN')).post(EP.refresh, { body: { refreshToken: a.refreshToken } }))).sessionType).toBe('TERMINAL');
    const b = await json<AuthSession>(await api.withTerminal(terminal('ADMIN')).login(m.username, passwordFor(m)));
    await expectProblem(await api.withTerminal(terminal('CASHIER_POS')).post(EP.refresh, { body: { refreshToken: b.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
    const c = await json<AuthSession>(await api.withTerminal(terminal('ADMIN')).login(m.username, passwordFor(m)));
    expect((await json<AuthSession>(await api.withTerminal(terminal('ADMIN')).post(EP.refresh, { body: { refreshToken: c.refreshToken } }))).sessionType).toBe('TERMINAL');
  });

  test('P1-AUTH-04-T53 after LOGIN_ANY_DEVICE is removed from the role, refreshing a personal session is 403 TERMINAL_REQUIRED_FOR_USER and the session ends; a terminal session still refreshes', async ({ owner, api, terminal }) => {
    const role = await createRole(owner, ['LOGIN_ANY_DEVICE', 'ORDER_VIEW']);
    const u = await createUser(owner, { roleIds: [role.id] });
    const personal = await json<AuthSession>(await api.loginPersonal(u.username, u.password));
    const onTerminal = await json<AuthSession>(await api.withTerminal(terminal('CASHIER_POS')).login(u.username, u.password));
    const r = await getRole(owner, role.id);
    await json(await owner.put(EP.role(role.id), { body: { name: r.name, permissionCodes: ['ORDER_VIEW'], version: r.version } }));

    await expectProblem(await api.withTerminal(undefined).post(EP.refresh, { body: { refreshToken: personal.refreshToken } }), 403, 'TERMINAL_REQUIRED_FOR_USER');
    // Q40 (lead 2026-11-24): the refresh token is revoked; the access token stays valid until it expires (<= 15 min)
    await expectProblem(await api.withTerminal(undefined).post(EP.refresh, { body: { refreshToken: personal.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
    expect((await api.withTerminal(undefined).withToken(personal.accessToken).get(EP.me)).status()).toBe(200);
    const t = await json<AuthSession>(await api.withTerminal(terminal('CASHIER_POS')).post(EP.refresh, { body: { refreshToken: onTerminal.refreshToken } }));
    expect(t.sessionType).toBe('TERMINAL');
    await expectProblem(await api.loginPersonal(u.username, u.password), 403, 'TERMINAL_REQUIRED_FOR_USER');
  });
});

test.describe('P1-AUD-01 / P1-AUTH-04 audit clientInfo and terminal by session kind', { tag: '@api' }, () => {
  test('P1-AUTH-04-T54 a personal LOGIN audit row has no terminal and a clientInfo with the caller\'s User-Agent; a terminal LOGIN row has both', async ({ owner, api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'manager' });
    const ua = `QA-Agent/${Date.now()} (personal)`;
    const res = await api.withTerminal(undefined).post(EP.login, { body: { username: u.username, password: u.password }, headers: { 'User-Agent': ua } });
    expect(res.status(), await res.text()).toBe(200);
    await json(await api.withTerminal(terminal('ADMIN')).login(u.username, u.password));
    const rows = await auditFor(owner, u.id, { action: 'LOGIN' });
    const p = rows.find((r) => !r.terminal);
    const t = rows.find((r) => r.terminal);
    expect(p, JSON.stringify(rows)).toBeDefined();
    expect(p!.clientInfo ?? '').toContain('QA-Agent');
    expect(p!.clientInfo!.length).toBeLessThanOrEqual(300);
    expect(t!.terminal!.id).toBe(terminal('ADMIN').terminalId);
    expect(t!.clientInfo).toEqual(expect.any(String));
  });

  test('P1-AUTH-04-T55 a refused personal login is LOGIN_FAILED with reason TERMINAL_REQUIRED_FOR_USER, no terminal and a clientInfo', async ({ owner, api, makeUser }) => {
    const u = await makeUser({ role: 'kitchen' });
    await expectProblem(await api.loginPersonal(u.username, u.password), 403, 'TERMINAL_REQUIRED_FOR_USER');
    const rows = await auditFor(owner, u.id, { action: 'LOGIN_FAILED' });
    const row = rows.find((r) => JSON.stringify(r).includes('TERMINAL_REQUIRED_FOR_USER'));
    expect(row, JSON.stringify(rows)).toBeDefined();
    expect(row!.terminal).toBeUndefined();
    expect(row!.clientInfo).toEqual(expect.any(String));
    expect(JSON.stringify(row)).not.toContain(u.password);
  });

  test('P1-AUTH-04-T56 an admin change made in a personal session is audited with the user, no terminal and a clientInfo', async ({ owner, apiPersonal }) => {
    const o = await apiPersonal('owner');
    const created = await createUser(o, { role: 'cashier' });
    const me = await json<Schemas['CurrentUserProfile']>(await o.get(EP.me));
    const rows = (await auditSearch(owner, { entityId: created.id })).items.filter((r) => r.user?.id === me.user.id);
    expect(rows.length, 'audit row for the user created in a personal session').toBeGreaterThan(0);
    expect(rows[0].terminal).toBeUndefined();
    expect(rows[0].clientInfo).toEqual(expect.any(String));
  });
});
