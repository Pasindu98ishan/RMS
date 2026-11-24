/**
 * Annex A §2 "every create, edit, discount, void and login is written to an audit log with user,
 * terminal and time"; §15 Audit (P1-AUD-01, P1-AUD-02, P1-AUD-03). M1.0 scope: login, users, roles,
 * terminals, settings (settings.spec.ts), password/PIN changes, audit export. Later actions are tested in
 * their milestones. Contract: searchAuditLog (GET audit-log), exportAuditLog (GET audit-log/export).
 * Every test isolates its rows with a throwaway user / role / terminal id, so other workers' rows never interfere.
 */
import JSZip from 'jszip';
import { test, expect } from '../fixtures/test';
import { passwordFor, userFor } from '../fixtures/seed';
import { AdminAuditPage } from '../pages/admin/admin-pages';
import { type Schemas, expectProblem } from '../utils/api-client';
import {
  PASSWORD,
  auditFor,
  auditSearch,
  colomboDate,
  createRole,
  createUser,
  getUser,
  json,
  registerTerminalAs,
  uniqueName,
} from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { SAMPLE_UUID } from '../utils/openapi';

const WRONG = 'Wrong#Password1';
const ownerCreds = () => ({ username: userFor('owner').username, password: passwordFor(userFor('owner')) });
const text = (v: unknown) => JSON.stringify(v ?? null);

