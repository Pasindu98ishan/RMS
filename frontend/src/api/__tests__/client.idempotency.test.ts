/**
 * No M1.0 operation is x-idempotent, so this test marks POST /users idempotent in the generated
 * metadata to exercise the mechanism (P1-ORD-10 later uses it for orders and payments).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

vi.mock('../generated/operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generated/operations')>()
  return {
    ...actual,
    OPERATIONS: actual.OPERATIONS.map((op) =>
      op.method === 'POST' && op.path === '/users' ? { ...op, idempotent: true } : op,
    ),
  }
})

const { createApiClient } = await import('../client')

const BASE = 'http://rms.test/api/v1'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const user = {
  id: 'u1',
  username: 'x1x',
  fullName: 'X',
  active: true,
  locked: false,
  pinSet: false,
  pinLocked: false,
  roles: [],
  version: 1,
  createdAt: 'a',
  updatedAt: 'a',
}
const body = { username: 'x1x', fullName: 'X', password: 'longenough', roleIds: ['r1'] }
const hooks = {
  getAccessToken: () => 't',
  getTerminalId: () => 'term',
  canRefresh: () => false,
  refresh: async () => false,
  onSessionExpired: () => undefined,
}

describe('Idempotency-Key middleware', () => {
  it('P1-ORD-10 adds a fresh Idempotency-Key to x-idempotent operations only', async () => {
    const keys: Array<string | null> = []
    server.use(
      http.post(`${BASE}/users`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'))
        return HttpResponse.json(user, { status: 201 })
      }),
      http.get(`${BASE}/roles`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'))
        return HttpResponse.json([])
      }),
    )
    const api = createApiClient({ baseUrl: BASE, hooks })
    await api.POST('/users', { body })
    await api.POST('/users', { body })
    await api.GET('/roles')
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[2]).toBeNull()
  })

  it('P1-ORD-10 keeps a caller-supplied key so a retry of the same action reuses it', async () => {
    let key: string | null = null
    server.use(
      http.post(`${BASE}/users`, ({ request }) => {
        key = request.headers.get('idempotency-key')
        return HttpResponse.json(user, { status: 201 })
      }),
    )
    const api = createApiClient({ baseUrl: BASE, hooks })
    await api.POST('/users', { body, headers: { 'Idempotency-Key': 'fixed-key' } })
    expect(key).toBe('fixed-key')
  })
})
