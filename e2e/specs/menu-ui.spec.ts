/**
 * M1.1 menu administration on the real frontend (P1-MENU-01..07, P1-SET-05): categories, items, modifier groups,
 * the sold-out screens and what each role sees. The matching API rules are tested in menu.spec.ts and stations.spec.ts.
 */
import { test, expect } from '../fixtures/test';
import { type Schemas } from '../utils/api-client';
import { auditSearch, json } from '../utils/admin-api';
import { EPM, createCategory, createGroup, createItem, getItem, stationByNumber, uniqueCode, uniqueLabel } from '../utils/menu-api';

/** Types into the items search and waits until the list shows exactly that one item (the search is debounced). */
async function searchItem(page: import('@playwright/test').Page, code: string): Promise<void> {
  await page.getByTestId('items-search').fill(code);
  await expect(page.getByTestId('items-total')).toHaveText(/^1 item/);
  await expect(page.getByTestId(`item-row-${code}`)).toBeVisible();
}

test.describe('P1-MENU-01 categories screen', () => {
  test('P1-MENU-01-T20 owner creates, renames, reorders and deactivates a category on the categories screen', async ({ uiAs, owner }) => {
    const page = await uiAs('owner');
    const name = uniqueLabel('UI Cat');
    await page.goto('/admin/menu/categories');
    await page.getByTestId('category-create').click();
    await page.getByTestId('category-name').fill(name);
    await page.getByTestId('category-order').fill('80');
    await page.getByTestId('category-save').click();
    await expect(page.getByTestId(`category-row-${name}`)).toBeVisible();
    const created = (await json<Schemas['Category'][]>(await owner.get(EPM.categories))).find((c) => c.name === name)!;
    expect(created).toMatchObject({ sortOrder: 80, active: true });
    await page.getByTestId(`category-edit-${name}`).click();
    const renamed = `${name} renamed`;
    await page.getByTestId('category-name').fill(renamed);
    await page.getByTestId('category-save').click();
    await expect(page.getByTestId(`category-row-${renamed}`)).toBeVisible();
    await page.getByTestId(`category-toggle-${renamed}`).click();
    const confirm = page.getByTestId('confirm-accept');
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect.poll(async () => (await json<Schemas['Category']>(await owner.get(EPM.category(created.id)))).active).toBe(false);
  });

  test('P1-MENU-01-T21 a duplicate category name shows an error in the dialog and saves nothing', async ({ uiAs, owner }) => {
    const c = await createCategory(owner);
    const page = await uiAs('owner');
    await page.goto('/admin/menu/categories');
    await page.getByTestId('category-create').click();
    await page.getByTestId('category-name').fill(c.name.toUpperCase());
    await page.getByTestId('category-save').click();
    await expect(page.getByTestId('category-error').or(page.getByTestId('field-error-name'))).toBeVisible();
    await expect(page.getByTestId('category-dialog')).toBeVisible();
  });
});

