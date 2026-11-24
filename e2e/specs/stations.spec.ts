/**
 * M1.1 kitchen stations, ordering points and terminal setup with a station
 * (P1-MENU-07, P1-SET-05, P1-FLOOR-02, P1-AUTH-04 / P1-AUTH-03 / P1-RBAC-04 M1.1 rows).
 * Annex A §5 "three kitchen stations"; §14 "item-to-kitchen mapping, printers and KDS".
 * The tests that rename stations or change their target times run in one worker (default mode) and restore the seed.
 */
import { test, expect } from '../fixtures/test';
import { passwordFor, userFor } from '../fixtures/seed';
import { seedBrowserStorage } from '../fixtures/ui';
import { TerminalSetupPage } from '../pages/shared';
import { type Schemas, expectProblem } from '../utils/api-client';
import { auditSearch, json, uniqueName } from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { EPM, createItem, listStations, stationByNumber, uniqueLabel } from '../utils/menu-api';
import { SAMPLE_UUID } from '../utils/openapi';

test.describe.configure({ mode: 'default' });

const ownerCreds = () => ({ username: userFor('owner').username, password: passwordFor(userFor('owner')) });
const stationBody = (s: Schemas['KitchenStation'], over: Record<string, unknown> = {}) => ({
  name: s.name,
  targetPrepMinutes: s.targetPrepMinutes,
  active: s.active,
  version: s.version,
  ...over,
});

