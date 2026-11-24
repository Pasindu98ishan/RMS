/**
 * Browser smoke (P1-NFR-02: current Chrome / Edge on PC). Runs in chromium-desktop with the rest and, on a machine
 * with Microsoft Edge installed, in the `edge-desktop` project: `npx playwright test --project=edge-desktop`.
 * It walks the real screens end to end: terminal known -> login -> admin home -> users -> settings -> audit -> logout.
 */
import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/shared';

test.describe('P1-NFR-02 browser smoke', { tag: '@smoke' }, () => {
  test('P1-NFR-02-T04 a manager logs in on an admin device, sees the admin home, is refused owner-only screens and logs out', async ({ freshDevice, makeUser }) => {
    const u = await makeUser({ role: 'manager' });
    const page = await freshDevice('ADMIN');
    const login = new LoginPage(page);
    await login.goto();
    await login.login(u.username, u.password);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId('admin-home')).toBeVisible();
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/forbidden/); // a manager has no USER_MANAGE
    await page.getByTestId('logout').click(); // the "No access" page has its own Log out button
    await expect(page).toHaveURL(/\/login/);
  });

  test('P1-NFR-02-T04b the owner can use users, roles, settings and audit screens', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin/users');
    await expect(page.getByTestId('users-table')).toBeVisible();
    await page.goto('/admin/roles');
    await expect(page.getByTestId('roles-list')).toBeVisible();
    await page.goto('/admin/settings');
    await expect(page.getByTestId('settings-restaurant')).toBeVisible();
    await page.goto('/admin/audit');
    await expect(page.getByTestId('audit-table')).toBeVisible();
  });
});
