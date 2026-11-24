/**
 * Tier 1 smoke (docs/qa/test-strategy.md §2a): API only, target under 3 minutes. Run it with `npm run test:smoke`
 * after every backend or frontend change. It covers login / refresh / logout, one happy path per module and a
 * personal login (ADR-008), and a permission-matrix SAMPLE read from the bundled contract: for every operation the owner
 * is not refused and one role that lacks the permission gets 403; x-terminal: REQUIRED operations refuse a personal session (the full role x operation matrix is permission-matrix.spec.ts, Tier 2 / 3).
 * It only creates uniquely named records, so it can run against a database that already has data. Needs the same
 * environment as the rest of the suite (see README: RMS_API_URL, bootstrap owner, RMS_SEED=1).
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/test';
import { passwordFor, userFor, UNKNOWN_USER } from '../fixtures/seed';
import { type ApiClient, type Schemas } from '../utils/api-client';
import { json, createRole, createUser, roleIdByKey } from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { env } from '../utils/env';
import { EPM, createArea, createCategory, createItem, createReason, createTable, stationByNumber } from '../utils/menu-api';
import { type Json, isObject } from '../utils/openapi';
import { buildRequest, generatePermissionMatrix } from '../utils/permission-matrix';
import { SEEDED_ROLES, type RoleKey } from '../utils/role-grants';

test.describe('Tier 1 smoke: auth', { tag: '@smoke-api' }, () => {
  test('SMOKE-AUTH login, me, refresh, logout', async ({ api, terminal }) => {
    const u = userFor('cashier');
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { client, session } = await dev.loginAs(u.username, passwordFor(u));
    expect((await client.get(EP.me)).status()).toBe(200);
    const next = await json<Schemas['AuthSession']>(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }));
    expect((await dev.withToken(next.accessToken).post(EP.logout, { body: { refreshToken: next.refreshToken } })).status()).toBe(204);
    expect((await dev.login(UNKNOWN_USER.username, UNKNOWN_USER.password)).status()).toBe(401);
  });

  test('SMOKE-AUTH-PERSONAL personal login without a terminal (ADR-008): owner PERSONAL session, cashier refused', async ({ api }) => {
    const o = userFor('owner');
    const s = await json<Schemas['AuthSession']>(await api.loginPersonal(o.username, passwordFor(o)));
    expect(s.sessionType).toBe('PERSONAL');
    expect(s.terminal).toBeUndefined();
    const me = await json<Schemas['CurrentUserProfile']>(await api.withTerminal(undefined).withToken(s.accessToken).get(EP.me));
    expect(me.sessionType).toBe('PERSONAL');
    const next = await json<Schemas['AuthSession']>(await api.withTerminal(undefined).post(EP.refresh, { body: { refreshToken: s.refreshToken } }));
    expect(next.sessionType).toBe('PERSONAL');
    const c = userFor('cashier');
    const refused = await api.loginPersonal(c.username, passwordFor(c));
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe('TERMINAL_REQUIRED_FOR_USER');
  });
});

test.describe('Tier 1 smoke: one happy path per module', { tag: '@smoke-api' }, () => {
  test('SMOKE-ADMIN users, roles, terminals, settings, audit', async ({ owner }) => {
    const role = await createRole(owner, ['ORDER_VIEW']);
    const u = await createUser(owner, { roleIds: [role.id] });
    expect((await json<Schemas['UserPage']>(await owner.get(EP.users, { query: { search: u.username } }))).totalItems).toBe(1);
    expect((await json<Schemas['RoleSummary'][]>(await owner.get(EP.roles))).some((r) => r.id === role.id)).toBe(true);
    expect((await json<Schemas['TerminalSummary'][]>(await owner.get(EP.terminals))).length).toBeGreaterThan(0);
    for (const path of Object.values(EP.settings)) expect((await owner.get(path)).status(), path).toBe(200);
    expect((await json<Schemas['AuditLogPage']>(await owner.get(EP.auditLog, { query: { entityId: u.id } }))).totalItems).toBeGreaterThan(0);
  });

  test('SMOKE-MENU stations, categories, items, availability, POS menu', async ({ owner, apiAs }) => {
    expect((await json<Schemas['KitchenStation'][]>(await owner.get(EPM.stations))).map((s) => s.number)).toEqual([1, 2, 3]);
    const cat = await createCategory(owner);
    const st = await stationByNumber(owner, 1);
    const item = await createItem(owner, { categoryId: cat.id, stationId: st.id });
    const cashier = await apiAs('cashier');
    await json(await cashier.put(EPM.availability(item.id), { body: { available: false } }));
    const menu = await json<Schemas['PosMenu']>(await cashier.get(EPM.posMenu));
    expect(menu.categories.flatMap((c) => c.items).find((i) => i.id === item.id)).toMatchObject({ available: false, localPrice: '500.00' });
  });

  test('SMOKE-FLOOR tables and floor layout', async ({ owner, apiAs }) => {
    const t = await createTable(owner, { x: 10, y: 20 });
    const layout = await json<Schemas['FloorLayout']>(await (await apiAs('cashier')).get(EPM.floorLayout));
    expect(layout.tables.find((x) => x.id === t.id)).toMatchObject({ x: 10, y: 20 });
  });

  test('SMOKE-SETTINGS delivery areas and reasons', async ({ owner, apiAs }) => {
    const a = await createArea(owner);
    const r = await createReason(owner);
    const cashier = await apiAs('cashier');
    expect((await json<Schemas['DeliveryAreaOption'][]>(await cashier.get(EPM.areaOptions))).some((x) => x.id === a.id)).toBe(true);
    expect((await json<Array<{ id: string }>>(await cashier.get(EPM.reasonOptions, { query: { category: 'CANCEL' } }))).some((x) => x.id === r.id)).toBe(true);
  });

  test('SMOKE-IMPORT a categories file: dry run, import, re-import unchanged', async ({ owner }) => {
    const name = `Smoke ${randomUUID().slice(0, 8)}`;
    const file = Buffer.from(`name,sort_order\r\n${name},5\r\n`);
    const run = async (dry: boolean) =>
      json<Schemas['ImportReport']>(await owner.call('POST', EPM.importData('CATEGORIES'), { query: { dryRun: dry }, multipart: { file: { name: 's.csv', mimeType: 'text/csv', buffer: file } } }));
    expect((await run(true)).counts.created).toBe(1);
    expect((await run(false)).counts.created).toBe(1);
    expect((await run(false)).counts).toEqual({ created: 0, updated: 0, unchanged: 1 });
  });
});

const bundle = existsSync(env.openapiBundle) ? generatePermissionMatrix(env.openapiBundle) : null;

test.describe('Tier 1 smoke: permission-matrix sample (every operation: owner allowed, one role denied)', { tag: '@smoke-api' }, () => {
  test('SMOKE-CONTRACT the bundled contract has no permission or security errors', () => {
    test.skip(!bundle, 'bundle missing: run redocly bundle');
    expect(bundle!.problems.filter((p) => p.severity === 'error').map((p) => p.message)).toEqual([]);
  });
  if (!bundle) return;

  const clients = new Map<RoleKey, ApiClient>();
  for (const op of bundle.operations) {
    const cases = bundle.cases.filter((c) => c.operationId === op.operationId && c.expectation !== 'public' && c.role !== 'anonymous');
    const allowed = cases.find((c) => c.role === 'owner' && c.expectation === 'allow');
    const denied = cases.find((c) => c.expectation === 'deny' && SEEDED_ROLES.includes(c.role as RoleKey));
    for (const c of [allowed, denied]) {
      if (!c) continue;
      test(`SMOKE-MATRIX [${c.role}] ${c.method.toUpperCase()} ${c.path} -> ${c.expectation === 'deny' ? '403' : 'not 401/403'}`, async ({ api, apiAs, terminal }) => {
        const plan = buildRequest(op);
        let body: Json | undefined = plan.body;
        let client: ApiClient;
        if (c.auth === 'inline-credentials') {
          const u = userFor(c.role as RoleKey);
          const creds = { username: u.username, password: passwordFor(u) };
          if (op.credentialsField === '') body = { ...(isObject(body) ? body : {}), ...creds };
          else if (isObject(body) && op.credentialsField) body = { ...body, [op.credentialsField]: creds };
          client = api.withToken(undefined).withTerminal(undefined);
        } else {
          if (!clients.has(c.role as RoleKey)) clients.set(c.role as RoleKey, await apiAs(c.role as RoleKey));
          const s = clients.get(c.role as RoleKey)!;
          client = api.withTerminal(s.terminal ?? terminal('CASHIER_POS')).withToken(s.token);
        }
        if (/logout/i.test(op.operationId)) client = await apiAs(c.role as RoleKey);
        const res = await client.call(plan.method, plan.url, {
          body: plan.bodyKind === 'multipart' ? undefined : (body ?? undefined),
          multipart: plan.bodyKind === 'multipart' ? { file: { name: 'm.csv', mimeType: 'text/csv', buffer: Buffer.from(['name,sort_order', 'QA smoke,1', ''].join(String.fromCharCode(10))) } } : undefined,
          query: plan.query,
          headers: plan.headers,
          idempotencyKey: plan.needsIdempotencyKey ? randomUUID() : undefined,
        });
        const status = res.status();
        expect(status, `server error ${await res.text()}`).toBeLessThan(500);
        if (c.expectation === 'deny') expect(status, await res.text()).toBe(403);
        else expect([401, 403], await res.text()).not.toContain(status);
      });
    }
  }
  // x-terminal: REQUIRED operations (from M1.2): the owner in a personal session gets 403 TERMINAL_REQUIRED.
  for (const c of bundle.sessionCases.filter((x) => x.role === 'owner' && x.expectCode === 'TERMINAL_REQUIRED')) {
    const op = bundle.operations.find((o) => o.operationId === c.operationId)!;
    test(`SMOKE-SESSION [personal:owner] ${c.method.toUpperCase()} ${c.path} -> 403 TERMINAL_REQUIRED`, async ({ api }) => {
      const o = userFor('owner');
      const s = await json<Schemas['AuthSession']>(await api.loginPersonal(o.username, passwordFor(o)));
      const plan = buildRequest(op);
      const res = await api.withTerminal(undefined).withToken(s.accessToken).call(plan.method, plan.url, {
        body: plan.bodyKind === 'json' ? (plan.body ?? undefined) : undefined,
        query: plan.query,
        headers: plan.headers,
        idempotencyKey: plan.needsIdempotencyKey ? randomUUID() : undefined,
      });
      expect(res.status(), await res.text()).toBe(403);
      expect((await res.json()).code).toBe('TERMINAL_REQUIRED');
    });
  }
  void roleIdByKey;
});