test.describe('P1-MENU-07 kitchen stations', { tag: '@api' }, () => {
  test('P1-MENU-07-T01 exactly three stations (numbers 1-3) are seeded with a name, a target time and an item count', async ({ owner }) => {
    const stations = await listStations(owner);
    expect(stations.map((s) => s.number)).toEqual([1, 2, 3]);
    for (const s of stations) {
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.targetPrepMinutes).toBeGreaterThan(0);
      expect(s.active).toBe(true);
      expect(s.activeItemCount).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(stations.map((s) => s.name.toLowerCase())).size).toBe(3);
  });

  test('P1-MENU-07-T02 the owner renames a station and sets its target time; persisted and audited with before and after', async ({ owner }) => {
    const s = await stationByNumber(owner, 3);
    const newName = uniqueLabel('Kitchen 3 QA');
    try {
      const saved = await json<Schemas['KitchenStation']>(await owner.put(EPM.station(s.id), { body: stationBody(s, { name: newName, targetPrepMinutes: 9 }) }));
      expect(saved).toMatchObject({ number: 3, name: newName, targetPrepMinutes: 9 });
      expect((await json<Schemas['KitchenStation']>(await owner.get(EPM.station(s.id)))).name).toBe(newName);
      const entries = (await auditSearch(owner, { entityId: s.id, action: 'UPDATE' })).items;
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].entityType).toBe('KITCHEN_STATION');
      expect(JSON.stringify(entries[0].before)).toContain(s.name);
      expect(JSON.stringify(entries[0].after)).toContain(newName);
      expect(entries[0].user?.username).toBe(userFor('owner').username);
      expect(entries[0].terminal?.id).toBeTruthy();
    } finally {
      const cur = await json<Schemas['KitchenStation']>(await owner.get(EPM.station(s.id)));
      await json(await owner.put(EPM.station(s.id), { body: stationBody(cur, { name: s.name, targetPrepMinutes: s.targetPrepMinutes }) }));
    }
  });

  test('P1-MENU-07-T03 a station name must be unique among stations (case-insensitive): 409 STATION_NAME_TAKEN', async ({ owner }) => {
    const [a, b] = [await stationByNumber(owner, 1), await stationByNumber(owner, 2)];
    await expectProblem(await owner.put(EPM.station(b.id), { body: stationBody(b, { name: a.name.toUpperCase() }) }), 409, 'STATION_NAME_TAKEN');
    expect((await stationByNumber(owner, 2)).name).toBe(b.name);
  });

  test('P1-MENU-07-T04 a stale version gets 409 VERSION_CONFLICT', async ({ owner }) => {
    const s = await stationByNumber(owner, 2);
    const next = await json<Schemas['KitchenStation']>(await owner.put(EPM.station(s.id), { body: stationBody(s, { targetPrepMinutes: s.targetPrepMinutes + 1 }) }));
    try {
      expect(next.version).toBeGreaterThan(s.version);
      await expectProblem(await owner.put(EPM.station(s.id), { body: stationBody(s) }), 409, 'VERSION_CONFLICT');
    } finally {
      await json(await owner.put(EPM.station(s.id), { body: stationBody(next, { targetPrepMinutes: s.targetPrepMinutes }) }));
    }
  });

  test('P1-MENU-07-T05 stations cannot be created or deleted through the API (seeded only)', async ({ owner }) => {
    const s = await stationByNumber(owner, 1);
    expect([404, 405]).toContain((await owner.post(EPM.stations, { body: { name: 'Kitchen 4', targetPrepMinutes: 10 } })).status());
    expect([404, 405]).toContain((await owner.delete(EPM.station(s.id))).status());
    expect((await listStations(owner)).length).toBe(3);
  });

  test('P1-MENU-07-T06 a station with active items cannot be deactivated: 409 STATION_IN_USE', async ({ owner }) => {
    const s = await stationByNumber(owner, 1);
    await createItem(owner, { stationId: s.id });
    await expectProblem(await owner.put(EPM.station(s.id), { body: stationBody(s, { active: false }) }), 409, 'STATION_IN_USE');
    expect((await stationByNumber(owner, 1)).active).toBe(true);
  });

  test('P1-MENU-07-T07 only an owner (MENU_MANAGE) can list or edit stations; the options lookup needs TERMINAL_MANAGE', async ({ apiAs }) => {
    for (const role of ['manager', 'cashier', 'kitchen'] as const) {
      const c = await apiAs(role);
      await expectProblem(await c.get(EPM.stations), 403, 'FORBIDDEN');
      await expectProblem(await c.get(EPM.stationOptions), 403, 'FORBIDDEN');
    }
  });

  test('P1-MENU-07-T08 the station options lookup lists active stations by number', async ({ owner }) => {
    const opts = await json<Schemas['KitchenStationOption'][]>(await owner.get(EPM.stationOptions));
    expect(opts.map((o) => o.number)).toEqual([1, 2, 3]);
    for (const o of opts) expect(Object.keys(o).sort()).toEqual(['id', 'name', 'number']);
  });

  test('P1-MENU-07-T09 the active item count per station follows item creation and deactivation', async ({ owner }) => {
    const s = await stationByNumber(owner, 2);
    const item = await createItem(owner, { stationId: s.id });
    expect((await stationByNumber(owner, 2)).activeItemCount).toBe(s.activeItemCount + 1);
    const cur = await json<Schemas['MenuItem']>(await owner.get(EPM.item(item.id)));
    await json(await owner.put(EPM.item(item.id), { body: { code: cur.code, name: cur.name, categoryId: cur.categoryId, stationId: cur.stationId, localPrice: cur.localPrice, foreignPrice: cur.foreignPrice, active: false, modifierGroupIds: [], version: cur.version } }));
    expect((await stationByNumber(owner, 2)).activeItemCount).toBe(s.activeItemCount);
  });
});

