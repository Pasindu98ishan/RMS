/**
 * Annex A §2 "audit log with user, terminal and time" — terminal registration (P1-AUTH-04).
 * Contract: registerTerminal (security: [], x-auth INLINE_CREDENTIALS), listTerminals, getTerminal,
 * updateTerminal, deactivateTerminal; login needs X-Terminal-Id + deviceToken.
 * Tests that deliberately fail registrations (per-IP rate limit, 429) are in serial.spec.ts.
 */
import { test, expect } from '../fixtures/test';
import { passwordFor, userFor } from '../fixtures/seed';
import { LoginPage, TerminalSetupPage } from '../pages/shared';
import { type Schemas, expectProblem } from '../utils/api-client';
import { auditFor, json, registerTerminalAs, uniqueName } from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { SAMPLE_UUID } from '../utils/openapi';

const PROTECTED_ROUTES = ['/pos', '/admin', '/admin/users', '/kitchen'];
const ownerCreds = () => ({ username: userFor('owner').username, password: passwordFor(userFor('owner')) });

test.describe('P1-AUTH-04 unregistered device (UI)', () => {
  // Changed by ADR-008 (client decision #9, contract 0.3.0): the first screen is the login page on every device; an
  // unregistered device logs in as a personal session and reaches setup through the "Set up this device" link.
  for (const route of PROTECTED_ROUTES) {
    test(`P1-AUTH-04-T01 unregistered browser opening ${route} is sent to the login page (personal device, setup link)`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByTestId('login-username')).toBeVisible();
      await expect(page.getByTestId('login-device')).toContainText(/personal device/i);
      await expect(page.getByTestId('link-terminal-setup')).toBeVisible();
    });
  }

  test('P1-AUTH-04-T01b unregistered browser opening /login stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('P1-AUTH-04-T03 owner registers this device as Admin from /setup/terminal, then a user logs in', async ({ page, makeUser }) => {
    const mgr = await makeUser({ role: 'manager' });
    const setup = new TerminalSetupPage(page);
    const name = uniqueName('QA Admin PC');
    await setup.goto();
    await setup.register(ownerCreds(), name, 'Admin');
    await expect(setup.registered).toBeVisible();
    await expect(setup.current).toContainText(name);
    await setup.gotoLogin.click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-device')).toContainText(name);
    const login = new LoginPage(page);
    await login.login(mgr.username, mgr.password);
    await expect(page).toHaveURL(/\/admin$/);
  });

  for (const [label, home] of [
    ['Cashier POS', /\/pos$/],
    ['Reception POS', /\/pos$/],
  ] as const) {
    test(`P1-AUTH-04-T03c registering the device as "${label}" and logging in lands on the POS`, async ({ page, makeUser }) => {
      const u = await makeUser({ role: 'cashier' });
      const setup = new TerminalSetupPage(page);
      await setup.goto();
      await setup.register(ownerCreds(), uniqueName(`QA ${label}`), label);
      await setup.gotoLogin.click();
      await new LoginPage(page).login(u.username, u.password);
      await expect(page).toHaveURL(home);
    });
  }

  test('P1-AUTH-04-T04b a user without TERMINAL_MANAGE is refused on the setup screen with a clear message', async ({ page, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const setup = new TerminalSetupPage(page);
    await setup.goto();
    await setup.register({ username: u.username, password: u.password }, uniqueName('QA denied'), 'Admin');
    await expect(setup.error).toBeVisible();
    await expect(setup.registered).toBeHidden();
  });

  test('P1-AUTH-04-T09 terminals screen lists name, type, status; owner renames a terminal (audited)', async ({ uiAs, owner, api }) => {
    const { terminal } = await registerTerminalAs(api, ownerCreds(), uniqueName('QA rename'), 'ADMIN');
    const page = await uiAs('owner');
    await page.goto('/admin/terminals');
    const row = page.getByTestId(`terminal-row-${terminal.name}`);
    await expect(row).toBeVisible();
    await expect(page.getByTestId(`terminal-status-${terminal.name}`)).toHaveText('Active');
    await expect(row).toContainText('Admin');
    const newName = uniqueName('QA renamed');
    await page.getByTestId(`terminal-edit-${terminal.name}`).click();
    await page.getByTestId('terminal-edit-name').fill(newName);
    await page.getByTestId('terminal-edit-save').click();
    await expect(page.getByTestId(`terminal-row-${newName}`)).toBeVisible();
    const entries = await auditFor(owner, terminal.id, { action: 'UPDATE', entityType: 'TERMINAL' });
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries[0].before)).toContain(terminal.name);
    expect(JSON.stringify(entries[0].after)).toContain(newName);
  });

  test('P1-AUTH-04-T09b owner deactivates a terminal from the terminals screen', async ({ uiAs, api }) => {
    const { terminal } = await registerTerminalAs(api, ownerCreds(), uniqueName('QA deact UI'), 'ADMIN');
    const page = await uiAs('owner');
    await page.goto('/admin/terminals');
    await page.getByTestId(`terminal-deactivate-${terminal.name}`).click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByTestId(`terminal-status-${terminal.name}`)).toHaveText('Deactivated');
    await expect(page.getByTestId(`terminal-edit-${terminal.name}`)).toHaveCount(0);
  });
});

