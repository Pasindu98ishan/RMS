/**
 * Annex A §14 Settings ("taxes and service charge") and §15 "Currency and tax" (P1-SET-01 .. P1-SET-05),
 * plus idle-timeout validation (P1-AUTH-03). Effects on orders / bills / receipts are tested in M1.2–M1.5.
 * Contract: GET/PUT settings/service-charges | tax | restaurant | business-day | idle-timeouts.
 *
 * These tests CHANGE global settings, so the whole file runs in one worker, in order. Idle-timeout VALUE
 * changes (which the idle tests depend on) are in serial.spec.ts.
 */
import { test, expect } from '../fixtures/test';
import { SEED, passwordFor, userFor } from '../fixtures/seed';
import { AdminSettingsPage } from '../pages/admin/admin-pages';
import { type ApiClient, type Schemas, expectProblem } from '../utils/api-client';
import { auditSearch, colomboDate, json } from '../utils/admin-api';
import { EP } from '../utils/endpoints';

test.describe.configure({ mode: 'default' }); // ordered in one worker, but a failure does not skip the rest

const RATES = (dine: string, take: string, del: string) => [
  { orderType: 'DINE_IN', rate: dine },
  { orderType: 'TAKEAWAY', rate: take },
  { orderType: 'DELIVERY', rate: del },
];

/** Puts every settings area back to the seed values, writing only what differs (a product bug must not poison later tests). */
async function restoreSettings(owner: ApiClient) {
  const S = SEED.settings;
  const sc = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
  const want = RATES(S.serviceChargeRate.DINE_IN, S.serviceChargeRate.TAKEAWAY, S.serviceChargeRate.DELIVERY);
  if (want.some((w) => sc.rules.find((r) => r.orderType === w.orderType)?.rate !== w.rate)) {
    await owner.put(EP.settings.serviceCharges, { body: { rules: want, version: sc.version } });
  }
  const tax = await json<Schemas['TaxSettings']>(await owner.get(EP.settings.tax));
  if (tax.enabled || tax.rate !== S.tax.rate) await owner.put(EP.settings.tax, { body: { enabled: false, rate: S.tax.rate, version: tax.version } });
  const rd = await json<Schemas['RestaurantDetails']>(await owner.get(EP.settings.restaurant));
  if (rd.name !== S.restaurant.name || rd.address !== S.restaurant.address || rd.phone !== S.restaurant.phone || (rd.receiptFooter ?? '') !== S.restaurant.receiptFooter) {
    await owner.put(EP.settings.restaurant, { body: { ...S.restaurant, version: rd.version } });
  }
  const bd = await json<Schemas['BusinessDaySettings']>(await owner.get(EP.settings.businessDay));
  if (bd.dayStartTime !== S.businessDayStart) await owner.put(EP.settings.businessDay, { body: { dayStartTime: S.businessDayStart, version: bd.version } });
  const idle = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
  const idleWant = Object.entries(S.idleTimeoutMinutes).map(([terminalType, idleTimeoutMinutes]) => ({ terminalType, idleTimeoutMinutes }));
  if (
    idle.idleTimeoutPersonalMinutes !== S.idleTimeoutPersonalMinutes ||
    idleWant.some((w) => idle.rules.find((r) => r.terminalType === w.terminalType)?.idleTimeoutMinutes !== w.idleTimeoutMinutes)
  ) {
    await owner.put(EP.settings.idleTimeouts, { body: { rules: idleWant, idleTimeoutPersonalMinutes: S.idleTimeoutPersonalMinutes, version: idle.version } });
  }
}

test.afterEach(async ({ owner }) => {
  await restoreSettings(owner);
});

async function settingsAudit(owner: Parameters<typeof auditSearch>[0], contains: string) {
  const today = colomboDate();
  const items = (await auditSearch(owner, { action: 'SETTINGS_CHANGED', from: today, to: today, size: 50 })).items;
  return items.filter((e) => JSON.stringify([e.before, e.after, e.entityId]).includes(contains));
}