test.describe('P1-SET-05 target preparation time per station', { tag: '@api' }, () => {
  test('P1-SET-05-T01 owner sets target minutes per station; persisted and audited', async ({ owner }) => {
    const before = await listStations(owner);
    try {
      for (const s of before) {
        await json(await owner.put(EPM.station(s.id), { body: stationBody(s, { targetPrepMinutes: 5 + s.number }) }));
      }
      expect((await listStations(owner)).map((s) => s.targetPrepMinutes)).toEqual([6, 7, 8]);
      const updates = (await auditSearch(owner, { entityType: 'KITCHEN_STATION', action: 'UPDATE', size: 20 })).items;
      expect(updates.length).toBeGreaterThanOrEqual(3);
    } finally {
      for (const s of await listStations(owner)) {
        const orig = before.find((b) => b.id === s.id)!;
        await json(await owner.put(EPM.station(s.id), { body: stationBody(s, { targetPrepMinutes: orig.targetPrepMinutes }) }));
      }
    }
  });

  for (const bad of [0, -5, 241, 7.5, 'ten']) {
    test(`P1-SET-05-T02 target time ${JSON.stringify(bad)} minutes is rejected`, async ({ owner }) => {
      const s = await stationByNumber(owner, 1);
      const res = await owner.put(EPM.station(s.id), { body: stationBody(s, { targetPrepMinutes: bad }) });
      expect([400, 422]).toContain(res.status());
      expect((await stationByNumber(owner, 1)).targetPrepMinutes).toBe(s.targetPrepMinutes);
    });
  }

  for (const ok of [1, 240]) {
    test(`P1-SET-05-T02b the boundary target time ${ok} minutes is accepted`, async ({ owner }) => {
      const s = await stationByNumber(owner, 3);
      const saved = await json<Schemas['KitchenStation']>(await owner.put(EPM.station(s.id), { body: stationBody(s, { targetPrepMinutes: ok }) }));
      await json(await owner.put(EPM.station(s.id), { body: stationBody(saved, { targetPrepMinutes: s.targetPrepMinutes }) }));
    });
  }
});

test.describe('P1-SET-05 / P1-MENU-07 kitchens screen', () => {
  test('P1-SET-05-T03 /admin/kitchens edits the name and target time of a station and saves', async ({ uiAs, owner }) => {
    const s = await stationByNumber(owner, 3);
    const page = await uiAs('owner');
    try {
      await page.goto('/admin/kitchens');
      await expect(page.getByTestId('station-3')).toBeVisible();
      await expect(page.getByTestId('set-station-target-3')).toHaveValue(String(s.targetPrepMinutes));
      const newName = uniqueLabel('Juice QA');
      await page.getByTestId('station-name-3').fill(newName);
      await page.getByTestId('set-station-target-3').fill('11');
      await expect(page.getByTestId('stations-dirty')).toBeVisible();
      await page.getByTestId('station-save-3').click();
      await expect.poll(async () => (await stationByNumber(owner, 3)).targetPrepMinutes).toBe(11);
      expect((await stationByNumber(owner, 3)).name).toBe(newName);
      await page.reload();
      await expect(page.getByTestId('set-station-target-3')).toHaveValue('11');
    } finally {
      const cur = await stationByNumber(owner, 3);
      await json(await owner.put(EPM.station(s.id), { body: stationBody(cur, { name: s.name, targetPrepMinutes: s.targetPrepMinutes }) }));
    }
  });

  test('P1-SET-05-T03b the kitchens screen refuses an invalid target time with a field error', async ({ uiAs, owner }) => {
    const s = await stationByNumber(owner, 1);
    const page = await uiAs('owner');
    await page.goto('/admin/kitchens');
    await page.getByTestId('set-station-target-1').fill('0');
    await page.getByTestId('station-save-1').click();
    await expect(page.getByTestId('station-error-1').or(page.getByTestId('field-error-targetPrepMinutes'))).toBeVisible();
    expect((await stationByNumber(owner, 1)).targetPrepMinutes).toBe(s.targetPrepMinutes);
  });
});