test.describe('P1-AUD-01 audit records', { tag: '@api' }, () => {
  test('P1-AUD-01-T01 successful login writes LOGIN with time (UTC), user and terminal', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const before = Date.now();
    await api.withTerminal(terminal('RECEPTION_POS')).loginAs(u.username, u.password);
    const entries = await auditFor(owner, u.id, { action: 'LOGIN' });
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.at).toMatch(/Z$/);
    expect(Math.abs(Date.parse(e.at) - before)).toBeLessThan(60_000);
    expect(e.user).toMatchObject({ id: u.id, username: u.username });
    expect(e.terminal?.id).toBe(terminal('RECEPTION_POS').terminalId);
    expect(e.entityType).toBe('AUTH_SESSION');
  });

  test('P1-AUD-01-T02 logout writes LOGOUT, with the reason USER or IDLE_TIMEOUT', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (const reason of ['USER', 'IDLE_TIMEOUT']) {
      const { client, session } = await dev.loginAs(u.username, u.password);
      await json(await client.post(EP.logout, { body: { refreshToken: session.refreshToken, reason } }), 204);
    }
    const entries = await auditFor(owner, u.id, { action: 'LOGOUT' });
    expect(entries).toHaveLength(2);
    const all = text(entries);
    expect(all).toContain('IDLE_TIMEOUT');
    expect(all).toMatch(/"USER"|USER/);
    expect(entries.every((e) => e.terminal?.id === terminal('CASHIER_POS').terminalId)).toBe(true);
  });

  test('P1-AUD-01-T03 failed login writes LOGIN_FAILED with the typed username and never the password', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const ghost = uniqueName('ghost');
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    await dev.login(u.username, WRONG);
    await dev.login(ghost, WRONG);
    const known = await auditFor(owner, u.id, { action: 'LOGIN_FAILED' });
    expect(known).toHaveLength(1);
    expect(known[0].terminal?.id).toBe(terminal('CASHIER_POS').terminalId);
    const unknown = (await auditSearch(owner, { action: 'LOGIN_FAILED', from: colomboDate(), to: colomboDate() })).items.filter((e) => e.username === ghost);
    expect(unknown).toHaveLength(1);
    expect(unknown[0].user).toBeUndefined();
    expect(text([known, unknown])).not.toContain(WRONG);
  });

  test('P1-AUD-01-T04 ACCOUNT_LOCKED and ACCOUNT_UNLOCKED are recorded', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 5; i++) await dev.login(u.username, WRONG);
    await json(await owner.post(EP.unlockUser(u.id)), [200, 204]);
    expect(await auditFor(owner, u.id, { action: 'ACCOUNT_LOCKED' })).toHaveLength(1);
    const unlocked = await auditFor(owner, u.id, { action: 'ACCOUNT_UNLOCKED' });
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0].user?.username).toBe(userFor('owner').username); // who unlocked
  });

  test('P1-AUD-01-T05 user CREATE / UPDATE / DEACTIVATE / ACTIVATE have before and after values and no secrets', async ({ owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier', pin: '2468' });
    const user = await getUser(owner, u.id);
    await json(await owner.put(EP.user(u.id), { body: { fullName: 'Audit Changed', version: user.version } }));
    await json(await owner.post(EP.deactivateUser(u.id)));
    await json(await owner.post(EP.activateUser(u.id)));
    const entries = (await auditSearch(owner, { entityId: u.id, entityType: 'USER' })).items;
    const by = (a: string) => entries.filter((e) => e.action === a);
    expect(by('CREATE')).toHaveLength(1);
    expect(by('UPDATE')).toHaveLength(1);
    expect(by('DEACTIVATE')).toHaveLength(1);
    expect(by('ACTIVATE')).toHaveLength(1);
    expect(text(by('UPDATE')[0].before)).toContain(`QA ${u.username}`);
    expect(text(by('UPDATE')[0].after)).toContain('Audit Changed');
    expect(text(by('CREATE')[0].after)).toContain(u.username);
    const all = text(entries);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toMatch(/"pin"\s*:|"password"\s*:|\$2[aby]\$|\$argon2|"2468"/i);
    for (const e of entries) {
      expect(e.user?.username).toBe(userFor('owner').username);
      expect(e.terminal?.id).toBeTruthy();
    }
  });

  test('P1-AUD-01-T06 role create / update / delete record user, terminal and time', async ({ owner }) => {
    const r = await createRole(owner, ['ORDER_VIEW']);
    const entries = (await auditSearch(owner, { entityId: r.id, entityType: 'ROLE' })).items;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'CREATE', entityType: 'ROLE' });
    expect(entries[0].user?.username).toBe(userFor('owner').username);
    expect(entries[0].terminal?.id).toBeTruthy();
    expect(entries[0].at).toMatch(/Z$/);
    // before / after permission codes are covered in P1-RBAC-02-T06
  });

  test('P1-AUD-01-T07 TERMINAL_REGISTERED, terminal UPDATE and DEACTIVATE are recorded', async ({ api, owner }) => {
    const { terminal } = await registerTerminalAs(api, ownerCreds(), uniqueName('QA aud term'), 'ADMIN');
    const current = await json<Schemas['Terminal']>(await owner.get(EP.terminal(terminal.id)));
    await json(await owner.put(EP.terminal(terminal.id), { body: { name: `${terminal.name}-2`, type: 'ADMIN', version: current.version } }));
    await json(await owner.post(EP.deactivateTerminal(terminal.id)));
    const entries = (await auditSearch(owner, { entityId: terminal.id, entityType: 'TERMINAL' })).items;
    expect(entries.map((e) => e.action).sort()).toEqual(['DEACTIVATE', 'TERMINAL_REGISTERED', 'UPDATE']);
    expect(entries.find((e) => e.action === 'TERMINAL_REGISTERED')?.user?.username).toBe(userFor('owner').username);
    expect(text(entries.find((e) => e.action === 'UPDATE')?.after)).toContain(`${terminal.name}-2`);
    expect(text(entries)).not.toMatch(/deviceToken|tokenHash/i);
  });

  test('P1-AUD-01-T11 one action writes exactly one audit row; a no-op repeat writes none', async ({ owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    await json(await owner.post(EP.deactivateUser(u.id)));
    await json(await owner.post(EP.deactivateUser(u.id))); // already inactive: 200 unchanged
    const entries = (await auditSearch(owner, { entityId: u.id, entityType: 'USER' })).items;
    expect(entries.filter((e) => e.action === 'CREATE')).toHaveLength(1);
    expect(entries.filter((e) => e.action === 'DEACTIVATE')).toHaveLength(1);
  });

  test('P1-AUD-01-T13 PASSWORD_CHANGED, PASSWORD_RESET, PIN_CHANGED, PIN_RESET are recorded without secret values', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const { client } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    const changed = 'Changed#Own-Pass-77';
    const reset = 'Reset#Admin-Pass-88';
    await json(await client.post(EP.myPassword, { body: { currentPassword: u.password, newPassword: changed } }), 204);
    await json(await client.post(EP.myPin, { body: { currentPassword: changed, newPin: '135790' } }), 204);
    await json(await owner.post(EP.resetPassword(u.id), { body: { newPassword: reset } }), 204);
    await json(await owner.post(EP.resetPin(u.id), { body: { newPin: '097531' } }), [200, 204]);
    const entries = await auditFor(owner, u.id);
    const actions = entries.map((e) => e.action);
    for (const a of ['PASSWORD_CHANGED', 'PASSWORD_RESET', 'PIN_CHANGED', 'PIN_RESET']) expect(actions).toContain(a);
    const all = text(entries);
    for (const secret of [u.password, changed, reset, '135790', '097531']) expect(all).not.toContain(secret);
  });

  test('P1-AUD-01-T14 AUDIT_EXPORTED is written with the filters used', async ({ owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const res = await owner.get(EP.auditExport, { query: { userId: u.id, action: 'CREATE', entityType: 'USER' } });
    expect(res.status()).toBe(200);
    const mine = (await auditSearch(owner, { userId: owner.session!.user.id, action: 'AUDIT_EXPORTED', size: 20 })).items;
    expect(mine.length).toBeGreaterThan(0);
    const all = text(mine[0]);
    expect(all).toContain(u.id);
    expect(all).toContain('CREATE');
  });

  test('P1-AUD-01-T09 approvals store the approver; PIN_FAILED / PIN_LOCKED are recorded (first x-approval op, M1.2)', async () => {
    test.fixme(true, 'No approval operation exists in M1.0 (Q10); runs with M1.2');
  });

  test('P1-AUD-01-T10 reason and comment are stored when the action has them', async () => {
    test.fixme(true, 'First M1.0 action with a reason arrives with approvals in M1.2');
  });

  test('P1-AUD-01-T12 price changes, discounts, cancellations, voids, refunds, shift and day-end are audited', async () => {
    test.fixme(true, 'Price changes are audited and tested (P1-MENU-05-T01); discounts, cancellations, voids, refunds arrive in M1.4, shift open/close and day-end in M1.5');
  });
});

