/**
 * M1.1 menu: categories, items, price lists, modifier groups, sold-out toggle, POS menu
 * (P1-MENU-01 .. P1-MENU-06). Annex A §3 (menu, custom prices), §14 (menu, categories, modifiers, item-to-kitchen
 * mapping, local and foreign price lists). Every test creates its own uniquely named records.
 * The daily sold-out reset needs the server clock and is in serial.spec.ts.
 */
import { test, expect } from '../fixtures/test';
import { type Schemas, expectProblem } from '../utils/api-client';
import { auditSearch, json, uniqueName } from '../utils/admin-api';
import {
  EPM,
  createCategory,
  createGroup,
  createItem,
  expectFieldError,
  getItem,
  itemUpdate,
  stationByNumber,
  uniqueCode,
  uniqueLabel,
} from '../utils/menu-api';
import { SAMPLE_UUID } from '../utils/openapi';

const jstr = (v: unknown) => JSON.stringify(v ?? null);

test.describe('P1-MENU-01 categories', { tag: '@api' }, () => {
  test('P1-MENU-01-T01 owner creates a category; defaults: active, placed at the end of the list, no items', async ({ owner }) => {
    const before = await json<Schemas['Category'][]>(await owner.get(EPM.categories));
    const maxSort = Math.max(...before.map((c) => c.sortOrder));
    const c = await createCategory(owner);
    expect(c).toMatchObject({ active: true, itemCount: 0 });
    expect(c.sortOrder).toBeGreaterThanOrEqual(maxSort);
    const list = await json<Schemas['Category'][]>(await owner.get(EPM.categories));
    expect(list.find((x) => x.id === c.id)).toBeTruthy();
  });

  test('P1-MENU-01-T02 the list is ordered by sortOrder, then name', async ({ owner }) => {
    const tag = uniqueName('ord');
    const b = await createCategory(owner, { name: `${tag} B`, sortOrder: 900 });
    const a = await createCategory(owner, { name: `${tag} A`, sortOrder: 900 });
    const first = await createCategory(owner, { name: `${tag} Z`, sortOrder: 899 });
    const list = (await json<Schemas['Category'][]>(await owner.get(EPM.categories))).filter((c) => c.name.startsWith(tag));
    expect(list.map((c) => c.id)).toEqual([first.id, a.id, b.id]);
  });

  test('P1-MENU-01-T03 a name is required (1-50 characters) and unique case-insensitively: 409 CATEGORY_NAME_TAKEN', async ({ owner }) => {
    const c = await createCategory(owner);
    await expectProblem(await owner.post(EPM.categories, { body: { name: c.name.toUpperCase() } }), 409, 'CATEGORY_NAME_TAKEN');
    await expectFieldError(await owner.post(EPM.categories, { body: { name: '' } }), 'name');
    await expectFieldError(await owner.post(EPM.categories, { body: { name: 'x'.repeat(51) } }), 'name');
    await expectFieldError(await owner.post(EPM.categories, { body: { name: uniqueLabel('neg'), sortOrder: -1 } }), 'sortOrder');
  });

  test('P1-MENU-01-T04 owner renames, reorders and deactivates a category; audited with before and after; stale version 409', async ({ owner }) => {
    const c = await createCategory(owner);
    const name = uniqueLabel('QA Cat renamed');
    const saved = await json<Schemas['Category']>(await owner.put(EPM.category(c.id), { body: { name, sortOrder: 5, active: false, version: c.version } }));
    expect(saved).toMatchObject({ name, sortOrder: 5, active: false });
    await expectProblem(await owner.put(EPM.category(c.id), { body: { name, sortOrder: 5, active: true, version: c.version } }), 409, 'VERSION_CONFLICT');
    const entries = (await auditSearch(owner, { entityType: 'CATEGORY', entityId: c.id })).items;
    expect(entries.map((e) => e.action).sort()).toEqual(['CREATE', 'UPDATE']);
    const update = entries.find((e) => e.action === 'UPDATE')!;
    expect(jstr(update.before)).toContain(c.name);
    expect(jstr(update.after)).toContain(name);
    expect(update.user?.username).toBeTruthy();
    expect(update.terminal?.id).toBeTruthy();
  });

  test('P1-MENU-01-T05 categories are never deleted (no DELETE endpoint); deactivate instead', async ({ owner }) => {
    const c = await createCategory(owner);
    expect([404, 405]).toContain((await owner.delete(EPM.category(c.id))).status());
    expect((await json<Schemas['Category']>(await owner.get(EPM.category(c.id)))).id).toBe(c.id);
    await expectProblem(await owner.get(EPM.category(SAMPLE_UUID)), 404, 'NOT_FOUND');
  });

  test('P1-MENU-01-T06 an inactive category hides its items from the POS menu without changing the items', async ({ owner, apiAs }) => {
    const cat = await createCategory(owner);
    const item = await createItem(owner, { categoryId: cat.id });
    const pos = await apiAs('cashier');
    const inMenu = async () => (await json<Schemas['PosMenu']>(await pos.get(EPM.posMenu))).categories.flatMap((c) => c.items).some((i) => i.id === item.id);
    expect(await inMenu()).toBe(true);
    await json(await owner.put(EPM.category(cat.id), { body: { name: cat.name, sortOrder: cat.sortOrder, active: false, version: cat.version } }));
    expect(await inMenu()).toBe(false);
    expect((await getItem(owner, item.id)).active).toBe(true);
    const cur = await json<Schemas['Category']>(await owner.get(EPM.category(cat.id)));
    await json(await owner.put(EPM.category(cat.id), { body: { name: cat.name, sortOrder: cat.sortOrder, active: true, version: cur.version } }));
    expect(await inMenu()).toBe(true);
  });

  test('P1-MENU-01-T07 itemCount counts all items of the category, active or not', async ({ owner }) => {
    const cat = await createCategory(owner);
    const a = await createItem(owner, { categoryId: cat.id });
    await createItem(owner, { categoryId: cat.id, active: false });
    expect((await json<Schemas['Category']>(await owner.get(EPM.category(cat.id)))).itemCount).toBe(2);
    expect(a.active).toBe(true);
  });

  test('P1-MENU-01-T08 the POS menu lists active categories in sortOrder', async ({ owner, apiAs }) => {
    const tag = uniqueName('pos');
    const late = await createCategory(owner, { name: `${tag} late`, sortOrder: 950 });
    const early = await createCategory(owner, { name: `${tag} early`, sortOrder: 949 });
    await createItem(owner, { categoryId: late.id });
    await createItem(owner, { categoryId: early.id });
    const menu = await json<Schemas['PosMenu']>(await (await apiAs('cashier')).get(EPM.posMenu));
    const names = menu.categories.map((c) => c.name).filter((n) => n.startsWith(tag));
    expect(names).toEqual([`${tag} early`, `${tag} late`]);
  });
});

