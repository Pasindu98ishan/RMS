import { describe, expect, it } from 'vitest'
import { routes, router } from '../index'
import { decideNavigation } from '../guard'
import { canAccess } from '../access'
import type { PermissionCode } from '@/api/types'

/** M1.1 admin routes and the permission each needs (permissions matrix / m1.1-scope.md). */
const EXPECTED: Array<[path: string, permission: PermissionCode]> = [
  ['menu/items', 'MENU_MANAGE'],
  ['menu/categories', 'MENU_MANAGE'],
  ['menu/modifiers', 'MENU_MANAGE'],
  ['kitchens', 'MENU_MANAGE'],
  ['menu/availability', 'MENU_AVAILABILITY'],
  ['floor', 'FLOOR_MANAGE'],
  ['delivery-areas', 'SETTINGS_MANAGE'],
  ['reasons', 'SETTINGS_MANAGE'],
  ['import', 'DATA_IMPORT'],
]

const admin = routes.find((r) => r.path === '/admin')
const child = (path: string) => admin?.children?.find((c) => c.path === path)

describe('M1.1 route permissions', () => {
  it.each(EXPECTED)('P1-RBAC-03 /admin/%s needs %s', (path, permission) => {
    const meta = child(path)?.meta
    expect(meta?.anyOf).toEqual([permission])
    expect(canAccess(meta ?? {}, (c) => c === permission)).toBe(true)
    expect(canAccess(meta ?? {}, () => false)).toBe(false)
  })

  it('every M1.1 admin screen is in the side menu', () => {
    for (const [path] of EXPECTED) expect(child(path)?.meta?.nav?.label, path).toBeTruthy()
  })

  it('P1-MENU-06 a cashier holding only MENU_AVAILABILITY reaches the sold-out board on the POS, not the item editor', () => {
    const pos = routes.find((r) => r.path === '/pos')
    const board = pos?.children?.find((c) => c.path === 'availability')?.meta
    const has = (c: PermissionCode) => ['ORDER_VIEW', 'MENU_AVAILABILITY'].includes(c)
    expect(canAccess(board ?? {}, has)).toBe(true)
    expect(canAccess(child('menu/items')?.meta ?? {}, has)).toBe(false)
  })

  it('P1-RBAC-03 Q35: the real router resolves /admin/menu/availability to the admin shell AND the child, and a cashier is refused', () => {
    const to = router.resolve('/admin/menu/availability')
    expect(to.matched.map((m) => m.path)).toEqual(['/admin', '/admin/menu/availability'])
    const guard = (perms: PermissionCode[]) =>
      decideNavigation(to, {
        authenticated: true,
        sessionType: 'TERMINAL',
        terminalType: 'CASHIER_POS',
        has: (c) => perms.includes(c),
      })
    expect(guard(['ORDER_VIEW', 'MENU_AVAILABILITY'])).toMatchObject({ path: '/forbidden' })
    expect(guard(['FLOOR_MANAGE', 'MENU_AVAILABILITY'])).toBe(true)
    // The POS copy of the board stays open to the cashier.
    const pos = router.resolve('/pos/availability')
    expect(
      decideNavigation(pos, {
        authenticated: true,
        sessionType: 'TERMINAL',
        terminalType: 'CASHIER_POS',
        has: (c) => ['ORDER_VIEW', 'MENU_AVAILABILITY'].includes(c),
      }),
    ).toBe(true)
  })

  it('P1-AUTH-04 ADR-008: /pos and /kitchen are marked terminal-session only; /home and /terminal-required exist', () => {
    expect(routes.find((r) => r.path === '/pos')?.meta?.terminalSession).toBe(true)
    expect(routes.find((r) => r.path === '/kitchen')?.meta?.terminalSession).toBe(true)
    expect(routes.find((r) => r.path === '/admin')?.meta?.terminalSession).toBeFalsy()
    expect(router.resolve('/home').name).toBe('home')
    expect(router.resolve('/terminal-required').name).toBe('terminal-required')
    const toPos = router.resolve('/pos/availability')
    expect(
      decideNavigation(toPos, {
        authenticated: true,
        sessionType: 'PERSONAL',
        terminalType: null,
        has: () => true,
      }),
    ).toEqual({ path: '/terminal-required', query: { from: '/pos/availability' } })
  })
})