test.describe('P1-SET-01 service charge per order type', { tag: '@api' }, () => {
  test('P1-SET-01-T01 settings hold exactly one rate each for DINE_IN, TAKEAWAY, DELIVERY (none for CREDIT)', async ({ owner }) => {
    const s = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
    expect(s.rules.map((r) => r.orderType).sort()).toEqual(['DELIVERY', 'DINE_IN', 'TAKEAWAY']);
    for (const r of s.rules) expect(r.rate).toMatch(/^(100\.00|\d{1,2}\.\d{2})$/);
  });

  test('P1-SET-01-T02 owner updates the rates; values persist; SETTINGS_CHANGED is audited with before and after', async ({ owner }) => {
    const before = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
    const updated = await json<Schemas['ServiceChargeSettings']>(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES('12.50', '5.00', '7.25'), version: before.version } }));
    expect(updated.version).toBeGreaterThan(before.version);
    const read = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
    const rate = (t: string) => read.rules.find((r) => r.orderType === t)?.rate;
    expect([rate('DINE_IN'), rate('TAKEAWAY'), rate('DELIVERY')]).toEqual(['12.50', '5.00', '7.25']);
    const entries = await settingsAudit(owner, '12.50');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].user?.username).toBeTruthy();
    expect(entries[0].terminal?.id).toBeTruthy();
    expect(JSON.stringify(entries[0].before)).toContain(SEED.settings.serviceChargeRate.DINE_IN);
    // restore the seed values
    await json(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES(SEED.settings.serviceChargeRate.DINE_IN, SEED.settings.serviceChargeRate.TAKEAWAY, SEED.settings.serviceChargeRate.DELIVERY), version: read.version } }));
  });

  for (const bad of ['-1.00', '100.01', '10.555', 'ten', '', '1e2', '5']) {
    test(`P1-SET-01-T03 service charge rate "${bad}" is rejected with 422`, async ({ owner }) => {
      const cur = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
      const p = await expectProblem(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES(bad, '0.00', '0.00'), version: cur.version } }), 422, 'VALIDATION_FAILED');
      expect((p.fieldErrors ?? []).some((f) => f.field.startsWith('rules'))).toBe(true);
    });
  }

  for (const boundary of ['0.00', '100.00']) {
    test(`P1-SET-01-T03b the boundary rate ${boundary} is accepted`, async ({ owner }) => {
      const cur = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
      const res = await json<Schemas['ServiceChargeSettings']>(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES(boundary, '0.00', '0.00'), version: cur.version } }));
      await json(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES('10.00', '0.00', '0.00'), version: res.version } }));
    });
  }

  test('P1-SET-01-T03c a missing or duplicated order type in the rules is rejected with 422', async ({ owner }) => {
    const cur = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
    await expectProblem(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES('1.00', '1.00', '1.00').slice(0, 2), version: cur.version } }), 422);
    const dup = [{ orderType: 'DINE_IN', rate: '1.00' }, { orderType: 'DINE_IN', rate: '2.00' }, { orderType: 'DELIVERY', rate: '3.00' }];
    await expectProblem(await owner.put(EP.settings.serviceCharges, { body: { rules: dup, version: cur.version } }), 422);
    const credit = [...RATES('1.00', '1.00', '1.00').slice(0, 2), { orderType: 'CREDIT', rate: '1.00' }];
    await expectProblem(await owner.put(EP.settings.serviceCharges, { body: { rules: credit, version: cur.version } }), 422);
  });

  test('P1-SET-01-T04 roles other than owner cannot read or change settings (403 FORBIDDEN)', async ({ apiAs }) => {
    for (const role of ['manager', 'cashier'] as const) {
      const c = await apiAs(role);
      await expectProblem(await c.get(EP.settings.serviceCharges), 403, 'FORBIDDEN');
      await expectProblem(await c.put(EP.settings.serviceCharges, { body: { rules: RATES('1.00', '1.00', '1.00'), version: 1 } }), 403, 'FORBIDDEN');
    }
  });

  test('P1-SET-01-T08 a stale version gets 409 VERSION_CONFLICT on every settings area', async ({ owner }) => {
    const sc = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
    const next = await json<Schemas['ServiceChargeSettings']>(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES('10.00', '0.00', '0.00'), version: sc.version } }));
    expect(next.version).toBeGreaterThan(sc.version);
    await expectProblem(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES('10.00', '0.00', '0.00'), version: sc.version } }), 409, 'VERSION_CONFLICT');
    await expectProblem(await owner.put(EP.settings.tax, { body: { enabled: false, rate: '0.00', version: -1 } }), 409, 'VERSION_CONFLICT');
    await expectProblem(await owner.put(EP.settings.restaurant, { body: { name: 'x', address: 'x', phone: 'x', version: -1 } }), 409, 'VERSION_CONFLICT');
    await expectProblem(await owner.put(EP.settings.businessDay, { body: { dayStartTime: '06:00', version: -1 } }), 409, 'VERSION_CONFLICT');
    await expectProblem(await owner.put(EP.settings.idleTimeouts, { body: { rules: [{ terminalType: 'CASHIER_POS', idleTimeoutMinutes: 10 }, { terminalType: 'RECEPTION_POS', idleTimeoutMinutes: 10 }, { terminalType: 'ADMIN', idleTimeoutMinutes: 30 }], version: -1 } }), 409, 'VERSION_CONFLICT');
  });
});