test.describe('P1-AUTH-04 registration API', { tag: '@api' }, () => {
  test('P1-AUTH-04-T03b registerTerminal with owner credentials returns the terminal and a one-time device token (>= 32 chars)', async ({ api }) => {
    const res = await api.registerTerminal(ownerCreds(), { name: uniqueName('QA reg'), type: 'CASHIER_POS' });
    expect(res.status()).toBe(201);
    const reg = (await res.json()) as Schemas['TerminalRegistration'];
    expect(reg.deviceToken.length).toBeGreaterThanOrEqual(32);
    expect(reg.terminal).toMatchObject({ type: 'CASHIER_POS', active: true });
  });

  test('P1-AUTH-04-T04 valid credentials without TERMINAL_MANAGE get 403 FORBIDDEN', async ({ api, makeUser }) => {
    const u = await makeUser({ role: 'manager' });
    await expectProblem(await api.registerTerminal({ username: u.username, password: u.password }, { name: uniqueName('QA deny'), type: 'ADMIN' }), 403, 'FORBIDDEN');
  });

  test('P1-AUTH-04-T14 duplicate terminal name (case-insensitive) gets 409 TERMINAL_NAME_TAKEN', async ({ api }) => {
    const name = uniqueName('QA dup');
    await registerTerminalAs(api, ownerCreds(), name, 'ADMIN');
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: name.toUpperCase(), type: 'ADMIN' }), 409, 'TERMINAL_NAME_TAKEN');
  });

  test('P1-AUTH-04-T17 KITCHEN without kitchenStationId and a non-KITCHEN type with a station are rejected with 422', async ({ api }) => {
    const p1 = await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA k'), type: 'KITCHEN' }), 422);
    expect((p1.fieldErrors ?? []).map((f) => f.field)).toContain('kitchenStationId');
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA k'), type: 'ADMIN', kitchenStationId: SAMPLE_UUID }), 422);
  });

  test('P1-AUTH-04-T18 terminal name is required and at most 50 characters', async ({ api }) => {
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: '', type: 'ADMIN' }), 422);
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: 'x'.repeat(51), type: 'ADMIN' }), 422);
  });
});

