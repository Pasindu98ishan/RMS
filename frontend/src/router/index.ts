import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import type { PermissionCode } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { ADMIN_AREA, DISPLAY_AREA, KITCHEN_AREA, POS_AREA, type AccessMeta } from './access'
import { decideNavigation } from './guard'

declare module 'vue-router' {
  interface RouteMeta extends AccessMeta {
    /** "/" - redirected to the terminal's landing area by the guard. */
    landing?: boolean
    title?: string
    /** Shown in the admin side menu. */
    nav?: { label: string; icon: string; group?: string }
  }
}

const only = (...codes: PermissionCode[]) => codes

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'landing',
    component: () => import('@/modules/auth/LandingView.vue'),
    meta: { landing: true },
  },
  {
    path: '/setup/terminal',
    name: 'terminal-setup',
    component: () => import('@/modules/auth/TerminalSetupView.vue'),
    meta: { public: true, title: 'Terminal setup' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/modules/auth/LoginView.vue'),
    meta: { public: true, title: 'Log in' },
  },
  {
    // Personal-session home for users with no admin or rider screens (ADR-008).
    path: '/home',
    name: 'home',
    component: () => import('@/modules/auth/HomeView.vue'),
    meta: { title: 'Home' },
  },
  {
    // A POS / kitchen route opened in a personal session.
    path: '/terminal-required',
    name: 'terminal-required',
    component: () => import('@/modules/auth/TerminalRequiredView.vue'),
    meta: { title: 'Use a counter device' },
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/modules/auth/ForbiddenView.vue'),
    meta: { title: 'No access' },
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { anyOf: ADMIN_AREA },
    children: [
      {
        path: '',
        name: 'admin-home',
        component: () => import('@/modules/admin/AdminHomeView.vue'),
        meta: { anyOf: ADMIN_AREA, title: 'Home', nav: { label: 'Home', icon: 'pi pi-home' } },
      },
      {
        path: 'menu/items',
        name: 'admin-menu-items',
        component: () => import('@/modules/admin/menu/ItemsView.vue'),
        meta: {
          anyOf: only('MENU_MANAGE'),
          title: 'Menu items',
          nav: { label: 'Menu items', icon: 'pi pi-book', group: 'Menu' },
        },
      },
      {
        path: 'menu/categories',
        name: 'admin-menu-categories',
        component: () => import('@/modules/admin/menu/CategoriesView.vue'),
        meta: {
          anyOf: only('MENU_MANAGE'),
          title: 'Categories',
          nav: { label: 'Categories', icon: 'pi pi-tags', group: 'Menu' },
        },
      },
      {
        path: 'menu/modifiers',
        name: 'admin-menu-modifiers',
        component: () => import('@/modules/admin/menu/ModifiersView.vue'),
        meta: {
          anyOf: only('MENU_MANAGE'),
          title: 'Modifier groups',
          nav: { label: 'Modifiers', icon: 'pi pi-sliders-h', group: 'Menu' },
        },
      },
      {
        path: 'menu/availability',
        name: 'admin-menu-availability',
        component: () => import('@/modules/admin/menu/AvailabilityView.vue'),
        meta: {
          anyOf: only('MENU_AVAILABILITY'),
          title: 'Sold out today',
          nav: { label: 'Sold out', icon: 'pi pi-ban', group: 'Menu' },
        },
      },
      {
        path: 'kitchens',
        name: 'admin-kitchens',
        component: () => import('@/modules/admin/menu/KitchensView.vue'),
        meta: {
          anyOf: only('MENU_MANAGE'),
          title: 'Kitchen stations',
          nav: { label: 'Kitchens', icon: 'pi pi-th-large', group: 'Menu' },
        },
      },
      {
        path: 'floor',
        name: 'admin-floor',
        component: () => import('@/modules/admin/floor/FloorView.vue'),
        meta: {
          anyOf: only('FLOOR_MANAGE'),
          title: 'Floor plan',
          nav: { label: 'Floor plan', icon: 'pi pi-objects-column', group: 'Floor and delivery' },
        },
      },
      {
        path: 'delivery-areas',
        name: 'admin-delivery-areas',
        component: () => import('@/modules/admin/delivery/DeliveryAreasView.vue'),
        meta: {
          anyOf: only('SETTINGS_MANAGE'),
          title: 'Delivery areas',
          nav: { label: 'Delivery areas', icon: 'pi pi-map-marker', group: 'Floor and delivery' },
        },
      },
      {
        path: 'reasons',
        name: 'admin-reasons',
        component: () => import('@/modules/admin/reasons/ReasonsView.vue'),
        meta: {
          anyOf: only('SETTINGS_MANAGE'),
          title: 'Reason lists',
          nav: { label: 'Reasons', icon: 'pi pi-list', group: 'Floor and delivery' },
        },
      },
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('@/modules/admin/users/UsersView.vue'),
        meta: {
          anyOf: only('USER_MANAGE'),
          title: 'Users',
          nav: { label: 'Users', icon: 'pi pi-users', group: 'Access' },
        },
      },
      {
        path: 'roles',
        name: 'admin-roles',
        component: () => import('@/modules/admin/roles/RolesView.vue'),
        meta: {
          anyOf: only('ROLE_MANAGE'),
          title: 'Roles & permissions',
          nav: { label: 'Roles', icon: 'pi pi-shield', group: 'Access' },
        },
      },
      {
        path: 'terminals',
        name: 'admin-terminals',
        component: () => import('@/modules/admin/terminals/TerminalsView.vue'),
        meta: {
          anyOf: only('TERMINAL_MANAGE'),
          title: 'Terminals',
          nav: { label: 'Terminals', icon: 'pi pi-desktop', group: 'System' },
        },
      },
      {
        path: 'settings',
        name: 'admin-settings',
        component: () => import('@/modules/admin/settings/SettingsView.vue'),
        meta: {
          anyOf: only('SETTINGS_MANAGE'),
          title: 'Settings',
          nav: { label: 'Settings', icon: 'pi pi-cog', group: 'System' },
        },
      },
      {
        path: 'audit',
        name: 'admin-audit',
        component: () => import('@/modules/admin/audit/AuditView.vue'),
        meta: {
          anyOf: only('AUDIT_VIEW'),
          title: 'Audit log',
          nav: { label: 'Audit log', icon: 'pi pi-history', group: 'System' },
        },
      },
      {
        path: 'import',
        name: 'admin-import',
        component: () => import('@/modules/admin/import/ImportView.vue'),
        meta: {
          anyOf: only('DATA_IMPORT'),
          title: 'Import',
          nav: { label: 'Import', icon: 'pi pi-upload', group: 'System' },
        },
      },
    ],
  },
  {
    path: '/pos',
    component: () => import('@/layouts/PosLayout.vue'),
    meta: { anyOf: POS_AREA, terminalSession: true },
    children: [
      {
        path: '',
        name: 'pos-home',
        component: () => import('@/modules/pos/PosHomeView.vue'),
        meta: { anyOf: POS_AREA, title: 'POS' },
      },
      {
        path: 'availability',
        name: 'pos-availability',
        component: () => import('@/modules/admin/menu/AvailabilityView.vue'),
        meta: { anyOf: only('MENU_AVAILABILITY'), title: 'Sold out today' },
      },
    ],
  },
  {
    path: '/kitchen',
    component: () => import('@/layouts/KitchenLayout.vue'),
    meta: { anyOf: KITCHEN_AREA, terminalSession: true },
    children: [
      {
        path: '',
        name: 'kitchen-board',
        component: () => import('@/modules/kitchen/KitchenBoardView.vue'),
        meta: { anyOf: KITCHEN_AREA, title: 'Kitchen' },
      },
    ],
  },
  {
    path: '/display',
    component: () => import('@/layouts/DisplayLayout.vue'),
    meta: { anyOf: DISPLAY_AREA },
    children: [
      {
        path: '',
        name: 'display-home',
        component: () => import('@/modules/display/DisplayView.vue'),
        meta: { anyOf: DISPLAY_AREA, title: 'Display' },
      },
    ],
  },
  {
    // Phase 4 rider PWA. Stub only; RIDER_APP is added to the contract when it is built.
    path: '/rider',
    component: () => import('@/layouts/RiderLayout.vue'),
    children: [
      {
        path: '',
        name: 'rider-home',
        component: () => import('@/modules/rider/RiderHomeView.vue'),
        meta: { title: 'Rider' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/modules/auth/NotFoundView.vue'),
    meta: { public: true, title: 'Not found' },
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.init()
  const result = decideNavigation(to, {
    authenticated: auth.isAuthenticated,
    sessionType: auth.sessionType,
    terminalType: auth.terminal?.type ?? null,
    isRider: auth.isRider,
    has: auth.has,
  })
  return result
})

router.afterEach((to) => {
  const title = to.meta.title
  document.title = title ? `${title} - RMS` : 'RMS - Santhula Hotel'
})
