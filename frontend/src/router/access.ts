/**
 * Route access rules (pure functions, unit-tested). The UI hides what a role cannot do; the server
 * enforces it anyway (P1-RBAC-03).
 */
import type { PermissionCode, SessionType, TerminalType } from '@/api/types'

export interface AccessMeta {
  /** Reachable without login (login, terminal setup). */
  public?: boolean
  /** The user needs at least one of these permissions. Empty / absent = any logged-in user. */
  anyOf?: readonly PermissionCode[]
  /** Needs a TERMINAL session (POS, kitchen): a personal session gets the 'use a counter device' page (ADR-008). */
  terminalSession?: boolean
}

export function canAccess(meta: AccessMeta, has: (code: PermissionCode) => boolean): boolean {
  if (meta.public) return true
  if (!meta.anyOf || meta.anyOf.length === 0) return true
  return meta.anyOf.some(has)
}

/** Permissions that open the admin area (QA route-permissions.ts, assumed mapping Q15). */
export const ADMIN_AREA: readonly PermissionCode[] = [
  'USER_MANAGE',
  'ROLE_MANAGE',
  'TERMINAL_MANAGE',
  'SETTINGS_MANAGE',
  'AUDIT_VIEW',
  'MENU_MANAGE',
  'FLOOR_MANAGE',
  'SHIFT_APPROVE',
  'REPORT_POS_ALL',
]
export const POS_AREA: readonly PermissionCode[] = ['ORDER_VIEW']
export const KITCHEN_AREA: readonly PermissionCode[] = ['KDS_OPERATE', 'KDS_VIEW_ALL']
/** The large display is read-only; any logged-in user on a DISPLAY terminal may show it. */
export const DISPLAY_AREA: readonly PermissionCode[] = []

interface Landing {
  path: string
  anyOf: readonly PermissionCode[]
}

const LANDING_BY_TERMINAL: Record<TerminalType, Landing> = {
  CASHIER_POS: { path: '/pos', anyOf: POS_AREA },
  RECEPTION_POS: { path: '/pos', anyOf: POS_AREA },
  KITCHEN: { path: '/kitchen', anyOf: KITCHEN_AREA },
  ADMIN: { path: '/admin', anyOf: ADMIN_AREA },
  DISPLAY: { path: '/display', anyOf: DISPLAY_AREA },
}

/** Fallback order when the user cannot use their terminal's own area. */
const FALLBACKS: readonly Landing[] = [
  { path: '/admin', anyOf: ADMIN_AREA },
  { path: '/pos', anyOf: POS_AREA },
  { path: '/kitchen', anyOf: KITCHEN_AREA },
]

/**
 * Where a user lands after login: the terminal type decides; if the user may not use that area,
 * the first area they can use; else the "no access" page.
 */
export function landingPath(
  terminalType: TerminalType | null | undefined,
  has: (c: PermissionCode) => boolean,
) {
  const primary = terminalType ? LANDING_BY_TERMINAL[terminalType] : undefined
  if (primary && canAccess({ anyOf: primary.anyOf }, has)) return primary.path
  const fallback = FALLBACKS.find((l) => canAccess({ anyOf: l.anyOf }, has))
  return fallback?.path ?? '/forbidden'
}

export interface SessionInfo {
  sessionType: SessionType | null | undefined
  terminalType?: TerminalType | null
  /** Holds the Rider role (role key RIDER). */
  isRider?: boolean
}

export const HOME_PATH = '/home'
export const RIDER_PATH = '/rider'

/**
 * Landing after login (ADR-008 #10). Terminal session: by terminal type (landingPath). Personal
 * session: /admin with any admin-area permission, else /rider for riders, else the simple home page.
 */
export function landingFor(s: SessionInfo, has: (c: PermissionCode) => boolean): string {
  if (s.sessionType === 'PERSONAL') {
    if (canAccess({ anyOf: ADMIN_AREA }, has)) return '/admin'
    if (s.isRider) return RIDER_PATH
    return HOME_PATH
  }
  return landingPath(s.terminalType, has)
}

/** Only same-app absolute paths are followed after login (no open redirects). */
export function safeRedirect(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.startsWith('/login') || value.startsWith('/setup')) return null
  return value
}