test.describe('P1-AUD-01 settings audit', { tag: '@api' }, () => {
  test('P1-AUD-01-T08 SETTINGS_CHANGED is written for each of the five settings areas, with before and after values', async ({ owner }) => {
    const countFor = async (needle: string) => (await settingsAudit(owner, needle)).length;
    const sc = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
    await json(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES('11.11', '0.00', '0.00'), version: sc.version } }));
    const tax = await json<Schemas['TaxSettings']>(await owner.get(EP.settings.tax));
    await json(await owner.put(EP.settings.tax, { body: { enabled: false, rate: '9.99', version: tax.version } }));
    const rd = await json<Schemas['RestaurantDetails']>(await owner.get(EP.settings.restaurant));
    await json(await owner.put(EP.settings.restaurant, { body: { name: 'Audit Probe Restaurant', address: rd.address, phone: rd.phone, version: rd.version } }));
    const bd = await json<Schemas['BusinessDaySettings']>(await owner.get(EP.settings.businessDay));
    await json(await owner.put(EP.settings.businessDay, { body: { dayStartTime: '03:33', version: bd.version } }));
    const idle = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
    await json(await owner.put(EP.settings.idleTimeouts, { body: { rules: [{ terminalType: 'CASHIER_POS', idleTimeoutMinutes: 13 }, { terminalType: 'RECEPTION_POS', idleTimeoutMinutes: 10 }, { terminalType: 'ADMIN', idleTimeoutMinutes: 30 }], version: idle.version } }));
    for (const needle of ['11.11', '9.99', 'Audit Probe Restaurant', '03:33', '13']) {
      expect(await countFor(needle), `audit row containing ${needle}`).toBeGreaterThan(0);
    }
    const probe = (await settingsAudit(owner, 'Audit Probe Restaurant'))[0];
    expect(probe.before).toBeTruthy();
    expect(probe.after).toBeTruthy();
    expect(probe.user?.username).toBeTruthy();
    expect(probe.terminal?.id).toBeTruthy();
  });
});

test.describe('P1-SET-01 settings screen', () => {
  test('P1-SET-01-T05 owner edits service charge per order type on the settings screen and saves', async ({ uiAs, owner }) => {
    const page = await uiAs('owner');
    const settings = new AdminSettingsPage(page);
    await settings.goto();
    await expect(settings.serviceCharge('DINE_IN')).toHaveValue(/\d/);
    await settings.serviceCharge('DINE_IN').fill('12.5');
    await settings.serviceCharge('TAKEAWAY').fill('3');
    await settings.serviceCharge('DELIVERY').fill('0.00');
    await settings.serviceCharge('DELIVERY').blur();
    await expect(page.getByTestId('settings-dirty')).toBeVisible();
    await settings.save();
    await expect(page.getByTestId('settings-dirty')).toBeHidden();
    await page.reload();
    await expect(settings.serviceCharge('DINE_IN')).toHaveValue('12.50');
    await expect(settings.serviceCharge('TAKEAWAY')).toHaveValue('3.00');
    const s = await json<Schemas['ServiceChargeSettings']>(await owner.get(EP.settings.serviceCharges));
    expect(s.rules.find((r) => r.orderType === 'DINE_IN')?.rate).toBe('12.50');
    await json(await owner.put(EP.settings.serviceCharges, { body: { rules: RATES('10.00', '0.00', '0.00'), version: s.version } }));
  });

  test('P1-SET-01-T05b an invalid rate shows a field error on the settings screen and saves nothing', async ({ uiAs }) => {
    const page = await uiAs('owner');
    const settings = new AdminSettingsPage(page);
    await settings.goto();
    await settings.serviceCharge('DINE_IN').fill('150');
    await settings.save();
    await expect(page.getByTestId('field-error-rules[0].rate')).toBeVisible();
    await page.reload();
    await expect(settings.serviceCharge('DINE_IN')).not.toHaveValue('150.00');
  });
});