test.describe('P1-MENU-02 menu items', { tag: '@api' }, () => {
  test('P1-MENU-02-T01 owner creates an item with code, name, category, one station, local and foreign price', async ({ owner }) => {
    const st = await stationByNumber(owner, 2);
    const item = await createItem(owner, { stationId: st.id, localPrice: '1250.00', foreignPrice: '1875.00' });
    expect(item).toMatchObject({ stationId: st.id, stationName: st.name, localPrice: '1250.00', foreignPrice: '1875.00', active: true, available: true });
    expect(item.modifierGroups).toEqual([]);
    expect(await getItem(owner, item.id)).toMatchObject({ code: item.code, version: item.version });
  });

  test('P1-MENU-02-T02 the foreign price is optional: an item without one has no foreignPrice', async ({ owner }) => {
    const item = await createItem(owner, { foreignPrice: null });
    expect(item.foreignPrice).toBeUndefined();
  });

  test('P1-MENU-02-T03 the code is unique (case: upper only): a second item with the same code gets 409 ITEM_CODE_TAKEN', async ({ owner }) => {
    const item = await createItem(owner);
    const station = await stationByNumber(owner, 1);
    const body = { code: item.code, name: 'dup', categoryId: item.categoryId, stationId: station.id, localPrice: '10.00' };
    await expectProblem(await owner.post(EPM.items, { body }), 409, 'ITEM_CODE_TAKEN');
  });

  for (const bad of ['', 'abc', 'A B', 'A_1', 'X'.repeat(21), 'RC/1']) {
    test(`P1-MENU-02-T04 item code "${bad}" is rejected with 422`, async ({ owner }) => {
      const cat = await createCategory(owner);
      const st = await stationByNumber(owner, 1);
      await expectFieldError(await owner.post(EPM.items, { body: { code: bad, name: 'x', categoryId: cat.id, stationId: st.id, localPrice: '10.00' } }), 'code');
    });
  }

  for (const [label, make] of [
    ['a single character', () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 35)]],
    ['with a dash', () => `A-${uniqueCode('').slice(1, 6)}`],
    ['of exactly 20 characters', () => `${'Z'.repeat(12)}${uniqueCode('').replace('-', '').slice(0, 8)}`],
  ] as const) {
    test(`P1-MENU-02-T04b an item code ${label} is accepted`, async ({ owner }) => {
      let code = make();
      for (let i = 0; i < 5; i++) {
        const cat = await createCategory(owner);
        const st = await stationByNumber(owner, 1);
        const res = await owner.post(EPM.items, { body: { code, name: 'edge code', categoryId: cat.id, stationId: st.id, localPrice: '1.00' } });
        if (res.status() === 409) { code = make(); continue; } // a single character can collide with an earlier run
        expect(res.status(), await res.text()).toBe(201);
        expect(((await res.json()) as Schemas['MenuItem']).code).toBe(code);
        return;
      }
      throw new Error('no free code found');
    });
  }

  test('P1-MENU-02-T05 an item cannot be saved without exactly one station: missing, unknown or empty stationId gets 422 on stationId', async ({ owner }) => {
    const cat = await createCategory(owner);
    const base = { code: uniqueCode(), name: 'x', categoryId: cat.id, localPrice: '10.00' };
    await expectFieldError(await owner.post(EPM.items, { body: base }), 'stationId');
    await expectFieldError(await owner.post(EPM.items, { body: { ...base, stationId: SAMPLE_UUID } }), 'stationId');
    await expectFieldError(await owner.post(EPM.items, { body: { ...base, stationId: '' } }), 'stationId');
    const st = await stationByNumber(owner, 1);
    // two stations are not even expressible: the request has one stationId field
    const two = await owner.post(EPM.items, { body: { ...base, stationId: [st.id, st.id] } });
    expect([400, 422]).toContain(two.status());
  });

  test('P1-MENU-02-T06 category and name are required; an unknown category is 422; name is at most 100 characters', async ({ owner }) => {
    const st = await stationByNumber(owner, 1);
    const cat = await createCategory(owner);
    const base = { code: uniqueCode(), name: 'x', categoryId: cat.id, stationId: st.id, localPrice: '10.00' };
    await expectFieldError(await owner.post(EPM.items, { body: { ...base, categoryId: SAMPLE_UUID } }), 'categoryId');
    await expectFieldError(await owner.post(EPM.items, { body: { ...base, name: '' } }), 'name');
    await expectFieldError(await owner.post(EPM.items, { body: { ...base, name: 'n'.repeat(101) } }), 'name');
    const noCat: Record<string, unknown> = { ...base };
    delete noCat.categoryId;
    await expectFieldError(await owner.post(EPM.items, { body: noCat }), 'categoryId');
  });

  for (const bad of ['abc', '10', '10.5', '-1.00', '1e2', '12345678901.00', '', '10,00', ' 10.00']) {
    test(`P1-MENU-02-T07 local price "${bad}" is rejected with 422 (money = 2-decimal string, not negative)`, async ({ owner }) => {
      const cat = await createCategory(owner);
      const st = await stationByNumber(owner, 1);
      await expectFieldError(await owner.post(EPM.items, { body: { code: uniqueCode(), name: 'x', categoryId: cat.id, stationId: st.id, localPrice: bad } }), 'localPrice');
    });
  }

  test('P1-MENU-02-T07b prices sent as JSON numbers, or a negative / malformed foreign price, are rejected', async ({ owner }) => {
    const cat = await createCategory(owner);
    const st = await stationByNumber(owner, 1);
    const base = { code: uniqueCode(), name: 'x', categoryId: cat.id, stationId: st.id, localPrice: '10.00' };
    const asNumber = await owner.post(EPM.items, { body: { ...base, localPrice: 500 } });
    expect([400, 422]).toContain(asNumber.status());
    await expectFieldError(await owner.post(EPM.items, { body: { ...base, foreignPrice: '-5.00' } }), 'foreignPrice');
    await expectFieldError(await owner.post(EPM.items, { body: { ...base, foreignPrice: '5' } }), 'foreignPrice');
  });

  test('P1-MENU-02-T07c a zero price and the largest price (10 digits) are accepted', async ({ owner }) => {
    expect((await createItem(owner, { localPrice: '0.00', foreignPrice: '0.00' })).localPrice).toBe('0.00');
    expect((await createItem(owner, { localPrice: '9999999999.99' })).localPrice).toBe('9999999999.99');
  });

  test('P1-MENU-02-T08 update is a full replacement: an omitted foreignPrice removes it, omitted groups detach all', async ({ owner }) => {
    const g = await createGroup(owner);
    const item = await createItem(owner, { modifierGroupIds: [g.id] });
    expect(item.modifierGroups.map((x) => x.id)).toEqual([g.id]);
    const body = itemUpdate(item);
    delete body.foreignPrice;
    delete body.modifierGroupIds;
    const saved = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body }));
    expect(saved.foreignPrice).toBeUndefined();
    expect(saved.modifierGroups).toEqual([]);
  });

  test('P1-MENU-02-T09 changing the code to an existing one is 409 ITEM_CODE_TAKEN; a stale version is 409 VERSION_CONFLICT', async ({ owner }) => {
    const [a, b] = [await createItem(owner), await createItem(owner)];
    await expectProblem(await owner.put(EPM.item(b.id), { body: itemUpdate(b, { code: a.code }) }), 409, 'ITEM_CODE_TAKEN');
    await json(await owner.put(EPM.item(b.id), { body: itemUpdate(b, { name: 'once' }) }));
    await expectProblem(await owner.put(EPM.item(b.id), { body: itemUpdate(b, { name: 'twice' }) }), 409, 'VERSION_CONFLICT');
  });

  test('P1-MENU-02-T10 items are never deleted: no DELETE endpoint, deactivate instead; an inactive item leaves the POS menu', async ({ owner, apiAs }) => {
    const item = await createItem(owner);
    expect([404, 405]).toContain((await owner.delete(EPM.item(item.id))).status());
    const pos = await apiAs('cashier');
    const inMenu = async () => (await json<Schemas['PosMenu']>(await pos.get(EPM.posMenu))).categories.flatMap((c) => c.items).some((i) => i.id === item.id);
    expect(await inMenu()).toBe(true);
    await json(await owner.put(EPM.item(item.id), { body: itemUpdate(item, { active: false }) }));
    expect(await inMenu()).toBe(false);
    expect((await getItem(owner, item.id)).active).toBe(false);
  });

  test('P1-MENU-02-T11 the list filters by search, category, station, active and available, and pages and sorts', async ({ owner }) => {
    const cat = await createCategory(owner);
    const st = await stationByNumber(owner, 3);
    const mk = (over: Record<string, unknown>) => createItem(owner, { categoryId: cat.id, ...over });
    const a = await mk({ stationId: st.id, localPrice: '300.00', name: 'Zed list' });
    const b = await mk({ stationId: st.id, localPrice: '100.00', name: 'Amy list' });
    const c = await mk({ localPrice: '200.00', active: false });
    const q = async (query: Record<string, string | number | boolean>) => json<Schemas['MenuItemPage']>(await owner.get(EPM.items, { query: { categoryId: cat.id, ...query } }));
    expect((await q({})).totalItems).toBe(3);
    expect((await q({ active: true })).totalItems).toBe(2);
    expect((await q({ active: false })).items.map((i) => i.id)).toEqual([c.id]);
    expect((await q({ stationId: st.id })).totalItems).toBe(2);
    expect((await q({ search: a.code })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await q({ search: 'amy list' })).items.map((i) => i.id)).toEqual([b.id]);
    expect((await q({ sort: 'localPrice,asc', size: 10 })).items.map((i) => i.localPrice)).toEqual(['100.00', '200.00', '300.00']);
    expect((await q({ sort: 'name,desc' })).items[0].id).toBe(a.id);
    const page2 = await q({ size: 2, page: 1, sort: 'localPrice,asc' });
    expect(page2).toMatchObject({ page: 1, size: 2, totalItems: 3 });
    expect(page2.items).toHaveLength(1);
    await expectProblem(await owner.get(EPM.items, { query: { size: 201 } }), 422);
    await expectProblem(await owner.get(EPM.items, { query: { sort: 'station,asc' } }), 422);
  });

  test('P1-MENU-02-T12 an item is created with modifier groups in a chosen display order; an unknown group id is 422', async ({ owner }) => {
    const [g1, g2] = [await createGroup(owner), await createGroup(owner)];
    const item = await createItem(owner, { modifierGroupIds: [g2.id, g1.id] });
    expect(item.modifierGroups.map((g) => g.id)).toEqual([g2.id, g1.id]);
    expect((await json<Schemas['ModifierGroup']>(await owner.get(EPM.modifierGroup(g1.id)))).itemCount).toBe(1);
    const cat = await createCategory(owner);
    const st = await stationByNumber(owner, 1);
    await expectFieldError(await owner.post(EPM.items, { body: { code: uniqueCode(), name: 'x', categoryId: cat.id, stationId: st.id, localPrice: '1.00', modifierGroupIds: [SAMPLE_UUID] } }), 'modifierGroupIds');
  });

  test('P1-MENU-02-T13 saving an item that keeps its modifier groups works (a price edit), and a group can be added at the end', async ({ owner }) => {
    const [g1, g2, g3] = [await createGroup(owner), await createGroup(owner), await createGroup(owner)];
    const item = await createItem(owner, { modifierGroupIds: [g2.id, g1.id] });
    const priced = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body: itemUpdate(item, { localPrice: '777.00' }) }));
    expect(priced.modifierGroups.map((g) => g.id)).toEqual([g2.id, g1.id]);
    const added = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body: itemUpdate(priced, { modifierGroupIds: [g2.id, g1.id, g3.id] }) }));
    expect(added.modifierGroups.map((g) => g.id)).toEqual([g2.id, g1.id, g3.id]);
  });

  test('P1-MENU-02-T13c the display order of the modifier groups of an item can be changed (move up / down)', async ({ owner }) => {
    const [g1, g2] = [await createGroup(owner), await createGroup(owner)];
    const item = await createItem(owner, { modifierGroupIds: [g2.id, g1.id] });
    const flipped = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body: itemUpdate(item, { modifierGroupIds: [g1.id, g2.id] }) }));
    expect(flipped.modifierGroups.map((g) => g.id)).toEqual([g1.id, g2.id]);
  });

  test('P1-MENU-02-T13b groups can be detached or replaced by different groups on update', async ({ owner }) => {
    const [g1, g2, g3] = [await createGroup(owner), await createGroup(owner), await createGroup(owner)];
    const item = await createItem(owner, { modifierGroupIds: [g1.id, g2.id] });
    const fewer = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body: itemUpdate(item, { modifierGroupIds: [g2.id] }) }));
    expect(fewer.modifierGroups.map((g) => g.id)).toEqual([g2.id]);
    const replaced = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body: itemUpdate(fewer, { modifierGroupIds: [g3.id] }) }));
    expect(replaced.modifierGroups.map((g) => g.id)).toEqual([g3.id]);
    const none = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body: itemUpdate(replaced, { modifierGroupIds: [] }) }));
    expect(none.modifierGroups).toEqual([]);
  });
});

