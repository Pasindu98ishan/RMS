/**
 * Annex A §2 roles and permissions: seeded roles, custom roles, users, kitchen station scope
 * (P1-RBAC-01, P1-RBAC-02, P1-RBAC-04). The operation × role matrix (P1-RBAC-03) is generated in
 * permission-matrix.spec.ts; the UI route matrix in ui-permissions.spec.ts. Tests that edit system
 * roles or change the number of owners are in serial.spec.ts.
 */
import { test, expect } from '../fixtures/test';
import { passwordFor, userFor } from '../fixtures/seed';
import { AdminRolesPage } from '../pages/admin/admin-pages';
import { type Schemas, expectProblem } from '../utils/api-client';
import { auditFor, auditSearch, createRole, createUser, getRole, getUser, json, roleIdByKey, uniqueName } from '../utils/admin-api';
import { EP } from '../utils/endpoints';
import { PERMISSIONS, ROLE_DISPLAY_NAMES, SEEDED_ROLES, defaultPermissionsOf } from '../utils/role-grants';

const sorted = (a: readonly string[]) => [...a].sort();

test.describe('P1-RBAC-01 seeded roles', { tag: '@api' }, () => {
  test('P1-RBAC-01-T01 exactly the 8 system roles exist with the documented names and keys', async ({ owner }) => {
    const roles = await json<Schemas['RoleSummary'][]>(await owner.get(EP.roles));
    const system = roles.filter((r) => r.system);
    expect(sorted(system.map((r) => r.name))).toEqual(sorted(Object.values(ROLE_DISPLAY_NAMES)));
    expect(sorted(system.map((r) => String(r.key)))).toEqual(sorted(SEEDED_ROLES.map((r) => r.toUpperCase())));
  });

  for (const role of SEEDED_ROLES) {
    test(`P1-RBAC-01-T02 [${role}] system role has exactly the default permissions of roles-permissions.md`, async ({ owner }) => {
      const id = await roleIdByKey(owner, role);
      const full = await getRole(owner, id);
      expect(full.system).toBe(true);
      expect(full.name).toBe(ROLE_DISPLAY_NAMES[role]);
      expect(sorted(full.permissionCodes)).toEqual(sorted(defaultPermissionsOf(role)));
    });

    test(`P1-RBAC-01-T03 [${role}] login response permissions[] equal the role's defaults`, async ({ apiAs }) => {
      const c = await apiAs(role);
      expect(sorted(c.session!.permissions)).toEqual(sorted(defaultPermissionsOf(role)));
      expect(c.session!.user.roles.map((r) => r.key)).toContain(role.toUpperCase());
    });
  }

  test('P1-RBAC-01-T04 listPermissions returns exactly the Phase 1 codes of roles-permissions.md, grouped by module', async ({ owner }) => {
    const perms = await json<Schemas['Permission'][]>(await owner.get(EP.permissions));
    expect(sorted(perms.map((p) => p.code))).toEqual(sorted(PERMISSIONS.filter((x) => x.phase === 1).map((p) => p.code)));
    for (const p of perms) {
      expect(p.description.length).toBeGreaterThan(3);
      expect(['ADMIN', 'ORDERS', 'BILLING', 'DISCOUNTS', 'KITCHEN', 'SHIFTS', 'REPORTS']).toContain(p.module);
    }
  });

  test('P1-RBAC-01-T05 system roles cannot be deleted or renamed (409 SYSTEM_ROLE_READ_ONLY)', async ({ owner }) => {
    const id = await roleIdByKey(owner, 'inventory');
    const role = await getRole(owner, id);
    await expectProblem(await owner.delete(EP.role(id)), 409, 'SYSTEM_ROLE_READ_ONLY');
    await expectProblem(
      await owner.put(EP.role(id), { body: { name: 'Renamed inventory', permissionCodes: role.permissionCodes, version: role.version } }),
      409,
      'SYSTEM_ROLE_READ_ONLY',
    );
    expect((await getRole(owner, id)).name).toBe('Inventory');
  });

  test('P1-RBAC-01-T08 the Owner role cannot be changed or deleted (409 OWNER_ROLE_READ_ONLY)', async ({ owner }) => {
    const id = await roleIdByKey(owner, 'owner');
    const role = await getRole(owner, id);
    const fewer = role.permissionCodes.filter((c) => c !== 'DISCOUNT_OWNER');
    await expectProblem(await owner.put(EP.role(id), { body: { name: role.name, permissionCodes: fewer, version: role.version } }), 409, 'OWNER_ROLE_READ_ONLY');
    await expectProblem(await owner.delete(EP.role(id)), 409);
    expect(sorted((await getRole(owner, id)).permissionCodes)).toEqual(sorted(role.permissionCodes));
  });

  test('P1-RBAC-01-T09 listRoleOptions and listUserOptions give narrow lookups without needing ROLE_MANAGE / USER_MANAGE', async ({ owner }) => {
    const roles = await json<Schemas['RoleOption'][]>(await owner.get(`${EP.roles}/options`));
    expect(roles.filter((r) => r.key).length).toBe(8);
    for (const r of roles) expect(Object.keys(r).sort()).toEqual(r.key ? ['id', 'key', 'name'] : ['id', 'name']);
    const users = await json<Schemas['UserOption'][]>(await owner.get(`${EP.users}/options`));
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) expect(Object.keys(u).sort()).toEqual(['fullName', 'id', 'username']);
  });
});

