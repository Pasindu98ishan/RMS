/**
 * Annex A §15 non-functional requirements applicable from M1.0 (P1-NFR-01 .. P1-NFR-07).
 * Hardware, Edge, Android, backup and availability checks are manual: see test-plan.md and signoff.md.
 */
import { test, expect } from '../fixtures/test';
import { passwordFor, userFor } from '../fixtures/seed';
import { AdminAuditPage } from '../pages/admin/admin-pages';
import { auditSearch, json, secretsToHide } from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { env } from '../utils/env';

const overflowX = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('P1-NFR-01 timing baseline', { tag: '@api' }, () => {
  test('P1-NFR-01-T01 login and a first protected call complete well inside 3 seconds', async ({ api, terminal }) => {
    const u = userFor('cashier');
    const started = Date.now();
    const { client } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, passwordFor(u));
    expect((await client.get(EP.me)).status()).toBe(200);
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'baseline', description: `login + /auth/me = ${ms} ms (KOT <= 3 s is measured in M1.3)` });
    expect(ms).toBeLessThan(3000);
  });
});

test.describe('P1-NFR-02 target screen sizes', () => {
  test('P1-NFR-02-T01 the login screen fits 1366x768 without horizontal scroll and its button is at least 48 px', async ({ page, registeredDevice }) => {
    expect(page.viewportSize()).toEqual({ width: 1366, height: 768 });
    const login = await registeredDevice('CASHIER_POS');
    await login.goto('/login');
    await expect(login.getByTestId('login-submit')).toBeVisible();
    expect(await overflowX(login)).toBeLessThanOrEqual(0);
    expect((await login.getByTestId('login-submit').boundingBox())!.height).toBeGreaterThanOrEqual(48);
    for (const id of ['login-username', 'login-password']) {
      expect((await login.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    }
  });

  test('P1-NFR-02-T01c the POS shell fits 1366x768 without horizontal scroll and its header touch targets are at least 48 px', async ({ uiAs }) => {
    const pos = await uiAs('cashier', { terminal: 'CASHIER_POS' });
    await pos.goto('/pos');
    await expect(pos.getByTestId('pos-home')).toBeVisible();
    expect(await overflowX(pos)).toBeLessThanOrEqual(0);
    const small: string[] = [];
    for (const id of ['nav-pos', 'user-menu']) {
      const box = await pos.getByTestId(id).boundingBox();
      if (box && (box.height < 48 || box.width < 48)) small.push(`${id} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    expect(small, `POS header touch targets under 48 px: ${small.join(', ')}`).toEqual([]);
  });

  test('P1-NFR-02-T01b admin screens fit 1366x768 without horizontal scroll', async ({ uiAs }) => {
    const page = await uiAs('owner');
    for (const route of ['/admin', '/admin/users', '/admin/roles', '/admin/terminals', '/admin/settings', '/admin/audit']) {
      await page.goto(route);
      await expect(page.getByTestId('app-nav')).toBeVisible();
      expect(await overflowX(page), route).toBeLessThanOrEqual(0);
    }
  });

  test('P1-NFR-02-T03 admin screens are usable at 360 px wide (no horizontal scroll, content reachable)', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.setViewportSize({ width: 360, height: 740 });
    for (const route of ['/admin', '/admin/users', '/admin/roles', '/admin/terminals', '/admin/settings', '/admin/audit']) {
      await page.goto(route);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await overflowX(page), `${route} at 360 px`).toBeLessThanOrEqual(0);
    }
    await page.goto('/admin/users');
    await expect(page.getByTestId('users-table')).toBeVisible();
    await expect(page.getByTestId('user-create')).toBeVisible();
  });

  test('P1-NFR-02-T06 the admin shell works at phone size 390x844 with the navigation drawer (owner on a phone, Annex A §14)', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');
    await expect(page.getByTestId('admin-home')).toBeVisible();
    await page.getByTestId('nav-toggle').click();
    await expect(page.getByTestId('nav-admin-audit')).toBeVisible();
  });
});

test.describe('P1-NFR-02 kitchen screen size', { tag: '@kds' }, () => {
  test('P1-NFR-02-T02 the kitchen layout fits 1280x800 landscape without scrolling', async ({ page, uiAs, makeUser }) => {
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
    const u = await makeUser({ role: 'kitchen' });
    const kds = await uiAs('kitchen', { terminal: 'CASHIER_POS', user: u }); // KITCHEN terminals need real stations (M1.1)
    await kds.goto('/kitchen');
    await expect(kds.getByTestId('kds-board')).toBeVisible();
    expect(await overflowX(kds)).toBeLessThanOrEqual(0);
    const vertical = await kds.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
    expect(vertical).toBeLessThanOrEqual(0);
  });

  test('P1-NFR-02-T02b kitchen header controls are at least 48 px (touch-first)', async ({ uiAs, makeUser }) => {
    const u = await makeUser({ role: 'kitchen' });
    const kds = await uiAs('kitchen', { terminal: 'CASHIER_POS', user: u });
    await kds.goto('/kitchen');
    await expect(kds.getByTestId('kds-board')).toBeVisible();
    const box = await kds.getByTestId('user-menu').boundingBox();
    expect(box!.height, 'user-menu height').toBeGreaterThanOrEqual(48);
  });
});

test.describe('P1-NFR-03 transport and secrets', { tag: '@api' }, () => {
  test('P1-NFR-03-T01 http:// redirects to https:// and HSTS is set', async ({ request }) => {
    test.skip(!env.baseUrl.startsWith('https:') && !process.env.RMS_STAGING_URL, 'Local stack runs on http; this check runs on staging (set RMS_STAGING_URL)');
    const res = await request.get((process.env.RMS_STAGING_URL ?? env.baseUrl).replace(/^https:/, 'http:'), { maxRedirects: 0, failOnStatusCode: false });
    expect([301, 308]).toContain(res.status());
    expect(res.headers().location ?? '').toMatch(/^https:\/\//);
  });

  test('P1-NFR-03-T05 no password, PIN, token hash or device token appears in any M1.0 read response', async ({ owner, seedState }) => {
    const me = owner.session!.user.id;
    const bodies: string[] = [];
    const get = async (p: string, q?: Record<string, string | number>) => bodies.push(await (await owner.get(p, { query: q })).text());
    await get(EP.users, { size: 200 });
    await get(EP.user(me));
    await get(EP.roles);
    await get(EP.permissions);
    await get(EP.terminals);
    await get(EP.me);
    await get(EP.auditLog, { size: 200 });
    for (const s of Object.values(EP.settings)) await get(s);
    const all = bodies.join('\n');
    expect(all).not.toMatch(/passwordHash|pinHash|password_hash|pin_hash|tokenHash|token_hash|"password"\s*:|"pin"\s*:|\$2[aby]\$|\$argon2/i);
    const deviceTokens = Object.values(seedState?.terminals ?? {}).map((t) => t!.deviceToken);
    for (const secret of [...secretsToHide(), ...deviceTokens]) expect(all).not.toContain(secret);
  });
});

test.describe('P1-NFR-06 / P1-NFR-07 language and time', () => {
  test('P1-NFR-06-T01 M1.0 screens are English with no untranslated keys or placeholders', async ({ uiAs }) => {
    const page = await uiAs('owner');
    for (const route of ['/admin', '/admin/users', '/admin/roles', '/admin/terminals', '/admin/settings', '/admin/audit']) {
      await page.goto(route);
      await expect(page.locator('h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      const text = await page.locator('body').innerText();
      expect(text, route).not.toMatch(/undefined|\[object Object\]|\bNaN\b|\{\{|\}\}|\bnull\b/);
      expect(text, route).not.toMatch(/\b[a-z]+(\.[a-z]+){2,}\b/);
      expect(text, route).not.toMatch(/[\u0D80-\u0DFF\u0B80-\u0BFF]/); // no Sinhala / Tamil (English only, client decision #3)
      expect(await page.locator('html').getAttribute('lang')).toBe('en');
    }
  });

  test('P1-NFR-07-T01 API timestamps are ISO-8601 UTC (Z)', { tag: '@api' }, async ({ owner }) => {
    const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
    const users = await json<{ items: Array<Record<string, string>> }>(await owner.get(EP.users, { query: { size: 5 } }));
    const sc = await json<Record<string, string>>(await owner.get(EP.settings.serviceCharges));
    const audit = await auditSearch(owner, { size: 5 });
    const stamps = [
      ...users.items.flatMap((u) => [u.createdAt, u.lastLoginAt].filter(Boolean)),
      sc.updatedAt,
      ...audit.items.map((e) => e.at),
    ];
    expect(stamps.length).toBeGreaterThan(3);
    for (const s of stamps) expect(s).toMatch(iso);
  });

  test.describe('browser in another timezone', () => {
    test.use({ timezoneId: 'Europe/London' });
    test('P1-NFR-07-T02 the audit viewer shows Asia/Colombo time even when the device is not in Sri Lanka', async ({ uiAs, api, terminal, owner, makeUser }) => {
      const u = await makeUser({ role: 'cashier' });
      await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
      const entry = (await auditSearch(owner, { userId: u.id, action: 'LOGIN' })).items[0];
      const colombo = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Colombo', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date(entry.at));
      const page = await uiAs('owner');
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('Europe/London');
      const audit = new AdminAuditPage(page);
      await audit.goto();
      await audit.user.selectOption({ label: `QA ${u.username} (${u.username})` });
      await audit.action.selectOption('LOGIN');
      await audit.searchButton.click();
      await expect(audit.times.first()).toHaveText(colombo);
    });
  });
});

test.describe('P1-NFR-07 kitchen clock', { tag: '@kds' }, () => {
  test.use({ timezoneId: 'Europe/London' });
  test('P1-NFR-07-T03 the kitchen header clock shows Asia/Colombo time', async ({ uiAs, makeUser }) => {
    const u = await makeUser({ role: 'kitchen' });
    const page = await uiAs('kitchen', { terminal: 'CASHIER_POS', user: u });
    await page.goto('/kitchen');
    const shown = (await page.getByLabel('Time in Colombo').textContent()) ?? '';
    const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    const ok = [hhmm(new Date()), hhmm(new Date(Date.now() - 60_000))];
    expect(ok.some((t) => shown.includes(t)), `clock shows "${shown}", Colombo is ${ok[0]}`).toBe(true);
  });
});
