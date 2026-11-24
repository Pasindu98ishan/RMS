/**
 * The mock backend follows ADR-008 (contract v0.3.0): personal and terminal sessions, LOGIN_ANY_DEVICE,
 * TERMINAL_REQUIRED_FOR_USER, header-matches-session-kind checks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { handlers } from '../handlers'
import { resetDb, db } from '../db'
import { MOCK_PASSWORD } from '../seed'

const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => resetDb())

const BASE = `${location.origin}/api/v1`

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: res.status === 204 ? null : await res.json() }
}

const cashierTerminal = () => db.terminals.find((t) => t.name === 'Cashier counter')!

describe('mock sessions (ADR-008)', () => {
  it('P1-AUTH-04 a user with LOGIN_ANY_DEVICE gets a personal session (no terminal, personal idle timeout)', async () => {
    const r = await post('/auth/login', { username: 'owner1', password: MOCK_PASSWORD })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ sessionType: 'PERSONAL', idleTimeoutMinutes: 30 })
    expect(r.body.terminal).toBeUndefined()
    expect(r.body.permissions).toContain('LOGIN_ANY_DEVICE')
  })

  it('P1-AUTH-04 a cashier without a terminal gets 403 TERMINAL_REQUIRED_FOR_USER and no lock count', async () => {
    const r = await post('/auth/login', { username: 'cashier1', password: MOCK_PASSWORD })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('TERMINAL_REQUIRED_FOR_USER')
    expect(db.users.find((u) => u.username === 'cashier1')!.failedLogins).toBe(0)
  })

  it('the same cashier on a registered device gets a terminal session', async () => {
    const t = cashierTerminal()
    const r = await post(
      '/auth/login',
      { username: 'cashier1', password: MOCK_PASSWORD, deviceToken: t.deviceToken },
      { 'X-Terminal-Id': t.id },
    )
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ sessionType: 'TERMINAL', terminal: { id: t.id }, idleTimeoutMinutes: 10 })
  })

  it('sending only one of header and deviceToken is 422 on deviceToken', async () => {
    const r = await post(
      '/auth/login',
      { username: 'owner1', password: MOCK_PASSWORD },
      { 'X-Terminal-Id': cashierTerminal().id },
    )
    expect(r.status).toBe(422)
    expect(r.body.fieldErrors[0].field).toBe('deviceToken')
  })

  it('seeds LOGIN_ANY_DEVICE for Owner, Manager, Rider, Inventory and HR only', () => {
    const holders = db.roles
      .filter((r) => r.permissionCodes.includes('LOGIN_ANY_DEVICE'))
      .map((r) => r.key)
      .sort()
    expect(holders).toEqual(['HR', 'INVENTORY', 'MANAGER', 'OWNER', 'RIDER'])
  })

  it('a personal session must not send X-Terminal-Id (403 TERMINAL_MISMATCH); refresh must match the session kind', async () => {
    const login = await post('/auth/login', { username: 'manager1', password: MOCK_PASSWORD })
    const auth = { Authorization: `Bearer ${login.body.accessToken}` }
    const ok = await fetch(`${BASE}/auth/me`, { headers: auth })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ sessionType: 'PERSONAL' })
    const bad = await fetch(`${BASE}/auth/me`, {
      headers: { ...auth, 'X-Terminal-Id': cashierTerminal().id },
    })
    expect(bad.status).toBe(403)
    expect((await bad.json()).code).toBe('TERMINAL_MISMATCH')

    const wrongKind = await post(
      '/auth/refresh',
      { refreshToken: login.body.refreshToken },
      { 'X-Terminal-Id': cashierTerminal().id },
    )
    expect(wrongKind.status).toBe(401)
    const second = await post('/auth/login', { username: 'manager1', password: MOCK_PASSWORD })
    const refreshed = await post('/auth/refresh', { refreshToken: second.body.refreshToken })
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.sessionType).toBe('PERSONAL')
  })

  it('a personal session ends at refresh once the user has lost LOGIN_ANY_DEVICE', async () => {
    const login = await post('/auth/login', { username: 'hr1', password: MOCK_PASSWORD })
    const hr = db.roles.find((r) => r.key === 'HR')!
    hr.permissionCodes = hr.permissionCodes.filter((c) => c !== 'LOGIN_ANY_DEVICE')
    const r = await post('/auth/refresh', { refreshToken: login.body.refreshToken })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('TERMINAL_REQUIRED_FOR_USER')
  })

  it('audit rows record client info, and no terminal for personal sessions', async () => {
    await post('/auth/login', { username: 'owner1', password: MOCK_PASSWORD })
    const last = db.audit[db.audit.length - 1]!
    expect(last.action).toBe('LOGIN')
    expect(last.terminal).toBeUndefined()
    expect(last.clientInfo).toMatch(/^127\.0\.0\.1 \| /)
  })
})