test.describe('P1-SET-02 tax off', () => {
  test('P1-SET-02-T01 fresh install has tax disabled with rate 0.00', { tag: '@api' }, async ({ owner }) => {
    const s = await json<Schemas['TaxSettings']>(await owner.get(EP.settings.tax));
    expect(s.enabled).toBe(false);
    expect(s.rate).toBe('0.00');
  });

  test('P1-SET-02-T03 enabling tax gets 409 TAX_NOT_SUPPORTED; rate and label alone can be stored and are audited', { tag: '@api' }, async ({ owner }) => {
    const cur = await json<Schemas['TaxSettings']>(await owner.get(EP.settings.tax));
    await expectProblem(await owner.put(EP.settings.tax, { body: { enabled: true, rate: '0.00', version: cur.version } }), 409, 'TAX_NOT_SUPPORTED');
    await expectProblem(await owner.put(EP.settings.tax, { body: { enabled: true, rate: '12.00', label: 'VAT', version: cur.version } }), 409, 'TAX_NOT_SUPPORTED');
    expect((await json<Schemas['TaxSettings']>(await owner.get(EP.settings.tax))).enabled).toBe(false);
    const stored = await json<Schemas['TaxSettings']>(await owner.put(EP.settings.tax, { body: { enabled: false, rate: '8.00', label: 'VAT', version: cur.version } }));
    expect(stored).toMatchObject({ enabled: false, rate: '8.00', label: 'VAT' });
    expect((await settingsAudit(owner, '8.00')).length).toBeGreaterThan(0);
    await json(await owner.put(EP.settings.tax, { body: { enabled: false, rate: '0.00', version: stored.version } }));
  });

  test('P1-SET-02-T03b a tax rate outside 0.00-100.00 is rejected with 422', { tag: '@api' }, async ({ owner }) => {
    const cur = await json<Schemas['TaxSettings']>(await owner.get(EP.settings.tax));
    await expectProblem(await owner.put(EP.settings.tax, { body: { enabled: false, rate: '100.01', version: cur.version } }), 422);
    await expectProblem(await owner.put(EP.settings.tax, { body: { enabled: false, rate: '-1.00', version: cur.version } }), 422);
  });

  test('P1-SET-02-T02 settings screen shows tax off and does not offer to switch it on', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin/settings');
    await expect(page.getByTestId('settings-tax')).toBeVisible();
    await expect(page.getByTestId('tax-not-in-use')).toBeVisible();
    await expect(page.getByTestId('set-tax-rate')).toHaveValue('0.00');
    await expect(page.getByTestId('set-tax-rate')).toBeDisabled();
    await expect(page.locator('input#set-tax-enabled')).toBeDisabled();
    await expect(page.locator('input#set-tax-enabled')).not.toBeChecked();
  });
});