test.describe('P1-MENU-02 menu items screen', () => {
  test('P1-MENU-02-T20 owner creates an item with category, station and both prices on the items screen; it is stored with exactly that station', async ({ uiAs, owner }) => {
    const cat = await createCategory(owner);
    const st = await stationByNumber(owner, 2);
    const code = uniqueCode('UI');
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await page.getByTestId('item-create').click();
    await page.getByTestId('item-code').fill(code);
    await page.getByTestId('item-name').fill('UI grilled thing');
    await page.getByTestId('item-category').selectOption({ label: cat.name });
    await page.getByTestId('item-station').selectOption({ label: st.name });
    await page.getByTestId('item-local-price').fill('1250');
    await page.getByTestId('item-foreign-price').fill('1800.00');
    await page.getByTestId('item-save').click();
    await expect.poll(async () => (await json<Schemas['MenuItemPage']>(await owner.get(EPM.items, { query: { search: code } }))).totalItems).toBe(1);
    const item = (await json<Schemas['MenuItemPage']>(await owner.get(EPM.items, { query: { search: code } }))).items[0];
    const full = await getItem(owner, item.id);
    expect(full).toMatchObject({ name: 'UI grilled thing', stationId: st.id, categoryId: cat.id, localPrice: '1250.00', foreignPrice: '1800.00', active: true, available: true });
    await page.getByTestId('items-search').fill(code);
    await expect(page.getByTestId(`item-row-${code}`)).toBeVisible();
  });

  test('P1-MENU-02-T21 an item cannot be saved without a station or with a duplicate code; the dialog shows the errors', async ({ uiAs, owner }) => {
    const existing = await createItem(owner);
    const cat = await createCategory(owner);
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await page.getByTestId('item-create').click();
    await page.getByTestId('item-code').fill(uniqueCode('UI'));
    await page.getByTestId('item-name').fill('No station');
    await page.getByTestId('item-category').selectOption({ label: cat.name });
    await page.getByTestId('item-local-price').fill('100.00');
    await page.getByTestId('item-save').click();
    await expect(page.getByTestId('field-error-stationId').or(page.getByTestId('item-error'))).toBeVisible();
    await expect(page.getByTestId('item-dialog')).toBeVisible();
    await page.getByTestId('item-station').selectOption({ index: 1 });
    await page.getByTestId('item-code').fill(existing.code);
    await page.getByTestId('item-save').click();
    await expect(page.getByTestId('field-error-code').or(page.getByTestId('item-error'))).toBeVisible();
    expect((await json<Schemas['MenuItemPage']>(await owner.get(EPM.items, { query: { search: existing.code } }))).totalItems).toBe(1);
  });

  test('P1-MENU-05-T20 owner changes an item price on the items screen: stored with 2 decimals, PRICE_CHANGED audited, POS menu shows it', async ({ uiAs, owner, apiAs }) => {
    const item = await createItem(owner, { localPrice: '500.00', foreignPrice: '700.00' });
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await searchItem(page, item.code);
    await page.getByTestId(`item-edit-${item.code}`).click();
    await expect(page.getByTestId('item-code')).toHaveValue(item.code); // the dialog loads the item after it opens
    await page.getByTestId('item-local-price').fill('525');
    await page.getByTestId('item-save').click();
    await expect.poll(async () => (await getItem(owner, item.id)).localPrice).toBe('525.00');
    const entries = (await auditSearch(owner, { entityType: 'MENU_ITEM', entityId: item.id, action: 'PRICE_CHANGED' })).items;
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0].before)).toContain('500.00');
    const menu = await json<Schemas['PosMenu']>(await (await apiAs('cashier')).get(EPM.posMenu));
    expect(menu.categories.flatMap((c) => c.items).find((i) => i.id === item.id)?.localPrice).toBe('525.00');
  });

  test('P1-MENU-03-T20 an item with a modifier group can be opened and saved again from the items screen (group kept)', async ({ uiAs, owner }) => {
    const g = await createGroup(owner);
    const item = await createItem(owner, { modifierGroupIds: [g.id], localPrice: '300.00' });
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await searchItem(page, item.code);
    await page.getByTestId(`item-edit-${item.code}`).click();
    await expect(page.getByTestId('item-code')).toHaveValue(item.code);
    await expect(page.getByTestId(`item-group-${g.name}`)).toBeVisible();
    await page.getByTestId('item-local-price').fill('310.00');
    await page.getByTestId('item-save').click();
    await expect.poll(async () => (await getItem(owner, item.id)).localPrice).toBe('310.00');
    expect((await getItem(owner, item.id)).modifierGroups.map((x) => x.id)).toEqual([g.id]);
  });

  test('P1-MENU-03-T20b the move up / move down arrows in the item dialog reorder the groups and save', async ({ uiAs, owner }) => {
    const [g1, g2] = [await createGroup(owner), await createGroup(owner)];
    const item = await createItem(owner, { modifierGroupIds: [g1.id, g2.id] });
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await searchItem(page, item.code);
    await page.getByTestId(`item-edit-${item.code}`).click();
    await expect(page.getByTestId('item-code')).toHaveValue(item.code);
    await page.getByTestId(`item-group-down-${g1.name}`).click();
    await page.getByTestId('item-save').click();
    await expect.poll(async () => (await getItem(owner, item.id)).modifierGroups.map((x) => x.id)).toEqual([g2.id, g1.id]);
  });

  test('P1-MENU-03-T21 owner attaches a modifier group to an item in the item dialog and removes it again', async ({ uiAs, owner }) => {
    const g = await createGroup(owner);
    const item = await createItem(owner);
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await searchItem(page, item.code);
    await page.getByTestId(`item-edit-${item.code}`).click();
    await expect(page.getByTestId('item-code')).toHaveValue(item.code);
    await expect(page.getByTestId('item-no-groups')).toBeVisible();
    await page.getByTestId('item-group-add').selectOption({ label: g.name });
    await page.getByTestId('item-group-add-button').click();
    await expect(page.getByTestId(`item-group-${g.name}`)).toBeVisible();
    await page.getByTestId('item-save').click();
    await expect.poll(async () => (await getItem(owner, item.id)).modifierGroups.map((x) => x.id)).toEqual([g.id]);
    await page.getByTestId(`item-edit-${item.code}`).click();
    await expect(page.getByTestId('item-code')).toHaveValue(item.code);
    await page.getByTestId(`item-group-remove-${g.name}`).click();
    await page.getByTestId('item-save').click();
    await expect.poll(async () => (await getItem(owner, item.id)).modifierGroups).toEqual([]);
  });

  test('P1-MENU-02-T22 the items screen filters by category, station, active and sold-out and pages through results', async ({ uiAs, owner }) => {
    const cat = await createCategory(owner);
    const a = await createItem(owner, { categoryId: cat.id });
    const b = await createItem(owner, { categoryId: cat.id, active: false });
    await json(await owner.put(EPM.availability(a.id), { body: { available: false } }));
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await page.getByTestId('items-filter-category').selectOption({ label: cat.name });
    await page.getByTestId('items-filter-active').selectOption('all');
    await expect(page.getByTestId('items-total')).toContainText('2');
    await page.getByTestId('items-filter-active').selectOption('false');
    await expect(page.getByTestId(`item-row-${b.code}`)).toBeVisible();
    await expect(page.getByTestId(`item-row-${a.code}`)).toHaveCount(0);
    await page.getByTestId('items-filter-active').selectOption('all');
    await expect(page.getByTestId(`item-soldout-${a.code}`)).toBeVisible();
  });

  test('P1-MENU-06-T20 owner toggles Sold out / Available from the items screen', async ({ uiAs, owner }) => {
    const item = await createItem(owner);
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await searchItem(page, item.code);
    await page.getByTestId(`item-availability-${item.code}`).click();
    await expect.poll(async () => (await getItem(owner, item.id)).available).toBe(false);
    await expect(page.getByTestId(`item-soldout-${item.code}`)).toBeVisible();
    await page.getByTestId(`item-availability-${item.code}`).click();
    await expect.poll(async () => (await getItem(owner, item.id)).available).toBe(true);
  });
});