test.describe('P1-RBAC-01 roles without Phase 1 screens', () => {
  for (const role of ['rider', 'inventory', 'hr'] as const) {
    test(`P1-RBAC-01-T07 [${role}] login shows the "no access" page, not an error`, async ({ uiAs }) => {
      const page = await uiAs(role, { terminal: 'CASHIER_POS' });
      await page.goto('/');
      await expect(page).toHaveURL(/\/forbidden/);
      await expect(page.getByTestId('forbidden-page')).toBeVisible();
      await expect(page.getByTestId('forbidden-page')).not.toContainText(/error|exception|500/i);
    });
  }
});

test.describe('P1-RBAC-02 custom roles and users', { tag: '@api' }, () => {
  test('P1-RBAC-02-T01 owner creates a custom role from the permission list', async ({ owner }) => {
    const r = await createRole(owner, ['ORDER_VIEW', 'FLOOR_MANAGE']);
    expect(r.system).toBe(false);
    expect(sorted(r.permissionCodes)).toEqual(['FLOOR_MANAGE', 'ORDER_VIEW']);
    const list = await json<Schemas['RoleSummary'][]>(await owner.get(EP.roles));
    expect(list.find((x) => x.id === r.id)).toMatchObject({ system: false, permissionCount: 2, userCount: 0 });
  });

  test('P1-RBAC-02-T02 owner assigns the custom role to a user: login permissions equal the role', async ({ owner, api, terminal }) => {
    const r = await createRole(owner, ['ORDER_VIEW', 'FLOOR_MANAGE']);
    const u = await createUser(owner, { roleIds: [r.id] });
    const { session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    expect(sorted(session.permissions)).toEqual(['FLOOR_MANAGE', 'ORDER_VIEW']);
    expect((await getRole(owner, r.id)).userCount).toBe(1);
  });

  test('P1-RBAC-02-T03 removing a permission takes effect on the user\'s next token refresh', async ({ owner, api, terminal }) => {
    const role = await createRole(owner, ['USER_MANAGE', 'ORDER_VIEW']);
    const u = await createUser(owner, { roleIds: [role.id] });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { client, session } = await dev.loginAs(u.username, u.password);
    expect(session.permissions).toContain('USER_MANAGE');
    expect((await client.get(EP.users)).status()).toBe(200);
    const current = await getRole(owner, role.id);
    await json(await owner.put(EP.role(role.id), { body: { name: current.name, permissionCodes: ['ORDER_VIEW'], version: current.version } }));
    const refreshed = (await json<Schemas['AuthSession']>(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } })));
    expect(refreshed.permissions).not.toContain('USER_MANAGE');
    expect(refreshed.permissions).toContain('ORDER_VIEW');
    await expectProblem(await dev.withToken(refreshed.accessToken).get(EP.users), 403, 'FORBIDDEN');
  });

  test('P1-RBAC-02-T04 adding a permission takes effect after the next token refresh', async ({ owner, api, terminal }) => {
    const role = await createRole(owner, ['ORDER_VIEW']);
    const u = await createUser(owner, { roleIds: [role.id] });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { client, session } = await dev.loginAs(u.username, u.password);
    await expectProblem(await client.get(EP.auditLog), 403, 'FORBIDDEN');
    const current = await getRole(owner, role.id);
    await json(await owner.put(EP.role(role.id), { body: { name: current.name, permissionCodes: ['ORDER_VIEW', 'AUDIT_VIEW'], version: current.version } }));
    const refreshed = await json<Schemas['AuthSession']>(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }));
    expect(refreshed.permissions).toContain('AUDIT_VIEW');
    expect((await dev.withToken(refreshed.accessToken).get(EP.auditLog)).status()).toBe(200);
  });

  test('P1-RBAC-02-T05 changing a user\'s roles takes effect after the next token refresh', async ({ owner, api, terminal }) => {
    const u = await createUser(owner, { role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { session } = await dev.loginAs(u.username, u.password);
    expect(session.permissions).toContain('BILL_PAY');
    const audit = await createRole(owner, ['AUDIT_VIEW']);
    const user = await getUser(owner, u.id);
    await json(await owner.put(EP.userRoles(u.id), { body: { roleIds: [audit.id], version: user.version } }));
    const refreshed = await json<Schemas['AuthSession']>(await dev.post(EP.refresh, { body: { refreshToken: session.refreshToken } }));
    expect(refreshed.permissions).toEqual(['AUDIT_VIEW']);
    expect((await dev.withToken(refreshed.accessToken).get(EP.auditLog)).status()).toBe(200);
  });

  test('P1-RBAC-02-T06 role create / update / delete are audit-logged with before and after permission codes', async ({ owner }) => {
    const r = await createRole(owner, ['ORDER_VIEW']);
    const current = await getRole(owner, r.id);
    await json(await owner.put(EP.role(r.id), { body: { name: current.name, permissionCodes: ['ORDER_VIEW', 'FLOOR_MANAGE'], version: current.version } }));
    await json(await owner.delete(EP.role(r.id)), 204);
    const entries = (await auditSearch(owner, { entityId: r.id, entityType: 'ROLE' })).items;
    const by = (a: string) => entries.filter((e) => e.action === a);
    expect(by('CREATE')).toHaveLength(1);
    expect(by('UPDATE')).toHaveLength(1);
    expect(by('DELETE')).toHaveLength(1);
    expect(JSON.stringify(by('CREATE')[0].after)).toContain('ORDER_VIEW');
    expect(JSON.stringify(by('UPDATE')[0].before)).toContain('ORDER_VIEW');
    expect(JSON.stringify(by('UPDATE')[0].before)).not.toContain('FLOOR_MANAGE');
    expect(JSON.stringify(by('UPDATE')[0].after)).toContain('FLOOR_MANAGE');
    expect(JSON.stringify(by('DELETE')[0].before)).toContain('FLOOR_MANAGE');
    for (const e of entries) expect(e.terminal?.id).toBeTruthy();
  });

  test('P1-RBAC-02-T07 role assignment is audit-logged (ROLES_ASSIGNED, before/after role names)', async ({ owner }) => {
    const u = await createUser(owner, { role: 'cashier' });
    const role = await createRole(owner, ['ORDER_VIEW']);
    const user = await getUser(owner, u.id);
    await json(await owner.put(EP.userRoles(u.id), { body: { roleIds: [role.id], version: user.version } }));
    const entries = await auditFor(owner, u.id, { action: 'ROLES_ASSIGNED' });
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0].before)).toContain('Cashier');
    expect(JSON.stringify(entries[0].after)).toContain(role.name);
  });

  test('P1-RBAC-02-T08 duplicate role name (case-insensitive) gets 409 ROLE_NAME_TAKEN', async ({ owner }) => {
    const r = await createRole(owner, ['ORDER_VIEW']);
    await expectProblem(await owner.post(EP.roles, { body: { name: r.name.toUpperCase(), permissionCodes: [] } }), 409, 'ROLE_NAME_TAKEN');
    await expectProblem(await owner.post(EP.roles, { body: { name: 'cashier', permissionCodes: [] } }), 409, 'ROLE_NAME_TAKEN');
  });

  test('P1-RBAC-02-T09 an unknown permission code is rejected with 422 on the permissionCodes field', async ({ owner }) => {
    const p = await expectProblem(await owner.post(EP.roles, { body: { name: uniqueName('QA Role'), permissionCodes: ['ORDER_TELEPORT'] } }), 422, 'VALIDATION_FAILED');
    expect((p.fieldErrors ?? []).map((f) => f.field).join()).toContain('permissionCodes');
  });

  test('P1-RBAC-02-T09b a role name is required (1..50 characters)', async ({ owner }) => {
    await expectProblem(await owner.post(EP.roles, { body: { name: '', permissionCodes: [] } }), 422);
    await expectProblem(await owner.post(EP.roles, { body: { name: 'x'.repeat(51), permissionCodes: [] } }), 422);
  });

  test('P1-RBAC-02-T10 deleting a custom role still assigned to a user gets 409 ROLE_IN_USE', async ({ owner }) => {
    const role = await createRole(owner, ['ORDER_VIEW']);
    const u = await createUser(owner, { roleIds: [role.id] });
    await expectProblem(await owner.delete(EP.role(role.id)), 409, 'ROLE_IN_USE');
    const user = await getUser(owner, u.id);
    const cashier = await roleIdByKey(owner, 'cashier');
    await json(await owner.put(EP.userRoles(u.id), { body: { roleIds: [cashier], version: user.version } }));
    await json(await owner.delete(EP.role(role.id)), 204);
  });

  test('P1-RBAC-02-T12 a stale version on updateRole, updateUser and assignUserRoles gets 409 VERSION_CONFLICT', async ({ owner }) => {
    const role = await createRole(owner, ['ORDER_VIEW']);
    await json(await owner.put(EP.role(role.id), { body: { name: role.name, permissionCodes: ['ORDER_VIEW', 'FLOOR_MANAGE'], version: role.version } }));
    await expectProblem(await owner.put(EP.role(role.id), { body: { name: role.name, permissionCodes: ['ORDER_VIEW'], version: role.version } }), 409, 'VERSION_CONFLICT');
    const u = await createUser(owner, { role: 'cashier' });
    const user = await getUser(owner, u.id);
    await json(await owner.put(EP.user(u.id), { body: { fullName: 'Changed once', version: user.version } }));
    await expectProblem(await owner.put(EP.user(u.id), { body: { fullName: 'Changed twice', version: user.version } }), 409, 'VERSION_CONFLICT');
    await expectProblem(await owner.put(EP.userRoles(u.id), { body: { roleIds: u.roleIds, version: user.version } }), 409, 'VERSION_CONFLICT');
  });

  test('P1-RBAC-02-T14 owner creates a user (username, password, PIN, role); a duplicate username gets 409 USERNAME_TAKEN', async ({ owner }) => {
    const u = await createUser(owner, { role: 'receptionist', pin: '2468' });
    const got = await getUser(owner, u.id);
    expect(got).toMatchObject({ username: u.username, active: true, locked: false, pinSet: true });
    expect(got.roles.map((r) => r.key)).toEqual(['RECEPTIONIST']);
    await expectProblem(await owner.post(EP.users, { body: { username: u.username, fullName: 'dup', password: u.password, roleIds: u.roleIds } }), 409, 'USERNAME_TAKEN');
    await expectProblem(await owner.post(EP.users, { body: { username: u.username.toUpperCase(), fullName: 'dup', password: u.password, roleIds: u.roleIds } }), 422);
  });

  test('P1-RBAC-02-T14b createUser validates: no role, unknown role id, short password', async ({ owner }) => {
    const base = { username: uniqueName('qa'), fullName: 'x', password: 'Valid#Pass-2026' };
    await expectProblem(await owner.post(EP.users, { body: { ...base, roleIds: [] } }), 422);
    await expectProblem(await owner.post(EP.users, { body: { ...base, roleIds: ['00000000-0000-4000-8000-0000000000aa'] } }), 422);
    await expectProblem(await owner.post(EP.users, { body: { ...base, password: 'short', roleIds: [await roleIdByKey(owner, 'cashier')] } }), 422);
  });

  test('P1-RBAC-02-T15 the owner cannot deactivate their own account (409 CANNOT_DEACTIVATE_SELF)', async ({ owner }) => {
    const me = owner.session!.user.id;
    await expectProblem(await owner.post(EP.deactivateUser(me)), 409, 'CANNOT_DEACTIVATE_SELF');
  });

  test('P1-RBAC-02-T16 a deactivated user cannot log in and keeps their history; activateUser restores login', async ({ owner, api, terminal }) => {
    const u = await createUser(owner, { role: 'cashier' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    await dev.loginAs(u.username, u.password);
    await json(await owner.post(EP.deactivateUser(u.id)));
    expect((await getUser(owner, u.id)).active).toBe(false);
    expect((await dev.login(u.username, u.password)).status()).toBe(401);
    const inactive = await json<Schemas['UserPage']>(await owner.get(EP.users, { query: { active: false, search: u.username } }));
    expect(inactive.items.map((x) => x.username)).toContain(u.username);
    await json(await owner.post(EP.activateUser(u.id)));
    expect((await dev.login(u.username, u.password)).status()).toBe(200);
    expect((await auditFor(owner, u.id, { action: 'LOGIN' })).length).toBeGreaterThanOrEqual(2);
  });

  test('P1-RBAC-02-T17 usernames must match ^[a-z0-9._-]{3,32}$ and cannot be changed afterwards', async ({ owner }) => {
    const roleIds = [await roleIdByKey(owner, 'cashier')];
    for (const bad of ['ab', 'UPPERCASE', 'has space', 'x'.repeat(33), 'sl/ash']) {
      await expectProblem(await owner.post(EP.users, { body: { username: bad, fullName: 'x', password: 'Valid#Pass-2026', roleIds } }), 422);
    }
    const u = await createUser(owner, { role: 'cashier' });
    const user = await getUser(owner, u.id);
    await json(await owner.put(EP.user(u.id), { body: { fullName: 'New name', username: 'renamed-user', version: user.version } }));
    expect((await getUser(owner, u.id)).username).toBe(u.username);
  });

  test('P1-RBAC-02-T18 listUsers: search, role filter, active filter, paging and sorting', async ({ owner }) => {
    const tag = uniqueName('qa-list');
    const a = await createUser(owner, { username: `${tag}-a`, role: 'cashier', fullName: 'Zed QA' });
    const b = await createUser(owner, { username: `${tag}-b`, role: 'manager', fullName: 'Amy QA' });
    const search = await json<Schemas['UserPage']>(await owner.get(EP.users, { query: { search: tag, sort: 'fullName,asc' } }));
    expect(search.totalItems).toBe(2);
    expect(search.items.map((x) => x.username)).toEqual([b.username, a.username]);
    const cashierId = await roleIdByKey(owner, 'cashier');
    const byRole = await json<Schemas['UserPage']>(await owner.get(EP.users, { query: { search: tag, roleId: cashierId } }));
    expect(byRole.items.map((x) => x.username)).toEqual([a.username]);
    const paged = await json<Schemas['UserPage']>(await owner.get(EP.users, { query: { search: tag, size: 1, page: 1, sort: 'username,asc' } }));
    expect(paged).toMatchObject({ page: 1, size: 1, totalItems: 2 });
    expect(paged.items).toHaveLength(1);
    await expectProblem(await owner.get(EP.users, { query: { size: 201 } }), 422);
  });
});

