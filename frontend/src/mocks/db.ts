/** In-memory mock database, persisted to localStorage so mock state survives a reload. */
import type {
  AuditEntry,
  AuditAction,
  Role,
  RoleRef,
  User,
  UserSummary,
  Terminal,
  TerminalSummary,
} from '@/api/types'
import {
  seedAreas,
  seedCategories,
  seedItems,
  seedModifierGroups,
  seedOrderingPoints,
  seedReasons,
  seedStations,
  seedTables,
  type MockArea,
  type MockCategory,
  type MockItem,
  type MockModifierGroup,
  type MockReason,
  type MockStation,
  type MockTable,
} from './seedCatalog'
import {
  KITCHEN_STATION_IDS,
  seedAudit,
  seedRoles,
  seedSettings,
  seedTerminals,
  seedUsers,
  type MockSettings,
  type MockTerminal,
  type MockUser,
} from './seed'

// Bump when the mock data shape changes, so stale state in localStorage is not reused.
const KEY = 'rms.mockdb.v4'
export const ACCESS_TTL_SECONDS = 900
export const REFRESH_TTL_SECONDS = 12 * 3600

export interface MockSession {
  userId: string
  /** null = personal session (ADR-008). */
  terminalId: string | null
  /** epoch ms */
  expiresAt: number
}

export interface MockDb {
  roles: Role[]
  users: MockUser[]
  terminals: MockTerminal[]
  settings: MockSettings
  stations: MockStation[]
  orderingPoints: Array<{ id: string; name: string }>
  categories: MockCategory[]
  items: MockItem[]
  modifierGroups: MockModifierGroup[]
  tables: MockTable[]
  areas: MockArea[]
  reasons: MockReason[]
  /** M1.1 setting: sold-out resets at the start of each business day. */
  menuSettings: { resetAvailabilityDaily: boolean; version: number; updatedAt: string }
  audit: AuditEntry[]
  /** Permissions are frozen into the access token, as in the real JWT (changes apply on refresh). */
  accessTokens: Record<string, MockSession & { refreshToken: string; permissions: string[] }>
  refreshTokens: Record<string, MockSession & { revoked: boolean }>
}

function fresh(): MockDb {
  const roles = seedRoles()
  const users = seedUsers(roles)
  const terminals = seedTerminals()
  return {
    roles,
    users,
    terminals,
    settings: seedSettings(),
    stations: seedStations(KITCHEN_STATION_IDS),
    orderingPoints: seedOrderingPoints(),
    categories: seedCategories(),
    items: seedItems(KITCHEN_STATION_IDS),
    modifierGroups: seedModifierGroups(),
    tables: seedTables(),
    areas: seedAreas(),
    reasons: seedReasons(),
    menuSettings: { resetAvailabilityDaily: true, version: 1, updatedAt: nowIso() },
    audit: seedAudit(users, terminals, new Date()),
    accessTokens: {},
    refreshTokens: {},
  }
}

function load(): MockDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as MockDb
  } catch {
    /* fall through to a fresh seed */
  }
  return fresh()
}

export const db: MockDb = load()

export function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* in-memory only */
  }
}

export function resetDb(): void {
  Object.assign(db, fresh())
  persist()
}

/** Forces every access token to expire, to exercise refresh-on-401 in the browser. */
export function expireAccessTokens(): void {
  for (const t of Object.values(db.accessTokens)) t.expiresAt = 0
  persist()
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(): string {
  return crypto.randomUUID()
}

export function newToken(prefix: string): string {
  return `${prefix}.${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

// ---------------------------------------------------------------- projections

export function roleRef(r: Role): RoleRef {
  return { id: r.id, name: r.name, system: r.system, ...(r.key ? { key: r.key } : {}) }
}

/** Active users holding the role. */
export function userCountFor(roleId: string): number {
  return db.users.filter((u) => u.active && u.roles.some((r) => r.id === roleId)).length
}

export function roleOut(r: Role): Role {
  return { ...r, userCount: userCountFor(r.id) }
}

/** Expires time-based locks, like the server does on read. */
function refreshLocks(u: MockUser): void {
  const now = Date.now()
  if (u.locked && u.lockedUntil && Date.parse(u.lockedUntil) <= now) {
    u.locked = false
    delete u.lockedUntil
    u.failedLogins = 0
  }
  if (u.pinLocked && u.pinLockedUntil && Date.parse(u.pinLockedUntil) <= now) {
    u.pinLocked = false
    delete u.pinLockedUntil
    u.failedPins = 0
  }
}

export function userOut(u: MockUser): User {
  refreshLocks(u)
  // Strip mock-only secrets; keep the contract shape (optional fields omitted, never null).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, pin, failedLogins, failedPins, ...rest } = u
  return { ...rest, roles: u.roles.map((r) => ({ ...r })) }
}

export function userSummaryOut(u: MockUser): UserSummary {
  const full = userOut(u)
  const s: UserSummary = {
    id: full.id,
    username: full.username,
    fullName: full.fullName,
    active: full.active,
    locked: full.locked,
    pinSet: full.pinSet,
    pinLocked: full.pinLocked,
    roles: full.roles,
  }
  if (full.lastLoginAt) s.lastLoginAt = full.lastLoginAt
  return s
}

/** Read-only names that come with the ids (kitchenStationName / orderingPointName). */
function withNames<T extends { kitchenStationId?: string; orderingPointId?: string }>(t: T): T {
  const out = { ...t } as T & { kitchenStationName?: string; orderingPointName?: string }
  const station = t.kitchenStationId ? db.stations.find((s) => s.id === t.kitchenStationId) : undefined
  const point = t.orderingPointId ? db.orderingPoints.find((p) => p.id === t.orderingPointId) : undefined
  if (station) out.kitchenStationName = station.name
  if (point) out.orderingPointName = point.name
  return out
}

export function terminalOut(t: MockTerminal): Terminal {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deviceToken, ...rest } = t
  return withNames(rest)
}

export function terminalSummaryOut(t: Terminal): TerminalSummary {
  const s: TerminalSummary = { id: t.id, name: t.name, type: t.type, active: t.active }
  if (t.kitchenStationId) s.kitchenStationId = t.kitchenStationId
  if (t.orderingPointId) s.orderingPointId = t.orderingPointId
  return withNames(s)
}

/** What the server records as client_info: IP address and a trimmed User-Agent (ADR-008). */
export function mockClientInfo(): string {
  const ua = typeof navigator === 'undefined' ? 'node' : navigator.userAgent
  return `127.0.0.1 | ${ua.slice(0, 80)}`
}

export function audit(
  action: AuditAction,
  entityType: string,
  init: Partial<Omit<AuditEntry, 'id' | 'at' | 'action' | 'entityType' | 'user' | 'terminal'>> & {
    actor?: MockUser | null
    terminal?: Terminal | null
  } = {},
): void {
  const { actor, terminal, ...rest } = init
  const entry: AuditEntry = {
    id: newId(),
    at: nowIso(),
    action,
    entityType,
    clientInfo: mockClientInfo(),
    ...rest,
  }
  if (actor) entry.user = { id: actor.id, username: actor.username, fullName: actor.fullName }
  if (terminal) entry.terminal = { id: terminal.id, name: terminal.name }
  db.audit.push(entry)
}
