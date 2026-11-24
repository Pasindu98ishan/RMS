/**
 * Seed data for the E2E / API acceptance suites (docs/qa/test-strategy.md §5).
 *
 * DATA: final for Phase 1 and typed. API: the M1.0 part (terminals, roles, users, settings) calls
 * the real contract (build/openapi.bundled.yaml); later parts are TODO per milestone.
 * Every value here is a test value for the RMS test environment only.
 *
 * Bootstrap: the backend creates the first owner on start-up; its credentials come from
 * RMS_BOOTSTRAP_OWNER_USERNAME / _PASSWORD / _PIN. Login needs a registered terminal, so the seed
 * first registers terminals with those credentials (registerTerminal, inline credentials).
 *
 * Deviations from §5 (recorded in test-plan.md): besides "one user per role" we seed kitchen2 /
 * kitchen3 (one kitchen identity per station for P1-RBAC-04) and cashier2 (own-records scoping needs
 * a second user of the same role). Kitchen terminals need a station id, and stations arrive in M1.1,
 * so they are registered from M1.1 on.
 */
import { writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import type { ApiClient, Schemas, TerminalIdentity, TerminalType } from '../utils/api-client';
import { EP } from '../utils/endpoints';
import { env, requireBootstrapOwner } from '../utils/env';
import { ROLE_DISPLAY_NAMES, type RoleKey, SEEDED_ROLES } from '../utils/role-grants';

// ---------------------------------------------------------------- types

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'CREDIT';
export type StationKey = 'K1' | 'K2' | 'K3';
export type TerminalKey = 'CASHIER_POS' | 'RECEPTION_POS' | 'KITCHEN_1' | 'KITCHEN_2' | 'KITCHEN_3' | 'ADMIN';
/** Money and rates are strings with 2 decimals on the wire (conventions.md). */
export type Money = `${number}.${number}`;

export interface SeedStation {
  key: StationKey;
  name: string;
  /** P1-SET-05 target preparation time. */
  targetPrepMinutes: number;
}

export interface SeedTerminal {
  key: TerminalKey;
  name: string;
  type: TerminalType;
  /** KITCHEN terminals only; needs the station id, so registered from M1.1. */
  station?: StationKey;
}

export interface SeedUser {
  username: string;
  fullName: string;
  role: RoleKey;
  /** P1-AUTH-05: 4–6 digits. */
  pin: string;
  /** Kitchen staff work at one station; the station is bound to the KITCHEN terminal (Q12). */
  station?: StationKey;
  /** Terminal the user normally works at. */
  terminal: TerminalKey;
}

export interface SeedCategory {
  code: string;
  name: string;
  displayOrder: number;
}

export interface SeedModifierOption {
  name: string;
  price: Money;
}

export interface SeedModifierGroup {
  code: string;
  name: string;
  required: boolean;
  min: number;
  max: number;
  options: SeedModifierOption[];
}

export interface SeedMenuItem {
  code: string;
  name: string;
  category: string;
  station: StationKey;
  localPrice: Money;
  foreignPrice: Money;
  modifierGroups: string[];
}

export interface SeedTable {
  number: string;
  area: string;
  seats: number;
}

export type SeedDiscountRule =
  | { code: string; name: string; type: 'STAFF'; rate: Money; monthlyLimitPerStaff?: Money }
  | { code: string; name: string; type: 'GOVERNMENT'; rate: Money }
  | { code: string; name: string; type: 'OTHER'; maxRate: Money; cashierLimitRate: Money };

export interface SeedDeliveryArea {
  name: string;
  fee: Money;
}

export interface SeedRider {
  name: string;
  phone: string;
  active: boolean;
}

export interface SeedCustomer {
  name: string;
  phone: string;
  address: string;
  company?: string;
  nic?: string;
  creditStatus?: 'ACTIVE' | 'BLOCKED';
}

export interface SeedSettings {
  restaurant: { name: string; address: string; phone: string; receiptFooter: string };
  /** P1-SET-01. Credit follows its service mode, so it has no own rate. */
  serviceChargeRate: Record<Schemas['ServiceChargeOrderType'], Money>;
  /** P1-SET-02 (client decision #2): enabled=true is 409 TAX_NOT_SUPPORTED in Phase 1. */
  tax: { enabled: false; rate: Money };
  /** P1-SET-04, local time Asia/Colombo, HH:mm. */
  businessDayStart: string;
  /** P1-AUTH-03 idle timeouts (1–240 min). KITCHEN and DISPLAY are exempt and not settable. */
  idleTimeoutMinutes: Record<'CASHIER_POS' | 'RECEPTION_POS' | 'ADMIN', number>;
  /** P1-AUTH-03 / ADR-008 idle logout of personal sessions (no terminal), 1–240 min, default 30. */
  idleTimeoutPersonalMinutes: number;
}

export interface SeedData {
  branch: { code: string; name: string };
  settings: SeedSettings;
  stations: SeedStation[];
  terminals: SeedTerminal[];
  users: SeedUser[];
  categories: SeedCategory[];
  modifierGroups: SeedModifierGroup[];
  menuItems: SeedMenuItem[];
  tables: SeedTable[];
  discountRules: SeedDiscountRule[];
  deliveryAreas: SeedDeliveryArea[];
  riders: SeedRider[];
  customers: SeedCustomer[];
}

/** A seeded terminal: identity plus the details the browser stores for a registered device. */
export interface TerminalRecord extends TerminalIdentity {
  name: string;
  type: TerminalType;
}

/** Server-assigned ids and device tokens captured while seeding; written to env.seedStateFile. */
export interface SeedState {
  createdAt: string;
  runId: string;
  terminals: Partial<Record<TerminalKey, TerminalRecord>>;
  users: Record<string, string>;
  roles: Partial<Record<RoleKey, string>>;
  stations: Partial<Record<StationKey, string>>;
}

// ---------------------------------------------------------------- data

const stations: SeedStation[] = [
  { key: 'K1', name: 'Kitchen 1 Rice & Curry', targetPrepMinutes: 15 },
  { key: 'K2', name: 'Kitchen 2 Grill', targetPrepMinutes: 20 },
  { key: 'K3', name: 'Kitchen 3 Juice & Dessert', targetPrepMinutes: 8 },
];

const terminals: SeedTerminal[] = [
  { key: 'CASHIER_POS', name: 'QA Cashier counter', type: 'CASHIER_POS' },
  { key: 'RECEPTION_POS', name: 'QA Reception', type: 'RECEPTION_POS' },
  { key: 'ADMIN', name: 'QA Owner office', type: 'ADMIN' },
  { key: 'KITCHEN_1', name: 'QA Kitchen 1', type: 'KITCHEN', station: 'K1' },
  { key: 'KITCHEN_2', name: 'QA Kitchen 2', type: 'KITCHEN', station: 'K2' },
  { key: 'KITCHEN_3', name: 'QA Kitchen 3', type: 'KITCHEN', station: 'K3' },
];

/**
 * One user per seeded role (+ kitchen2/3, cashier2). The owner row is a placeholder: the real owner is
 * the bootstrap owner from env (see ownerUser()). No user has PIN 0000 (used as the "wrong PIN").
 */
const users: SeedUser[] = [
  { username: 'owner1', fullName: 'QA Owner', role: 'owner', pin: '246810', terminal: 'ADMIN' },
  { username: 'manager1', fullName: 'QA Manager', role: 'manager', pin: '1357', terminal: 'CASHIER_POS' },
  { username: 'cashier1', fullName: 'QA Cashier', role: 'cashier', pin: '2468', terminal: 'CASHIER_POS' },
  { username: 'reception1', fullName: 'QA Receptionist', role: 'receptionist', pin: '3579', terminal: 'RECEPTION_POS' },
  { username: 'kitchen1', fullName: 'QA Kitchen 1', role: 'kitchen', pin: '4680', station: 'K1', terminal: 'KITCHEN_1' },
  { username: 'rider1', fullName: 'QA Rider', role: 'rider', pin: '5791', terminal: 'CASHIER_POS' },
  { username: 'inventory1', fullName: 'QA Inventory', role: 'inventory', pin: '6802', terminal: 'ADMIN' },
  { username: 'hr1', fullName: 'QA HR', role: 'hr', pin: '7913', terminal: 'ADMIN' },
  // extras
  { username: 'kitchen2', fullName: 'QA Kitchen 2', role: 'kitchen', pin: '4681', station: 'K2', terminal: 'KITCHEN_2' },
  { username: 'kitchen3', fullName: 'QA Kitchen 3', role: 'kitchen', pin: '4682', station: 'K3', terminal: 'KITCHEN_3' },
  { username: 'cashier2', fullName: 'QA Cashier 2', role: 'cashier', pin: '2469', terminal: 'RECEPTION_POS' },
];

const categories: SeedCategory[] = [
  { code: 'RC', name: 'Rice & Curry', displayOrder: 1 },
  { code: 'KF', name: 'Kottu & Fried Rice', displayOrder: 2 },
  { code: 'GR', name: 'Grill', displayOrder: 3 },
  { code: 'SF', name: 'Seafood', displayOrder: 4 },
  { code: 'JU', name: 'Juices', displayOrder: 5 },
  { code: 'DS', name: 'Desserts', displayOrder: 6 },
];

const modifierGroups: SeedModifierGroup[] = [
  { code: 'SPICE', name: 'Spice level', required: true, min: 1, max: 1, options: [
    { name: 'Mild', price: '0.00' }, { name: 'Medium', price: '0.00' }, { name: 'Hot', price: '0.00' },
  ] },
  { code: 'EXTRAS', name: 'Extras', required: false, min: 0, max: 3, options: [
    { name: 'Egg', price: '100.00' }, { name: 'Cheese', price: '150.00' }, { name: 'Extra chicken', price: '300.00' },
  ] },
  { code: 'SUGAR', name: 'Sugar', required: true, min: 1, max: 1, options: [
    { name: 'Normal', price: '0.00' }, { name: 'Less sugar', price: '0.00' }, { name: 'No sugar', price: '0.00' },
  ] },
];

/** [code, name, category, local LKR]: foreign price = local × 1.5; station follows category. */
const ITEM_ROWS: Array<[string, string, string, number]> = [
  ['RC01', 'Chicken rice & curry', 'RC', 950], ['RC02', 'Fish rice & curry', 'RC', 1050],
  ['RC03', 'Vegetable rice & curry', 'RC', 750], ['RC04', 'Egg rice & curry', 'RC', 800],
  ['RC05', 'Pork rice & curry', 'RC', 1150], ['RC06', 'Prawn rice & curry', 'RC', 1450],
  ['RC07', 'Dhal curry (extra)', 'RC', 250],
  ['KF01', 'Chicken kottu', 'KF', 1100], ['KF02', 'Cheese kottu', 'KF', 1350],
  ['KF03', 'Vegetable kottu', 'KF', 850], ['KF04', 'Chicken fried rice', 'KF', 1050],
  ['KF05', 'Seafood fried rice', 'KF', 1400], ['KF06', 'Nasi goreng', 'KF', 1300],
  ['KF07', 'Egg fried rice', 'KF', 900],
  ['GR01', 'Grilled chicken (half)', 'GR', 1800], ['GR02', 'Grilled chicken (full)', 'GR', 3200],
  ['GR03', 'Beef steak', 'GR', 2900], ['GR04', 'Pork chops', 'GR', 2600],
  ['GR05', 'Chicken skewers', 'GR', 1500], ['GR06', 'BBQ platter', 'GR', 4800],
  ['GR07', 'Grilled vegetables', 'GR', 1100],
  ['SF01', 'Devilled prawns', 'SF', 2400], ['SF02', 'Grilled fish fillet', 'SF', 2200],
  ['SF03', 'Cuttlefish fried', 'SF', 2000], ['SF04', 'Crab curry', 'SF', 3800],
  ['SF05', 'Lobster grill', 'SF', 6500], ['SF06', 'Calamari rings', 'SF', 1700],
  ['JU01', 'Lime juice', 'JU', 350], ['JU02', 'Mango juice', 'JU', 550],
  ['JU03', 'Passion fruit juice', 'JU', 500], ['JU04', 'Papaya juice', 'JU', 450],
  ['JU05', 'Watermelon juice', 'JU', 450], ['JU06', 'King coconut', 'JU', 300],
  ['JU07', 'Faluda', 'JU', 650],
  ['DS01', 'Watalappan', 'DS', 450], ['DS02', 'Curd & treacle', 'DS', 550],
  ['DS03', 'Ice cream (2 scoops)', 'DS', 400], ['DS04', 'Fruit salad', 'DS', 500],
  ['DS05', 'Chocolate biscuit pudding', 'DS', 600], ['DS06', 'Caramel pudding', 'DS', 450],
];

const STATION_BY_CATEGORY: Record<string, StationKey> = { RC: 'K1', KF: 'K1', GR: 'K2', SF: 'K2', JU: 'K3', DS: 'K3' };
const MODIFIERS_BY_CATEGORY: Record<string, string[]> = {
  RC: ['SPICE', 'EXTRAS'], KF: ['SPICE', 'EXTRAS'], GR: ['SPICE'], SF: ['SPICE'], JU: ['SUGAR'], DS: [],
};
const money = (n: number): Money => n.toFixed(2) as Money;

const menuItems: SeedMenuItem[] = ITEM_ROWS.map(([code, name, category, local]) => ({
  code,
  name,
  category,
  station: STATION_BY_CATEGORY[category],
  localPrice: money(local),
  foreignPrice: money(local * 1.5),
  modifierGroups: MODIFIERS_BY_CATEGORY[category],
}));

const tables: SeedTable[] = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  const area = n <= 6 ? 'Indoor' : n <= 10 ? 'Garden' : 'Verandah';
  return { number: `T${n}`, area, seats: n % 3 === 0 ? 6 : n % 2 === 0 ? 4 : 2 };
});

