/**
 * Personal login in the browser (client decision #9, ADR-008 #8-#10, screens.md "Shared"): P1-AUTH-04, P1-AUTH-01.
 * - The first screen is /login on every device; an unregistered device shows "Personal device" and a
 *   "Set up this device" link to /setup/terminal.
 * - Landing after a personal login: /admin with any admin permission, /rider for riders, otherwise /home.
 * - POS and kitchen routes in a personal session show "Use a registered counter device" (/terminal-required).
 * - A registered device shows its terminal name and logs in as a terminal session, as before.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { type TerminalRecord, passwordFor, userFor } from '../fixtures/seed';
import { seedBrowserStorage } from '../fixtures/ui';
import { LoginPage } from '../pages/shared';
import type { ApiClient, AuthSession } from '../utils/api-client';
import { json } from '../utils/admin-api';
import type { RoleKey } from '../utils/role-grants';

async function loginOnPersonalDevice(page: Page, role: RoleKey): Promise<void> {
  const u = userFor(role);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await new LoginPage(page).login(u.username, passwordFor(u));
}

/** Personal session injected into the browser (no terminal in storage). */
async function personalSession(context: BrowserContext, api: ApiClient, role: RoleKey): Promise<void> {
  const u = userFor(role);
  const session = await json<AuthSession>(await api.loginPersonal(u.username, passwordFor(u)));
  expect(session.sessionType).toBe('PERSONAL');
  await seedBrowserStorage(context, { session });
}

test.describe('P1-AUTH-04 personal device: login page first (UI)', () => {
  test('P1-AUTH-04-T60 an unregistered device opens at /login, shows "Personal device" and a "Set up this device" link to /setup/terminal', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-device')).toBeVisible();
    await expect(page.getByTestId('login-device')).toContainText(/personal device/i);
    const link = page.getByTestId('link-terminal-setup');
    await expect(link).toHaveText(/set up this device/i);
    await link.click();
    await expect(page).toHaveURL(/\/setup\/terminal$/);
    await expect(page.getByTestId('terminal-register')).toBeVisible();
  });

  test('P1-AUTH-04-T61 the owner logs in on an unregistered device without setup and lands on /admin', async ({ page }) => {
    await loginOnPersonalDevice(page, 'owner');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId('nav-admin-users')).toBeVisible();
  });

  test('P1-AUTH-04-T62 the manager lands on /admin (holds admin permissions such as FLOOR_MANAGE)', async ({ page }) => {
    await loginOnPersonalDevice(page, 'manager');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('P1-AUTH-04-T63 a rider logs in on an unregistered device and lands on /rider', async ({ page }) => {
    await loginOnPersonalDevice(page, 'rider');
    await expect(page).toHaveURL(/\/rider$/);
    await expect(page.getByTestId('rider-home')).toBeVisible();
  });

  for (const role of ['inventory', 'hr'] as const) {
    test(`P1-AUTH-04-T64 [${role}] with no admin or rider screens lands on the personal home page /home`, async ({ page }) => {
      await loginOnPersonalDevice(page, role);
      await expect(page).toHaveURL(/\/home$/);
      await expect(page.getByTestId('home-page')).toBeVisible();
    });
  }

  for (const role of ['cashier', 'receptionist', 'kitchen'] as const) {
    test(`P1-AUTH-04-T65 [${role}] on an unregistered device sees "only on a registered counter or kitchen device" and stays on /login`, async ({ page }) => {
      await loginOnPersonalDevice(page, role);
      await expect(page.getByTestId('login-error')).toContainText(/registered counter or kitchen device/i);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe('P1-AUTH-04 registered device (UI, unchanged behaviour)', () => {
  test('P1-AUTH-04-T66 a registered device shows its terminal name on the login page and the cashier logs in to /pos as a terminal session', async ({ registeredDevice, seedState }) => {
    const page = await registeredDevice('CASHIER_POS');
    const t = seedState!.terminals.CASHIER_POS as TerminalRecord;
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('login-device')).toContainText(t.name);
    await expect(page.getByTestId('link-terminal-setup')).toBeVisible();
    const u = userFor('cashier');
    await new LoginPage(page).login(u.username, passwordFor(u));
    await expect(page).toHaveURL(/\/pos$/);
  });
});

test.describe('P1-AUTH-04 POS and kitchen need a terminal session (UI)', () => {
  for (const route of ['/pos', '/pos/availability', '/kitchen']) {
    test(`P1-AUTH-04-T67 in a personal session the owner opening ${route} sees "Use a registered counter device" instead of the screen`, async ({ context, page, api }) => {
      await personalSession(context, api, 'owner');
      await page.goto(route);
      await expect(page.getByTestId('terminal-required-page')).toBeVisible();
      await expect(page.getByText(/use a registered counter device/i).first()).toBeVisible();
      await expect(page.getByTestId('pos-availability')).toHaveCount(0);
    });
  }

  // Q42 (lead 2026-11-24): permission first, then session type.
  test('P1-AUTH-04-T67b in a personal session the manager opening /pos sees "Use a registered counter device"', async ({ context, page, api }) => {
    await personalSession(context, api, 'manager');
    await page.goto('/pos');
    await expect(page.getByTestId('terminal-required-page')).toBeVisible();
  });

  test('P1-AUTH-04-T67c in a personal session a rider (no POS permission) opening /pos gets /forbidden, not the terminal page', async ({ context, page, api }) => {
    await personalSession(context, api, 'rider');
    await page.goto('/pos');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByTestId('terminal-required-page')).toHaveCount(0);
  });

  test('P1-AUTH-04-T68 in a personal session the admin screens work as usual (owner opens /admin/users)', async ({ context, page, api }) => {
    await personalSession(context, api, 'owner');
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByTestId('terminal-required-page')).toHaveCount(0);
    await expect(page.getByTestId('forbidden-page')).toHaveCount(0);
  });

  test('P1-AUTH-04-T69 permission still applies in a personal session: a rider opening /admin/users gets /forbidden', async ({ context, page, api }) => {
    await personalSession(context, api, 'rider');
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/forbidden/);
  });
});