test.describe('P1-AUTH-04 terminal id on every request', { tag: '@api' }, () => {
  // Contract v0.3.0 (ADR-008): no header + no deviceToken is now a personal login (auth-personal.spec.ts); a deviceToken
  // without the header is 422 (field deviceToken).
  test('P1-AUTH-04-T02 login with a deviceToken but no X-Terminal-Id is rejected with 422 (field deviceToken)', async ({ api, terminal }) => {
    const u = userFor('cashier');
    const p = await expectProblem(await api.withTerminal(undefined).login(u.username, passwordFor(u), terminal('CASHIER_POS').deviceToken), 422);
    expect(JSON.stringify(p)).toContain('deviceToken');
  });

  test('P1-AUTH-04-T05 unknown terminal id gets 403 TERMINAL_NOT_REGISTERED', async ({ api }) => {
    const u = userFor('cashier');
    await expectProblem(await api.withTerminal({ terminalId: SAMPLE_UUID, deviceToken: 'x'.repeat(32) }).login(u.username, passwordFor(u)), 403, 'TERMINAL_NOT_REGISTERED');
  });

  test('P1-AUTH-04-T05b registered terminal id with a wrong device token is rejected with 403', async ({ api, terminal }) => {
    const u = userFor('cashier');
    const t = terminal('CASHIER_POS');
    await expectProblem(await api.withTerminal(t).login(u.username, passwordFor(u), 'x'.repeat(43)), 403, 'TERMINAL_NOT_REGISTERED');
  });

  test('P1-AUTH-04-T05c malformed X-Terminal-Id is a 400', async ({ api }) => {
    const res = await api.call('POST', EP.login, { headers: { 'X-Terminal-Id': 'nope' }, body: { username: 'a', password: 'b', deviceToken: 'c' } });
    await expectProblem(res, 400, 'MALFORMED_REQUEST');
  });

  test('P1-AUTH-04-T06 deactivated terminal: login gets 403 TERMINAL_INACTIVE and its refresh tokens get 401', async ({ api, owner, makeUser }) => {
    const { identity, terminal } = await registerTerminalAs(api, ownerCreds(), uniqueName('QA inactive'), 'CASHIER_POS');
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(identity);
    const { session } = await dev.loginAs(u.username, u.password);
    await json(await owner.post(EP.deactivateTerminal(terminal.id)));
    await expectProblem(await dev.login(u.username, u.password), 403, 'TERMINAL_INACTIVE');
    await expectProblem(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }), 401, 'REFRESH_TOKEN_INVALID');
  });

  test('P1-AUTH-04-T11 a token used with another terminal\'s X-Terminal-Id gets 403 TERMINAL_MISMATCH', async ({ apiAs, terminal }) => {
    const cashier = await apiAs('cashier', { terminal: 'CASHIER_POS' });
    await expectProblem(await cashier.withTerminal(terminal('RECEPTION_POS')).get(EP.me), 403, 'TERMINAL_MISMATCH');
    await expectProblem(await cashier.withTerminal(undefined).get(EP.me), 403, 'TERMINAL_MISMATCH');
  });

  test('P1-AUTH-04-T07 login and terminal changes are audited with the terminal of the device', async ({ api, owner, makeUser, terminal }) => {
    const u = await makeUser({ role: 'cashier' });
    await api.withTerminal(terminal('RECEPTION_POS')).loginAs(u.username, u.password);
    const entries = await auditFor(owner, u.id, { action: 'LOGIN' });
    expect(entries.length).toBe(1);
    expect(entries[0].terminal?.id).toBe(terminal('RECEPTION_POS').terminalId);
    expect(entries[0].user?.id).toBe(u.id);
  });

  test('P1-AUTH-04-T15 a deactivated terminal cannot be reactivated and is listed with active=false only', async ({ api, owner }) => {
    const { terminal } = await registerTerminalAs(api, ownerCreds(), uniqueName('QA gone'), 'ADMIN');
    await json(await owner.post(EP.deactivateTerminal(terminal.id)));
    const inactive = await json<Schemas['TerminalSummary'][]>(await owner.get(EP.terminals, { query: { active: false } }));
    expect(inactive.map((t) => t.id)).toContain(terminal.id);
    const active = await json<Schemas['TerminalSummary'][]>(await owner.get(EP.terminals, { query: { active: true } }));
    expect(active.map((t) => t.id)).not.toContain(terminal.id);
    // Deactivating again is a no-op (200); there is no reactivate operation in the contract.
    await json(await owner.post(EP.deactivateTerminal(terminal.id)));
  });

  test('P1-AUTH-04-T19 listTerminals never exposes a device token or its hash', async ({ owner }) => {
    const text = await (await owner.get(EP.terminals)).text();
    expect(text).not.toMatch(/deviceToken|tokenHash|device_token/i);
  });

  test('P1-AUTH-04-T10 orders and payments store the terminal id (M1.2 / M1.4)', async () => {
    test.fixme(true, 'No order or payment endpoint exists before M1.2 / M1.4');
  });
});
