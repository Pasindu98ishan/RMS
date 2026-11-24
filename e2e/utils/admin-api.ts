/**
 * Helpers that drive the M1.0 admin API for test set-up: throwaway users and roles, the test clock,
 * audit lookups. Every helper takes an already logged-in owner client.
 */
import { randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { type ApiClient, type Schemas, type TerminalIdentity } from './api-client';
import { EP } from './endpoints';
import { env } from './env';
import type { RoleKey } from './role-grants';

export const PASSWORD = env.seedPassword;

/** Unique, valid username (^[a-z0-9._-]{3,32}$). */
export function uniqueName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`.slice(0, 32);
}

export interface TestUser {
  id: string;
  username: string;
  password: string;
  /** null = created without a PIN. */
  pin: string | null;
  roleIds: string[];
}

export async function json<T>(res: APIResponse, expected: number | number[] = 200): Promise<T> {
  const list = Array.isArray(expected) ? expected : [expected];
  expect(list, `${res.url()} -> ${res.status()} ${await res.text()}`).toContain(res.status());
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

export async function roleIdByKey(owner: ApiClient, key: RoleKey): Promise<string> {
  const roles = await json<Schemas['RoleOption'][]>(await owner.get(`${EP.roles}/options`));
  const r = roles.find((x) => x.key === key.toUpperCase());
  if (!r) throw new Error(`system role ${key} not found`);
  return r.id;
}

export interface CreateUserOpts {
  role?: RoleKey;
  /** Overrides `role`. */
  roleIds?: string[];
  username?: string;
  password?: string;
  pin?: string | null;
  fullName?: string;
}

/** Creates a throwaway user (never reuse a seeded user for a test that locks, changes or deactivates). */
export async function createUser(owner: ApiClient, opts: CreateUserOpts = {}): Promise<TestUser> {
  const username = opts.username ?? uniqueName('qa');
  const password = opts.password ?? PASSWORD;
  const pin = opts.pin === undefined ? '1357' : opts.pin;
  const roleIds = opts.roleIds ?? [await roleIdByKey(owner, opts.role ?? 'cashier')];
  const body: Record<string, unknown> = { username, fullName: opts.fullName ?? `QA ${username}`, password, roleIds };
  if (pin !== null) body.pin = pin;
  const u = await json<Schemas['User']>(await owner.post(EP.users, { body }), 201);
  return { id: u.id, username, password, pin, roleIds };
}

export async function createRole(
  owner: ApiClient,
  permissionCodes: string[],
  name = uniqueName('QA Role'),
): Promise<Schemas['Role']> {
  return json<Schemas['Role']>(await owner.post(EP.roles, { body: { name, description: 'QA test role', permissionCodes } }), 201);
}

export async function getRole(owner: ApiClient, id: string): Promise<Schemas['Role']> {
  return json<Schemas['Role']>(await owner.get(EP.role(id)));
}

export async function getUser(owner: ApiClient, id: string): Promise<Schemas['User']> {
  return json<Schemas['User']>(await owner.get(EP.user(id)));
}

/** Registers a fresh terminal with the owner's credentials (throwaway device). */
export async function registerTerminalAs(
  api: ApiClient,
  creds: { username: string; password: string },
  name: string,
  type: Schemas['TerminalType'] = 'CASHIER_POS',
): Promise<{ identity: TerminalIdentity; terminal: Schemas['Terminal'] }> {
  const reg = await json<Schemas['TerminalRegistration']>(await api.registerTerminal(creds, { name, type }), 201);
  return { identity: { terminalId: reg.terminal.id, deviceToken: reg.deviceToken }, terminal: reg.terminal };
}

// ---- test clock (backend `test` profile; affects the whole server: use only in serial tests) ----

export async function advanceClock(api: ApiClient, minutes: number): Promise<{ now: string; offsetMinutes: number }> {
  return json(await api.withToken(undefined).post('test/clock/advance', { body: { minutes } }));
}

export async function resetClock(api: ApiClient): Promise<{ now: string; offsetMinutes: number }> {
  return json(await api.withToken(undefined).post('test/clock/reset'));
}

// ---- audit ----

export type AuditQuery = Partial<Record<'page' | 'size' | 'sort' | 'from' | 'to' | 'userId' | 'action' | 'entityType' | 'entityId', string | number>>;

export async function auditSearch(owner: ApiClient, q: AuditQuery = {}): Promise<Schemas['AuditLogPage']> {
  return json<Schemas['AuditLogPage']>(await owner.get(EP.auditLog, { query: { size: 200, ...q } as Record<string, string | number> }));
}

/** Entries about a user (as actor `userId`, or as the record `entityId`), newest first. */
export async function auditFor(owner: ApiClient, userId: string, q: AuditQuery = {}): Promise<Schemas['AuditEntry'][]> {
  const asActor = (await auditSearch(owner, { userId, ...q })).items;
  const asRecord = (await auditSearch(owner, { entityId: userId, ...q })).items;
  const seen = new Set<string>();
  return [...asActor, ...asRecord].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => b.at.localeCompare(a.at));
}

/** YYYY-MM-DD in Asia/Colombo for an instant (audit from/to are Colombo calendar dates). */
export function colomboDate(d: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

/** Text that must never appear in any response body (test secrets). */
export function secretsToHide(extra: string[] = []): string[] {
  return [PASSWORD, env.bootstrapOwner.password, ...extra].filter(Boolean);
}
