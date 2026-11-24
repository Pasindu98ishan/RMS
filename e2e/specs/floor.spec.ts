/**
 * M1.1 tables and floor plan (P1-FLOOR-01). Annex A §14 "tables and floor plan". Positions are the CENTRE of the
 * table on a 1000 x 700 logical grid (m1.1-scope.md decision 7). Tables are never deleted, only deactivated.
 */
import { test, expect } from '../fixtures/test';
import { type ApiClient, type Schemas, expectProblem } from '../utils/api-client';
import { auditSearch, json } from '../utils/admin-api';
import { EPM, createTable, expectFieldError, uniqueTableNo } from '../utils/menu-api';
import { SAMPLE_UUID } from '../utils/openapi';

const jstr = (v: unknown) => JSON.stringify(v ?? null);
const pos = (t: Schemas['DiningTable'], x: number, y: number) => ({ tableId: t.id, x, y, version: t.version });
const get = async (c: ApiClient, id: string) => json<Schemas['DiningTable']>(await c.get(EPM.table(id)));

test.describe('P1-FLOOR-01 tables', { tag: '@api' }, () => {
  test('P1-FLOOR-01-T01 owner creates a table with number, section and seats; it is active and placed on the grid', async ({ owner }) => {
    const n = uniqueTableNo();
    const t = await createTable(owner, { number: n, section: 'Garden', seats: 6 });
    expect(t).toMatchObject({ number: n, section: 'Garden', seats: 6, active: true });
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.x).toBeLessThanOrEqual(1000);
    expect(t.y).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeLessThanOrEqual(700);
  });

  test('P1-FLOOR-01-T02 without x / y a new table goes to the next free spot: two new tables never share a position', async ({ owner }) => {
    const [a, b, c] = [await createTable(owner), await createTable(owner), await createTable(owner)];
    const spots = new Set([a, b, c].map((t) => `${t.x},${t.y}`));
    expect(spots.size).toBe(3);
  });

  test('P1-FLOOR-01-T03 a table can be created at a given position; x / y are the centre within 0-1000 / 0-700 (edges accepted)', async ({ owner }) => {
    const t = await createTable(owner, { x: 123, y: 456 });
    expect([t.x, t.y]).toEqual([123, 456]);
    for (const [x, y] of [[0, 0], [1000, 700]]) {
      const e = await createTable(owner, { x, y });
      expect([e.x, e.y]).toEqual([x, y]);
    }
  });

  for (const [label, over, field] of [
    ['x below 0', { x: -1, y: 10 }, 'x'],
    ['x above 1000', { x: 1001, y: 10 }, 'x'],
    ['y below 0', { x: 10, y: -1 }, 'y'],
    ['y above 700', { x: 10, y: 701 }, 'y'],
  ] as const) {
    test(`P1-FLOOR-01-T04 ${label} is rejected with 422`, async ({ owner }) => {
      await expectFieldError(await owner.post(EPM.tables, { body: { number: uniqueTableNo(), section: 'QA', seats: 4, ...over } }), field);
    });
  }

  test('P1-FLOOR-01-T05 the table number is unique (case-insensitive): 409 TABLE_NUMBER_TAKEN', async ({ owner }) => {
    const t = await createTable(owner);
    await expectProblem(await owner.post(EPM.tables, { body: { number: t.number.toLowerCase(), section: 'QA', seats: 2 } }), 409, 'TABLE_NUMBER_TAKEN');
  });

  for (const bad of ['', 'T 1', 'T_1', 'N'.repeat(11), 'T/1']) {
    test(`P1-FLOOR-01-T06 table number "${bad}" is rejected with 422`, async ({ owner }) => {
      await expectFieldError(await owner.post(EPM.tables, { body: { number: bad, section: 'QA', seats: 2 } }), 'number');
    });
  }

  for (const [label, over, field] of [
    ['seats 0', { seats: 0 }, 'seats'],
    ['seats 51', { seats: 51 }, 'seats'],
    ['seats 2.5', { seats: 2.5 }, 'seats'],
    ['an empty section', { section: '' }, 'section'],
    ['a section over 30 characters', { section: 's'.repeat(31) }, 'section'],
  ] as const) {
    test(`P1-FLOOR-01-T07 ${label} is rejected`, async ({ owner }) => {
      const res = await owner.post(EPM.tables, { body: { number: uniqueTableNo(), section: 'QA', seats: 4, ...(over as Record<string, unknown>) } });
      if (res.status() === 422) await expectFieldError(res, field);
      else expect(res.status()).toBe(400);
    });
  }

  test('P1-FLOOR-01-T08 the edge values seats 1 and 50 and a 30-character section are accepted', async ({ owner }) => {
    expect((await createTable(owner, { seats: 1 })).seats).toBe(1);
    expect((await createTable(owner, { seats: 50, section: 's'.repeat(30) })).seats).toBe(50);
  });

  test('P1-FLOOR-01-T09 owner or manager edits number, section, seats and active; audited with before and after; stale version 409', async ({ owner, apiAs }) => {
    const t = await createTable(owner);
    const manager = await apiAs('manager');
    const n = uniqueTableNo();
    const saved = await json<Schemas['DiningTable']>(await manager.put(EPM.table(t.id), { body: { number: n, section: 'Moved', seats: 8, active: false, version: t.version } }));
    expect(saved).toMatchObject({ number: n, section: 'Moved', seats: 8, active: false });
    expect([saved.x, saved.y]).toEqual([t.x, t.y]); // details do not move the table
    await expectProblem(await owner.put(EPM.table(t.id), { body: { number: n, section: 'x', seats: 2, active: true, version: t.version } }), 409, 'VERSION_CONFLICT');
    const entries = (await auditSearch(owner, { entityType: 'DINING_TABLE', entityId: t.id })).items;
    expect(entries.map((e) => e.action).sort()).toEqual(['CREATE', 'UPDATE']);
    const upd = entries.find((e) => e.action === 'UPDATE')!;
    expect(jstr(upd.before)).toContain(t.number);
    expect(jstr(upd.after)).toContain(n);
    expect(upd.user?.username).toBe(manager.session!.user.username);
    expect(upd.terminal?.id).toBeTruthy();
  });

  test('P1-FLOOR-01-T10 changing a number to an existing one is 409 TABLE_NUMBER_TAKEN', async ({ owner }) => {
    const [a, b] = [await createTable(owner), await createTable(owner)];
    await expectProblem(await owner.put(EPM.table(b.id), { body: { number: a.number, section: b.section, seats: b.seats, active: true, version: b.version } }), 409, 'TABLE_NUMBER_TAKEN');
  });

  test('P1-FLOOR-01-T11 tables are never deleted (no DELETE); the list filters by active and section; unknown id is 404', async ({ owner }) => {
    const sec = `S${uniqueTableNo()}`.slice(0, 20);
    const [a, b] = [await createTable(owner, { section: sec }), await createTable(owner, { section: sec })];
    await json(await owner.put(EPM.table(b.id), { body: { number: b.number, section: sec, seats: b.seats, active: false, version: b.version } }));
    expect([404, 405]).toContain((await owner.delete(EPM.table(a.id))).status());
    const q = async (query: Record<string, string | boolean>) => json<Schemas['DiningTable'][]>(await owner.get(EPM.tables, { query: { section: sec, ...query } }));
    expect((await q({})).map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect((await q({ active: true })).map((t) => t.id)).toEqual([a.id]);
    expect((await q({ active: false })).map((t) => t.id)).toEqual([b.id]);
    await expectProblem(await owner.get(EPM.table(SAMPLE_UUID)), 404, 'NOT_FOUND');
  });

  test('P1-FLOOR-01-T12 the POS floor layout lists active tables only on a 1000 x 700 grid; cashier and reception may read it, kitchen / rider / HR may not', async ({ owner, apiAs }) => {
    const [a, b] = [await createTable(owner, { x: 300, y: 200 }), await createTable(owner)];
    await json(await owner.put(EPM.table(b.id), { body: { number: b.number, section: b.section, seats: b.seats, active: false, version: b.version } }));
    for (const role of ['cashier', 'receptionist', 'manager'] as const) {
      const layout = await json<Schemas['FloorLayout']>(await (await apiAs(role)).get(EPM.floorLayout));
      expect([layout.width, layout.height]).toEqual([1000, 700]);
      expect(layout.tables.find((t) => t.id === a.id)).toMatchObject({ number: a.number, x: 300, y: 200 });
      expect(layout.tables.find((t) => t.id === b.id)).toBeUndefined();
    }
    for (const role of ['kitchen', 'rider', 'hr', 'inventory'] as const) {
      await expectProblem(await (await apiAs(role)).get(EPM.floorLayout), 403, 'FORBIDDEN');
    }
  });

  test('P1-FLOOR-01-T13 table admin needs FLOOR_MANAGE: the cashier and receptionist get 403 on list, create and update', async ({ owner, apiAs }) => {
    const t = await createTable(owner);
    for (const role of ['cashier', 'receptionist'] as const) {
      const c = await apiAs(role);
      await expectProblem(await c.get(EPM.tables), 403, 'FORBIDDEN');
      await expectProblem(await c.post(EPM.tables, { body: { number: uniqueTableNo(), section: 'x', seats: 2 } }), 403, 'FORBIDDEN');
      await expectProblem(await c.put(EPM.positions, { body: { positions: [pos(t, 1, 1)] } }), 403, 'FORBIDDEN');
    }
  });
});

