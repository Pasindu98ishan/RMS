/**
 * Seed data for the in-browser mocks (VITE_USE_MOCKS=true). Test values only, never used against a
 * real backend. Every seeded user logs in with MOCK_PASSWORD; seeded terminals use the device token
 * `mock-device-token-<n>` so the mock tools on /setup/terminal can adopt them.
 */
import type {
  AuditAction,
  AuditEntry,
  BusinessDaySettings,
  IdleTimeoutSettings,
  Permission,
  PermissionCode,
  RestaurantDetails,
  Role,
  RoleKey,
  ServiceChargeSettings,
  TaxSettings,
  Terminal,
  TerminalType,
  User,
} from '@/api/types'

export const MOCK_PASSWORD = 'rms-dev-pass'

/** Deterministic UUID v4-shaped ids so reloads and links stay stable. */
export function seedId(kind: number, n: number): string {
  const hex = (v: number, len: number) => v.toString(16).padStart(len, '0')
  return `${hex(kind, 8)}-0000-4000-8000-${hex(n, 12)}`
}

const SEED_TIME = '2026-11-01T02:30:00Z'

export const PERMISSIONS: Permission[] = [
  {
    code: 'USER_MANAGE',
    module: 'ADMIN',
    description: 'Manage user accounts, locks, password and PIN resets',
  },
  { code: 'ROLE_MANAGE', module: 'ADMIN', description: 'Create and edit roles and their permissions' },
  { code: 'TERMINAL_MANAGE', module: 'ADMIN', description: 'Register and manage terminals (devices)' },
  { code: 'SETTINGS_MANAGE', module: 'ADMIN', description: 'Change restaurant settings' },
  { code: 'AUDIT_VIEW', module: 'ADMIN', description: 'Search and export the audit log' },
  { code: 'MENU_MANAGE', module: 'ADMIN', description: 'Manage menu items, prices, modifiers and stations' },
  { code: 'MENU_AVAILABILITY', module: 'ADMIN', description: 'Mark menu items sold out / available' },
  { code: 'FLOOR_MANAGE', module: 'ADMIN', description: 'Edit tables and the floor plan' },
  { code: 'DATA_IMPORT', module: 'ADMIN', description: 'Import menu and tables from a spreadsheet' },
  {
    code: 'LOGIN_ANY_DEVICE',
    module: 'ADMIN',
    description: 'Sign in on any device (phone, home computer) without a registered terminal',
  },
  { code: 'ORDER_CREATE', module: 'ORDERS', description: 'Create orders of all types' },
  { code: 'ORDER_VIEW', module: 'ORDERS', description: 'View orders' },
  { code: 'ORDER_CUSTOM_ITEM', module: 'ORDERS', description: 'Add custom items not on the menu' },
  { code: 'ORDER_TABLE_OPS', module: 'ORDERS', description: 'Move, merge and split table orders' },
  {
    code: 'ORDER_PRICE_LIST_CHANGE_SENT',
    module: 'ORDERS',
    description: 'Change the price list of lines already sent to the kitchen',
  },
  { code: 'DELIVERY_MANAGE', module: 'ORDERS', description: 'Assign riders and settle delivery orders' },
  { code: 'CUSTOMER_MANAGE', module: 'ORDERS', description: 'Create and edit customers' },
  { code: 'RIDER_LIST_MANAGE', module: 'ORDERS', description: 'Manage the rider list' },
  { code: 'BILL_PAY', module: 'BILLING', description: 'Take payments' },
  { code: 'BILL_REPRINT', module: 'BILLING', description: 'Reprint bills and receipts' },
  {
    code: 'LINE_CANCEL_BEFORE_KOT',
    module: 'BILLING',
    description: 'Cancel lines before they reach the kitchen',
  },
  {
    code: 'LINE_CANCEL_AFTER_KOT',
    module: 'BILLING',
    description: 'Cancel lines after they reach the kitchen',
  },
  { code: 'REFUND', module: 'BILLING', description: 'Refund paid bills' },
  { code: 'BILL_VOID', module: 'BILLING', description: 'Void whole bills' },
  { code: 'DISCOUNT_STAFF', module: 'DISCOUNTS', description: 'Apply the staff discount' },
  { code: 'DISCOUNT_GOVERNMENT', module: 'DISCOUNTS', description: 'Apply the government discount' },
  {
    code: 'DISCOUNT_OTHER_WITHIN_LIMIT',
    module: 'DISCOUNTS',
    description: 'Apply other discounts within the cashier limit',
  },
  {
    code: 'DISCOUNT_OTHER_ABOVE_LIMIT',
    module: 'DISCOUNTS',
    description: 'Apply other discounts above the cashier limit',
  },
  { code: 'DISCOUNT_OWNER', module: 'DISCOUNTS', description: 'Apply an owner discount (0-100 %)' },
  {
    code: 'DISCOUNT_LIMIT_OVERRIDE',
    module: 'DISCOUNTS',
    description: 'Override the staff monthly discount limit',
  },
  { code: 'KDS_OPERATE', module: 'KITCHEN', description: 'Operate a kitchen screen' },
  { code: 'KDS_VIEW_ALL', module: 'KITCHEN', description: 'View all kitchen screens' },
  { code: 'SHIFT_OPERATE', module: 'SHIFTS', description: 'Open, run and close a shift' },
  { code: 'SHIFT_APPROVE', module: 'SHIFTS', description: 'Approve closed shifts' },
  { code: 'DAY_END', module: 'SHIFTS', description: 'Close the business day' },
  { code: 'REPORT_OWN_SHIFT', module: 'REPORTS', description: 'Reports for own shift' },
  { code: 'REPORT_POS_ALL', module: 'REPORTS', description: 'All POS reports' },
  { code: 'REPORT_EXPORT', module: 'REPORTS', description: 'Export reports to PDF / Excel' },
]

