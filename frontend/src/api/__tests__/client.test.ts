import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createApiClient, type AuthHooks } from '../client'
import { ApiError, detailStatesWait, parseRetryAfter } from '../errors'

const BASE = 'http://rms.test/api/v1'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const problem = (status: number, code: string, detail: string, extra: object = {}) =>
  HttpResponse.json(
    { type: `https://rms/errors/${code}`, title: 'T', status, code, detail, traceId: 'abc', ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )

const roles = [{ id: 'r1', name: 'Owner', system: true, permissionCount: 37, userCount: 1 }]

type TestHooks = AuthHooks & {
  token: string
  refresh: ReturnType<typeof vi.fn>
  onSessionExpired: ReturnType<typeof vi.fn>
}

function hooks(overrides: Partial<TestHooks> = {}): TestHooks {
  const state: TestHooks = {
    token: 'old-token',
    getAccessToken: () => state.token,
    getTerminalId: () => 'term-1',
    canRefresh: () => true,
    refresh: vi.fn(async () => {
      state.token = 'new-token'
      return true
    }),
    onSessionExpired: vi.fn(),
    ...overrides,
  }
  return state
}

describe('api client middleware', () => {
  it('P1-AUTH-02 sends the bearer token and X-Terminal-Id on authenticated calls', async () => {
    let seen: Headers | undefined
    server.use(
      http.get(`${BASE}/roles`, ({ request }) => {
        seen = request.headers
        return HttpResponse.json(roles)
      }),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const { data } = await api.GET('/roles')
    expect(data).toEqual(roles)
    expect(seen?.get('authorization')).toBe('Bearer old-token')
    expect(seen?.get('x-terminal-id')).toBe('term-1')
  })

  it('P1-AUTH-04 ADR-008 sends no X-Terminal-Id in a personal session, not even on the retry after a refresh', async () => {
    const seen: Array<string | null> = []
    server.use(
      http.get(`${BASE}/roles`, ({ request }) => {
        seen.push(request.headers.get('x-terminal-id'))
        return request.headers.get('authorization') === 'Bearer new-token'
          ? HttpResponse.json(roles)
          : problem(401, 'TOKEN_EXPIRED', 'expired')
      }),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks({ getTerminalId: () => null }) })
    const { data } = await api.GET('/roles')
    expect(data).toEqual(roles)
    expect(seen).toEqual([null, null])
  })

  it('P1-AUTH-04 sends no bearer token on security: [] operations (login)', async () => {
    let seen: Headers | undefined
    server.use(
      http.post(`${BASE}/auth/login`, ({ request }) => {
        seen = request.headers
        return problem(401, 'INVALID_CREDENTIALS', 'Wrong username or password.')
      }),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    await expect(
      api.POST('/auth/login', {
        params: { header: { 'X-Terminal-Id': 'term-1' } },
        body: { username: 'a', password: 'b', deviceToken: 'c' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 })
    expect(seen?.get('authorization')).toBeNull()
    expect(seen?.get('x-terminal-id')).toBe('term-1')
  })

  it('P1-AUTH-02 refreshes once on 401 and retries the original request with the new token', async () => {
    const auths: string[] = []
    server.use(
      http.get(`${BASE}/roles`, ({ request }) => {
        const auth = request.headers.get('authorization') ?? ''
        auths.push(auth)
        return auth === 'Bearer new-token'
          ? HttpResponse.json(roles)
          : problem(401, 'TOKEN_EXPIRED', 'Your session has expired.')
      }),
    )
    const h = hooks()
    const api = createApiClient({ baseUrl: BASE, hooks: h })
    const { data } = await api.GET('/roles')
    expect(data).toEqual(roles)
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(auths).toEqual(['Bearer old-token', 'Bearer new-token'])
    expect(h.onSessionExpired).not.toHaveBeenCalled()
  })

  it('P1-AUTH-02 retries a request with a body (PUT) after refresh, body intact', async () => {
    const bodies: unknown[] = []
    server.use(
      http.put(`${BASE}/settings/business-day`, async ({ request }) => {
        bodies.push(await request.json())
        if (request.headers.get('authorization') !== 'Bearer new-token')
          return problem(401, 'TOKEN_EXPIRED', 'x')
        return HttpResponse.json({
          dayStartTime: '05:00',
          timeZone: 'Asia/Colombo',
          version: 2,
          updatedAt: 'x',
        })
      }),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const { data } = await api.PUT('/settings/business-day', { body: { dayStartTime: '05:00', version: 1 } })
    expect(data?.version).toBe(2)
    expect(bodies).toEqual([
      { dayStartTime: '05:00', version: 1 },
      { dayStartTime: '05:00', version: 1 },
    ])
  })

  it('P1-AUTH-02 parallel 401s share a single in-flight refresh', async () => {
    server.use(
      http.get(`${BASE}/roles`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer new-token'
          ? HttpResponse.json(roles)
          : problem(401, 'TOKEN_EXPIRED', 'expired'),
      ),
      http.get(`${BASE}/permissions`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer new-token'
          ? HttpResponse.json([])
          : problem(401, 'TOKEN_EXPIRED', 'expired'),
      ),
    )
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const h = hooks()
    h.refresh = vi.fn(async () => {
      await gate
      h.token = 'new-token'
      return true
    })
    const api = createApiClient({ baseUrl: BASE, hooks: h })
    const all = Promise.all([api.GET('/roles'), api.GET('/permissions'), api.GET('/roles')])
    await new Promise((r) => setTimeout(r, 30))
    release()
    const results = await all
    expect(results.map((r) => r.response.status)).toEqual([200, 200, 200])
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('P1-AUTH-02 a failed refresh ends the session and rejects with the original 401', async () => {
    server.use(http.get(`${BASE}/roles`, () => problem(401, 'TOKEN_EXPIRED', 'Your session has expired.')))
    const h = hooks({ refresh: vi.fn(async () => false) })
    const api = createApiClient({ baseUrl: BASE, hooks: h })
    await expect(api.GET('/roles')).rejects.toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' })
    expect(h.onSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('P1-AUTH-02 a 401 on the retry also ends the session (no refresh loop)', async () => {
    server.use(http.get(`${BASE}/roles`, () => problem(401, 'UNAUTHENTICATED', 'Please log in.')))
    const h = hooks()
    const api = createApiClient({ baseUrl: BASE, hooks: h })
    await expect(api.GET('/roles')).rejects.toBeInstanceOf(ApiError)
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(h.onSessionExpired).toHaveBeenCalledTimes(1)
  })

  it('maps problem+json to a typed ApiError with detail and fieldErrors as sent', async () => {
    server.use(
      http.post(`${BASE}/users`, () =>
        problem(422, 'VALIDATION_FAILED', 'Some fields are missing or invalid.', {
          fieldErrors: [{ field: 'username', message: 'Username is already taken' }],
        }),
      ),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const err = await api
      .POST('/users', { body: { username: 'x', fullName: 'X', password: 'longenough', roleIds: ['r1'] } })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const e = err as ApiError
    expect(e.status).toBe(422)
    expect(e.code).toBe('VALIDATION_FAILED')
    expect(e.userMessage).toBe('Some fields are missing or invalid.')
    expect(e.fieldErrorMap).toEqual({ username: 'Username is already taken' })
    expect(e.traceId).toBe('abc')
  })

  it('maps 409 VERSION_CONFLICT so screens can offer a reload', async () => {
    server.use(
      http.put(`${BASE}/settings/tax`, () => problem(409, 'VERSION_CONFLICT', 'Changed by someone else.')),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api
      .PUT('/settings/tax', { body: { enabled: false, rate: '0.00', version: 1 } })
      .catch((x: unknown) => x)) as ApiError
    expect(e.isVersionConflict).toBe(true)
  })

  it('shows a 429 TOO_MANY_ATTEMPTS detail as sent (registerTerminal rate limit)', async () => {
    server.use(http.post(`${BASE}/terminals`, () => problem(429, 'TOO_MANY_ATTEMPTS', 'Wait 10 minutes.')))
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api
      .POST('/terminals', {
        body: { credentials: { username: 'o', password: 'p' }, name: 'T', type: 'ADMIN' },
      })
      .catch((x: unknown) => x)) as ApiError
    expect(e).toMatchObject({ status: 429, code: 'TOO_MANY_ATTEMPTS', userMessage: 'Wait 10 minutes.' })
    expect(e.retryAfterText).toBeNull()
  })

  it('reads Retry-After from a 429 TooManyRequests response into a wait time', async () => {
    server.use(
      http.post(`${BASE}/terminals`, () => {
        const res = problem(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong usernames or passwords.')
        res.headers.set('Retry-After', '540')
        return res
      }),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api
      .POST('/terminals', {
        body: { credentials: { username: 'o', password: 'p' }, name: 'T', type: 'ADMIN' },
      })
      .catch((x: unknown) => x)) as ApiError
    expect(e.retryAfterSeconds).toBe(540)
    expect(e.retryAfterText).toBe('Try again in 9 minutes.')
  })

  it('does not add a second wait line when the 429 detail already contains the wait', async () => {
    server.use(
      http.post(`${BASE}/terminals`, () => {
        const res = problem(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Try again in 15 minutes.')
        res.headers.set('Retry-After', '900')
        return res
      }),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api
      .POST('/terminals', {
        body: { credentials: { username: 'o', password: 'p' }, name: 'T', type: 'ADMIN' },
      })
      .catch((x: unknown) => x)) as ApiError
    expect(e.retryAfterSeconds).toBe(900)
    expect(e.retryAfterText).toBeNull()
    expect(detailStatesWait('Wait 30 seconds.')).toBe(true)
    expect(detailStatesWait('Too many attempts from this device.')).toBe(false)
  })

  it('shows a distinct message for a 403 that is not problem+json (e.g. Spring "Invalid CORS request")', async () => {
    server.use(http.get(`${BASE}/roles`, () => new HttpResponse('Invalid CORS request', { status: 403 })))
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api.GET('/roles').catch((x: unknown) => x)) as ApiError
    expect(e.status).toBe(403)
    expect(e.userMessage).toBe(
      "The server rejected this request (403). If you're developing, check the backend's allowed origins.",
    )
    expect(e.userMessage).not.toMatch(/permission/)
  })

  it('ADR-008 TERMINAL_REQUIRED shows "Use a registered counter device for this." whatever the detail', async () => {
    server.use(http.get(`${BASE}/roles`, () => problem(403, 'TERMINAL_REQUIRED', 'server wording')))
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api.GET('/roles').catch((x: unknown) => x)) as ApiError
    expect(e.userMessage).toBe('Use a registered counter device for this.')
    expect(new ApiError({ status: 403, code: 'TERMINAL_REQUIRED_FOR_USER', title: 'x' }).userMessage).toBe(
      'This account can only sign in on a registered counter or kitchen device.',
    )
  })

  it('keeps the permission message for a problem+json 403', async () => {
    server.use(
      http.get(`${BASE}/roles`, () => problem(403, 'FORBIDDEN', 'You do not have permission to do this.')),
    )
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api.GET('/roles').catch((x: unknown) => x)) as ApiError
    expect(e.code).toBe('FORBIDDEN')
    expect(e.userMessage).toBe('You do not have permission to do this.')
  })

  it('parses Retry-After as seconds or an HTTP date', () => {
    const now = Date.parse('2026-11-21T08:00:00Z')
    expect(parseRetryAfter('30', now)).toBe(30)
    expect(parseRetryAfter('Sat, 21 Nov 2026 08:02:00 GMT', now)).toBe(120)
    expect(parseRetryAfter('soon', now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
    expect(new ApiError({ status: 429, code: 'X', title: 'x', retryAfterSeconds: 1 }).retryAfterText).toBe(
      'Try again in 1 second.',
    )
  })

  it('falls back to a plain message for a non-problem error body', async () => {
    server.use(http.get(`${BASE}/roles`, () => new HttpResponse('<html>Bad gateway</html>', { status: 502 })))
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api.GET('/roles').catch((x: unknown) => x)) as ApiError
    expect(e.code).toBe('HTTP_502')
    expect(e.userMessage).toMatch(/not reachable/)
  })

  it('turns a network failure into ApiError NETWORK_ERROR', async () => {
    server.use(http.get(`${BASE}/roles`, () => HttpResponse.error()))
    const api = createApiClient({ baseUrl: BASE, hooks: hooks() })
    const e = (await api.GET('/roles').catch((x: unknown) => x)) as ApiError
    expect(e).toBeInstanceOf(ApiError)
    expect(e.code).toBe('NETWORK_ERROR')
  })
})