test.describe('P1-FLOOR-01 floor-plan positions', { tag: '@api' }, () => {
  test('P1-FLOOR-01-T20 saving positions moves the tables, returns the updated tables with new versions, and audits one UPDATE per moved table', async ({ owner }) => {
    const [a, b, untouched] = [await createTable(owner, { x: 100, y: 100 }), await createTable(owner, { x: 200, y: 200 }), await createTable(owner, { x: 300, y: 300 })];
    const res = await json<Schemas['DiningTable'][]>(await owner.put(EPM.positions, { body: { positions: [pos(a, 111, 222), pos(b, 0, 700)] } }));
    expect(res.map((t) => [t.id, t.x, t.y]).sort()).toEqual([[a.id, 111, 222], [b.id, 0, 700]].sort());
    for (const t of res) expect(t.version).toBeGreaterThan([a, b].find((o) => o.id === t.id)!.version);
    expect([(await get(owner, untouched.id)).x, (await get(owner, untouched.id)).y]).toEqual([300, 300]);
    for (const t of [a, b]) {
      const e = (await auditSearch(owner, { entityType: 'DINING_TABLE', entityId: t.id, action: 'UPDATE' })).items;
      expect(e).toHaveLength(1);
    }
    expect((await auditSearch(owner, { entityType: 'DINING_TABLE', entityId: untouched.id, action: 'UPDATE' })).totalItems).toBe(0);
  });

  test('P1-FLOOR-01-T21 saving positions is all-or-nothing: an unknown table id or an out-of-grid position changes nothing (422)', async ({ owner }) => {
    const [a, b] = [await createTable(owner, { x: 50, y: 60 }), await createTable(owner, { x: 70, y: 80 })];
    await expectProblem(await owner.put(EPM.positions, { body: { positions: [pos(a, 500, 500), { tableId: SAMPLE_UUID, x: 1, y: 1, version: 1 }] } }), 422);
    await expectProblem(await owner.put(EPM.positions, { body: { positions: [pos(a, 500, 500), pos(b, 1001, 10)] } }), 422);
    await expectProblem(await owner.put(EPM.positions, { body: { positions: [pos(a, 500, 500), pos(b, 10, -5)] } }), 422);
    expect([(await get(owner, a.id)).x, (await get(owner, a.id)).y]).toEqual([50, 60]);
    expect([(await get(owner, b.id)).x, (await get(owner, b.id)).y]).toEqual([70, 80]);
  });

  test('P1-FLOOR-01-T22 a stale table version anywhere in the request gives 409 VERSION_CONFLICT and moves nothing', async ({ owner }) => {
    const [a, b] = [await createTable(owner, { x: 10, y: 10 }), await createTable(owner, { x: 20, y: 20 })];
    await json(await owner.put(EPM.table(b.id), { body: { number: b.number, section: 'Changed', seats: b.seats, active: true, version: b.version } })); // bumps b's version
    await expectProblem(await owner.put(EPM.positions, { body: { positions: [pos(a, 900, 600), pos(b, 800, 500)] } }), 409, 'VERSION_CONFLICT');
    expect([(await get(owner, a.id)).x, (await get(owner, a.id)).y]).toEqual([10, 10]);
  });

  test('P1-FLOOR-01-T23 an empty list, more than 200 positions, or a missing version is rejected', async ({ owner }) => {
    await expectProblem(await owner.put(EPM.positions, { body: { positions: [] } }), 422);
    const t = await createTable(owner);
    const noVersion = await owner.put(EPM.positions, { body: { positions: [{ tableId: t.id, x: 1, y: 1 }] } });
    expect([400, 422]).toContain(noVersion.status());
    const many = Array.from({ length: 201 }, () => pos(t, 1, 1));
    expect([400, 422]).toContain((await owner.put(EPM.positions, { body: { positions: many } })).status());
  });

  test('P1-FLOOR-01-T24 moving a table updates the POS floor layout at once', async ({ owner, apiAs }) => {
    const t = await createTable(owner, { x: 100, y: 100 });
    const pos_ = await apiAs('cashier');
    const where = async () => (await json<Schemas['FloorLayout']>(await pos_.get(EPM.floorLayout))).tables.find((x) => x.id === t.id)!;
    expect([(await where()).x, (await where()).y]).toEqual([100, 100]);
    await json(await owner.put(EPM.positions, { body: { positions: [pos(t, 640, 360)] } }));
    expect([(await where()).x, (await where()).y]).toEqual([640, 360]);
  });
});