const ALL: PermissionCode[] = PERMISSIONS.map((p) => p.code)

const MANAGER: PermissionCode[] = [
  'LOGIN_ANY_DEVICE',
  'MENU_AVAILABILITY',
  'FLOOR_MANAGE',
  'ORDER_CREATE',
  'ORDER_VIEW',
  'ORDER_CUSTOM_ITEM',
  'ORDER_TABLE_OPS',
  'ORDER_PRICE_LIST_CHANGE_SENT',
  'DELIVERY_MANAGE',
  'CUSTOMER_MANAGE',
  'RIDER_LIST_MANAGE',
  'BILL_PAY',
  'BILL_REPRINT',
  'LINE_CANCEL_BEFORE_KOT',
  'LINE_CANCEL_AFTER_KOT',
  'REFUND',
  'BILL_VOID',
  'DISCOUNT_STAFF',
  'DISCOUNT_GOVERNMENT',
  'DISCOUNT_OTHER_WITHIN_LIMIT',
  'DISCOUNT_OTHER_ABOVE_LIMIT',
  'DISCOUNT_LIMIT_OVERRIDE',
  'KDS_OPERATE',
  'KDS_VIEW_ALL',
  'SHIFT_OPERATE',
  'SHIFT_APPROVE',
  'DAY_END',
  'REPORT_OWN_SHIFT',
  'REPORT_POS_ALL',
  'REPORT_EXPORT',
]

const CASHIER: PermissionCode[] = [
  'MENU_AVAILABILITY',
  'ORDER_CREATE',
  'ORDER_VIEW',
  'ORDER_CUSTOM_ITEM',
  'ORDER_TABLE_OPS',
  'DELIVERY_MANAGE',
  'CUSTOMER_MANAGE',
  'BILL_PAY',
  'BILL_REPRINT',
  'LINE_CANCEL_BEFORE_KOT',
  'DISCOUNT_STAFF',
  'DISCOUNT_GOVERNMENT',
  'DISCOUNT_OTHER_WITHIN_LIMIT',
  'KDS_VIEW_ALL',
  'SHIFT_OPERATE',
  'REPORT_OWN_SHIFT',
]

const RECEPTION: PermissionCode[] = [
  'ORDER_CREATE',
  'ORDER_VIEW',
  'ORDER_CUSTOM_ITEM',
  'ORDER_TABLE_OPS',
  'CUSTOMER_MANAGE',
  'BILL_PAY',
  'BILL_REPRINT',
  'LINE_CANCEL_BEFORE_KOT',
  'DISCOUNT_STAFF',
  'DISCOUNT_GOVERNMENT',
  'DISCOUNT_OTHER_WITHIN_LIMIT',
  'SHIFT_OPERATE',
  'REPORT_OWN_SHIFT',
]

export const ROLE_IDS = {
  owner: seedId(0x1, 1),
  manager: seedId(0x1, 2),
  cashier: seedId(0x1, 3),
  receptionist: seedId(0x1, 4),
  kitchen: seedId(0x1, 5),
  rider: seedId(0x1, 6),
  inventory: seedId(0x1, 7),
  hr: seedId(0x1, 8),
} as const

function role(key: RoleKey, id: string, name: string, description: string, codes: PermissionCode[]): Role {
  return {
    id,
    key,
    name,
    description,
    system: true,
    permissionCodes: [...codes],
    userCount: 0,
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  }
}

