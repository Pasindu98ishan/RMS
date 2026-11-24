import type { PermissionCode, SessionType, TerminalType } from '@/api/types'
import { canAccess, landingFor, type AccessMeta } from './access'

export interface GuardContext {
  authenticated: boolean
  /** TERMINAL or PERSONAL once logged in (ADR-008). */
  sessionType: SessionType | null | undefined
  terminalType: TerminalType | null | undefined
  isRider?: boolean
  has: (code: PermissionCode) => boolean
}

export interface GuardTarget {
  path: string
  fullPath: string
  name?: string | symbol | null
  meta: AccessMeta & { landing?: boolean }
  /**
   * Matched route records, parent first. vue-router merges `meta` with the child's value winning, so a
   * child's `anyOf` would replace its parent's; every record's own rule must pass instead.
   */
  matched?: ReadonlyArray<{ meta: AccessMeta }>
}

/** true = go ahead; otherwise the location to go to instead. */
export type GuardResult = true | { path: string; query?: Record<string, string> }

export const SETUP_PATH = '/setup/terminal'
export const LOGIN_PATH = '/login'
export const FORBIDDEN_PATH = '/forbidden'
export const TERMINAL_REQUIRED_PATH = '/terminal-required'

/**
 * The login page is the first screen on every device (ADR-008 #9): an unregistered device logs in as
 * a personal session; terminal setup is reached from a link and is always open.
 */
export function decideNavigation(to: GuardTarget, ctx: GuardContext): GuardResult {
  // Terminal setup is always reachable: it authenticates with owner credentials inline.
  if (to.path === SETUP_PATH) return true

  const landing = () => landingFor(ctx, ctx.has)

  if (to.path === LOGIN_PATH) return ctx.authenticated ? { path: landing() } : true

  if (!ctx.authenticated) {
    if (to.meta.public) return true
    return to.meta.landing ? { path: LOGIN_PATH } : { path: LOGIN_PATH, query: { redirect: to.fullPath } }
  }

  if (to.meta.landing) return { path: landing() }

  const rules: AccessMeta[] = to.matched?.length ? to.matched.map((m) => m.meta) : [to.meta]
  // Permission first (Q42): someone who may not use the screen at all gets /forbidden; only a user who
  // may use it but is in a personal session gets the 'use a registered counter device' page.
  if (!rules.every((meta) => canAccess(meta, ctx.has))) {
    return to.path === FORBIDDEN_PATH ? true : { path: FORBIDDEN_PATH, query: { from: to.fullPath } }
  }
  if (ctx.sessionType === 'PERSONAL' && rules.some((m) => m.terminalSession)) {
    return { path: TERMINAL_REQUIRED_PATH, query: { from: to.fullPath } }
  }
  return true
}