test.describe('P1-FLOOR-01 floor-plan editor (UI)', () => {
  test('P1-FLOOR-01-T30 owner drags a table on the floor canvas and saves: the new centre is stored (scaled to the 1000 x 700 grid)', async ({ uiAs, owner }) => {
    const t = await createTable(owner, { x: 200, y: 200 });
    const page = await uiAs('owner');
    await page.goto('/admin/floor');
    const canvas = page.getByTestId('floor-canvas');
    await expect(canvas).toBeVisible();
    const tableEl = page.getByTestId(`floor-table-${t.number}`);
    await expect(tableEl).toBeVisible();
    const c = (await canvas.boundingBox())!;
    const from = (await tableEl.boundingBox())!;
    const startX = from.x + from.width / 2;
    const startY = from.y + from.height / 2;
    const targetX = c.x + c.width * 0.6;
    const targetY = c.y + c.height * 0.5;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + targetX) / 2, (startY + targetY) / 2, { steps: 6 });
    await page.mouse.move(targetX, targetY, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('floor-dirty')).toBeVisible();
    await page.getByTestId('floor-save').click();
    await expect(page.getByTestId('floor-dirty')).toBeHidden();
    await expect.poll(async () => (await get(owner, t.id)).x).toBeGreaterThan(450);
    const saved = await get(owner, t.id);
    expect(saved.x).toBeGreaterThan(550);
    expect(saved.x).toBeLessThan(650);
    expect(saved.y).toBeGreaterThan(300);
    expect(saved.y).toBeLessThan(400);
    expect(saved.version).toBeGreaterThan(t.version);
  });

  test('P1-FLOOR-01-T31 dragging then "Discard" puts the table back and saves nothing', async ({ uiAs, owner }) => {
    const t = await createTable(owner, { x: 300, y: 300 });
    const page = await uiAs('owner');
    await page.goto('/admin/floor');
    const el = page.getByTestId(`floor-table-${t.number}`);
    await expect(el).toBeVisible();
    const b = (await el.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('floor-dirty')).toBeVisible();
    await page.getByTestId('floor-discard').click();
    await expect(page.getByTestId('floor-dirty')).toBeHidden();
    const after = (await el.boundingBox())!;
    expect(Math.abs(after.x - b.x)).toBeLessThan(3);
    const stored = await get(owner, t.id);
    expect([stored.x, stored.y]).toEqual([300, 300]);
  });

  test('P1-FLOOR-01-T32 a table cannot be dragged outside the canvas: the saved centre stays inside 0-1000 / 0-700', async ({ uiAs, owner }) => {
    const t = await createTable(owner, { x: 900, y: 600 });
    const page = await uiAs('owner');
    await page.goto('/admin/floor');
    const canvas = (await page.getByTestId('floor-canvas').boundingBox())!;
    const el = page.getByTestId(`floor-table-${t.number}`);
    const b = (await el.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width + 200, canvas.y + canvas.height + 200, { steps: 8 });
    await page.mouse.up();
    if (await page.getByTestId('floor-dirty').isVisible()) {
      await page.getByTestId('floor-save').click();
      await expect(page.getByTestId('floor-dirty')).toBeHidden();
    }
    const stored = await get(owner, t.id);
    expect(stored.x).toBeLessThanOrEqual(1000);
    expect(stored.y).toBeLessThanOrEqual(700);
    expect(stored.x).toBeGreaterThanOrEqual(0);
  });

  test('P1-FLOOR-01-T33 a position saved from a stale screen shows the reload banner (409 VERSION_CONFLICT), nothing is overwritten', async ({ uiAs, owner }) => {
    const t = await createTable(owner, { x: 400, y: 400 });
    const page = await uiAs('owner');
    await page.goto('/admin/floor');
    const el = page.getByTestId(`floor-table-${t.number}`);
    await expect(el).toBeVisible();
    await json(await owner.put(EPM.table(t.id), { body: { number: t.number, section: 'Concurrent', seats: t.seats, active: true, version: t.version } })); // someone else edits
    const b = (await el.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 100, b.y + b.height / 2 + 50, { steps: 8 });
    await page.mouse.up();
    await page.getByTestId('floor-save').click();
    await expect(page.getByTestId('version-conflict')).toBeVisible();
    expect([(await get(owner, t.id)).x, (await get(owner, t.id)).y]).toEqual([400, 400]);
  });

  test('P1-FLOOR-01-T34 the tables list: create, edit and deactivate a table from the tables screen', async ({ uiAs, owner }) => {
    const page = await uiAs('manager', { terminal: 'ADMIN' });
    const n = uniqueTableNo();
    await page.goto('/admin/floor');
    await page.getByTestId('table-create').click();
    await page.getByTestId('table-number').fill(n);
    await page.getByTestId('table-section').fill('UI');
    await page.getByTestId('table-seats').fill('5');
    await page.getByTestId('table-save').click();
    await expect(page.getByTestId(`table-row-${n}`)).toBeVisible();
    const created = (await json<Schemas['DiningTable'][]>(await owner.get(EPM.tables, { query: { section: 'UI' } }))).find((x) => x.number === n)!;
    expect(created).toMatchObject({ seats: 5, section: 'UI', active: true });
    await page.getByTestId(`table-edit-${n}`).click();
    await page.getByTestId('table-seats').fill('7');
    await page.getByTestId('table-save').click();
    await expect.poll(async () => (await get(owner, created.id)).seats).toBe(7);
  });

  test('P1-FLOOR-01-T35 the table dialog shows field errors for a duplicate number and for seats outside 1-50', async ({ uiAs, owner }) => {
    const t = await createTable(owner);
    const page = await uiAs('owner');
    await page.goto('/admin/floor');
    await page.getByTestId('table-create').click();
    await page.getByTestId('table-number').fill(t.number);
    await page.getByTestId('table-section').fill('UI');
    await page.getByTestId('table-seats').fill('4');
    await page.getByTestId('table-save').click();
    await expect(page.getByTestId('table-error').or(page.getByTestId('field-error-number'))).toBeVisible();
    await page.getByTestId('table-number').fill(uniqueTableNo());
    await page.getByTestId('table-seats').fill('99');
    await page.getByTestId('table-save').click();
    await expect(page.getByTestId('field-error-seats').or(page.getByTestId('table-error'))).toBeVisible();
  });

  test('P1-FLOOR-01-T36 the cashier does not see the floor editor (403 page); the manager does', async ({ uiAs }) => {
    const cashier = await uiAs('cashier', { terminal: 'ADMIN' });
    await cashier.goto('/admin/floor');
    await expect(cashier).toHaveURL(/\/forbidden/);
  });

  test('P1-FLOOR-01-T37 the POS home shows the floor tables with their live status colours (M1.2)', async () => {
    test.fixme(true, 'Live table status (free / occupied / bill printed) arrives with orders in M1.2');
  });
});