export function seedRoles(): Role[] {
  return [
    role('OWNER', ROLE_IDS.owner, 'Owner', 'Full access to everything', ALL),
    role('MANAGER', ROLE_IDS.manager, 'Manager', 'Runs the floor, approves overrides with PIN', MANAGER),
    role('CASHIER', ROLE_IDS.cashier, 'Cashier', 'Takes orders and payments at the cashier counter', CASHIER),
    role(
      'RECEPTIONIST',
      ROLE_IDS.receptionist,
      'Receptionist',
      'Takes dine-in orders at reception',
      RECEPTION,
    ),
    role('KITCHEN', ROLE_IDS.kitchen, 'Kitchen', 'Operates one kitchen station screen', ['KDS_OPERATE']),
    role('RIDER', ROLE_IDS.rider, 'Rider', 'Delivery rider (rider app in Phase 4)', ['LOGIN_ANY_DEVICE']),
    role('INVENTORY', ROLE_IDS.inventory, 'Inventory', 'Stock and GRN (Phase 2)', ['LOGIN_ANY_DEVICE']),
    role('HR', ROLE_IDS.hr, 'HR', 'Employees, attendance and payroll (Phase 5)', ['LOGIN_ANY_DEVICE']),
  ]
}

export const KITCHEN_STATION_IDS = [seedId(0x5, 1), seedId(0x5, 2), seedId(0x5, 3)] as const

export interface MockTerminal extends Terminal {
  deviceToken: string
}

export function seedTerminals(): MockTerminal[] {
  const t = (
    n: number,
    name: string,
    type: TerminalType,
    extra: Partial<Terminal> = {},
    active = true,
  ): MockTerminal => ({
    id: seedId(0x3, n),
    name,
    type,
    active,
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    lastLoginAt: '2026-11-20T13:05:00Z',
    deviceToken: `mock-device-token-${n}`.padEnd(40, '0'),
    ...extra,
  })
  return [
    t(1, 'Cashier counter', 'CASHIER_POS', { orderingPointId: seedId(0x4, 1) }),
    t(2, 'Reception', 'RECEPTION_POS', { orderingPointId: seedId(0x4, 2) }),
    t(3, 'Kitchen 1 screen', 'KITCHEN', { kitchenStationId: KITCHEN_STATION_IDS[0] }),
    t(4, 'Kitchen 2 screen', 'KITCHEN', { kitchenStationId: KITCHEN_STATION_IDS[1] }),
    t(5, 'Kitchen 3 screen', 'KITCHEN', { kitchenStationId: KITCHEN_STATION_IDS[2] }),
    t(6, 'Owner office', 'ADMIN'),
    t(7, 'Store display', 'DISPLAY'),
    t(8, 'Old cashier PC', 'CASHIER_POS', {}, false),
  ]
}

export interface MockUser extends User {
  password: string
  pin?: string
  failedLogins: number
  failedPins: number
}

export function seedUsers(roles: Role[]): MockUser[] {
  const ref = (id: string) => {
    const r = roles.find((x) => x.id === id)
    if (!r) throw new Error(`seed role ${id} missing`)
    return { id: r.id, name: r.name, system: r.system, ...(r.key ? { key: r.key } : {}) }
  }
  let n = 0
  const u = (
    username: string,
    fullName: string,
    roleIds: string[],
    extra: Partial<MockUser> = {},
  ): MockUser => ({
    id: seedId(0x2, ++n),
    username,
    fullName,
    phone: `+94 77 000 ${String(1000 + n).slice(-4)}`,
    active: true,
    locked: false,
    pinSet: true,
    pinLocked: false,
    roles: roleIds.map(ref),
    lastLoginAt: '2026-11-20T12:00:00Z',
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    password: MOCK_PASSWORD,
    pin: `${1000 + n * 111}`.slice(0, 4),
    failedLogins: 0,
    failedPins: 0,
    ...extra,
  })
  return [
    u('owner1', 'Sunil Jayawardena', [ROLE_IDS.owner]),
    u('manager1', 'Chamari Fernando', [ROLE_IDS.manager]),
    u('cashier1', 'Nimal Perera', [ROLE_IDS.cashier]),
    u('cashier2', 'Kasun Silva', [ROLE_IDS.cashier], {
      locked: true,
      lockedUntil: '2099-01-01T00:00:00Z',
      failedLogins: 5,
    }),
    u('reception1', 'Dilani Wickramasinghe', [ROLE_IDS.receptionist], {
      pinLocked: true,
      pinLockedUntil: '2099-01-01T00:00:00Z',
      failedPins: 3,
    }),
    u('kitchen1', 'Ruwan Bandara', [ROLE_IDS.kitchen], { pinSet: false, pin: undefined }),
    u('kitchen2', 'Pradeep Kumara', [ROLE_IDS.kitchen], { pinSet: false, pin: undefined }),
    u('kitchen3', 'Sanduni Rathnayake', [ROLE_IDS.kitchen], { pinSet: false, pin: undefined }),
    u('rider1', 'Lahiru Madushanka', [ROLE_IDS.rider], { pinSet: false, pin: undefined }),
    u('inventory1', 'Tharindu Gamage', [ROLE_IDS.inventory]),
    u('hr1', 'Ishara Senanayake', [ROLE_IDS.hr]),
    u('formercashier', 'Amila Rajapaksha', [ROLE_IDS.cashier], {
      active: false,
      lastLoginAt: '2026-10-02T09:00:00Z',
    }),
  ]
}