test.describe('P1-RBAC-02 role editor screen', () => {
  test('P1-RBAC-02-T13 roles editor groups permissions by module, creates a role and persists it after reload', async ({ uiAs }) => {
    const page = await uiAs('owner');
    const roles = new AdminRolesPage(page);
    const name = uniqueName('QA Floor');
    await roles.goto();
    await expect(roles.list).toBeVisible();
    await roles.createButton.click();
    await expect(page.getByTestId('perm-group-ADMIN')).toBeVisible();
    await expect(page.getByTestId('perm-group-BILLING')).toBeVisible();
    await roles.nameInput.fill(name);
    await roles.permission('FLOOR_MANAGE').check();
    await roles.permission('ORDER_VIEW').check();
    await expect(page.getByTestId('role-perm-count')).toContainText('2 of 37');
    await roles.saveButton.click();
    await expect(roles.row(name)).toBeVisible();
    await page.reload();
    await roles.row(name).click();
    await expect(roles.permission('FLOOR_MANAGE')).toBeChecked();
    await expect(roles.permission('ORDER_VIEW')).toBeChecked();
    await expect(roles.permission('BILL_PAY')).not.toBeChecked();
  });

  test('P1-RBAC-02-T13b the Owner role is read-only in the editor; system roles have a fixed name', async ({ uiAs }) => {
    const page = await uiAs('owner');
    const roles = new AdminRolesPage(page);
    await roles.goto();
    await roles.row('Owner').click();
    await expect(page.getByTestId('role-owner-readonly')).toBeVisible();
    await expect(roles.saveButton).toHaveCount(0);
    await roles.row('Cashier').click();
    await expect(page.getByTestId('role-system-note')).toBeVisible();
    await expect(roles.nameInput).toBeDisabled();
    await expect(roles.deleteButton).toHaveCount(0);
  });

  test('P1-RBAC-02-T14c owner creates a user on the users screen; the new user can log in', async ({ uiAs, api, terminal }) => {
    const page = await uiAs('owner');
    const username = uniqueName('qa-ui');
    await page.goto('/admin/users');
    await page.getByTestId('user-create').click();
    await page.getByTestId('user-username').fill(username);
    await page.getByTestId('user-fullname').fill('QA UI User');
    await page.getByTestId('user-password').fill('Ui#User-Pass-2026');
    await page.getByTestId('user-pin').fill('2468');
    await page.getByTestId('user-roles').click();
    await page.locator('li[role="option"][aria-label="Cashier"]').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('user-save').click();
    await page.getByTestId('users-search').fill(username);
    await expect(page.getByTestId(`user-row-${username}`)).toBeVisible();
    await expect(page.getByTestId(`user-status-${username}`)).toHaveText('Active');
    expect((await api.withTerminal(terminal('CASHIER_POS')).login(username, 'Ui#User-Pass-2026')).status()).toBe(200);
  });

  test('P1-RBAC-02-T16b owner deactivates and reactivates a user on the users screen', async ({ uiAs, owner, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    const page = await uiAs('owner');
    await page.goto('/admin/users');
    await page.getByTestId('users-search').fill(u.username);
    await page.getByTestId(`user-deactivate-${u.username}`).click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByTestId(`user-status-${u.username}`)).toHaveCount(0); // filtered out of the default "Active" view
    expect((await getUser(owner, u.id)).active).toBe(false);
    await page.getByTestId('users-filter-active').selectOption('false');
    await expect(page.getByTestId(`user-status-${u.username}`)).toHaveText('Deactivated');
    await page.getByTestId(`user-activate-${u.username}`).click();
    await page.getByTestId('confirm-accept').click();
    await expect.poll(async () => (await getUser(owner, u.id)).active).toBe(true);
  });

  test('P1-RBAC-02-T19 owner resets a PIN and a password from the users screen', async ({ uiAs, owner, api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'manager', pin: null });
    const page = await uiAs('owner');
    await page.goto('/admin/users');
    await page.getByTestId('users-search').fill(u.username);
    await expect(page.getByTestId(`user-no-pin-${u.username}`)).toBeVisible();
    await page.getByTestId(`user-reset-pin-${u.username}`).click();
    await page.getByTestId('user-pin').fill('864209');
    await page.getByTestId('user-save').click();
    await expect(page.getByTestId('reset-pin-dialog')).toBeHidden();
    await expect.poll(async () => (await getUser(owner, u.id)).pinSet).toBe(true);
    await page.reload();
    await page.getByTestId('users-search').fill(u.username);
    await expect(page.getByTestId(`user-row-${u.username}`)).toBeVisible();
    await expect(page.getByTestId(`user-no-pin-${u.username}`)).toHaveCount(0);
    await page.getByTestId(`user-reset-password-${u.username}`).click();
    await page.getByTestId('user-password').fill('Brand#New-Pass-2026');
    await page.getByTestId('user-save').click();
    await expect(page.getByTestId('reset-password-dialog')).toBeHidden();
    await expect
      .poll(async () => (await api.withTerminal(terminal('CASHIER_POS')).login(u.username, 'Brand#New-Pass-2026')).status())
      .toBe(200);
  });

  test('P1-RBAC-02-T19b the users list drops the "No PIN" badge right after a PIN reset (no reload needed)', async ({ uiAs, makeUser }) => {
    const u = await makeUser({ role: 'manager', pin: null });
    const page = await uiAs('owner');
    await page.goto('/admin/users');
    await page.getByTestId('users-search').fill(u.username);
    await expect(page.getByTestId(`user-no-pin-${u.username}`)).toBeVisible();
    await page.getByTestId(`user-reset-pin-${u.username}`).click();
    await page.getByTestId('user-pin').fill('864209');
    await page.getByTestId('user-save').click();
    await expect(page.getByTestId(`user-no-pin-${u.username}`)).toHaveCount(0);
  });

  test('P1-RBAC-02-T20 a user whose role lacks ROLE_MANAGE is refused the role endpoints by the server', async ({ owner, api, terminal }) => {
    const role = await createRole(owner, ['ORDER_VIEW']);
    const u = await createUser(owner, { roleIds: [role.id] });
    const { client } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    await expectProblem(await client.post(EP.roles, { body: { name: uniqueName('QA no'), permissionCodes: [] } }), 403, 'FORBIDDEN');
  });
});