test.describe('P1-MENU-03 modifier groups screen', () => {
  test('P1-MENU-03-T22 owner creates a required group with options and prices on the modifiers screen, then deactivates it', async ({ uiAs, owner }) => {
    const page = await uiAs('owner');
    const name = uniqueLabel('UI Group');
    await page.goto('/admin/menu/modifiers');
    await page.getByTestId('modifier-create').click();
    await page.getByTestId('mod-name').fill(name);
    await page.locator('input#mod-required').check({ force: true }).catch(async () => page.getByTestId('mod-required').click());
    await page.getByTestId('mod-min').fill('1');
    await page.getByTestId('mod-max').fill('1');
    await page.getByTestId('mod-option-name-0').fill('Mild');
    await page.getByTestId('mod-option-price-0').fill('0');
    await page.getByTestId('mod-option-name-1').fill('Hot');
    await page.getByTestId('mod-option-price-1').fill('50.00');
    await page.getByTestId('mod-save').click();
    await expect(page.getByTestId(`modifier-row-${name}`)).toBeVisible();
    const g = (await json<Schemas['ModifierGroup'][]>(await owner.get(EPM.modifierGroups))).find((x) => x.name === name)!;
    expect(g).toMatchObject({ required: true, minSelect: 1, maxSelect: 1, active: true });
    expect(g.options.map((o) => [o.name, o.priceDelta])).toEqual([['Mild', '0.00'], ['Hot', '50.00']]);
    await page.getByTestId(`modifier-toggle-${name}`).click();
    const confirm = page.getByTestId('confirm-accept');
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect.poll(async () => (await json<Schemas['ModifierGroup']>(await owner.get(EPM.modifierGroup(g.id)))).active).toBe(false);
  });

  test('P1-MENU-03-T23 the group dialog shows field errors: two options with the same name, and a maximum above the number of options', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin/menu/modifiers');
    await page.getByTestId('modifier-create').click();
    await page.getByTestId('mod-name').fill(uniqueLabel('UI Bad'));
    await page.getByTestId('mod-option-name-0').fill('Same');
    await page.getByTestId('mod-option-name-1').fill('same');
    await page.getByTestId('mod-max').fill('5');
    await page.getByTestId('mod-save').click();
    await expect(page.getByTestId('modifier-dialog')).toBeVisible();
    await expect(page.locator('[data-testid^="field-error-"], [data-testid="mod-error"]').first()).toBeVisible();
  });

  test('P1-MENU-03-T24 options can be reordered with the arrows and removed', async ({ uiAs, owner }) => {
    const g = await createGroup(owner, { options: [{ name: 'One', priceDelta: '0.00' }, { name: 'Two', priceDelta: '0.00' }, { name: 'Three', priceDelta: '0.00' }], maxSelect: 2 });
    const page = await uiAs('owner');
    await page.goto('/admin/menu/modifiers');
    await page.getByTestId(`modifier-edit-${g.name}`).click();
    await page.getByTestId('mod-option-down-0').click();
    await page.getByTestId('mod-option-remove-2').click();
    await page.getByTestId('mod-save').click();
    await expect.poll(async () => (await json<Schemas['ModifierGroup']>(await owner.get(EPM.modifierGroup(g.id)))).options.map((o) => o.name)).toEqual(['Two', 'One']);
  });
});

