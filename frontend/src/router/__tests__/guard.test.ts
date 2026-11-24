import { describe, expect, it } from 'vitest'
import type { PermissionCode, TerminalType } from '@/api/types'
import { ADMIN_AREA, canAccess, landingFor, landingPath, safeRedirect } from '../access'
import { decideNavigation, type GuardContext, type GuardTarget } from '../guard'

const perms =
  (...codes: PermissionCode[]) =>
  (c: PermissionCode) =>
    codes.includes(c)

const OWNER: PermissionCode[] = [
  'USER_MANAGE',
  'ROLE_MANAGE',
  'TERMINAL_MANAGE',
  'SETTINGS_MANAGE',
  'AUDIT_VIEW',
  'ORDER_VIEW',
  'KDS_OPERATE',
]
const CASHIER: PermissionCode[] = ['ORDER_VIEW', 'BILL_PAY', 'KDS_VIEW_ALL']
const KITCHEN: PermissionCode[] = ['KDS_OPERATE']

function ctx(
  codes: PermissionCode[],
  terminalType: TerminalType = 'ADMIN',
  over: Partial<GuardContext> = {},
): GuardContext {
  return { authenticated: true, sessionType: 'TERMINAL', terminalType, has: perms(...codes), ...over }
}

function to(path: string, meta: GuardTarget['meta'] = {}): GuardTarget {
  return { path, fullPath: path, meta }
}

describe('canAccess', () => {
  it('P1-RBAC-03 needs any one of the listed permissions', () => {
    expect(canAccess({ anyOf: ['USER_MANAGE'] }, perms(...OWNER))).toBe(true)
    expect(canAccess({ anyOf: ['USER_MANAGE'] }, perms(...CASHIER))).toBe(false)
    expect(canAccess({ anyOf: ADMIN_AREA }, perms('AUDIT_VIEW'))).toBe(true)
    expect(canAccess({}, perms())).toBe(true)
    expect(canAccess({ public: true, anyOf: ['USER_MANAGE'] }, perms())).toBe(true)
  })
})

describe('landingPath (terminal type decides the landing route)', () => {
  it.each<[TerminalType, PermissionCode[], string]>([
    ['ADMIN', OWNER, '/admin'],
    ['CASHIER_POS', CASHIER, '/pos'],
    ['RECEPTION_POS', CASHIER, '/pos'],
    ['KITCHEN', KITCHEN, '/kitchen'],
    ['DISPLAY', [], '/display'],
    ['CASHIER_POS', OWNER, '/pos'],
    ['KITCHEN', OWNER, '/kitchen'],
  ])('%s terminal with %j lands on %s', (type, codes, expected) => {
    expect(landingPath(type, perms(...codes))).toBe(expected)
  })

  it('falls back to an area the user can use when the terminal area is not allowed', () => {
    expect(landingPath('ADMIN', perms(...CASHIER))).toBe('/pos')
    expect(landingPath('CASHIER_POS', perms(...KITCHEN))).toBe('/kitchen')
  })

  it('P1-RBAC-03 a user with no usable area gets the no-access page', () => {
    expect(landingPath('CASHIER_POS', perms())).toBe('/forbidden')
  })
})

describe('decideNavigation', () => {
  it('P1-AUTH-04 ADR-008: any device (registered or not) opens the login page first; setup stays reachable', () => {
    const c = ctx([], 'ADMIN', { authenticated: false, sessionType: null, terminalType: null })
    expect(decideNavigation(to('/login', { public: true }), c)).toBe(true)
    expect(decideNavigation(to('/', { landing: true }), c)).toEqual({ path: '/login' })
    expect(decideNavigation(to('/setup/terminal', { public: true }), c)).toBe(true)
    expect(decideNavigation(to('/admin/users', { anyOf: ['USER_MANAGE'] }), c)).toEqual({
      path: '/login',
      query: { redirect: '/admin/users' },
    })
  })

  it('P1-AUTH-01 a logged-out user is sent to login with a redirect back', () => {
    const c = ctx([], 'ADMIN', { authenticated: false })
    expect(decideNavigation(to('/login', { public: true }), c)).toBe(true)
    expect(decideNavigation(to('/admin/users', { anyOf: ['USER_MANAGE'] }), c)).toEqual({
      path: '/login',
      query: { redirect: '/admin/users' },
    })
    expect(decideNavigation(to('/', { landing: true }), c)).toEqual({ path: '/login' })
  })

  it('a logged-in user visiting /login or / goes to their landing area', () => {
    expect(decideNavigation(to('/login', { public: true }), ctx(CASHIER, 'CASHIER_POS'))).toEqual({
      path: '/pos',
    })
    expect(decideNavigation(to('/', { landing: true }), ctx(OWNER, 'ADMIN'))).toEqual({ path: '/admin' })
  })

  it('P1-RBAC-03 routes are guarded by permission', () => {
    const users = to('/admin/users', { anyOf: ['USER_MANAGE'] })
    expect(decideNavigation(users, ctx(OWNER))).toBe(true)
    expect(decideNavigation(users, ctx(CASHIER, 'CASHIER_POS'))).toEqual({
      path: '/forbidden',
      query: { from: '/admin/users' },
    })
    expect(decideNavigation(to('/kitchen', { anyOf: ['KDS_OPERATE', 'KDS_VIEW_ALL'] }), ctx(CASHIER))).toBe(
      true,
    )
    expect(decideNavigation(to('/pos', { anyOf: ['ORDER_VIEW'] }), ctx(KITCHEN, 'KITCHEN'))).toMatchObject({
      path: '/forbidden',
    })
  })

  it('terminal setup stays reachable when logged in (re-registering a device)', () => {
    expect(decideNavigation(to('/setup/terminal', { public: true }), ctx(CASHIER))).toBe(true)
  })
})