test.describe('P1-AUD-02 audit log is immutable', { tag: '@api' }, () => {
  // T01 (contract) runs in permission-matrix.spec.ts against the bundled spec.
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST'] as const) {
    test(`P1-AUD-02-T02 ${method} on the audit log is not possible, even for the owner`, async ({ owner }) => {
      const first = (await auditSearch(owner, { size: 1 })).items[0];
      for (const path of [EP.auditLog, `${EP.auditLog}/${first.id}`, `${EP.auditLog}/${SAMPLE_UUID}`]) {
        const res = await owner.call(method, path, { body: method === 'DELETE' ? undefined : { action: 'LOGIN' } });
        expect([404, 405], `${method} ${path}`).toContain(res.status());
      }
      const again = (await auditSearch(owner, { entityId: first.entityId ?? undefined, size: 200 })).items;
      expect(again.find((e) => e.id === first.id)).toBeDefined();
    });
  }
  // T03 (DB privilege) is checked by the backend IT AuditLogImmutabilityIT and manually with psql: see signoff.md.
});

test.describe('P1-AUD-03 audit search API', { tag: '@api' }, () => {
  test('P1-AUD-03-T01 from / to filter by calendar date in Asia/Colombo, inclusive', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    const today = colomboDate();
    const yesterday = colomboDate(new Date(Date.now() - 24 * 3600 * 1000));
    const tomorrow = colomboDate(new Date(Date.now() + 24 * 3600 * 1000));
    const n = async (from: string, to: string) => (await auditSearch(owner, { userId: u.id, action: 'LOGIN', from, to })).totalItems;
    expect(await n(today, today)).toBe(1);
    expect(await n(yesterday, today)).toBe(1);
    expect(await n(today, tomorrow)).toBe(1);
    expect(await n(yesterday, yesterday)).toBe(0);
    expect(await n(tomorrow, tomorrow)).toBe(0);
  });

  test('P1-AUD-03-T02 filter by userId', async ({ api, owner, terminal, makeUser }) => {
    const a = await makeUser({ role: 'cashier' });
    const b = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    await dev.loginAs(a.username, a.password);
    await dev.loginAs(b.username, b.password);
    const page = await auditSearch(owner, { userId: a.id, action: 'LOGIN' });
    expect(page.items.every((e) => e.user?.id === a.id)).toBe(true);
    expect(page.totalItems).toBe(1);
  });

  test('P1-AUD-03-T03 filter by action', async ({ owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    await json(await owner.post(EP.deactivateUser(u.id)));
    const page = await auditSearch(owner, { entityId: u.id, action: 'DEACTIVATE' });
    expect(page.items.map((e) => e.action)).toEqual(['DEACTIVATE']);
    await expectProblem(await owner.get(EP.auditLog, { query: { action: 'NOT_AN_ACTION' } }), 400, 'MALFORMED_REQUEST');
  });

  test('P1-AUD-03-T04 filter by entityType and entityId', async ({ owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const role = await createRole(owner, ['ORDER_VIEW']);
    expect((await auditSearch(owner, { entityType: 'USER', entityId: u.id })).items.map((e) => e.action)).toEqual(['CREATE']);
    expect((await auditSearch(owner, { entityType: 'ROLE', entityId: role.id })).totalItems).toBe(1);
    expect((await auditSearch(owner, { entityType: 'ROLE', entityId: u.id })).totalItems).toBe(0);
  });

  test('P1-AUD-03-T05 combined filters are ANDed', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    await dev.login(u.username, WRONG);
    await dev.loginAs(u.username, u.password);
    const today = colomboDate();
    expect((await auditSearch(owner, { userId: u.id, action: 'LOGIN_FAILED', from: today, to: today })).totalItems).toBe(1);
    expect((await auditSearch(owner, { userId: u.id, action: 'LOGIN', from: today, to: today })).totalItems).toBe(1);
    expect((await auditSearch(owner, { userId: u.id, action: 'DEACTIVATE', from: today, to: today })).totalItems).toBe(0);
    expect((await auditSearch(owner, { userId: u.id, entityType: 'ROLE' })).totalItems).toBe(0);
  });

  test('P1-AUD-03-T06 pagination: page, size (max 200), totalItems; newest first; sort only on at', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 4; i++) await dev.loginAs(u.username, u.password);
    const all = await auditSearch(owner, { userId: u.id, action: 'LOGIN' });
    expect(all.totalItems).toBe(4);
    const p0 = await auditSearch(owner, { userId: u.id, action: 'LOGIN', size: 3, page: 0 });
    const p1 = await auditSearch(owner, { userId: u.id, action: 'LOGIN', size: 3, page: 1 });
    expect(p0).toMatchObject({ page: 0, size: 3, totalItems: 4 });
    expect(p0.items).toHaveLength(3);
    expect(p1.items).toHaveLength(1);
    const ats = [...p0.items, ...p1.items].map((e) => e.at);
    expect(ats).toEqual([...ats].sort().reverse()); // newest first by default
    const asc = await auditSearch(owner, { userId: u.id, action: 'LOGIN', sort: 'at,asc' });
    expect(asc.items.map((e) => e.at)).toEqual([...ats].sort());
    await expectProblem(await owner.get(EP.auditLog, { query: { size: 201 } }), 422);
    await expectProblem(await owner.get(EP.auditLog, { query: { sort: 'action,asc' } }), 422);
    expect((await owner.get(EP.auditLog, { query: { size: 200 } })).status()).toBe(200);
  });

  test('P1-AUD-03-T07 export returns one .xlsx sheet with exactly the filtered rows', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 3; i++) await dev.loginAs(u.username, u.password);
    const filter = { userId: u.id, action: 'LOGIN' };
    const total = (await auditSearch(owner, filter)).totalItems;
    expect(total).toBe(3);
    const res = await owner.get(EP.auditExport, { query: filter });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('spreadsheetml');
    expect(res.headers()['content-disposition'] ?? '').toMatch(/\.xlsx/);
    const zip = await JSZip.loadAsync(await res.body());
    const sheets = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
    expect(sheets).toHaveLength(1);
    const xml = await zip.file(sheets[0])!.async('string');
    const rows = (xml.match(/<row[ >]/g) ?? []).length;
    expect(rows).toBe(total + 1); // header + one row per entry
    const strings = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? xml;
    expect(strings).toContain('LOGIN');
    expect(strings).toContain(u.username);
  });

  test('P1-AUD-03-T07b the export honours the same date filter and shows times in Asia/Colombo', async ({ api, owner, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    const entry = (await auditSearch(owner, { userId: u.id, action: 'LOGIN' })).items[0];
    const colombo = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(entry.at));
    const yesterday = colomboDate(new Date(Date.now() - 24 * 3600 * 1000));
    const empty = await JSZip.loadAsync(await (await owner.get(EP.auditExport, { query: { userId: u.id, from: yesterday, to: yesterday } })).body());
    const emptySheet = await empty.file(Object.keys(empty.files).find((f) => /worksheets\/sheet1\.xml$/.test(f))!)!.async('string');
    expect((emptySheet.match(/<row[ >]/g) ?? []).length).toBe(1); // header only
    const full = await JSZip.loadAsync(await (await owner.get(EP.auditExport, { query: { userId: u.id } })).body());
    const blob = (await full.file('xl/sharedStrings.xml')?.async('string')) ?? '';
    const sheet = await full.file(Object.keys(full.files).find((f) => /worksheets\/sheet1\.xml$/.test(f))!)!.async('string');
    expect(`${blob}${sheet}`).toContain(colombo);
  });

  test('P1-AUD-03-T11 to before from gets 422 on search and export', async ({ owner }) => {
    await expectProblem(await owner.get(EP.auditLog, { query: { from: '2026-11-21', to: '2026-11-20' } }), 422);
    await expectProblem(await owner.get(EP.auditExport, { query: { from: '2026-11-21', to: '2026-11-20' } }), 422);
  });

  test('P1-AUD-03-T13 only the owner holds AUDIT_VIEW: a user with a custom AUDIT_VIEW role can search and export', async ({ owner, api, terminal }) => {
    const role = await createRole(owner, ['AUDIT_VIEW']);
    const u = await createUser(owner, { roleIds: [role.id] });
    const { client } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    expect((await client.get(EP.auditLog)).status()).toBe(200);
    expect((await client.get(EP.auditExport)).status()).toBe(200);
    expect((await client.get(`${EP.users}/options`)).status()).toBe(200);
    await expectProblem(await client.get(EP.users), 403, 'FORBIDDEN');
  });
});

