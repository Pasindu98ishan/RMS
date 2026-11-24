import { expect, test } from '@playwright/test';
import {
  PERMISSIONS,
  PERSONAL_LOGIN_ROLES,
  SEEDED_ROLES,
  defaultPermissionsOf,
  findPermission,
  grantFor,
  parseCell,
} from '../role-grants';

test.describe('role-grants: cell parser', () => {
  test('parses every legend token', () => {
    expect(parseCell('Y')).toMatchObject({ granted: true, scope: 'all', canApprove: false, defaultOnly: false });
    expect(parseCell('Y+PIN')).toMatchObject({ granted: true, canApprove: true });
    expect(parseCell('Y:own')).toMatchObject({ granted: true, scope: 'own' });
    expect(parseCell('Y:read')).toMatchObject({ granted: true, scope: 'read' });
    expect(parseCell('Y:dine-in*')).toMatchObject({ granted: true, scope: 'dine-in', defaultOnly: true });
    expect(parseCell('Y*')).toMatchObject({ granted: true, defaultOnly: true });
    expect(parseCell('-')).toMatchObject({ granted: false, grantable: false });
    expect(parseCell('grant-only')).toMatchObject({ granted: false, grantable: true });
  });

  test('rejects unknown tokens', () => {
    expect(() => parseCell('yes')).toThrow(/unrecognised/);
    expect(() => parseCell('Y:everything')).toThrow(/unrecognised/);
  });
});

test.describe('role-grants: table encodes roles-permissions.md', () => {
  test('8 seeded roles (P1-RBAC-01)', () => {
    expect([...SEEDED_ROLES]).toEqual(['owner', 'manager', 'cashier', 'receptionist', 'kitchen', 'rider', 'inventory', 'hr']);
  });

  test('every permission has a grant for every role; codes are unique', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const p of PERMISSIONS) {
      for (const r of SEEDED_ROLES) expect(p.grants[r], `${p.code}/${r}`).toBeDefined();
    }
  });

  test('Phase 1 table has the 38 permission codes of the doc (37 + LOGIN_ANY_DEVICE, ADR-008)', () => {
    expect(PERMISSIONS.filter((p) => p.phase === 1)).toHaveLength(38);
  });

  test('owner holds every Phase 1 permission', () => {
    for (const p of PERMISSIONS.filter((x) => x.phase === 1)) {
      expect(p.grants.owner.granted, p.code).toBe(true);
    }
  });

  test('rider, inventory and HR hold only LOGIN_ANY_DEVICE in Phase 1 (ADR-008)', () => {
    for (const r of ['rider', 'inventory', 'hr'] as const) {
      expect(defaultPermissionsOf(r), r).toEqual(['LOGIN_ANY_DEVICE']);
    }
  });

  test('LOGIN_ANY_DEVICE: owner, manager, rider, inventory, HR; not cashier, reception, kitchen (ADR-008)', () => {
    expect([...PERSONAL_LOGIN_ROLES]).toEqual(['owner', 'manager', 'rider', 'inventory', 'hr']);
  });

  test('kitchen holds only KDS_OPERATE (own station) in Phase 1', () => {
    expect(defaultPermissionsOf('kitchen')).toEqual(['KDS_OPERATE']);
    expect(grantFor('kitchen', 'KDS_OPERATE')).toMatchObject({ scope: 'own' });
  });

  test('spot checks against the doc', () => {
    expect(grantFor('manager', 'USER_MANAGE')?.granted).toBe(false);
    expect(grantFor('manager', 'BILL_VOID')).toMatchObject({ granted: true, canApprove: true });
    expect(grantFor('manager', 'DISCOUNT_OWNER')?.granted).toBe(false);
    expect(grantFor('owner', 'DISCOUNT_OWNER')).toMatchObject({ granted: true, canApprove: true });
    expect(grantFor('cashier', 'KDS_VIEW_ALL')).toMatchObject({ granted: true, scope: 'read' });
    expect(grantFor('cashier', 'SHIFT_OPERATE')).toMatchObject({ granted: true, scope: 'own' });
    expect(grantFor('cashier', 'REFUND')?.granted).toBe(false);
    expect(grantFor('receptionist', 'ORDER_CREATE')).toMatchObject({ granted: true, scope: 'dine-in', defaultOnly: true });
    expect(grantFor('receptionist', 'BILL_PAY')).toMatchObject({ granted: true, defaultOnly: true });
    expect(grantFor('receptionist', 'DELIVERY_MANAGE')?.granted).toBe(false);
  });

  test('later-phase table maps its own column order (Owner, Manager, Inventory, HR, Cashier, Reception, Rider)', () => {
    expect(grantFor('inventory', 'INVENTORY_GRN_CREATE')?.granted).toBe(true);
    expect(grantFor('manager', 'INVENTORY_GRN_CREATE')?.granted).toBe(false);
    expect(grantFor('kitchen', 'INVENTORY_GRN_CREATE')?.granted).toBe(false);
    expect(grantFor('rider', 'RIDER_APP')).toMatchObject({ granted: true, scope: 'own' });
    expect(grantFor('cashier', 'RIDER_REASSIGN')?.granted).toBe(true);
    expect(grantFor('cashier', 'RIDER_APPROVE')?.granted).toBe(false);
    expect(grantFor('receptionist', 'BOOKING_MANAGE')?.granted).toBe(true);
    expect(grantFor('hr', 'HR_SALARY_VIEW')?.granted).toBe(true);
    expect(grantFor('manager', 'HR_SALARY_VIEW')).toMatchObject({ granted: false, grantable: true });
  });

  test('exact codes win over wildcards; unknown codes are undefined', () => {
    expect(findPermission('REPORT_INVENTORY')?.code).toBe('REPORT_INVENTORY');
    expect(findPermission('INVENTORY_COUNT')?.code).toBe('INVENTORY_*');
    expect(findPermission('ORDER_TELEPORT')).toBeUndefined();
  });
});