test.describe('P1-FLOOR-02 ordering points', { tag: '@api' }, () => {
  test('P1-FLOOR-02-T01 two ordering points are seeded: Cashier and Reception', async ({ owner }) => {
    const pts = await json<Schemas['OrderingPoint'][]>(await owner.get(EPM.orderingPoints));
    expect(pts.map((p) => p.name).sort()).toEqual(['Cashier', 'Reception']);
    expect(await owner.post(EPM.orderingPoints, { body: { name: 'Bar' } }).then((r) => r.status())).toBeGreaterThanOrEqual(400);
  });

  test('P1-FLOOR-02-T02 a POS terminal registered with an ordering point carries it in its session (orders will store it, M1.2)', async ({ api, owner, makeUser }) => {
    const pts = await json<Schemas['OrderingPoint'][]>(await owner.get(EPM.orderingPoints));
    const reception = pts.find((p) => p.name === 'Reception')!;
    const res = await api.registerTerminal(ownerCreds(), { name: uniqueName('QA reception'), type: 'RECEPTION_POS', orderingPointId: reception.id });
    expect(res.status()).toBe(201);
    const reg = (await res.json()) as Schemas['TerminalRegistration'];
    expect(reg.terminal.orderingPointId).toBe(reception.id);
    const u = await makeUser({ role: 'receptionist' });
    const { session } = await api.withTerminal({ terminalId: reg.terminal.id, deviceToken: reg.deviceToken }).loginAs(u.username, u.password);
    expect(session.terminal?.orderingPointId).toBe(reception.id);
  });

  test('P1-FLOOR-02-T03 an unknown ordering point, or one on a KITCHEN / ADMIN terminal, is rejected with 422', async ({ api, owner }) => {
    const pts = await json<Schemas['OrderingPoint'][]>(await owner.get(EPM.orderingPoints));
    const st = await stationByNumber(owner, 1);
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA op'), type: 'CASHIER_POS', orderingPointId: SAMPLE_UUID }), 422);
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA op'), type: 'KITCHEN', kitchenStationId: st.id, orderingPointId: pts[0].id }), 422);
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA op'), type: 'ADMIN', orderingPointId: pts[0].id }), 422);
  });
});