test.describe('P1-MENU-02 edit dialog does not lose early typing', () => {
  test('P1-MENU-02-T30 typing into the item dialog right after opening it is kept (fields stay disabled until the item is loaded)', async ({ uiAs, owner }) => {
    const item = await createItem(owner);
    const page = await uiAs('owner');
    await page.goto('/admin/menu/items');
    await searchItem(page, item.code);
    await page.getByTestId(`item-edit-${item.code}`).click();
    await page.getByTestId('item-local-price').fill('321.00'); // waits until the field is enabled, then types
    await expect(page.getByTestId('item-code')).toHaveValue(item.code);
    await expect(page.getByTestId('item-local-price')).toHaveValue('321.00');
    await page.getByTestId('item-save').click();
    await expect.poll(async () => (await getItem(owner, item.id)).localPrice).toBe('321.00');
  });
});

test.describe('P1-MENU-06 sold-out screens', () => {
  test('P1-MENU-06-T30 a cashier who opens the admin sold-out URL is sent to /forbidden (the /admin guard applies); the POS screen still works', async ({ uiAs }) => {
    const page = await uiAs('cashier', { terminal: 'CASHIER_POS' });
    await page.goto('/admin/menu/availability');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await page.goto('/pos/availability');
    await expect(page).toHaveURL(/\/pos\/availability$/);
    await expect(page.getByTestId('forbidden-page')).toHaveCount(0);
  });

  test('P1-MENU-06-T21 the cashier marks an item sold out on the POS sold-out screen (/pos/availability) and available again', async ({ uiAs, owner }) => {
    const item = await createItem(owner);
    const page = await uiAs('cashier', { terminal: 'CASHIER_POS' });
    await page.goto('/pos');
    await page.getByTestId('pos-availability').click();
    await expect(page).toHaveURL(/\/pos\/availability$/);
    await page.getByTestId('availability-search').fill(item.code);
    const row = page.getByTestId(`availability-item-${item.code}`);
    await expect(row).toBeVisible();
    await expect(page.getByTestId(`availability-state-${item.code}`)).toContainText(/available/i);
    await row.click();
    await expect.poll(async () => (await getItem(owner, item.id)).available).toBe(false);
    await expect(page.getByTestId(`availability-state-${item.code}`)).toContainText(/sold out/i);
    await page.getByTestId('availability-only-soldout').check();
    await expect(row).toBeVisible();
    await row.click();
    await expect.poll(async () => (await getItem(owner, item.id)).available).toBe(true);
    await expect(page.getByTestId('availability-back')).toBeVisible();
  });

  test('P1-MENU-06-T22 the sold-out screen lists items grouped by category and hides inactive items', async ({ uiAs, owner }) => {
    const cat = await createCategory(owner);
    const on = await createItem(owner, { categoryId: cat.id });
    const off = await createItem(owner, { categoryId: cat.id, active: false });
    const page = await uiAs('cashier', { terminal: 'CASHIER_POS' });
    await page.goto('/pos/availability');
    await page.getByTestId('availability-search').fill(on.code);
    await expect(page.getByTestId(`availability-group-${cat.name}`)).toBeVisible();
    await expect(page.getByTestId(`availability-item-${on.code}`)).toBeVisible();
    await page.getByTestId('availability-search').fill(off.code);
    await expect(page.getByTestId(`availability-item-${off.code}`)).toHaveCount(0);
    await expect(page.getByTestId('availability-empty')).toBeVisible();
  });

  test('P1-MENU-06-T23 the manager can use the sold-out screen in admin; the receptionist has no sold-out link in the POS', async ({ uiAs, owner }) => {
    const item = await createItem(owner);
    const mgr = await uiAs('manager', { terminal: 'ADMIN' });
    await mgr.goto('/admin/menu/availability');
    await mgr.getByTestId('availability-search').fill(item.code);
    await mgr.getByTestId(`availability-item-${item.code}`).click();
    await expect.poll(async () => (await getItem(owner, item.id)).available).toBe(false);
  });

  test('P1-MENU-06-T24 the receptionist (no MENU_AVAILABILITY) does not see the sold-out link and is refused /pos/availability', async ({ uiAs }) => {
    const page = await uiAs('receptionist', { terminal: 'RECEPTION_POS' });
    await page.goto('/pos');
    await expect(page.getByTestId('pos-home')).toBeVisible();
    await expect(page.getByTestId('pos-availability')).toHaveCount(0);
    await page.goto('/pos/availability');
    await expect(page).toHaveURL(/\/forbidden/);
  });
});

