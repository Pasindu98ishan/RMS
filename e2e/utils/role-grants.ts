/**
 * Default role → permission grants, encoded from docs/security/roles-permissions.md
 * (source: Annex A §2). This file is the QA oracle for the permission matrix
 * (P1-RBAC-01, P1-RBAC-03): when the doc changes, change this file in the same PR.
 *
 * Cell tokens mirror the doc's legend so a row can be checked against the table by eye:
 *   'Y'            ✅ granted
 *   'Y+PIN'        ✅ 🔑 granted and can approve with PIN
 *   'Y:own'        ✅ own   (only own records / own shift / own station)
 *   'Y:read'       ✅ (read) (GET only)
 *   'Y:dine-in'    ✅ dine-in (receptionist ORDER_CREATE)
 *   suffix '*'     footnote ¹: granted by default, owner can remove ("if enabled", Annex A §2)
 *   'grant-only'   not granted by default, owner may grant it (HR_SALARY_VIEW for manager)
 *   '-'            not granted
 */

export const SEEDED_ROLES = [
  'owner',
  'manager',
  'cashier',
  'receptionist',
  'kitchen',
  'rider',
  'inventory',
  'hr',
] as const;

export type RoleKey = (typeof SEEDED_ROLES)[number];

/** Display names of the seeded roles, as P1-RBAC-01 lists them. */
export const ROLE_DISPLAY_NAMES: Record<RoleKey, string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  receptionist: 'Receptionist',
  kitchen: 'Kitchen',
  rider: 'Rider',
  inventory: 'Inventory',
  hr: 'HR',
};

export type GrantScope = 'all' | 'own' | 'read' | 'dine-in';

export interface Grant {
  granted: boolean;
  /** Restriction on a granted permission. 'all' when unrestricted. */
  scope: GrantScope;
  /** 🔑 — this role's PIN can approve an action that needs this permission. */
  canApprove: boolean;
  /** Footnote ¹ — default grant the owner can remove. */
  defaultOnly: boolean;
  /** Not granted by default but the owner may grant it. */
  grantable: boolean;
  /** The raw cell token, for error messages. */
  token: string;
}

export type CellToken = string;

/** Column order of the Phase 1 table in roles-permissions.md. */
const PHASE1_COLUMNS: readonly RoleKey[] = SEEDED_ROLES;

/**
 * Column order of the "Later phases" table in roles-permissions.md:
 * Owner | Manager | Inventory | HR | Cashier | Reception | Rider (Kitchen has no column = not granted).
 */
const LATER_COLUMNS: readonly RoleKey[] = [
  'owner',
  'manager',
  'inventory',
  'hr',
  'cashier',
  'receptionist',
  'rider',
];

const TOKEN_RE = /^(?:(-)|(grant-only)|Y(\+PIN)?(?::(own|read|dine-in))?(\*)?)$/;

export function parseCell(token: CellToken): Grant {
  const m = TOKEN_RE.exec(token.trim());
  if (!m) {
    throw new Error(`role-grants: unrecognised cell token "${token}"`);
  }
  const [, none, grantOnly, pin, scope, footnote] = m;
  if (none || grantOnly) {
    return {
      granted: false,
      scope: 'all',
      canApprove: false,
      defaultOnly: false,
      grantable: Boolean(grantOnly),
      token,
    };
  }
  return {
    granted: true,
    scope: (scope as GrantScope | undefined) ?? 'all',
    canApprove: Boolean(pin),
    defaultOnly: Boolean(footnote),
    grantable: true,
    token,
  };
}

function row(columns: readonly RoleKey[], cells: CellToken[]): Record<RoleKey, Grant> {
  if (cells.length !== columns.length) {
    throw new Error(`role-grants: row has ${cells.length} cells, expected ${columns.length}`);
  }
  const out = {} as Record<RoleKey, Grant>;
  for (const role of SEEDED_ROLES) {
    const idx = columns.indexOf(role);
    out[role] = parseCell(idx === -1 ? '-' : cells[idx]);
  }
  return out;
}

const p1 = (...cells: CellToken[]) => row(PHASE1_COLUMNS, cells);
const later = (...cells: CellToken[]) => row(LATER_COLUMNS, cells);

export interface PermissionDef {
  code: string;
  group: string;
  /** 1 = Phase 1 table; 'later' = "Later phases (granted when built)" table. */
  phase: 1 | 'later';
  /** true when code ends with '*' and matches any code with that prefix (e.g. INVENTORY_*). */
  wildcard: boolean;
  grants: Record<RoleKey, Grant>;
}

type RawTable = Array<[code: string, group: string, grants: Record<RoleKey, Grant>]>;