export const SEED: SeedData = {
  branch: { code: 'NET', name: 'Santhula Hotel, Netolpitiya' },
  settings: {
    restaurant: {
      name: 'Santhula Hotel',
      address: 'Netolpitiya, Sri Lanka',
      phone: '+94 47 000 0000',
      receiptFooter: 'Thank you, come again!',
    },
    // Test values; the client's real rates are loaded in M1.6.
    serviceChargeRate: { DINE_IN: '10.00', TAKEAWAY: '0.00', DELIVERY: '0.00' },
    tax: { enabled: false, rate: '0.00' },
    businessDayStart: '06:00',
    idleTimeoutMinutes: { CASHIER_POS: 10, RECEPTION_POS: 10, ADMIN: 30 },
    idleTimeoutPersonalMinutes: 30,
  },
  stations,
  terminals,
  users,
  categories,
  modifierGroups,
  menuItems,
  tables,
  discountRules: [
    { code: 'STAFF', name: 'Staff', type: 'STAFF', rate: '30.00', monthlyLimitPerStaff: '5000.00' },
    { code: 'GOV', name: 'Government', type: 'GOVERNMENT', rate: '30.00' },
    { code: 'REGULAR', name: 'Regular customer', type: 'OTHER', maxRate: '20.00', cashierLimitRate: '10.00' },
  ],
  deliveryAreas: [
    { name: 'Netolpitiya', fee: '200.00' },
    { name: 'Tangalle', fee: '400.00' },
  ],
  riders: [
    { name: 'QA Rider One', phone: '0770000001', active: true },
    { name: 'QA Rider Two', phone: '0770000002', active: true },
  ],
  customers: [
    { name: 'Nimal Perera', phone: '0771111111', address: '12 Beach Rd, Netolpitiya' },
    { name: 'Kamala Silva', phone: '0772222222', address: '5 Temple Rd, Tangalle', company: 'Silva Traders', creditStatus: 'ACTIVE' },
    { name: 'Blocked Credit Ltd', phone: '0773333333', address: '1 Main St, Tangalle', creditStatus: 'BLOCKED' },
  ],
};