test.describe('P1-SET-03 restaurant details for receipts', () => {
  test('P1-SET-03-T01 owner saves name, address, phone, footer; persisted and audited', { tag: '@api' }, async ({ owner }) => {
    const cur = await json<Schemas['RestaurantDetails']>(await owner.get(EP.settings.restaurant));
    const body = { name: 'Santhula QA', address: 'No 1, Test Road\nNetolpitiya', phone: '+94 47 111 2222', receiptFooter: 'Thanks!\nCome again', version: cur.version };
    const saved = await json<Schemas['RestaurantDetails']>(await owner.put(EP.settings.restaurant, { body }));
    expect(saved).toMatchObject({ name: 'Santhula QA', address: 'No 1, Test Road\nNetolpitiya', phone: '+94 47 111 2222', receiptFooter: 'Thanks!\nCome again' });
    expect((await settingsAudit(owner, 'Santhula QA')).length).toBeGreaterThan(0);
    await json(await owner.put(EP.settings.restaurant, { body: { ...SEED.settings.restaurant, version: saved.version } }));
  });

  test('P1-SET-03-T02 name (1-60), address (1-200), phone (1-40) are required; footer is at most 300 characters', { tag: '@api' }, async ({ owner }) => {
    const cur = await json<Schemas['RestaurantDetails']>(await owner.get(EP.settings.restaurant));
    const ok = { name: 'n', address: 'a', phone: 'p', version: cur.version };
    const cases: Array<[string, Record<string, unknown>]> = [
      ['name', { ...ok, name: '' }],
      ['name', { ...ok, name: 'x'.repeat(61) }],
      ['address', { ...ok, address: '' }],
      ['address', { ...ok, address: 'x'.repeat(201) }],
      ['phone', { ...ok, phone: '' }],
      ['phone', { ...ok, phone: 'x'.repeat(41) }],
      ['receiptFooter', { ...ok, receiptFooter: 'x'.repeat(301) }],
    ];
    for (const [field, body] of cases) {
      const p = await expectProblem(await owner.put(EP.settings.restaurant, { body }), 422);
      expect((p.fieldErrors ?? []).map((f) => f.field), field).toContain(field);
    }
    const edge = await json<Schemas['RestaurantDetails']>(await owner.put(EP.settings.restaurant, { body: { name: 'x'.repeat(60), address: 'x'.repeat(200), phone: 'x'.repeat(40), receiptFooter: 'x'.repeat(300), version: cur.version } }));
    await json(await owner.put(EP.settings.restaurant, { body: { ...SEED.settings.restaurant, version: edge.version } }));
  });

  test('P1-SET-03-T03 settings screen edits the restaurant details', async ({ uiAs, owner }) => {
    const page = await uiAs('owner');
    const settings = new AdminSettingsPage(page);
    await settings.goto();
    await expect(settings.restaurantName).toHaveValue(/\w/);
    await settings.restaurantName.fill('Santhula UI QA');
    await settings.restaurantPhone.fill('+94 47 555 0000');
    await settings.restaurantAddress.fill('Line one\nLine two');
    await settings.receiptFooter.fill('See you soon');
    await settings.save();
    await expect(page.getByTestId('settings-dirty')).toBeHidden();
    await page.reload();
    await expect(settings.restaurantName).toHaveValue('Santhula UI QA');
    await expect(settings.restaurantAddress).toHaveValue('Line one\nLine two');
    await expect(settings.receiptFooter).toHaveValue('See you soon');
    const cur = await json<Schemas['RestaurantDetails']>(await owner.get(EP.settings.restaurant));
    await json(await owner.put(EP.settings.restaurant, { body: { ...SEED.settings.restaurant, version: cur.version } }));
  });

  test('P1-SET-03-T03b the settings screen shows a field error for an empty name and saves nothing', async ({ uiAs }) => {
    const page = await uiAs('owner');
    const settings = new AdminSettingsPage(page);
    await settings.goto();
    await expect(settings.restaurantName).toHaveValue(/\w/);
    await settings.restaurantName.fill('');
    await settings.save();
    await expect(page.getByTestId('field-error-name')).toBeVisible();
  });

  test('P1-SET-03-T04 restaurant details are printed on every receipt, including reprints', async () => {
    test.fixme(true, 'Needs the print agent and an 80 mm printer (M1.3 / M1.4); manual hardware check');
  });
});

