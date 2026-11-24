import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AuthSession } from '@/api/types'
import { ApiError } from '@/api/errors'

vi.mock('@/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    changeOwnPassword: vi.fn(),
    setOwnPin: vi.fn(),
  },
}))

const { authApi } = await import('@/api/auth')
const { useAuthStore } = await import('../auth')
const { useTerminalStore } = await import('../terminal')

const terminal = { id: 'term-1', name: 'Cashier counter', type: 'CASHIER_POS' as const, active: true }

function session(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: 'at-1',
    expiresIn: 900,
    refreshToken: 'rt-1',
    refreshExpiresIn: 43200,
    user: { id: 'u1', username: 'cashier1', fullName: 'Nimal Perera', roles: [], pinSet: true },
    permissions: ['ORDER_VIEW', 'BILL_PAY'],
    sessionType: 'TERMINAL',
    terminal,
    idleTimeoutMinutes: 10,
    ...overrides,
  }
}

function register() {
  useTerminalStore().adopt({ terminalId: 'term-1', deviceToken: 'dev-token', terminal, registeredAt: 'x' })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(authApi.login).mockReset()
  vi.mocked(authApi.refresh).mockReset()
  vi.mocked(authApi.logout).mockReset()
  vi.mocked(authApi.me).mockReset()
})

