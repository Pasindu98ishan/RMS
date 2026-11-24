/**
 * UI side of the permission matrix (P1-RBAC-03 "UI hiding is not enough" — but the UI must still
 * hide/guard). Routes and their required permission come from docs/ui/screens.md; where the doc
 * names no permission the mapping is a QA assumption, flagged `assumed: true` (test-plan Q14).
 */
import { type PermissionExpr, decide } from './permission-matrix';
import { type RoleKey, SEEDED_ROLES } from './role-grants';

export interface RouteRule {
  route: string;
  screen: string;
  milestone: 'M1.0' | 'M1.1' | 'M1.2' | 'M1.3' | 'M1.4' | 'M1.5';
  permission: PermissionExpr;
  requirements: string[];
  assumed: boolean;
  /** The parent layout's guard that must ALSO pass (e.g. /admin needs the admin area). */
  parent?: PermissionExpr;
}

const code = (c: string): PermissionExpr => ({ kind: 'anyOf', codes: [c] });
const anyOf = (...codes: string[]): PermissionExpr => ({ kind: 'anyOf', codes });

const ADMIN_AREA: PermissionExpr = anyOf('USER_MANAGE', 'ROLE_MANAGE', 'TERMINAL_MANAGE', 'SETTINGS_MANAGE', 'AUDIT_VIEW', 'MENU_MANAGE', 'FLOOR_MANAGE', 'SHIFT_APPROVE', 'REPORT_POS_ALL');

export const ROUTE_RULES: RouteRule[] = [
  { route: '/login', screen: 'Login', milestone: 'M1.0', permission: { kind: 'public' }, requirements: ['P1-AUTH-01'], assumed: false },
  // The screen itself is open to anyone: it authenticates with the owner's credentials inline (registerTerminal), so
  // the permission is enforced by the API, not the route. (screens.md lists "Owner" as the user, not a route guard.)
  { route: '/setup/terminal', screen: 'Terminal setup', milestone: 'M1.0', permission: { kind: 'public' }, requirements: ['P1-AUTH-04'], assumed: true },
  { route: '/admin/users', screen: 'Users', milestone: 'M1.0', permission: code('USER_MANAGE'), requirements: ['P1-RBAC-02'], assumed: false },
  { route: '/admin/roles', screen: 'Roles & permissions', milestone: 'M1.0', permission: code('ROLE_MANAGE'), requirements: ['P1-RBAC-02'], assumed: false },
  { route: '/admin/terminals', screen: 'Terminals', milestone: 'M1.0', permission: code('TERMINAL_MANAGE'), requirements: ['P1-AUTH-04'], assumed: false },
  { route: '/admin/settings', screen: 'Settings', milestone: 'M1.0', permission: code('SETTINGS_MANAGE'), requirements: ['P1-SET-01', 'P1-SET-02', 'P1-SET-03', 'P1-SET-04'], assumed: false },
  { route: '/admin/audit', screen: 'Audit log', milestone: 'M1.0', permission: code('AUDIT_VIEW'), requirements: ['P1-AUD-03'], assumed: false },
  {
    route: '/admin',
    screen: 'Admin home',
    milestone: 'M1.0',
    permission: anyOf('USER_MANAGE', 'ROLE_MANAGE', 'TERMINAL_MANAGE', 'SETTINGS_MANAGE', 'AUDIT_VIEW', 'MENU_MANAGE', 'FLOOR_MANAGE', 'SHIFT_APPROVE', 'REPORT_POS_ALL'),
    requirements: ['P1-RBAC-03'],
    assumed: true,
  },
  { route: '/pos', screen: 'POS home', milestone: 'M1.0', permission: code('ORDER_VIEW'), requirements: ['P1-RBAC-03'], assumed: true },
  { route: '/kitchen', screen: 'KDS board', milestone: 'M1.0', permission: anyOf('KDS_OPERATE', 'KDS_VIEW_ALL'), requirements: ['P1-RBAC-03', 'P1-RBAC-04'], assumed: true },
  // ---- M1.1 (frontend/src/router/index.ts)
  { route: '/admin/menu/items', screen: 'Menu items', milestone: 'M1.1', permission: code('MENU_MANAGE'), requirements: ['P1-MENU-02'], assumed: false },
  { route: '/admin/menu/categories', screen: 'Categories', milestone: 'M1.1', permission: code('MENU_MANAGE'), requirements: ['P1-MENU-01'], assumed: false },
  { route: '/admin/menu/modifiers', screen: 'Modifiers', milestone: 'M1.1', permission: code('MENU_MANAGE'), requirements: ['P1-MENU-03'], assumed: false },
  { route: '/admin/kitchens', screen: 'Kitchens', milestone: 'M1.1', permission: code('MENU_MANAGE'), requirements: ['P1-MENU-07', 'P1-SET-05'], assumed: false },
  { route: '/admin/menu/availability', screen: 'Sold out (admin)', milestone: 'M1.1', permission: code('MENU_AVAILABILITY'), requirements: ['P1-MENU-06'], assumed: true, parent: ADMIN_AREA },
  { route: '/admin/floor', screen: 'Floor plan', milestone: 'M1.1', permission: code('FLOOR_MANAGE'), requirements: ['P1-FLOOR-01'], assumed: false },
  { route: '/admin/delivery-areas', screen: 'Delivery areas', milestone: 'M1.1', permission: code('SETTINGS_MANAGE'), requirements: ['P1-SET-07'], assumed: false },
  { route: '/admin/reasons', screen: 'Reasons', milestone: 'M1.1', permission: code('SETTINGS_MANAGE'), requirements: ['P1-SET-08'], assumed: false },
  { route: '/admin/import', screen: 'Import', milestone: 'M1.1', permission: code('DATA_IMPORT'), requirements: ['P1-IMP-01'], assumed: false },
  { route: '/pos/availability', screen: 'Sold out (POS)', milestone: 'M1.1', permission: code('MENU_AVAILABILITY'), requirements: ['P1-MENU-06'], assumed: true },
];

export interface RouteCase {
  title: string;
  route: string;
  role: RoleKey;
  expectation: 'reachable' | 'blocked';
  assumed: boolean;
}

/** One case per route × role: reachable when the role's default grants satisfy the route. */
export function buildRouteCases(rules: RouteRule[] = ROUTE_RULES, roles: readonly RoleKey[] = SEEDED_ROLES): RouteCase[] {
  const out: RouteCase[] = [];
  for (const rule of rules) {
    for (const role of roles) {
      const d = decide({ permission: rule.permission, method: 'get' }, role);
      const parentOk = rule.parent ? decide({ permission: rule.parent, method: 'get' }, role).expectation !== 'deny' : true;
      const reachable = d.expectation !== 'deny' && parentOk;
      out.push({
        title: `P1-RBAC-03 UI [${role}] ${rule.route} (${rule.screen}) -> ${reachable ? 'reachable' : 'blocked'}${rule.assumed ? ' (assumed mapping)' : ''}`,
        route: rule.route,
        role,
        expectation: reachable ? 'reachable' : 'blocked',
        assumed: rule.assumed,
      });
    }
  }
  return out;
}