test.describe('P1-SET-04 business day start', () => {
  test('P1-SET-04-T01 owner sets dayStartTime (HH:mm); persisted, audited; time zone is Asia/Colombo', { tag: '@api' }, async ({ owner }) => {
    const cur = await json<Schemas['BusinessDaySettings']>(await owner.get(EP.settings.businessDay));
    expect(cur.timeZone).toBe('Asia/Colombo');
    const saved = await json<Schemas['BusinessDaySettings']>(await owner.put(EP.settings.businessDay, { body: { dayStartTime: '04:30', version: cur.version } }));
    expect(saved.dayStartTime).toBe('04:30');
    expect((await json<Schemas['BusinessDaySettings']>(await owner.get(EP.settings.businessDay))).dayStartTime).toBe('04:30');
    expect((await settingsAudit(owner, '04:30')).length).toBeGreaterThan(0);
    await json(await owner.put(EP.settings.businessDay, { body: { dayStartTime: SEED.settings.businessDayStart, version: saved.version } }));
  });

  for (const bad of ['25:00', '6:00', '06:60', 'abc', '', '24:00', '06:00:00']) {
    test(`P1-SET-04-T02 dayStartTime "${bad}" is rejected with 422`, { tag: '@api' }, async ({ owner }) => {
      const cur = await json<Schemas['BusinessDaySettings']>(await owner.get(EP.settings.businessDay));
      await expectProblem(await owner.put(EP.settings.businessDay, { body: { dayStartTime: bad, version: cur.version } }), 422);
    });
  }

  for (const ok of ['00:00', '23:59']) {
    test(`P1-SET-04-T02b the boundary time ${ok} is accepted`, { tag: '@api' }, async ({ owner }) => {
      const cur = await json<Schemas['BusinessDaySettings']>(await owner.get(EP.settings.businessDay));
      const res = await json<Schemas['BusinessDaySettings']>(await owner.put(EP.settings.businessDay, { body: { dayStartTime: ok, version: cur.version } }));
      await json(await owner.put(EP.settings.businessDay, { body: { dayStartTime: SEED.settings.businessDayStart, version: res.version } }));
    });
  }

  test('P1-SET-04-T03 settings screen edits the business day start', async ({ uiAs, owner }) => {
    const page = await uiAs('owner');
    const settings = new AdminSettingsPage(page);
    await settings.goto();
    await expect(settings.businessDayStart).toHaveValue(/\d\d:\d\d/);
    await expect(page.getByTestId('settings-business-day')).toContainText('Asia/Colombo');
    await settings.businessDayStart.fill('05:15');
    await settings.save();
    await expect(page.getByTestId('settings-dirty')).toBeHidden();
    await page.reload();
    await expect(settings.businessDayStart).toHaveValue('05:15');
    const cur = await json<Schemas['BusinessDaySettings']>(await owner.get(EP.settings.businessDay));
    await json(await owner.put(EP.settings.businessDay, { body: { dayStartTime: SEED.settings.businessDayStart, version: cur.version } }));
  });

  test('P1-SET-04-T04 an order after midnight but before day-end belongs to the open business day', async () => {
    test.fixme(true, 'Needs orders and day-end (M1.5)');
  });
  test('P1-SET-04-T05 a change applies from the next business day; the open day is unchanged', async () => {
    test.fixme(true, 'Needs an open business day (M1.5)');
  });
});

test.describe('P1-AUTH-03 idle timeout settings', { tag: '@api' }, () => {
  test('P1-AUTH-03-T10 defaults: CASHIER_POS 10, RECEPTION_POS 10, ADMIN 30; KITCHEN and DISPLAY exempt', async ({ owner }) => {
    const s = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
    const by = Object.fromEntries(s.rules.map((r) => [r.terminalType, r]));
    expect(by.CASHIER_POS?.idleTimeoutMinutes).toBe(10);
    expect(by.RECEPTION_POS?.idleTimeoutMinutes).toBe(10);
    expect(by.ADMIN?.idleTimeoutMinutes).toBe(30);
    expect(by.KITCHEN).toMatchObject({ exempt: true });
    expect(by.DISPLAY).toMatchObject({ exempt: true });
    expect(by.KITCHEN?.idleTimeoutMinutes).toBeUndefined();
  });

  for (const bad of [0, 241, -1, 7.5]) {
    test(`P1-AUTH-03-T07 idle timeout of ${bad} minutes is rejected with 422`, async ({ owner }) => {
      const cur = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
      const rules = [{ terminalType: 'CASHIER_POS', idleTimeoutMinutes: bad }, { terminalType: 'RECEPTION_POS', idleTimeoutMinutes: 10 }, { terminalType: 'ADMIN', idleTimeoutMinutes: 30 }];
      await expectProblem(await owner.put(EP.settings.idleTimeouts, { body: { rules, version: cur.version } }), 422);
    });
  }

  test('P1-AUTH-03-T07b a KITCHEN or DISPLAY rule, or a missing or duplicated POS type, is rejected with 422', async ({ owner }) => {
    const cur = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
    const base = [{ terminalType: 'CASHIER_POS', idleTimeoutMinutes: 10 }, { terminalType: 'RECEPTION_POS', idleTimeoutMinutes: 10 }, { terminalType: 'ADMIN', idleTimeoutMinutes: 30 }];
    await expectProblem(await owner.put(EP.settings.idleTimeouts, { body: { rules: [...base.slice(0, 2), { terminalType: 'KITCHEN', idleTimeoutMinutes: 5 }], version: cur.version } }), 422);
    await expectProblem(await owner.put(EP.settings.idleTimeouts, { body: { rules: [...base.slice(0, 2), { terminalType: 'DISPLAY', idleTimeoutMinutes: 5 }], version: cur.version } }), 422);
    await expectProblem(await owner.put(EP.settings.idleTimeouts, { body: { rules: base.slice(0, 2), version: cur.version } }), 422);
    await expectProblem(await owner.put(EP.settings.idleTimeouts, { body: { rules: [base[0], base[0], base[2]], version: cur.version } }), 422);
  });
});