test.describe('P1-RBAC-03 error shape', { tag: '@api' }, () => {
  test('P1-RBAC-03-T06 a 403 is RFC 7807 problem+json with a plain-English detail and no stack trace', async ({ apiAs }) => {
    const c = await apiAs('cashier');
    const res = await c.get(EP.users);
    expect(res.status()).toBe(403);
    expect(res.headers()['content-type']).toContain('application/problem+json');
    const p = (await res.json()) as Schemas['Problem'];
    expect(p).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(p.title.length).toBeGreaterThan(3);
    expect((p.detail ?? '').length).toBeGreaterThan(10);
    expect(JSON.stringify(p)).not.toMatch(/Exception|at com\.|stackTrace|org\.springframework|java\./);
    expect(res.headers()['x-trace-id']).toBeTruthy();
    expect(p.traceId).toBe(res.headers()['x-trace-id']);
  });
});

test.describe('P1-RBAC-04 kitchen station scope', { tag: '@api' }, () => {
  test.fixme('P1-RBAC-04-T02 Kitchen 1 user cannot list Kitchen 2 KOTs (403/404): M1.3', async () => {});
  test.fixme('P1-RBAC-04-T04 Kitchen 1 cannot subscribe to the Kitchen 2 WebSocket topic: M1.3', async () => {});
  test.fixme('P1-RBAC-04-T05 Kitchen 1 cannot change the status of a Kitchen 2 KOT: M1.3', async () => {});
});

test.describe('P1-RBAC-04 kitchen screen', { tag: '@kds' }, () => {
  test.fixme('P1-RBAC-04-T03 Kitchen 1 screen cannot open station 2 by URL: M1.3', async () => {});
});