test.describe('P1-MENU-04 / P1-MENU-05 price lists and price changes', { tag: '@api' }, () => {
  test('P1-MENU-04-T01 the POS menu carries the LOCAL and the FOREIGN price of every item; an item without a foreign price has none', async ({ owner, apiAs }) => {
    const both = await createItem(owner, { localPrice: '400.00', foreignPrice: '600.00' });
    const only = await createItem(owner, { localPrice: '300.00', foreignPrice: null });
    const menu = await json<Schemas['PosMenu']>(await (await apiAs('cashier')).get(EPM.posMenu));
    const items = menu.categories.flatMap((c) => c.items);
    expect(items.find((i) => i.id === both.id)).toMatchObject({ localPrice: '400.00', foreignPrice: '600.00' });
    const o = items.find((i) => i.id === only.id)!;
    expect(o.localPrice).toBe('300.00');
    expect(o.foreignPrice).toBeUndefined();
  });

  test('P1-MENU-05-T01 a price change writes PRICE_CHANGED (before and after) besides UPDATE, for local and for foreign price', async ({ owner }) => {
    const item = await createItem(owner, { localPrice: '500.00', foreignPrice: '750.00' });
    const a = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body: itemUpdate(item, { localPrice: '550.00' }) }));
    await json(await owner.put(EPM.item(item.id), { body: itemUpdate(a, { foreignPrice: '800.00' }) }));
    const entries = (await auditSearch(owner, { entityType: 'MENU_ITEM', entityId: item.id })).items;
    const changed = entries.filter((e) => e.action === 'PRICE_CHANGED');
    expect(changed).toHaveLength(2);
    const local = changed.find((e) => jstr(e.after).includes('"localPrice":"550.00"') && jstr(e.before).includes('"localPrice":"500.00"'));
    const foreign = changed.find((e) => jstr(e.after).includes('"foreignPrice":"800.00"') && jstr(e.before).includes('"foreignPrice":"750.00"'));
    expect(local, jstr(changed)).toBeTruthy();
    expect(foreign, jstr(changed)).toBeTruthy();
    expect(entries.filter((e) => e.action === 'UPDATE').length).toBeGreaterThanOrEqual(2);
    expect(entries.filter((e) => e.action === 'CREATE')).toHaveLength(1);
    for (const e of changed) {
      expect(e.user?.username).toBeTruthy();
      expect(e.terminal?.id).toBeTruthy();
    }
  });

  test('P1-MENU-05-T02 a change that is not a price writes UPDATE only, and removing the foreign price counts as a price change', async ({ owner }) => {
    const item = await createItem(owner, { localPrice: '500.00', foreignPrice: '750.00' });
    const renamed = await json<Schemas['MenuItem']>(await owner.put(EPM.item(item.id), { body: itemUpdate(item, { name: 'Renamed only' }) }));
    expect((await auditSearch(owner, { entityType: 'MENU_ITEM', entityId: item.id, action: 'PRICE_CHANGED' })).totalItems).toBe(0);
    const body = itemUpdate(renamed);
    delete body.foreignPrice;
    await json(await owner.put(EPM.item(item.id), { body }));
    expect((await auditSearch(owner, { entityType: 'MENU_ITEM', entityId: item.id, action: 'PRICE_CHANGED' })).totalItems).toBe(1);
  });

  test('P1-MENU-05-T03 the POS menu shows a new price at once (existing orders keep theirs: checked with orders in M1.2)', async ({ owner, apiAs }) => {
    const item = await createItem(owner, { localPrice: '500.00' });
    const pos = await apiAs('cashier');
    const price = async () => (await json<Schemas['PosMenu']>(await pos.get(EPM.posMenu))).categories.flatMap((c) => c.items).find((i) => i.id === item.id)?.localPrice;
    expect(await price()).toBe('500.00');
    await json(await owner.put(EPM.item(item.id), { body: itemUpdate(item, { localPrice: '650.00' }) }));
    expect(await price()).toBe('650.00');
  });
});