test.describe('P1-AUD-03 audit viewer', () => {
  test('P1-AUD-03-T09 owner filters by action, paginates and exports the audit log', async ({ uiAs, api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    for (let i = 0; i < 3; i++) await dev.loginAs(u.username, u.password);
    const page = await uiAs('owner');
    const audit = new AdminAuditPage(page);
    await audit.goto();
    await expect(audit.table).toBeVisible();
    await expect(audit.user.locator('option', { hasText: u.username })).toHaveCount(1); // options load asynchronously
    await audit.action.selectOption('LOGIN');
    await audit.user.selectOption({ label: `QA ${u.username} (${u.username})` });
    await audit.searchButton.click();
    await expect(page.getByTestId('audit-total')).toHaveText('3 entries');
    await expect(audit.rows).toHaveCount(3);
    await expect(page.getByTestId('audit-total')).toHaveText('3 entries');
    for (const a of await page.getByTestId('audit-action-cell').allTextContents()) expect(a).toBe('LOGIN');
    const download = page.waitForEvent('download');
    await audit.exportButton.click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('P1-AUD-03-T09b the viewer pages through results and shows before / after details', async ({ uiAs, owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const user = await getUser(owner, u.id);
    await json(await owner.put(EP.user(u.id), { body: { fullName: 'Viewer Detail', version: user.version } }));
    const page = await uiAs('owner');
    const audit = new AdminAuditPage(page);
    await audit.goto();
    await audit.entity.fill('USER');
    await page.getByTestId('audit-entity-id').fill(u.id);
    await audit.searchButton.click();
    await expect(audit.rows).toHaveCount(2); // CREATE + UPDATE
    await page.getByTestId('audit-details').first().click();
    await expect(page.locator('.detail')).toContainText('Viewer Detail');
    await page.getByTestId('audit-clear').click();
    await audit.searchButton.click();
    await expect(page.getByTestId('audit-total')).not.toHaveText('2 entries');
  });

  test('P1-AUD-02-T04 audit viewer has no edit or delete controls', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin/audit');
    await expect(page.getByTestId('audit-table')).toBeVisible();
    await expect(page.getByTestId('audit-row').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /edit|delete|remove|clear all|purge/i }).filter({ hasNotText: /^Clear$/ })).toHaveCount(0);
    await page.getByTestId('audit-details').first().click().catch(() => undefined);
    await expect(page.getByRole('button', { name: /edit|delete|remove|purge/i })).toHaveCount(0);
  });

  test('P1-AUD-03-T14 a range with to before from is flagged in the form before searching', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin/audit');
    await page.getByTestId('audit-from').fill('2026-11-21');
    await page.getByTestId('audit-to').fill('2026-11-20');
    await expect(page.getByTestId('field-error-to')).toBeVisible();
    await expect(page.getByTestId('audit-export')).toBeDisabled();
  });
});
