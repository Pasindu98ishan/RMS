/**
 * Annex A §2 — UI route matrix (P1-RBAC-03-T04/T05). Generated from utils/route-permissions.ts
 * (routes from docs/ui/screens.md; mappings marked "assumed" follow frontend/src/router/access.ts, Q14).
 * Everyone logs in on the ADMIN terminal; reachability depends on permissions, not on the terminal.
 * "UI hiding is not enough" is covered by the generated API matrix in permission-matrix.spec.ts.
 */
import { test, expect } from '../fixtures/test';
import { createRole, createUser } from '../utils/admin-api';
import { buildRouteCases } from '../utils/route-permissions';
import { SEEDED_ROLES } from '../utils/role-grants';

const pathOf = (url: string) => new URL(url).pathname;

test.describe('P1-RBAC-03 UI route matrix (generated)', () => {
  for (const c of buildRouteCases()) {
    test(c.title, async ({ uiAs, registeredDevice }) => {
      let page;
      if (c.route === '/login' || c.route === '/setup/terminal') {
        // Public screens: a registered device with nobody logged in, plus (below) a logged-in user.
        page = await registeredDevice('ADMIN');
        await page.goto(c.route);
        await expect(page).toHaveURL(new RegExp(`${c.route.replace(/\//g, '\/')}$`));
        return;
      }
      page = await uiAs(c.role, { terminal: 'ADMIN' });
      await page.goto(c.route);
      await expect(page.locator('body')).not.toBeEmpty();
      if (c.expectation === 'reachable') {
        await expect(page).toHaveURL(new RegExp(`${c.route.replace(/\//g, '\/')}$`));
        await expect(page.getByTestId('forbidden-page')).toHaveCount(0);
      } else {
        await expect(page).toHaveURL(/\/forbidden/);
        expect(pathOf(page.url())).toBe('/forbidden');
        await expect(page.getByTestId('forbidden-page')).toBeVisible();
      }
    });
  }

  test('P1-RBAC-03-T05 the admin navigation shows only the entries the role may open', async ({ uiAs }) => {
    const owner = await uiAs('owner');
    await owner.goto('/admin');
    for (const item of ['nav-admin', 'nav-admin-users', 'nav-admin-roles', 'nav-admin-terminals', 'nav-admin-settings', 'nav-admin-audit']) {
      // "nav-admin" is the home entry (path "/admin")
      if (item === 'nav-admin') continue;
      await expect(owner.getByTestId(item), item).toBeVisible();
    }
  });

  test('P1-RBAC-03-T05b a manager sees the admin home but none of the owner-only entries', async ({ uiAs }) => {
    const page = await uiAs('manager');
    await page.goto('/admin');
    await expect(page.getByTestId('admin-home')).toBeVisible();
    for (const item of ['nav-admin-users', 'nav-admin-roles', 'nav-admin-terminals', 'nav-admin-settings', 'nav-admin-audit']) {
      await expect(page.getByTestId(item), item).toHaveCount(0);
    }
  });

  test('P1-RBAC-03-T05c a user with only AUDIT_VIEW sees only the audit entry', async ({ uiAs, owner }) => {
    const role = await createRole(owner, ['AUDIT_VIEW']);
    const u = await createUser(owner, { roleIds: [role.id] });
    const page = await uiAs('owner', { user: u, terminal: 'ADMIN' });
    await page.goto('/admin');
    await expect(page.getByTestId('nav-admin-audit')).toBeVisible();
    for (const item of ['nav-admin-users', 'nav-admin-roles', 'nav-admin-terminals', 'nav-admin-settings']) {
      await expect(page.getByTestId(item), item).toHaveCount(0);
    }
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/forbidden/);
  });

  test('P1-RBAC-03-T08 a logged-in user is sent back to their landing page when opening /login', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/login');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('P1-RBAC-03-T09 the matrix covers every seeded role for every route', () => {
    const cases = buildRouteCases();
    for (const role of SEEDED_ROLES) expect(cases.filter((c) => c.role === role).length).toBe(20);
  });
});