// ---------------------------------------------------------------- helpers

/** The owner is the bootstrap owner when its env vars are set; otherwise the owner1 placeholder. */
export function ownerUser(): SeedUser {
  const base = SEED.users.find((u) => u.role === 'owner')!;
  const o = env.bootstrapOwner;
  return o.username ? { ...base, username: o.username, pin: o.pin || base.pin } : base;
}

export function userFor(role: RoleKey): SeedUser {
  if (role === 'owner') return ownerUser();
  const u = SEED.users.find((x) => x.role === role);
  if (!u) throw new Error(`No seeded user for role ${role}`);
  return u;
}

export function userByName(username: string): SeedUser {
  if (username === ownerUser().username) return ownerUser();
  const u = SEED.users.find((x) => x.username === username);
  if (!u) throw new Error(`No seeded user ${username}`);
  return u;
}

export function passwordFor(user: SeedUser): string {
  return user.role === 'owner' && env.bootstrapOwner.password ? env.bootstrapOwner.password : env.seedPassword;
}

/** A PIN no seeded user has: use as the "wrong PIN". */
export const WRONG_PIN = '0000';

/** Credentials of a user that does not exist (no lockout side effect). */
export const UNKNOWN_USER = { username: 'qa-no-such-user', password: 'Wrong#Password1' } as const;