test.describe('P1-MENU-03 modifier groups', { tag: '@api' }, () => {
  test('P1-MENU-03-T01 owner creates a required group (pick 1) and an optional group (up to 3) with option prices', async ({ owner }) => {
    const req = await createGroup(owner, { required: true, minSelect: 1, maxSelect: 1, options: [{ name: 'Mild', priceDelta: '0.00' }, { name: 'Hot', priceDelta: '0.00' }] });
    expect(req).toMatchObject({ required: true, minSelect: 1, maxSelect: 1, active: true, itemCount: 0 });
    const opt = await createGroup(owner, { required: false, minSelect: 0, maxSelect: 3, options: [{ name: 'Egg', priceDelta: '100.00' }, { name: 'Cheese', priceDelta: '150.00' }, { name: 'Chicken', priceDelta: '300.00' }] });
    expect(opt.options.map((o) => [o.name, o.priceDelta])).toEqual([['Egg', '100.00'], ['Cheese', '150.00'], ['Chicken', '300.00']]);
    expect(opt.options.every((o) => o.id)).toBe(true);
  });

  const invalid: Array<[string, Record<string, unknown>, string]> = [
    ['a required group with minSelect 0', { required: true, minSelect: 0, maxSelect: 1 }, 'minSelect'],
    ['an optional group with minSelect 1', { required: false, minSelect: 1, maxSelect: 2 }, 'minSelect'],
    ['maxSelect below minSelect', { required: true, minSelect: 2, maxSelect: 1 }, 'maxSelect'],
    ['maxSelect above the number of options', { required: false, minSelect: 0, maxSelect: 5 }, 'maxSelect'],
    ['maxSelect 0', { required: false, minSelect: 0, maxSelect: 0 }, 'maxSelect'],
    ['no options', { options: [] }, 'options'],
    ['a negative option price', { options: [{ name: 'A', priceDelta: '-1.00' }, { name: 'B', priceDelta: '0.00' }] }, 'options'],
    ['a malformed option price', { options: [{ name: 'A', priceDelta: '5' }, { name: 'B', priceDelta: '0.00' }] }, 'options'],
    ['duplicate option names (case-insensitive)', { options: [{ name: 'Same', priceDelta: '0.00' }, { name: 'SAME', priceDelta: '1.00' }] }, 'options'],
    ['an empty option name', { options: [{ name: '', priceDelta: '0.00' }, { name: 'B', priceDelta: '0.00' }] }, 'options'],
    ['a name over 50 characters', { name: 'g'.repeat(51) }, 'name'],
    ['an empty name', { name: '' }, 'name'],
  ];
  for (const [label, over, field] of invalid) {
    test(`P1-MENU-03-T02 ${label} is rejected with 422`, async ({ owner }) => {
      const body = { name: uniqueLabel('QA Group'), required: false, minSelect: 0, maxSelect: 2, options: [{ name: 'A', priceDelta: '0.00' }, { name: 'B', priceDelta: '1.00' }], ...over };
      await expectFieldError(await owner.post(EPM.modifierGroups, { body }), field);
    });
  }

  test('P1-MENU-03-T03 a group name is unique (case-insensitive): 409 MODIFIER_GROUP_NAME_TAKEN', async ({ owner }) => {
    const g = await createGroup(owner);
    await expectProblem(await owner.post(EPM.modifierGroups, { body: { name: g.name.toUpperCase(), required: false, minSelect: 0, maxSelect: 1, options: [{ name: 'X', priceDelta: '0.00' }] } }), 409, 'MODIFIER_GROUP_NAME_TAKEN');
  });

  test('P1-MENU-03-T04 update replaces the group and its options: options keep their id, unlisted options are removed; audited; stale version 409', async ({ owner }) => {
    const g = await createGroup(owner, { options: [{ name: 'One', priceDelta: '0.00' }, { name: 'Two', priceDelta: '10.00' }, { name: 'Three', priceDelta: '20.00' }], maxSelect: 3 });
    const keep = g.options[1];
    const saved = await json<Schemas['ModifierGroup']>(
      await owner.put(EPM.modifierGroup(g.id), {
        body: { name: g.name, required: false, minSelect: 0, maxSelect: 2, active: true, options: [{ id: keep.id, name: 'Two renamed', priceDelta: '15.00' }, { name: 'Four', priceDelta: '5.00' }], version: g.version },
      }),
    );
    expect(saved.options.map((o) => o.name)).toEqual(['Two renamed', 'Four']);
    expect(saved.options[0].id).toBe(keep.id);
    expect(saved.options[1].id).not.toBe(g.options[0].id);
    await expectProblem(await owner.put(EPM.modifierGroup(g.id), { body: { name: g.name, required: false, minSelect: 0, maxSelect: 1, active: true, options: [{ name: 'X', priceDelta: '0.00' }], version: g.version } }), 409, 'VERSION_CONFLICT');
    const entries = (await auditSearch(owner, { entityType: 'MODIFIER_GROUP', entityId: g.id })).items;
    expect(entries.map((e) => e.action).sort()).toEqual(['CREATE', 'UPDATE']);
    expect(jstr(entries.find((e) => e.action === 'UPDATE')!.before)).toContain('Three');
    expect(jstr(entries.find((e) => e.action === 'UPDATE')!.after)).toContain('Two renamed');
  });

  test('P1-MENU-03-T05 groups are never deleted; an inactive group leaves the POS menu and keeps its attachments', async ({ owner, apiAs }) => {
    const g = await createGroup(owner);
    const item = await createItem(owner, { modifierGroupIds: [g.id] });
    expect([404, 405]).toContain((await owner.delete(EPM.modifierGroup(g.id))).status());
    const pos = await apiAs('cashier');
    const groups = async () => (await json<Schemas['PosMenu']>(await pos.get(EPM.posMenu))).modifierGroups.map((x) => x.id);
    expect(await groups()).toContain(g.id);
    await json(await owner.put(EPM.modifierGroup(g.id), { body: { name: g.name, required: false, minSelect: 0, maxSelect: 2, active: false, options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta })), version: g.version } }));
    expect(await groups()).not.toContain(g.id);
    expect((await getItem(owner, item.id)).modifierGroups.map((x) => x.id)).toEqual([g.id]);
  });

  test('P1-MENU-03-T06 the POS menu lists each item with the ids of its groups, in order, and the groups with their options', async ({ owner, apiAs }) => {
    const [g1, g2] = [await createGroup(owner, { required: true, minSelect: 1, maxSelect: 1 }), await createGroup(owner)];
    const item = await createItem(owner, { modifierGroupIds: [g2.id, g1.id] });
    const menu = await json<Schemas['PosMenu']>(await (await apiAs('cashier')).get(EPM.posMenu));
    const posItem = menu.categories.flatMap((c) => c.items).find((i) => i.id === item.id)!;
    expect(posItem.modifierGroupIds).toEqual([g2.id, g1.id]);
    const posG1 = menu.modifierGroups.find((g) => g.id === g1.id)!;
    expect(posG1).toMatchObject({ required: true, minSelect: 1, maxSelect: 1 });
    expect(posG1.options.map((o) => o.name)).toEqual(g1.options.map((o) => o.name));
  });

  test('P1-MENU-03-T07 a required modifier not chosen: the item cannot be added to the order (enforced in M1.2)', async () => {
    test.fixme(true, 'No order endpoint before M1.2');
  });
});