export interface MockSettings {
  restaurant: RestaurantDetails
  serviceCharges: ServiceChargeSettings
  tax: TaxSettings
  businessDay: BusinessDaySettings
  idleTimeouts: IdleTimeoutSettings
}

export function seedSettings(): MockSettings {
  return {
    restaurant: {
      name: 'Santhula Hotel',
      address: 'No. 12, Main Street\nNetolpitiya',
      phone: '+94 47 222 3344',
      receiptFooter: 'Thank you, come again!',
      version: 1,
      updatedAt: SEED_TIME,
    },
    serviceCharges: {
      rules: [
        { orderType: 'DINE_IN', rate: '10.00' },
        { orderType: 'TAKEAWAY', rate: '0.00' },
        { orderType: 'DELIVERY', rate: '0.00' },
      ],
      version: 1,
      updatedAt: SEED_TIME,
    },
    tax: { enabled: false, rate: '0.00', label: 'VAT', version: 1, updatedAt: SEED_TIME },
    businessDay: { dayStartTime: '06:00', timeZone: 'Asia/Colombo', version: 1, updatedAt: SEED_TIME },
    idleTimeouts: {
      rules: [
        { terminalType: 'CASHIER_POS', exempt: false, idleTimeoutMinutes: 10 },
        { terminalType: 'RECEPTION_POS', exempt: false, idleTimeoutMinutes: 10 },
        { terminalType: 'ADMIN', exempt: false, idleTimeoutMinutes: 30 },
        { terminalType: 'KITCHEN', exempt: true },
        { terminalType: 'DISPLAY', exempt: true },
      ],
      idleTimeoutPersonalMinutes: 30,
      version: 1,
      updatedAt: SEED_TIME,
    },
  }
}

/** A plausible fortnight of audit history (deterministic). */
export function seedAudit(users: MockUser[], terminals: MockTerminal[], now: Date): AuditEntry[] {
  let s = 42
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T
  const active = users.filter((u) => u.active)
  const pos = terminals.filter((t) => t.type !== 'DISPLAY' && t.active)
  const out: AuditEntry[] = []
  const actions: Array<[AuditAction, string]> = [
    ['LOGIN', 'AUTH_SESSION'],
    ['LOGIN', 'AUTH_SESSION'],
    ['LOGIN', 'AUTH_SESSION'],
    ['LOGOUT', 'AUTH_SESSION'],
    ['LOGOUT', 'AUTH_SESSION'],
    ['LOGIN_FAILED', 'AUTH_SESSION'],
    ['UPDATE', 'USER'],
    ['SETTINGS_CHANGED', 'SETTING'],
    ['PIN_CHANGED', 'USER'],
  ]
  for (let i = 0; i < 160; i++) {
    const at = new Date(now.getTime() - (160 - i) * 2.1 * 3600_000 - Math.floor(rnd() * 3600_000))
    const user = pick(active)
    const terminal = pick(pos)
    const [action, entityType] = pick(actions)
    const entry: AuditEntry = {
      id: seedId(0x7, i + 1),
      at: at.toISOString(),
      user: { id: user.id, username: user.username, fullName: user.fullName },
      // Every 6th entry is from a personal session (no terminal; ADR-008).
      ...(i % 6 === 5 ? {} : { terminal: { id: terminal.id, name: terminal.name } }),
      clientInfo:
        i % 6 === 5
          ? '203.0.113.7 | Mozilla/5.0 (Android 14; Mobile) Chrome/131'
          : '192.168.1.20 | Mozilla/5.0 (Windows NT 10.0) Chrome/131',
      action,
      entityType,
      entityId: entityType === 'SETTING' ? 'service-charges' : user.id,
    }
    if (action === 'LOGOUT') entry.reason = rnd() > 0.6 ? 'IDLE_TIMEOUT' : 'USER'
    if (action === 'UPDATE') {
      entry.before = { phone: '+94 77 000 0000' }
      entry.after = { phone: user.phone ?? '' }
    }
    if (action === 'SETTINGS_CHANGED') {
      entry.before = { DINE_IN: '10.00' }
      entry.after = { DINE_IN: '10.00' }
    }
    out.push(entry)
  }
  return out
}
