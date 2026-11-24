import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import PrimeVue from 'primevue/config'
import { ApiError } from '@/api/errors'

vi.mock('@/api/auth', () => ({ authApi: { login: vi.fn(), refresh: vi.fn(), logout: vi.fn(), me: vi.fn() } }))
const { authApi } = await import('@/api/auth')
const { default: LoginView } = await import('../LoginView.vue')
const { useTerminalStore } = await import('@/stores/terminal')

const blank = { template: '<div />' }
const q = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)

function setup() {
  setActivePinia(createPinia())
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/login', '/admin', '/home', '/rider', '/pos', '/setup/terminal'].map((path) => ({
      path,
      component: blank,
    })),
  })
  return { router }
}

async function mountLogin(router: ReturnType<typeof setup>['router']) {
  await router.push('/login')
  const w = mount(LoginView, {
    attachTo: document.body,
    global: { plugins: [[PrimeVue, { unstyled: true }], router] },
  })
  await flushPromises()
  return w
}

async function submit(username: string) {
  const fields: Array<[string, string]> = [
    ['login-username', username],
    ['login-password', 'pw'],
  ]
  for (const [id, v] of fields) {
    const el = q(id) as HTMLInputElement
    el.value = v
    el.dispatchEvent(new Event('input'))
  }
  await flushPromises()
  q('login-submit')!.click()
  await flushPromises()
}

const user = { id: 'u', username: 'x', fullName: 'X', roles: [], pinSet: true }
const base = { accessToken: 'a', expiresIn: 900, refreshToken: 'r', refreshExpiresIn: 43200, user }

// Braces matter: a hook that returns a function makes Vitest call it as a teardown.
beforeEach(() => {
  vi.mocked(authApi.login).mockReset()
})

describe('LoginView (ADR-008: first screen on every device)', () => {
  it('P1-AUTH-04 an unregistered device shows "Personal device" and the "Set up this device" link', async () => {
    const { router } = setup()
    const w = await mountLogin(router)
    expect(q('login-device')?.textContent).toBe('Personal device')
    expect(q('link-terminal-setup')?.textContent?.trim()).toBe('Set up this device')
    w.unmount()
  })

  it('a registered device shows its terminal name and still offers the setup link', async () => {
    const { router } = setup()
    useTerminalStore().adopt({
      terminalId: 't1',
      deviceToken: 'd',
      terminal: { id: 't1', name: 'Cashier counter', type: 'CASHIER_POS', active: true },
      registeredAt: 'x',
    })
    const w = await mountLogin(router)
    expect(q('login-device')?.textContent).toBe('Cashier counter')
    expect(q('link-terminal-setup')).not.toBeNull()
    w.unmount()
  })

  it('P1-AUTH-04 TERMINAL_REQUIRED_FOR_USER shows the counter-device message', async () => {
    // mockImplementation, not mockRejectedValue: the rejection must not exist before the login call.
    vi.mocked(authApi.login).mockImplementation(async () => {
      throw new ApiError({
        status: 403,
        code: 'TERMINAL_REQUIRED_FOR_USER',
        title: 'x',
        detail: 'server text',
      })
    })
    const { router } = setup()
    const w = await mountLogin(router)
    await submit('cashier1')
    expect(q('login-error')?.textContent?.trim()).toBe(
      'This account can only sign in on a registered counter or kitchen device.',
    )
    w.unmount()
  })

  it.each([
    ['owner (admin permission)', ['USER_MANAGE', 'LOGIN_ANY_DEVICE'], [], '/admin'],
    ['rider', ['LOGIN_ANY_DEVICE'], [{ id: 'r', name: 'Rider', system: true, key: 'RIDER' }], '/rider'],
    ['HR', ['LOGIN_ANY_DEVICE'], [{ id: 'h', name: 'HR', system: true, key: 'HR' }], '/home'],
  ] as const)('P1-AUTH-04 a personal login as %s lands on %s', async (_who, permissions, roles, expected) => {
    vi.mocked(authApi.login).mockResolvedValue({
      ...base,
      user: { ...user, roles: [...roles] },
      permissions: [...permissions],
      sessionType: 'PERSONAL',
      idleTimeoutMinutes: 30,
    })
    const { router } = setup()
    const w = await mountLogin(router)
    await submit('someone')
    expect(authApi.login).toHaveBeenCalledWith(null, { username: 'someone', password: 'pw' })
    expect(router.currentRoute.value.path).toBe(expected)
    w.unmount()
  })
})