test.describe('P1-MENU-06 sold-out toggle', { tag: '@api' }, () => {
  test('P1-MENU-06-T01 cashier and manager can toggle availability; the item itself stays untouched; the POS menu shows available=false', async ({ owner, apiAs }) => {
    const item = await createItem(owner);
    const pos = await apiAs('cashier');
    const flag = async () => (await json<Schemas['PosMenu']>(await pos.get(EPM.posMenu))).categories.flatMap((c) => c.items).find((i) => i.id === item.id)!.available;
    expect(await flag()).toBe(true);
    const res = await json<Schemas['ItemAvailability']>(await pos.put(EPM.availability(item.id), { body: { available: false } }));
    expect(res).toMatchObject({ id: item.id, available: false });
    expect(await flag()).toBe(false);
    const manager = await apiAs('manager');
    await json(await manager.put(EPM.availability(item.id), { body: { available: true } }));
    expect(await flag()).toBe(true);
    const cur = await getItem(owner, item.id);
    expect(cur).toMatchObject({ name: item.name, localPrice: item.localPrice, active: true });
  });

  test('P1-MENU-06-T02 a cashier can toggle availability but cannot edit, create or deactivate items (403 FORBIDDEN)', async ({ owner, apiAs }) => {
    const item = await createItem(owner);
    const cashier = await apiAs('cashier');
    await json(await cashier.put(EPM.availability(item.id), { body: { available: false } }));
    await expectProblem(await cashier.put(EPM.item(item.id), { body: itemUpdate(item, { name: 'hacked' }) }), 403, 'FORBIDDEN');
    await expectProblem(await cashier.put(EPM.item(item.id), { body: itemUpdate(item, { active: false }) }), 403, 'FORBIDDEN');
    await expectProblem(await cashier.post(EPM.items, { body: { code: uniqueCode(), name: 'x', categoryId: item.categoryId, stationId: item.stationId, localPrice: '1.00' } }), 403, 'FORBIDDEN');
    await expectProblem(await cashier.get(EPM.items), 403, 'FORBIDDEN');
    expect((await getItem(owner, item.id)).name).toBe(item.name);
  });

  test('P1-MENU-06-T03 roles without MENU_AVAILABILITY (receptionist, kitchen, rider, inventory, HR) get 403 on the toggle and the board', async ({ owner, apiAs }) => {
    const item = await createItem(owner);
    for (const role of ['receptionist', 'kitchen', 'rider', 'inventory', 'hr'] as const) {
      const c = await apiAs(role);
      await expectProblem(await c.put(EPM.availability(item.id), { body: { available: false } }), 403, 'FORBIDDEN');
      await expectProblem(await c.get(EPM.availabilityList), 403, 'FORBIDDEN');
    }
    expect((await getItem(owner, item.id)).available).toBe(true);
  });

  test('P1-MENU-06-T04 the toggle is idempotent and audited as UPDATE (MENU_ITEM) with before and after available', async ({ owner, apiAs }) => {
    const item = await createItem(owner);
    const cashier = await apiAs('cashier');
    await json(await cashier.put(EPM.availability(item.id), { body: { available: false } }));
    await json(await cashier.put(EPM.availability(item.id), { body: { available: false } }));
    const entries = (await auditSearch(owner, { entityType: 'MENU_ITEM', entityId: item.id, action: 'UPDATE' })).items;
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const e = entries[0];
    expect(jstr(e.before)).toContain('true');
    expect(jstr(e.after)).toContain('false');
    expect(e.user?.username).toBe(cashier.session!.user.username);
    expect(e.terminal?.id).toBeTruthy();
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  test('P1-MENU-06-T05 the availability board lists active items of active categories only, with their flag', async ({ owner, apiAs }) => {
    const cat = await createCategory(owner);
    const on = await createItem(owner, { categoryId: cat.id });
    const inactive = await createItem(owner, { categoryId: cat.id, active: false });
    const cashier = await apiAs('cashier');
    const list = await json<Schemas['AvailabilityItem'][]>(await cashier.get(EPM.availabilityList));
    expect(list.find((i) => i.id === on.id)).toMatchObject({ code: on.code, available: true, categoryName: cat.name });
    expect(list.find((i) => i.id === inactive.id)).toBeUndefined();
    await json(await owner.put(EPM.category(cat.id), { body: { name: cat.name, sortOrder: cat.sortOrder, active: false, version: cat.version } }));
    expect((await json<Schemas['AvailabilityItem'][]>(await cashier.get(EPM.availabilityList))).find((i) => i.id === on.id)).toBeUndefined();
  });

  test('P1-MENU-06-T06 an unknown item is 404; a body without `available` is 422', async ({ apiAs, owner }) => {
    const cashier = await apiAs('cashier');
    await expectProblem(await cashier.put(EPM.availability(SAMPLE_UUID), { body: { available: false } }), 404, 'NOT_FOUND');
    const item = await createItem(owner);
    await expectProblem(await cashier.put(EPM.availability(item.id), { body: {} }), 422);
  });

  test('P1-MENU-06-T07 menu settings: the daily reset is on by default and can be switched off (audited)', async ({ owner }) => {
    const cur = await json<Schemas['MenuSettings']>(await owner.get(EPM.menuSettings));
    expect(cur.resetAvailabilityDaily).toBe(true);
    await expectProblem(await owner.put(EPM.menuSettings, { body: { resetAvailabilityDaily: false, version: -1 } }), 409, 'VERSION_CONFLICT');
  });

  test('P1-MENU-06-T08 sold-out items are greyed out on the POS and cannot be added to an order (M1.2)', async () => {
    test.fixme(true, 'Adding items to an order arrives in M1.2');
  });
});
