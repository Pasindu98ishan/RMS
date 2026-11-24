/**
 * M1.1 set-up helpers (catalog and floor). Every helper takes a logged-in client with the permission it needs
 * (the owner by default) and creates uniquely named records, so parallel tests never collide.
 */
import { randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import type { ApiClient, Schemas } from './api-client';
import { json } from './admin-api';

export const EPM = {
  stations: 'kitchen-stations',
  station: (id: string) => `kitchen-stations/${id}`,
  stationOptions: 'kitchen-stations/options',
  orderingPoints: 'ordering-points',
  setupOptions: 'terminals/setup-options',
  categories: 'categories',
  category: (id: string) => `categories/${id}`,
  items: 'menu-items',
  item: (id: string) => `menu-items/${id}`,
  availability: (id: string) => `menu-items/${id}/availability`,
  availabilityList: 'menu/availability',
  posMenu: 'menu/pos',
  modifierGroups: 'modifier-groups',
  modifierGroup: (id: string) => `modifier-groups/${id}`,
  tables: 'tables',
  table: (id: string) => `tables/${id}`,
  positions: 'tables/positions',
  floorLayout: 'floor/layout',
  areas: 'delivery-areas',
  area: (id: string) => `delivery-areas/${id}`,
  areaOptions: 'delivery-areas/options',
  reasons: 'reasons',
  reason: (id: string) => `reasons/${id}`,
  reasonOptions: 'reasons/options',
  menuSettings: 'settings/menu',
  importData: (type: string) => `import/${type}`,
  importTemplate: (type: string) => `import/${type}/template`,
} as const;

/** Upper-case item code (^[A-Z0-9-]{1,20}$). */
export function uniqueCode(prefix = 'QA'): string {
  return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`.slice(0, 20);
}

/** Table number (^[A-Za-z0-9-]{1,10}$). */
export function uniqueTableNo(): string {
  return `Q${randomBytes(3).toString('hex').toUpperCase()}`;
}

export const uniqueLabel = (prefix: string): string => `${prefix} ${randomBytes(3).toString('hex')}`;

export async function listStations(c: ApiClient): Promise<Schemas['KitchenStation'][]> {
  return json<Schemas['KitchenStation'][]>(await c.get(EPM.stations));
}

/** Station by number 1..3 (stable across renames). */
export async function stationByNumber(c: ApiClient, n: 1 | 2 | 3): Promise<Schemas['KitchenStation']> {
  const s = (await listStations(c)).find((x) => x.number === n);
  if (!s) throw new Error(`station ${n} not found`);
  return s;
}

export async function createCategory(c: ApiClient, over: Partial<Schemas['CreateCategoryRequest']> = {}): Promise<Schemas['Category']> {
  return json<Schemas['Category']>(await c.post(EPM.categories, { body: { name: uniqueLabel('QA Cat'), ...over } }), 201);
}

export interface ItemOpts {
  code?: string;
  name?: string;
  categoryId?: string;
  stationId?: string;
  localPrice?: string;
  foreignPrice?: string | null;
  active?: boolean;
  modifierGroupIds?: string[];
}

export async function createItem(c: ApiClient, o: ItemOpts = {}): Promise<Schemas['MenuItem']> {
  const categoryId = o.categoryId ?? (await createCategory(c)).id;
  const stationId = o.stationId ?? (await stationByNumber(c, 1)).id;
  const body: Record<string, unknown> = {
    code: o.code ?? uniqueCode(),
    name: o.name ?? uniqueLabel('QA Item'),
    categoryId,
    stationId,
    localPrice: o.localPrice ?? '500.00',
  };
  if (o.foreignPrice !== null) body.foreignPrice = o.foreignPrice ?? '750.00';
  if (o.active !== undefined) body.active = o.active;
  if (o.modifierGroupIds) body.modifierGroupIds = o.modifierGroupIds;
  return json<Schemas['MenuItem']>(await c.post(EPM.items, { body }), 201);
}

/** Full-replacement body for updateMenuItem built from the current item, with overrides. */
export function itemUpdate(item: Schemas['MenuItem'], over: Record<string, unknown> = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    code: item.code,
    name: item.name,
    categoryId: item.categoryId,
    stationId: item.stationId,
    localPrice: item.localPrice,
    active: item.active,
    modifierGroupIds: item.modifierGroups.map((g) => g.id),
    version: item.version,
  };
  if (item.foreignPrice) body.foreignPrice = item.foreignPrice;
  return { ...body, ...over };
}

export async function getItem(c: ApiClient, id: string): Promise<Schemas['MenuItem']> {
  return json<Schemas['MenuItem']>(await c.get(EPM.item(id)));
}

export async function createGroup(
  c: ApiClient,
  over: Partial<Schemas['CreateModifierGroupRequest']> = {},
): Promise<Schemas['ModifierGroup']> {
  const body = {
    name: uniqueLabel('QA Group'),
    required: false,
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: 'Alpha', priceDelta: '0.00' },
      { name: 'Beta', priceDelta: '50.00' },
    ],
    ...over,
  };
  return json<Schemas['ModifierGroup']>(await c.post(EPM.modifierGroups, { body }), 201);
}

export async function createTable(c: ApiClient, over: Record<string, unknown> = {}): Promise<Schemas['DiningTable']> {
  return json<Schemas['DiningTable']>(
    await c.post(EPM.tables, { body: { number: uniqueTableNo(), section: 'QA', seats: 4, ...over } }),
    201,
  );
}

export async function createArea(c: ApiClient, over: Record<string, unknown> = {}): Promise<Schemas['DeliveryArea']> {
  return json<Schemas['DeliveryArea']>(await c.post(EPM.areas, { body: { name: uniqueLabel('QA Area'), fee: '250.00', ...over } }), 201);
}

export async function createReason(c: ApiClient, over: Record<string, unknown> = {}): Promise<Schemas['Reason']> {
  return json<Schemas['Reason']>(
    await c.post(EPM.reasons, { body: { category: 'CANCEL', text: uniqueLabel('QA reason'), ...over } }),
    201,
  );
}

/** Asserts a 422 whose fieldErrors name `field` (prefix match, e.g. `options` matches `options[0].name`). */
export async function expectFieldError(res: import('@playwright/test').APIResponse, field: string): Promise<Schemas['Problem']> {
  expect(res.status(), await res.text()).toBe(422);
  const p = (await res.json()) as Schemas['Problem'];
  expect(p.code).toBe('VALIDATION_FAILED');
  expect((p.fieldErrors ?? []).map((f) => f.field).join(' | '), `field errors of ${JSON.stringify(p.fieldErrors)}`).toContain(field);
  return p;
}