describe('auth store', () => {
  it('P1-AUTH-01 login sends terminal id + device token and stores the session', async () => {
    register()
    vi.mocked(authApi.login).mockResolvedValue(session())
    const auth = useAuthStore()
    await auth.login('cashier1', 'secret')

    expect(authApi.login).toHaveBeenCalledWith(
      { terminalId: 'term-1', deviceToken: 'dev-token' },
      { username: 'cashier1', password: 'secret' },
    )
    expect(auth.sessionType).toBe('TERMINAL')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.has('BILL_PAY')).toBe(true)
    expect(auth.has('USER_MANAGE')).toBe(false)
    expect(auth.hasAny(['USER_MANAGE', 'ORDER_VIEW'])).toBe(true)
    expect(auth.idleTimeoutMinutes).toBe(10)
    expect(JSON.parse(localStorage.getItem('rms.session') ?? '{}')).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      sessionType: 'TERMINAL',
    })
  })

  it('P1-AUTH-03 KITCHEN sessions have no idle timeout', async () => {
    register()
    const s = session({ terminal: { ...terminal, type: 'KITCHEN' } })
    delete s.idleTimeoutMinutes
    vi.mocked(authApi.login).mockResolvedValue(s)
    const auth = useAuthStore()
    await auth.login('kitchen1', 'secret')
    expect(auth.idleTimeoutMinutes).toBeNull()
  })

  it('P1-AUTH-04 ADR-008 an unregistered device logs in as a personal session (no terminal id, no device token)', async () => {
    vi.mocked(authApi.login).mockResolvedValue(
      session({
        sessionType: 'PERSONAL',
        terminal: undefined,
        idleTimeoutMinutes: 30,
        permissions: ['USER_MANAGE'],
      }),
    )
    const auth = useAuthStore()
    await auth.login('owner1', 'secret')
    expect(authApi.login).toHaveBeenCalledWith(null, { username: 'owner1', password: 'secret' })
    expect(auth.sessionType).toBe('PERSONAL')
    expect(auth.isPersonal).toBe(true)
    expect(auth.terminal).toBeNull()
    // ADR-008 #6: the personal idle timeout comes from the session.
    expect(auth.idleTimeoutMinutes).toBe(30)
  })

  it('P1-AUTH-04 ADR-008 a refused personal login (TERMINAL_REQUIRED_FOR_USER) shows the fixed message', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError({ status: 403, code: 'TERMINAL_REQUIRED_FOR_USER', title: 'x', detail: 'server text' }),
    )
    const auth = useAuthStore()
    const err = await auth.login('cashier1', 'secret').catch((e: unknown) => e)
    expect((err as ApiError).userMessage).toBe(
      'This account can only sign in on a registered counter or kitchen device.',
    )
    expect(auth.isAuthenticated).toBe(false)
  })

  it('P1-AUTH-02 ADR-008 a personal session refreshes without X-Terminal-Id even on a registered browser', async () => {
    vi.mocked(authApi.login).mockResolvedValue(session({ sessionType: 'PERSONAL', terminal: undefined }))
    vi.mocked(authApi.refresh).mockResolvedValue(
      session({ sessionType: 'PERSONAL', terminal: undefined, accessToken: 'at-2', refreshToken: 'rt-2' }),
    )
    const auth = useAuthStore()
    await auth.login('owner1', 'secret')
    register() // registered afterwards: the session stays personal
    expect(await auth.refresh()).toBe(true)
    expect(authApi.refresh).toHaveBeenCalledWith(null, 'rt-1')
  })

  it('P1-AUTH-02 ADR-008 a personal session whose user lost LOGIN_ANY_DEVICE ends with that reason', async () => {
    vi.mocked(authApi.login).mockResolvedValue(session({ sessionType: 'PERSONAL', terminal: undefined }))
    vi.mocked(authApi.refresh).mockRejectedValue(
      new ApiError({ status: 403, code: 'TERMINAL_REQUIRED_FOR_USER', title: 'x' }),
    )
    const auth = useAuthStore()
    await auth.login('hr1', 'secret')
    expect(await auth.refresh()).toBe(false)
    auth.sessionExpired()
    expect(auth.endedReason).toBe('TERMINAL_REQUIRED_FOR_USER')
  })

  it('restores a stored personal session without a terminal registration', async () => {
    localStorage.setItem(
      'rms.session',
      JSON.stringify({ accessToken: 'a', refreshToken: 'r', sessionType: 'PERSONAL' }),
    )
    vi.mocked(authApi.me).mockResolvedValue({
      user: session().user,
      permissions: ['AUDIT_VIEW'],
      sessionType: 'PERSONAL',
      idleTimeoutMinutes: 30,
    })
    const auth = useAuthStore()
    await auth.init()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isPersonal).toBe(true)
  })

  it('P1-AUTH-04 a deactivated terminal at login is flagged for setup', async () => {
    register()
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError({
        status: 403,
        code: 'TERMINAL_INACTIVE',
        title: 'x',
        detail: 'This terminal has been deactivated.',
      }),
    )
    const auth = useAuthStore()
    await expect(auth.login('a', 'b')).rejects.toBeInstanceOf(ApiError)
    expect(useTerminalStore().problem).toBe('This terminal has been deactivated.')
    expect(auth.isAuthenticated).toBe(false)
  })

  it('P1-AUTH-02 refresh rotates both tokens and re-reads permissions', async () => {
    register()
    vi.mocked(authApi.login).mockResolvedValue(session())
    vi.mocked(authApi.refresh).mockResolvedValue(
      session({ accessToken: 'at-2', refreshToken: 'rt-2', permissions: ['ORDER_VIEW', 'USER_MANAGE'] }),
    )
    const auth = useAuthStore()
    await auth.login('cashier1', 'secret')
    expect(await auth.refresh()).toBe(true)
    // A terminal session sends its terminal id on refresh.
    expect(authApi.refresh).toHaveBeenCalledWith('term-1', 'rt-1')
    expect(auth.has('USER_MANAGE')).toBe(true)
    expect(JSON.parse(localStorage.getItem('rms.session') ?? '{}').refreshToken).toBe('rt-2')
  })

  it('P1-AUTH-02 a rejected refresh reports false', async () => {
    register()
    vi.mocked(authApi.login).mockResolvedValue(session())
    vi.mocked(authApi.refresh).mockRejectedValue(
      new ApiError({ status: 401, code: 'REFRESH_TOKEN_INVALID', title: 'x' }),
    )
    const auth = useAuthStore()
    await auth.login('cashier1', 'secret')
    expect(await auth.refresh()).toBe(false)
  })

  it('P1-AUTH-03 idle logout sends reason IDLE_TIMEOUT and clears the session', async () => {
    register()
    vi.mocked(authApi.login).mockResolvedValue(session())
    vi.mocked(authApi.logout).mockResolvedValue()
    const auth = useAuthStore()
    await auth.login('cashier1', 'secret')
    await auth.logout('IDLE_TIMEOUT')
    expect(authApi.logout).toHaveBeenCalledWith('rt-1', 'IDLE_TIMEOUT')
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.endedReason).toBe('IDLE_TIMEOUT')
    expect(localStorage.getItem('rms.session')).toBeNull()
  })

  it('P1-AUTH-02 logout clears locally even when the server call fails', async () => {
    register()
    vi.mocked(authApi.login).mockResolvedValue(session())
    vi.mocked(authApi.logout).mockRejectedValue(new Error('offline'))
    const auth = useAuthStore()
    await auth.login('cashier1', 'secret')
    await auth.logout()
    expect(authApi.logout).toHaveBeenCalledWith('rt-1', 'USER')
    expect(auth.status).toBe('anonymous')
  })

  it('restores a stored session after reload via GET /auth/me', async () => {
    register()
    localStorage.setItem('rms.session', JSON.stringify({ accessToken: 'at-9', refreshToken: 'rt-9' }))
    vi.mocked(authApi.me).mockResolvedValue({
      user: session().user,
      permissions: ['AUDIT_VIEW'],
      sessionType: 'TERMINAL',
      terminal,
      idleTimeoutMinutes: 30,
    })
    const auth = useAuthStore()
    await auth.init()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.has('AUDIT_VIEW')).toBe(true)
    expect(auth.idleTimeoutMinutes).toBe(30)
  })

  it('a stored session that the server rejects ends anonymous', async () => {
    register()
    localStorage.setItem('rms.session', JSON.stringify({ accessToken: 'x', refreshToken: 'y' }))
    vi.mocked(authApi.me).mockRejectedValue(
      new ApiError({ status: 401, code: 'UNAUTHENTICATED', title: 'x' }),
    )
    const auth = useAuthStore()
    await auth.init()
    expect(auth.status).toBe('anonymous')
    expect(localStorage.getItem('rms.session')).toBeNull()
  })

  it('session expiry from the client clears the session and remembers why', async () => {
    register()
    vi.mocked(authApi.login).mockResolvedValue(session())
    const auth = useAuthStore()
    await auth.login('cashier1', 'secret')
    auth.sessionExpired()
    expect(auth.status).toBe('anonymous')
    expect(auth.endedReason).toBe('EXPIRED')
  })
})