test.describe('P1-AUTH-04 kitchen terminals and terminal setup options', { tag: '@api' }, () => {
  test('P1-AUTH-04-T08 a KITCHEN terminal needs a real active station: missing, unknown or on another type gets 422', async ({ api, owner }) => {
    const st = await stationByNumber(owner, 2);
    const p1 = await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA k'), type: 'KITCHEN' }), 422);
    expect((p1.fieldErrors ?? []).map((f) => f.field)).toContain('kitchenStationId');
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA k'), type: 'KITCHEN', kitchenStationId: SAMPLE_UUID }), 422);
    await expectProblem(await api.registerTerminal(ownerCreds(), { name: uniqueName('QA k'), type: 'ADMIN', kitchenStationId: st.id }), 422);
    const ok = await api.registerTerminal(ownerCreds(), { name: uniqueName('QA k'), type: 'KITCHEN', kitchenStationId: st.id });
    expect(ok.status()).toBe(201);
    const reg = (await ok.json()) as Schemas['TerminalRegistration'];
    expect(reg.terminal).toMatchObject({ type: 'KITCHEN', kitchenStationId: st.id, kitchenStationName: st.name });
  });

  test('P1-RBAC-04-T01 a KITCHEN terminal is bound to exactly one station; it can be moved to another station but never left without one', async ({ api, owner }) => {
    const [s1, s3] = [await stationByNumber(owner, 1), await stationByNumber(owner, 3)];
    const r = await api.registerTerminal(ownerCreds(), { name: uniqueName('QA kb'), type: 'KITCHEN', kitchenStationId: s1.id });
    const { terminal } = (await json<Schemas['TerminalRegistration']>(r, 201));
    expect(terminal.kitchenStationId).toBe(s1.id);
    const moved = await json<Schemas['Terminal']>(await owner.put(EP.terminal(terminal.id), { body: { name: terminal.name, type: 'KITCHEN', kitchenStationId: s3.id, version: terminal.version } }));
    expect(moved.kitchenStationId).toBe(s3.id);
    await expectProblem(await owner.put(EP.terminal(terminal.id), { body: { name: terminal.name, type: 'KITCHEN', version: moved.version } }), 422);
  });

  test('P1-AUTH-03-T11 a session on a KITCHEN terminal has no idle timeout (the screen stays logged in)', async ({ api, owner, makeUser }) => {
    const st = await stationByNumber(owner, 1);
    const r = await api.registerTerminal(ownerCreds(), { name: uniqueName('QA kds'), type: 'KITCHEN', kitchenStationId: st.id });
    const reg = (await r.json()) as Schemas['TerminalRegistration'];
    const u = await makeUser({ role: 'kitchen' });
    const { session } = await api.withTerminal({ terminalId: reg.terminal.id, deviceToken: reg.deviceToken }).loginAs(u.username, u.password);
    expect(session.idleTimeoutMinutes).toBeUndefined();
    expect(session.terminal).toMatchObject({ type: 'KITCHEN', kitchenStationId: st.id });
  });

  test('P1-AUTH-04-T20 terminal setup options (no token) return active stations and ordering points for the owner', async ({ api }) => {
    const res = await api.withToken(undefined).withTerminal(undefined).post(EPM.setupOptions, { body: ownerCreds() });
    const o = await json<Schemas['TerminalSetupOptions']>(res);
    expect(o.kitchenStations.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(o.orderingPoints.map((p) => p.name).sort()).toEqual(['Cashier', 'Reception']);
  });

  test('P1-AUTH-04-T21 terminal setup options: valid credentials without TERMINAL_MANAGE get 403; no body is 422', async ({ api, makeUser }) => {
    const u = await makeUser({ role: 'manager' });
    const dev = api.withToken(undefined).withTerminal(undefined);
    await expectProblem(await dev.post(EPM.setupOptions, { body: { username: u.username, password: u.password } }), 403, 'FORBIDDEN');
    await expectProblem(await dev.post(EPM.setupOptions, { body: {} }), 422);
  });
});

test.describe('P1-AUTH-04 terminal setup with a station (UI)', () => {
  test('P1-AUTH-04-T22 the owner registers a KITCHEN screen on the setup page by choosing its station; the kitchen user then logs in to /kitchen', async ({ page, owner, makeUser }) => {
    const st = await stationByNumber(owner, 2);
    const u = await makeUser({ role: 'kitchen' });
    const name = uniqueName('QA KDS');
    const setup = new TerminalSetupPage(page);
    await setup.goto();
    await setup.ownerUsername.fill(ownerCreds().username);
    await setup.ownerPassword.fill(ownerCreds().password);
    await setup.name.fill(name);
    await setup.type.click();
    await page.getByRole('option', { name: 'Kitchen screen', exact: true }).click();
    if (await page.getByTestId('terminal-load-options').isVisible().catch(() => false)) await page.getByTestId('terminal-load-options').click();
    await expect(setup.station).toBeEnabled();
    await setup.station.click();
    await page.getByRole('option', { name: st.name, exact: true }).click();
    await setup.submit.click();
    await expect(setup.registered).toBeVisible();
    await setup.gotoLogin.click();
    await page.getByTestId('login-username').fill(u.username);
    await page.getByTestId('login-password').fill(u.password);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/kitchen$/);
    await expect(page.getByTestId('header-terminal')).toBeVisible();
  });

  test('P1-AUTH-04-T23 the setup page refuses a KITCHEN screen without a station', async ({ page }) => {
    const setup = new TerminalSetupPage(page);
    await setup.goto();
    await setup.ownerUsername.fill(ownerCreds().username);
    await setup.ownerPassword.fill(ownerCreds().password);
    await setup.name.fill(uniqueName('QA KDS none'));
    await setup.type.click();
    await page.getByRole('option', { name: 'Kitchen screen', exact: true }).click();
    await setup.submit.click();
    await expect(page.getByTestId('field-error-kitchenStationId')).toBeVisible();
    await expect(setup.registered).toBeHidden();
  });

  test('P1-AUTH-04-T24 the setup page offers ordering points for a POS device and registers it with the chosen point', async ({ page, owner }) => {
    const setup = new TerminalSetupPage(page);
    const name = uniqueName('QA POS op');
    await setup.goto();
    await setup.ownerUsername.fill(ownerCreds().username);
    await setup.ownerPassword.fill(ownerCreds().password);
    await setup.name.fill(name);
    await setup.type.click();
    await page.getByRole('option', { name: 'Reception POS', exact: true }).click();
    if (await page.getByTestId('terminal-load-options').isVisible().catch(() => false)) await page.getByTestId('terminal-load-options').click();
    await expect(page.getByTestId('terminal-ordering-point')).toBeEnabled();
    await page.getByTestId('terminal-ordering-point').click();
    await page.getByRole('option', { name: 'Reception', exact: true }).click();
    await setup.submit.click();
    await expect(setup.registered).toBeVisible();
    const list = await json<Schemas['TerminalSummary'][]>(await owner.get(EP.terminals));
    const t = list.find((x) => x.name === name)!;
    const pts = await json<Schemas['OrderingPoint'][]>(await owner.get(EPM.orderingPoints));
    expect(t.orderingPointId).toBe(pts.find((p) => p.name === 'Reception')!.id);
  });
});