describe('safeRedirect', () => {
  it('only follows same-app paths', () => {
    expect(safeRedirect('/admin/users?x=1')).toBe('/admin/users?x=1')
    expect(safeRedirect('//evil.example')).toBeNull()
    expect(safeRedirect('https://evil.example')).toBeNull()
    expect(safeRedirect('/login')).toBeNull()
    expect(safeRedirect(['/admin'])).toBeNull()
  })
})

describe('parent route guards still apply to child routes (Q35)', () => {
  const parent = { meta: { anyOf: ['USER_MANAGE', 'FLOOR_MANAGE'] as PermissionCode[] } }
  const child = { meta: { anyOf: ['MENU_AVAILABILITY'] as PermissionCode[] } }
  const target = (): GuardTarget => ({
    path: '/admin/menu/availability',
    fullPath: '/admin/menu/availability',
    meta: child.meta, // vue-router's merged meta: the child's rule replaces the parent's
    matched: [parent, child],
  })

  it('P1-RBAC-03 a cashier (MENU_AVAILABILITY but no admin permission) is sent to /forbidden', () => {
    const cashier = ctx(['ORDER_VIEW', 'MENU_AVAILABILITY', 'BILL_PAY'], 'CASHIER_POS')
    expect(decideNavigation(target(), cashier)).toEqual({
      path: '/forbidden',
      query: { from: '/admin/menu/availability' },
    })
  })

  it('a manager (parent rule passes via FLOOR_MANAGE, child via MENU_AVAILABILITY) gets through', () => {
    expect(decideNavigation(target(), ctx(['FLOOR_MANAGE', 'MENU_AVAILABILITY']))).toBe(true)
  })

  it('both rules must pass: admin access without the child permission is still refused', () => {
    expect(decideNavigation(target(), ctx(['FLOOR_MANAGE']))).toMatchObject({ path: '/forbidden' })
  })
})

describe('personal sessions (ADR-008)', () => {
  const personal = (codes: PermissionCode[], over: Partial<GuardContext> = {}) =>
    ctx(codes, 'ADMIN', { sessionType: 'PERSONAL', terminalType: null, ...over })

  it('P1-AUTH-04 POS and kitchen routes need a terminal session: a personal session gets the counter-device page', () => {
    const pos: GuardTarget = {
      ...to('/pos', { anyOf: ['ORDER_VIEW'] }),
      matched: [{ meta: { anyOf: ['ORDER_VIEW'], terminalSession: true } }],
    }
    const kitchen: GuardTarget = {
      ...to('/kitchen'),
      matched: [{ meta: { anyOf: ['KDS_OPERATE'], terminalSession: true } }],
    }
    expect(decideNavigation(pos, personal(OWNER))).toEqual({
      path: '/terminal-required',
      query: { from: '/pos' },
    })
    expect(decideNavigation(kitchen, personal(OWNER))).toEqual({
      path: '/terminal-required',
      query: { from: '/kitchen' },
    })
    // The same routes in a terminal session work as before.
    expect(decideNavigation(pos, ctx(CASHIER, 'CASHIER_POS'))).toBe(true)
  })

  it('Q42 permission first: a rider (no POS permission) opening /pos in a personal session gets /forbidden', () => {
    const pos: GuardTarget = {
      ...to('/pos'),
      matched: [{ meta: { anyOf: ['ORDER_VIEW'], terminalSession: true } }],
    }
    expect(decideNavigation(pos, personal(['LOGIN_ANY_DEVICE'], { isRider: true }))).toEqual({
      path: '/forbidden',
      query: { from: '/pos' },
    })
  })

  it('admin routes work in either session', () => {
    expect(decideNavigation(to('/admin/users', { anyOf: ['USER_MANAGE'] }), personal(OWNER))).toBe(true)
  })

  it.each<[string, PermissionCode[], boolean, string]>([
    ['owner / manager (admin permission)', OWNER, false, '/admin'],
    ['manager with only FLOOR_MANAGE', ['FLOOR_MANAGE', 'LOGIN_ANY_DEVICE'], false, '/admin'],
    ['rider', ['LOGIN_ANY_DEVICE'], true, '/rider'],
    ['HR / inventory (nothing built yet)', ['LOGIN_ANY_DEVICE'], false, '/home'],
  ])('P1-AUTH-04 personal landing: %s -> %s', (_who, codes, isRider, expected) => {
    expect(landingFor({ sessionType: 'PERSONAL', isRider }, perms(...codes))).toBe(expected)
    expect(decideNavigation(to('/', { landing: true }), personal(codes, { isRider }))).toEqual({
      path: expected,
    })
  })

  it('terminal sessions still land by terminal type', () => {
    expect(landingFor({ sessionType: 'TERMINAL', terminalType: 'CASHIER_POS' }, perms(...OWNER))).toBe('/pos')
    expect(landingFor({ sessionType: 'TERMINAL', terminalType: 'KITCHEN' }, perms(...KITCHEN))).toBe(
      '/kitchen',
    )
  })
})