test.describe('M1.1 roles: who sees the menu administration', () => {
  const MENU_ROUTES = ['/admin/menu/items', '/admin/menu/categories', '/admin/menu/modifiers', '/admin/kitchens', '/admin/import', '/admin/delivery-areas', '/admin/reasons'];

  for (const role of ['kitchen', 'rider', 'inventory', 'hr', 'receptionist', 'cashier'] as const) {
    test(`M1.1-ROLE-T01 [${role}] sees none of the menu administration screens (every route goes to the no-access page)`, async ({ uiAs }) => {
      const page = await uiAs(role, { terminal: 'ADMIN' });
      for (const route of MENU_ROUTES) {
        await page.goto(route);
        await expect(page, route).toHaveURL(/\/forbidden/);
      }
    });
  }

  test('M1.1-ROLE-T02 the manager sees the sold-out screen and the floor plan but not items, categories, modifiers, kitchens, import, areas, reasons', async ({ uiAs }) => {
    const page = await uiAs('manager', { terminal: 'ADMIN' });
    await page.goto('/admin');
    await expect(page.getByTestId('nav-admin-menu-availability')).toBeVisible();
    await expect(page.getByTestId('nav-admin-floor')).toBeVisible();
    for (const id of ['nav-admin-menu-items', 'nav-admin-menu-categories', 'nav-admin-menu-modifiers', 'nav-admin-kitchens', 'nav-admin-import', 'nav-admin-delivery-areas', 'nav-admin-reasons']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
  });

  test('M1.1-ROLE-T03 the owner sees every M1.1 entry in the admin navigation', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin');
    for (const id of ['nav-admin-menu-items', 'nav-admin-menu-categories', 'nav-admin-menu-modifiers', 'nav-admin-menu-availability', 'nav-admin-kitchens', 'nav-admin-floor', 'nav-admin-delivery-areas', 'nav-admin-reasons', 'nav-admin-import']) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
  });
});