test.describe('P1-AUTH-03 personal-session idle timeout (ADR-008, idleTimeoutPersonalMinutes)', { tag: '@api' }, () => {
  const POS_RULES = [{ terminalType: 'CASHIER_POS', idleTimeoutMinutes: 10 }, { terminalType: 'RECEPTION_POS', idleTimeoutMinutes: 10 }, { terminalType: 'ADMIN', idleTimeoutMinutes: 30 }];

  test('P1-AUTH-03-T20 default idleTimeoutPersonalMinutes is 30 and a personal session reports it as its idle timeout', async ({ owner, api }) => {
    const s = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
    expect(s.idleTimeoutPersonalMinutes).toBe(30);
    const m = userFor('manager');
    const session = await json<Schemas['AuthSession']>(await api.loginPersonal(m.username, passwordFor(m)));
    expect(session).toMatchObject({ sessionType: 'PERSONAL', idleTimeoutMinutes: 30 });
  });

  for (const bad of [0, 241, -1, 7.5]) {
    test(`P1-AUTH-03-T21 idleTimeoutPersonalMinutes of ${bad} is rejected with 422`, async ({ owner }) => {
      const cur = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
      await expectProblem(await owner.put(EP.settings.idleTimeouts, { body: { rules: POS_RULES, idleTimeoutPersonalMinutes: bad, version: cur.version } }), 422);
    });
  }

  test('P1-AUTH-03-T22 1 and 240 are accepted; a new personal session gets the new value, a terminal session keeps its type rule; omitting the field keeps it', async ({ owner, api, terminal }) => {
    for (const ok of [1, 240, 45]) {
      const cur = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
      const saved = await json<Schemas['IdleTimeoutSettings']>(await owner.put(EP.settings.idleTimeouts, { body: { rules: POS_RULES, idleTimeoutPersonalMinutes: ok, version: cur.version } }));
      expect(saved.idleTimeoutPersonalMinutes).toBe(ok);
    }
    const m = userFor('manager');
    expect(await json<Schemas['AuthSession']>(await api.loginPersonal(m.username, passwordFor(m)))).toMatchObject({ sessionType: 'PERSONAL', idleTimeoutMinutes: 45 });
    const t = await json<Schemas['AuthSession']>(await api.withTerminal(terminal('ADMIN')).login(m.username, passwordFor(m)));
    expect(t).toMatchObject({ sessionType: 'TERMINAL', idleTimeoutMinutes: 30 });
    const cur = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
    const kept = await json<Schemas['IdleTimeoutSettings']>(await owner.put(EP.settings.idleTimeouts, { body: { rules: POS_RULES, version: cur.version } }));
    expect(kept.idleTimeoutPersonalMinutes).toBe(45);
  });

  test('P1-AUTH-03-T23 changing idleTimeoutPersonalMinutes leaves a SETTINGS_CHANGED audit row with the old and new value', async ({ owner }) => {
    const cur = await json<Schemas['IdleTimeoutSettings']>(await owner.get(EP.settings.idleTimeouts));
    await json(await owner.put(EP.settings.idleTimeouts, { body: { rules: POS_RULES, idleTimeoutPersonalMinutes: 44, version: cur.version } }));
    // the idle_timeouts snapshot names the personal value PERSONAL (before/after: {CASHIER_POS, RECEPTION_POS, ADMIN, PERSONAL})
    const rows = await settingsAudit(owner, 'idle_timeouts');
    const row = rows.find((r) => (r.after as Record<string, unknown> | undefined)?.PERSONAL === 44);
    expect(row, JSON.stringify(rows.slice(0, 3))).toBeDefined();
    expect(row!.terminal?.id).toBeDefined(); // owner fixture = terminal session
    expect(row!.clientInfo).toEqual(expect.any(String));
  });
});

test.describe('P1-AUTH-03 idle timeout settings screen', () => {
  test('P1-AUTH-03-T12 the settings screen shows POS and admin timeouts and "Never" for kitchen and display', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin/settings');
    await expect(page.getByTestId('set-idle-CASHIER_POS')).toHaveValue('10');
    await expect(page.getByTestId('set-idle-ADMIN')).toHaveValue('30');
    await expect(page.getByTestId('set-idle-KITCHEN')).toContainText('Never');
    await expect(page.getByTestId('set-idle-DISPLAY')).toContainText('Never');
  });
});