async function ok<T>(res: APIResponse, expected: number | number[], what: string): Promise<T> {
  const list = Array.isArray(expected) ? expected : [expected];
  expect(list, `${what}: ${res.status()} ${await res.text()}`).toContain(res.status());
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

// ---------------------------------------------------------------- API seeding

/**
 * Seeds the M1.0 data through the public API and returns the ids / device tokens.
 * Re-runnable: terminals get a per-run name suffix (they can't be deleted), existing users are
 * reactivated and reset to the seed password / PIN / role.
 */
export async function seedViaApi(api: ApiClient, data: SeedData = SEED): Promise<SeedState> {
  const boot = requireBootstrapOwner();
  const state: SeedState = { createdAt: new Date().toISOString(), runId: env.runId, terminals: {}, users: {}, roles: {}, stations: {} };

  // 1. Terminals (P1-AUTH-04). KITCHEN needs kitchenStationId; stations exist from M1.1.
  for (const t of data.terminals.filter((x) => x.type !== 'KITCHEN')) {
    const reg = await ok<Schemas['TerminalRegistration']>(
      await api.registerTerminal({ username: boot.username, password: boot.password }, { name: `${t.name} ${env.runId}`.slice(0, 50), type: t.type }),
      201,
      `register terminal ${t.key}`,
    );
    state.terminals[t.key] = { terminalId: reg.terminal.id, deviceToken: reg.deviceToken, name: reg.terminal.name, type: reg.terminal.type };
  }
  // TODO(M1.1): read station ids (GET kitchen-stations), set target times (P1-SET-05), register KITCHEN_1..3.

  // 2. Owner session on the ADMIN terminal.
  const { client: owner, session } = await api.withTerminal(state.terminals.ADMIN).loginAs(boot.username, boot.password);
  state.users[boot.username] = session.user.id;

  // 3. Seeded system roles (P1-RBAC-01).
  const roles = await ok<Schemas['RoleSummary'][]>(await owner.get(EP.roles), 200, 'list roles');
  for (const role of SEEDED_ROLES) {
    // Match on the stable key, never on the name (contract: RoleKey).
    const r = roles.find((x) => x.system && x.key === role.toUpperCase());
    if (!r) throw new Error(`Seeded role ${role.toUpperCase()} (${ROLE_DISPLAY_NAMES[role]}) not found (P1-RBAC-01)`);
    state.roles[role] = r.id;
  }

  // 4. Users with role + PIN (P1-RBAC-02, P1-AUTH-05). The owner is the bootstrap owner.
  for (const u of data.users.filter((x) => x.role !== 'owner')) {
    const roleIds = [state.roles[u.role]!];
    const page = await ok<Schemas['UserPage']>(await owner.get(EP.users, { query: { search: u.username, size: 50 } }), 200, `find ${u.username}`);
    const existing = page.items.find((x) => x.username === u.username);
    if (!existing) {
      const created = await ok<Schemas['User']>(
        await owner.post(EP.users, { body: { username: u.username, fullName: u.fullName, password: env.seedPassword, pin: u.pin, roleIds } }),
        201,
        `create ${u.username}`,
      );
      state.users[u.username] = created.id;
      continue;
    }
    const id = existing.id;
    if (!existing.active) await ok(await owner.post(EP.activateUser(id)), 200, `activate ${u.username}`);
    await ok(await owner.post(EP.resetPassword(id), { body: { newPassword: env.seedPassword } }), [200, 204], `reset password ${u.username}`);
    await ok(await owner.post(EP.resetPin(id), { body: { newPin: u.pin } }), [200, 204], `reset PIN ${u.username}`);
    await ok(await owner.post(EP.unlockUser(id)), [200, 204], `unlock ${u.username}`);
    const full = await ok<Schemas['User']>(await owner.get(EP.user(id)), 200, `get ${u.username}`);
    await ok(await owner.put(EP.userRoles(id), { body: { roleIds, version: full.version } }), 200, `assign roles ${u.username}`);
    state.users[u.username] = id;
  }

  // 5. Settings (P1-SET-01..04, P1-AUTH-03): read version, then write the seed values.
  const s = data.settings;
  const put = async (path: string, body: (v: number) => unknown, what: string) => {
    const cur = await ok<{ version: number }>(await owner.get(path), 200, `get ${what}`);
    await ok(await owner.put(path, { body: body(cur.version) }), 200, `update ${what}`);
  };
  await put(EP.settings.serviceCharges, (version) => ({
    rules: Object.entries(s.serviceChargeRate).map(([orderType, rate]) => ({ orderType, rate })),
    version,
  }), 'service charges');
  await put(EP.settings.tax, (version) => ({ enabled: false, rate: s.tax.rate, version }), 'tax');
  await put(EP.settings.restaurant, (version) => ({ ...s.restaurant, version }), 'restaurant details');
  await put(EP.settings.businessDay, (version) => ({ dayStartTime: s.businessDayStart, version }), 'business day');
  await put(EP.settings.idleTimeouts, (version) => ({
    rules: Object.entries(s.idleTimeoutMinutes).map(([terminalType, idleTimeoutMinutes]) => ({ terminalType, idleTimeoutMinutes })),
    idleTimeoutPersonalMinutes: s.idleTimeoutPersonalMinutes,
    version,
  }), 'idle timeouts');

  // TODO(M1.1): categories, modifier groups, menu items (local/foreign price + station), tables + floor plan,
  //             delivery areas (P1-SET-07). TODO(M1.2): riders, customers. TODO(M1.4): discount rules.
  return state;
}

export function writeSeedState(state: SeedState, file = env.seedStateFile): void {
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}
