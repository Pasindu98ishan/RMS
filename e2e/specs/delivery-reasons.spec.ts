/**
 * M1.1 delivery areas (P1-SET-07) and reason lists (P1-SET-08). Annex A §3 (delivery fee, area), §6 (cancellation
 * reasons: mandatory reason + comment), §4 (discount reason), §9 (petty cash reason), §14 (delivery areas and fees).
 * Both lists are never deleted, only deactivated, and need SETTINGS_MANAGE; the narrow lookups need ORDER_CREATE / ORDER_VIEW.
 */
import { test, expect } from '../fixtures/test';
import { type Schemas, expectProblem } from '../utils/api-client';
import { auditSearch, json } from '../utils/admin-api';
import { EPM, createArea, createReason, expectFieldError, uniqueLabel } from '../utils/menu-api';
import { SAMPLE_UUID } from '../utils/openapi';

const jstr = (v: unknown) => JSON.stringify(v ?? null);
const CATEGORIES = ['CANCEL', 'VOID', 'REFUND', 'PETTY_CASH', 'DISCOUNT_OTHER'] as const;

test.describe('P1-SET-07 delivery areas', { tag: '@api' }, () => {
  test('P1-SET-07-T01 owner creates a delivery area with a fee; active by default; audited', async ({ owner }) => {
    const a = await createArea(owner, { fee: '325.50' });
    expect(a).toMatchObject({ fee: '325.50', active: true });
    const e = (await auditSearch(owner, { entityType: 'DELIVERY_AREA', entityId: a.id })).items;
    expect(e.map((x) => x.action)).toEqual(['CREATE']);
    expect(e[0].user?.username).toBeTruthy();
    expect(e[0].terminal?.id).toBeTruthy();
  });

  test('P1-SET-07-T02 the list includes inactive areas and is ordered by name', async ({ owner }) => {
    const off = await createArea(owner);
    await createArea(owner);
    await json(await owner.put(EPM.area(off.id), { body: { name: off.name, fee: off.fee, active: false, version: off.version } }));
    const list = await json<Schemas['DeliveryArea'][]>(await owner.get(EPM.areas));
    expect(list.some((a) => a.id === off.id && !a.active)).toBe(true);
    const names = list.map((x) => x.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  });

  test('P1-SET-07-T03 the name is unique (case-insensitive): 409 DELIVERY_AREA_NAME_TAKEN; empty or over 100 characters is 422', async ({ owner }) => {
    const a = await createArea(owner);
    await expectProblem(await owner.post(EPM.areas, { body: { name: a.name.toUpperCase(), fee: '10.00' } }), 409, 'DELIVERY_AREA_NAME_TAKEN');
    await expectFieldError(await owner.post(EPM.areas, { body: { name: '', fee: '10.00' } }), 'name');
    await expectFieldError(await owner.post(EPM.areas, { body: { name: 'n'.repeat(101), fee: '10.00' } }), 'name');
  });

  for (const bad of ['abc', '-1.00', '10', '10.5', '1e2', '', '12345678901.00']) {
    test(`P1-SET-07-T04 fee "${bad}" is rejected with 422 (2-decimal string, not negative)`, async ({ owner }) => {
      await expectFieldError(await owner.post(EPM.areas, { body: { name: uniqueLabel('QA Area'), fee: bad } }), 'fee');
    });
  }

  test('P1-SET-07-T05 a zero fee is allowed; a fee sent as a JSON number is rejected', async ({ owner }) => {
    expect((await createArea(owner, { fee: '0.00' })).fee).toBe('0.00');
    expect([400, 422]).toContain((await owner.post(EPM.areas, { body: { name: uniqueLabel('QA Area'), fee: 150 } })).status());
  });

  test('P1-SET-07-T06 update renames, changes the fee and deactivates; audited with before and after; stale version 409; never deleted', async ({ owner }) => {
    const a = await createArea(owner, { fee: '200.00' });
    const name = uniqueLabel('QA Area renamed');
    const saved = await json<Schemas['DeliveryArea']>(await owner.put(EPM.area(a.id), { body: { name, fee: '260.00', active: false, version: a.version } }));
    expect(saved).toMatchObject({ name, fee: '260.00', active: false });
    await expectProblem(await owner.put(EPM.area(a.id), { body: { name, fee: '1.00', active: true, version: a.version } }), 409, 'VERSION_CONFLICT');
    const upd = (await auditSearch(owner, { entityType: 'DELIVERY_AREA', entityId: a.id, action: 'UPDATE' })).items[0];
    expect(jstr(upd.before)).toContain('200.00');
    expect(jstr(upd.after)).toContain('260.00');
    expect([404, 405]).toContain((await owner.delete(EPM.area(a.id))).status());
    await expectProblem(await owner.get(EPM.area(SAMPLE_UUID)), 404, 'NOT_FOUND');
  });

  test('P1-SET-07-T07 changing the name to an existing one is 409 DELIVERY_AREA_NAME_TAKEN', async ({ owner }) => {
    const [a, b] = [await createArea(owner), await createArea(owner)];
    await expectProblem(await owner.put(EPM.area(b.id), { body: { name: a.name, fee: b.fee, active: true, version: b.version } }), 409, 'DELIVERY_AREA_NAME_TAKEN');
  });

  test('P1-SET-07-T08 the order-screen lookup lists active areas with their fee for ORDER_CREATE roles; inactive areas are hidden', async ({ owner, apiAs }) => {
    const [on, off] = [await createArea(owner, { fee: '410.00' }), await createArea(owner)];
    await json(await owner.put(EPM.area(off.id), { body: { name: off.name, fee: off.fee, active: false, version: off.version } }));
    for (const role of ['cashier', 'receptionist', 'manager'] as const) {
      const opts = await json<Schemas['DeliveryAreaOption'][]>(await (await apiAs(role)).get(EPM.areaOptions));
      expect(opts.find((o) => o.id === on.id)).toMatchObject({ name: on.name, fee: '410.00' });
      expect(opts.find((o) => o.id === off.id)).toBeUndefined();
    }
    for (const role of ['kitchen', 'rider', 'hr', 'inventory'] as const) {
      await expectProblem(await (await apiAs(role)).get(EPM.areaOptions), 403, 'FORBIDDEN');
    }
  });

  test('P1-SET-07-T09 managing areas needs SETTINGS_MANAGE (owner only): manager and cashier get 403', async ({ apiAs }) => {
    for (const role of ['manager', 'cashier'] as const) {
      const c = await apiAs(role);
      await expectProblem(await c.get(EPM.areas), 403, 'FORBIDDEN');
      await expectProblem(await c.post(EPM.areas, { body: { name: uniqueLabel('QA'), fee: '1.00' } }), 403, 'FORBIDDEN');
    }
  });

  test('P1-SET-07-T10 the delivery fee is added as a bill line on delivery orders', async () => {
    test.fixme(true, 'Delivery orders and the bill arrive in M1.2 / M1.4');
  });
});

test.describe('P1-SET-07 delivery areas screen', () => {
  test('P1-SET-07-T20 owner adds, edits and deactivates an area on the delivery areas screen', async ({ uiAs, owner }) => {
    const page = await uiAs('owner');
    const name = uniqueLabel('UI Area');
    await page.goto('/admin/delivery-areas');
    await page.getByTestId('area-create').click();
    await page.getByTestId('area-name').fill(name);
    await page.getByTestId('area-fee').fill('275');
    await page.getByTestId('area-save').click();
    await expect(page.getByTestId(`area-row-${name}`)).toBeVisible();
    const created = (await json<Schemas['DeliveryArea'][]>(await owner.get(EPM.areas))).find((a) => a.name === name)!;
    expect(created).toMatchObject({ fee: '275.00', active: true });
    await page.getByTestId(`area-edit-${name}`).click();
    await page.getByTestId('area-fee').fill('300.00');
    await page.getByTestId('area-save').click();
    await expect.poll(async () => (await json<Schemas['DeliveryArea']>(await owner.get(EPM.area(created.id)))).fee).toBe('300.00');
    await page.getByTestId(`area-toggle-${name}`).click();
    await expect.poll(async () => (await json<Schemas['DeliveryArea']>(await owner.get(EPM.area(created.id)))).active).toBe(false);
  });

  test('P1-SET-07-T21 the area dialog shows a field error for a duplicate name and an invalid fee', async ({ uiAs, owner }) => {
    const a = await createArea(owner);
    const page = await uiAs('owner');
    await page.goto('/admin/delivery-areas');
    await page.getByTestId('area-create').click();
    await page.getByTestId('area-name').fill(a.name);
    await page.getByTestId('area-fee').fill('100.00');
    await page.getByTestId('area-save').click();
    await expect(page.getByTestId('area-error').or(page.getByTestId('field-error-name'))).toBeVisible();
    const ok = uniqueLabel('UI Area ok');
    await page.getByTestId('area-name').fill(ok);
    await page.getByTestId('area-fee').fill('abc'); // the money field drops letters: the fee stays empty
    await expect(page.getByTestId('area-fee')).toHaveValue('');
    await page.getByTestId('area-save').click();
    await expect(page.getByTestId('area-dialog')).toBeVisible(); // not saved
    expect((await json<Schemas['DeliveryArea'][]>(await owner.get(EPM.areas))).some((x) => x.name === ok)).toBe(false);
  });
});

test.describe('P1-SET-08 reason lists', { tag: '@api' }, () => {
  test('P1-SET-08-T01 every reason list (CANCEL, VOID, REFUND, PETTY_CASH, DISCOUNT_OTHER) is seeded with defaults', async ({ owner }) => {
    const all = await json<Schemas['Reason'][]>(await owner.get(EPM.reasons));
    for (const c of CATEGORIES) expect(all.filter((r) => r.category === c && r.active).length, c).toBeGreaterThanOrEqual(1);
  });

  test('P1-SET-08-T02 the list can be filtered by category and is ordered by category then text', async ({ owner }) => {
    const refund = await json<Schemas['Reason'][]>(await owner.get(EPM.reasons, { query: { category: 'REFUND' } }));
    expect(refund.length).toBeGreaterThan(0);
    expect(refund.every((r) => r.category === 'REFUND')).toBe(true);
    const texts = refund.map((r) => r.text);
    expect(texts).toEqual([...texts].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    expect((await owner.get(EPM.reasons, { query: { category: 'NOPE' } })).status()).toBe(400);
  });

  test('P1-SET-08-T03 owner adds a reason to a list; active by default; audited', async ({ owner }) => {
    const r = await createReason(owner, { category: 'VOID' });
    expect(r).toMatchObject({ category: 'VOID', active: true });
    const e = (await auditSearch(owner, { entityType: 'REASON', entityId: r.id })).items;
    expect(e.map((x) => x.action)).toEqual(['CREATE']);
  });

  test('P1-SET-08-T04 the text is unique inside its list (case-insensitive): 409 REASON_TEXT_TAKEN; the same text is allowed in another list', async ({ owner }) => {
    const r = await createReason(owner, { category: 'CANCEL' });
    await expectProblem(await owner.post(EPM.reasons, { body: { category: 'CANCEL', text: r.text.toUpperCase() } }), 409, 'REASON_TEXT_TAKEN');
    expect((await createReason(owner, { category: 'REFUND', text: r.text })).category).toBe('REFUND');
  });

  test('P1-SET-08-T05 text is required (1-200 characters) and the category must be valid', async ({ owner }) => {
    await expectFieldError(await owner.post(EPM.reasons, { body: { category: 'CANCEL', text: '' } }), 'text');
    await expectFieldError(await owner.post(EPM.reasons, { body: { category: 'CANCEL', text: 't'.repeat(201) } }), 'text');
    expect([400, 422]).toContain((await owner.post(EPM.reasons, { body: { category: 'OTHER', text: uniqueLabel('x') } })).status());
    expect([400, 422]).toContain((await owner.post(EPM.reasons, { body: { text: uniqueLabel('x') } })).status());
    expect((await createReason(owner, { text: 't'.repeat(200) })).text).toHaveLength(200);
  });

  test('P1-SET-08-T06 update changes the text or deactivates; the list cannot be changed; audited; stale version 409; never deleted', async ({ owner }) => {
    const r = await createReason(owner, { category: 'PETTY_CASH' });
    const text = uniqueLabel('QA petty edited');
    const saved = await json<Schemas['Reason']>(await owner.put(EPM.reason(r.id), { body: { text, active: false, version: r.version, category: 'CANCEL' } }));
    expect(saved).toMatchObject({ text, active: false, category: 'PETTY_CASH' });
    await expectProblem(await owner.put(EPM.reason(r.id), { body: { text, active: true, version: r.version } }), 409, 'VERSION_CONFLICT');
    const upd = (await auditSearch(owner, { entityType: 'REASON', entityId: r.id, action: 'UPDATE' })).items[0];
    expect(jstr(upd.before)).toContain(r.text);
    expect(jstr(upd.after)).toContain(text);
    expect([404, 405]).toContain((await owner.delete(EPM.reason(r.id))).status());
  });

  test('P1-SET-08-T07 changing a text to an existing one in the same list is 409 REASON_TEXT_TAKEN', async ({ owner }) => {
    const [a, b] = [await createReason(owner), await createReason(owner)];
    await expectProblem(await owner.put(EPM.reason(b.id), { body: { text: a.text, active: true, version: b.version } }), 409, 'REASON_TEXT_TAKEN');
  });

  test('P1-SET-08-T08 the dialog lookup returns the active reasons of one category by text, for ORDER_VIEW roles; inactive ones are hidden', async ({ owner, apiAs }) => {
    const [on, off] = [await createReason(owner, { category: 'DISCOUNT_OTHER' }), await createReason(owner, { category: 'DISCOUNT_OTHER' })];
    await json(await owner.put(EPM.reason(off.id), { body: { text: off.text, active: false, version: off.version } }));
    for (const role of ['cashier', 'receptionist', 'manager'] as const) {
      const c = await apiAs(role);
      const opts = await json<Array<{ id: string; text: string; category?: string }>>(await c.get(EPM.reasonOptions, { query: { category: 'DISCOUNT_OTHER' } }));
      expect(opts.find((o) => o.id === on.id)?.text).toBe(on.text);
      expect(opts.find((o) => o.id === off.id)).toBeUndefined();
      const texts = opts.map((o) => o.text);
      expect(texts).toEqual([...texts].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    }
    for (const role of ['kitchen', 'rider', 'hr', 'inventory'] as const) {
      await expectProblem(await (await apiAs(role)).get(EPM.reasonOptions, { query: { category: 'CANCEL' } }), 403, 'FORBIDDEN');
    }
  });

  test('P1-SET-08-T09 managing reasons needs SETTINGS_MANAGE (owner only): manager and cashier get 403', async ({ apiAs }) => {
    for (const role of ['manager', 'cashier'] as const) {
      const c = await apiAs(role);
      await expectProblem(await c.get(EPM.reasons), 403, 'FORBIDDEN');
      await expectProblem(await c.post(EPM.reasons, { body: { category: 'CANCEL', text: uniqueLabel('x') } }), 403, 'FORBIDDEN');
    }
  });

  test('P1-SET-08-T10 cancellation, void, refund and discount dialogs offer these reasons plus a free-text comment', async () => {
    test.fixme(true, 'The dialogs arrive in M1.4');
  });
});

test.describe('P1-SET-08 reasons screen', () => {
  test('P1-SET-08-T20 owner adds, edits and deactivates a reason on the reasons screen; tabs switch the list', async ({ uiAs, owner }) => {
    const page = await uiAs('owner');
    const text = uniqueLabel('UI reason');
    await page.goto('/admin/reasons');
    await page.getByTestId('reason-tab-REFUND').click();
    await page.getByTestId('reason-create').click();
    await page.getByTestId('reason-text').fill(text);
    await page.getByTestId('reason-save').click();
    await expect(page.getByTestId(`reason-row-${text}`)).toBeVisible();
    const created = (await json<Schemas['Reason'][]>(await owner.get(EPM.reasons, { query: { category: 'REFUND' } }))).find((r) => r.text === text)!;
    expect(created.category).toBe('REFUND');
    await page.getByTestId('reason-tab-VOID').click();
    await expect(page.getByTestId(`reason-row-${text}`)).toHaveCount(0);
    await page.getByTestId('reason-tab-REFUND').click();
    await page.getByTestId(`reason-edit-${text}`).click();
    const text2 = `${text} edited`;
    await page.getByTestId('reason-text').fill(text2);
    await page.getByTestId('reason-save').click();
    await expect.poll(async () => (await json<Schemas['Reason'][]>(await owner.get(EPM.reasons, { query: { category: 'REFUND' } }))).some((r) => r.text === text2)).toBe(true);
    await page.getByTestId(`reason-toggle-${text2}`).click();
    await expect.poll(async () => (await json<Schemas['Reason'][]>(await owner.get(EPM.reasons, { query: { category: 'REFUND' } }))).find((r) => r.text === text2)?.active).toBe(false);
  });

  test('P1-SET-08-T21 a duplicate reason text in the same list shows an error in the dialog', async ({ uiAs, owner }) => {
    const r = await createReason(owner, { category: 'CANCEL' });
    const page = await uiAs('owner');
    await page.goto('/admin/reasons');
    await page.getByTestId('reason-tab-CANCEL').click();
    await page.getByTestId('reason-create').click();
    await page.getByTestId('reason-text').fill(r.text);
    await page.getByTestId('reason-save').click();
    await expect(page.getByTestId('reason-error')).toBeVisible();
  });
});