test.describe('P1-AUTH-03 KDS exemption', { tag: '@kds' }, () => {
  test('P1-AUTH-04-T12 the kitchen screen of a KITCHEN terminal shows which kitchen it is (terminal name in the header) and lands on /kitchen', async ({ page, context, api, owner, makeUser }) => {
    const st = await stationByNumber(owner, 2);
    const name = `${st.name} screen ${uniqueName('k')}`.slice(0, 50);
    const r = await api.registerTerminal(ownerCreds(), { name, type: 'KITCHEN', kitchenStationId: st.id });
    const reg = (await r.json()) as Schemas['TerminalRegistration'];
    const u = await makeUser({ role: 'kitchen' });
    const identity = { terminalId: reg.terminal.id, deviceToken: reg.deviceToken };
    const { session } = await api.withTerminal(identity).loginAs(u.username, u.password);
    await seedBrowserStorage(context, { terminal: { ...identity, name, type: 'KITCHEN' }, session });
    await page.goto('/');
    await expect(page).toHaveURL(/\/kitchen$/);
    await expect(page.getByTestId('header-terminal')).toContainText(st.name);
    await expect(page.getByTestId('connection-status')).toBeVisible();
  });

  test('P1-AUTH-03-T05 a kitchen screen stays logged in after 12 idle hours', async ({ page, context, api, owner, makeUser }) => {
    const st = await stationByNumber(owner, 1);
    const r = await api.registerTerminal(ownerCreds(), { name: uniqueName('QA kds idle'), type: 'KITCHEN', kitchenStationId: st.id });
    const reg = (await r.json()) as Schemas['TerminalRegistration'];
    const u = await makeUser({ role: 'kitchen' });
    const identity = { terminalId: reg.terminal.id, deviceToken: reg.deviceToken };
    const { session } = await api.withTerminal(identity).loginAs(u.username, u.password);
    await seedBrowserStorage(context, { terminal: { ...identity, name: reg.terminal.name, type: 'KITCHEN' }, session });
    await page.clock.install();
    await page.goto('/kitchen');
    await expect(page.getByTestId('kds-board')).toBeVisible();
    await page.clock.fastForward('12:00:00');
    await expect(page.getByTestId('idle-lock-overlay')).toBeHidden();
    await expect(page.getByTestId('kds-board')).toBeVisible();
  });
});