//                                         Owner    Manager  Cashier   Reception       Kitchen  Rider Inventory HR
const PHASE1_TABLE: RawTable = [
  ['USER_MANAGE',                  'Admin',     p1('Y',     '-',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['ROLE_MANAGE',                  'Admin',     p1('Y',     '-',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['TERMINAL_MANAGE',              'Admin',     p1('Y',     '-',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['LOGIN_ANY_DEVICE',             'Admin',     p1('Y',     'Y',     '-',      '-',            '-',     'Y',  'Y',  'Y')],
  ['SETTINGS_MANAGE',              'Admin',     p1('Y',     '-',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['AUDIT_VIEW',                   'Admin',     p1('Y',     '-',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['MENU_MANAGE',                  'Admin',     p1('Y',     '-',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['MENU_AVAILABILITY',            'Admin',     p1('Y',     'Y',     'Y',      '-',            '-',     '-',  '-',  '-')],
  ['FLOOR_MANAGE',                 'Admin',     p1('Y',     'Y',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['DATA_IMPORT',                  'Admin',     p1('Y',     '-',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['ORDER_CREATE',                 'Orders',    p1('Y',     'Y',     'Y',      'Y:dine-in*',   '-',     '-',  '-',  '-')],
  ['ORDER_VIEW',                   'Orders',    p1('Y',     'Y',     'Y',      'Y',            '-',     '-',  '-',  '-')],
  ['ORDER_CUSTOM_ITEM',            'Orders',    p1('Y',     'Y',     'Y',      'Y',            '-',     '-',  '-',  '-')],
  ['ORDER_TABLE_OPS',              'Orders',    p1('Y',     'Y',     'Y',      'Y',            '-',     '-',  '-',  '-')],
  ['ORDER_PRICE_LIST_CHANGE_SENT', 'Orders',    p1('Y+PIN', 'Y+PIN', '-',      '-',            '-',     '-',  '-',  '-')],
  ['DELIVERY_MANAGE',              'Orders',    p1('Y',     'Y',     'Y',      '-',            '-',     '-',  '-',  '-')],
  ['CUSTOMER_MANAGE',              'Orders',    p1('Y',     'Y',     'Y',      'Y',            '-',     '-',  '-',  '-')],
  ['RIDER_LIST_MANAGE',            'Orders',    p1('Y',     'Y',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['BILL_PAY',                     'Billing',   p1('Y',     'Y',     'Y',      'Y*',           '-',     '-',  '-',  '-')],
  ['BILL_REPRINT',                 'Billing',   p1('Y',     'Y',     'Y',      'Y*',           '-',     '-',  '-',  '-')],
  ['LINE_CANCEL_BEFORE_KOT',       'Billing',   p1('Y',     'Y',     'Y',      'Y',            '-',     '-',  '-',  '-')],
  ['LINE_CANCEL_AFTER_KOT',        'Billing',   p1('Y+PIN', 'Y+PIN', '-',      '-',            '-',     '-',  '-',  '-')],
  ['REFUND',                       'Billing',   p1('Y+PIN', 'Y+PIN', '-',      '-',            '-',     '-',  '-',  '-')],
  ['BILL_VOID',                    'Billing',   p1('Y+PIN', 'Y+PIN', '-',      '-',            '-',     '-',  '-',  '-')],
  ['DISCOUNT_STAFF',               'Discounts', p1('Y',     'Y',     'Y',      'Y*',           '-',     '-',  '-',  '-')],
  ['DISCOUNT_GOVERNMENT',          'Discounts', p1('Y',     'Y',     'Y',      'Y*',           '-',     '-',  '-',  '-')],
  ['DISCOUNT_OTHER_WITHIN_LIMIT',  'Discounts', p1('Y',     'Y',     'Y',      'Y*',           '-',     '-',  '-',  '-')],
  ['DISCOUNT_OTHER_ABOVE_LIMIT',   'Discounts', p1('Y+PIN', 'Y+PIN', '-',      '-',            '-',     '-',  '-',  '-')],
  ['DISCOUNT_OWNER',               'Discounts', p1('Y+PIN', '-',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['DISCOUNT_LIMIT_OVERRIDE',      'Discounts', p1('Y+PIN', 'Y+PIN', '-',      '-',            '-',     '-',  '-',  '-')],
  ['KDS_OPERATE',                  'Kitchen',   p1('Y',     'Y',     '-',      '-',            'Y:own', '-',  '-',  '-')],
  ['KDS_VIEW_ALL',                 'Kitchen',   p1('Y',     'Y',     'Y:read', '-',            '-',     '-',  '-',  '-')],
  ['SHIFT_OPERATE',                'Shifts',    p1('Y',     'Y',     'Y:own',  'Y:own*',       '-',     '-',  '-',  '-')],
  ['SHIFT_APPROVE',                'Shifts',    p1('Y',     'Y',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['DAY_END',                      'Shifts',    p1('Y',     'Y',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['REPORT_OWN_SHIFT',             'Reports',   p1('Y',     'Y',     'Y',      'Y',            '-',     '-',  '-',  '-')],
  ['REPORT_POS_ALL',               'Reports',   p1('Y',     'Y',     '-',      '-',            '-',     '-',  '-',  '-')],
  ['REPORT_EXPORT',                'Reports',   p1('Y',     'Y',     '-',      '-',            '-',     '-',  '-',  '-')],
];

//                                                 Owner    Manager       Inventory HR   Cashier  Reception Rider
const LATER_TABLE: RawTable = [
  ['INVENTORY_*',           'Inventory', later('Y',     '-',          'Y',  '-',  '-',     '-',  '-')],
  ['REPORT_INVENTORY',      'Inventory', later('Y',     'Y',          'Y',  '-',  '-',     '-',  '-')],
  ['REPORT_PROFIT',         'Reports',   later('Y',     '-',          '-',  '-',  '-',     '-',  '-')],
  ['DASHBOARD_OWNER',       'Reports',   later('Y',     '-',          '-',  '-',  '-',     '-',  '-')],
  ['RIDER_APP',             'Riders',    later('-',     '-',          '-',  '-',  '-',     '-',  'Y:own')],
  ['RIDER_REASSIGN',        'Riders',    later('Y',     'Y',          '-',  '-',  'Y',     '-',  '-')],
  ['RIDER_APPROVE',         'Riders',    later('Y',     'Y',          '-',  '-',  '-',     '-',  '-')],
  ['CREDIT_LIMIT_OVERRIDE', 'Credit',    later('Y+PIN', 'Y+PIN',      '-',  '-',  '-',     '-',  '-')],
  ['CREDIT_SETTLE',         'Credit',    later('Y',     'Y',          '-',  '-',  'Y',     'Y',  '-')],
  ['BOOKING_MANAGE',        'Booking',   later('Y',     'Y',          '-',  '-',  'Y',     'Y',  '-')],
  ['HR_EMPLOYEES',          'HR',        later('Y',     '-',          '-',  'Y',  '-',     '-',  '-')],
  ['HR_ATTENDANCE',         'HR',        later('Y',     '-',          '-',  'Y',  '-',     '-',  '-')],
  ['HR_OT_APPROVE',         'HR',        later('Y',     '-',          '-',  'Y',  '-',     '-',  '-')],
  ['HR_SALARY_VIEW',        'HR',        later('Y',     'grant-only', '-',  'Y',  '-',     '-',  '-')],
  ['HR_PAYROLL_RUN',        'HR',        later('Y',     'grant-only', '-',  'Y',  '-',     '-',  '-')],
];

function build(table: RawTable, phase: 1 | 'later'): PermissionDef[] {
  return table.map(([code, group, grants]) => ({
    code,
    group,
    phase,
    wildcard: code.endsWith('*'),
    grants,
  }));
}

export const PERMISSIONS: readonly PermissionDef[] = [
  ...build(PHASE1_TABLE, 1),
  ...build(LATER_TABLE, 'later'),
];

/** Exact-code lookup first, then wildcard prefix (INVENTORY_GRN_CREATE → INVENTORY_*). */
export function findPermission(
  code: string,
  permissions: readonly PermissionDef[] = PERMISSIONS,
): PermissionDef | undefined {
  const exact = permissions.find((p) => !p.wildcard && p.code === code);
  if (exact) return exact;
  return permissions.find((p) => p.wildcard && code.startsWith(p.code.slice(0, -1)));
}

export function grantFor(
  role: RoleKey,
  code: string,
  permissions: readonly PermissionDef[] = PERMISSIONS,
): Grant | undefined {
  return findPermission(code, permissions)?.grants[role];
}

/** Default permission codes of a seeded role (exact codes only; wildcards are listed as-is). */
export function defaultPermissionsOf(
  role: RoleKey,
  opts: { phase?: 1 | 'later' | 'all' } = {},
  permissions: readonly PermissionDef[] = PERMISSIONS,
): string[] {
  const phase = opts.phase ?? 1;
  return permissions
    .filter((p) => phase === 'all' || p.phase === phase)
    .filter((p) => p.grants[role].granted)
    .map((p) => p.code);
}

/** Roles that may start a personal session (no terminal) by default: holders of LOGIN_ANY_DEVICE (ADR-008). */
export const PERSONAL_LOGIN_ROLES: readonly RoleKey[] = SEEDED_ROLES.filter((r) => grantFor(r, 'LOGIN_ANY_DEVICE')?.granted === true);
