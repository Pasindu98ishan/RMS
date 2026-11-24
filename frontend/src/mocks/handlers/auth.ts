import type { AuthSession } from '@/api/types'
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  audit,
  db,
  newToken,
  nowIso,
  persist,
  terminalSummaryOut,
} from '../db'
import { http, latency, mustCaller, permissionsOf, problem, validation } from '../http'
import type { MockTerminal, MockUser } from '../seed'

const LOCK_MINUTES = 15
const MAX_FAILED_LOGINS = 5

/** Idle logout of a session: the terminal type's rule (none for KITCHEN / DISPLAY), or the personal rule (ADR-008). */
function idleMinutesFor(terminal: MockTerminal | null): number | undefined {
  if (!terminal) return db.settings.idleTimeouts.idleTimeoutPersonalMinutes
  const rule = db.settings.idleTimeouts.rules.find((r) => r.terminalType === terminal.type)
  return rule && !rule.exempt ? rule.idleTimeoutMinutes : undefined
}

function authUser(u: MockUser) {
  return { id: u.id, username: u.username, fullName: u.fullName, roles: u.roles, pinSet: u.pinSet }
}

/** Terminal session when `terminal` is given, personal session (no terminal) otherwise. */
export function issueSession(user: MockUser, terminal: MockTerminal | null): AuthSession {
  const now = Date.now()
  const refreshToken = newToken('mock-rt')
  const accessToken = newToken('mock-at')
  const permissions = permissionsOf(user)
  const terminalId = terminal?.id ?? null
  db.refreshTokens[refreshToken] = {
    userId: user.id,
    terminalId,
    expiresAt: now + REFRESH_TTL_SECONDS * 1000,
    revoked: false,
  }
  db.accessTokens[accessToken] = {
    userId: user.id,
    terminalId,
    expiresAt: now + ACCESS_TTL_SECONDS * 1000,
    refreshToken,
    permissions,
  }
  const session: AuthSession = {
    accessToken,
    expiresIn: ACCESS_TTL_SECONDS,
    refreshToken,
    refreshExpiresIn: REFRESH_TTL_SECONDS,
    user: authUser(user),
    permissions,
    sessionType: terminal ? 'TERMINAL' : 'PERSONAL',
    ...(terminal ? { terminal: terminalSummaryOut(terminal) } : {}),
  }
  const idle = idleMinutesFor(terminal)
  if (idle !== undefined) session.idleTimeoutMinutes = idle
  return session
}

const terminalRequiredForUser = () =>
  problem(
    403,
    'TERMINAL_REQUIRED_FOR_USER',
    'This account can only sign in on a registered counter or kitchen device.',
    undefined,
    'Registered device needed',
  )
/** Revokes refresh + access tokens of a user (optionally keeping one refresh token). */
export function revokeUserSessions(userId: string, keepRefreshToken?: string): void {
  for (const [rt, rec] of Object.entries(db.refreshTokens)) {
    if (rec.userId === userId && rt !== keepRefreshToken) rec.revoked = true
  }
  for (const [at, rec] of Object.entries(db.accessTokens)) {
    if (rec.userId === userId && rec.refreshToken !== keepRefreshToken) delete db.accessTokens[at]
  }
}

export function revokeTerminalSessions(terminalId: string): void {
  for (const rec of Object.values(db.refreshTokens)) if (rec.terminalId === terminalId) rec.revoked = true
  for (const [at, rec] of Object.entries(db.accessTokens))
    if (rec.terminalId === terminalId) delete db.accessTokens[at]
}

/** Password check shared by login, change-password and set-PIN (counts towards the lock). */
export function checkPassword(
  user: MockUser,
  password: string,
  terminal: MockTerminal | null,
): 'ok' | 'wrong' | 'locked' {
  if (user.locked && user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) return 'locked'
  if (user.password === password) {
    user.failedLogins = 0
    user.locked = false
    delete user.lockedUntil
    return 'ok'
  }
  user.failedLogins += 1
  if (user.failedLogins >= MAX_FAILED_LOGINS) {
    user.locked = true
    user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
    audit('ACCOUNT_LOCKED', 'USER', { actor: user, terminal, entityId: user.id })
    return 'locked'
  }
  return 'wrong'
}

const lockedProblem = () =>
  problem(
    423,
    'ACCOUNT_LOCKED',
    'Too many wrong passwords. Try again in 15 minutes or ask the owner to unlock your account.',
    undefined,
    'Account locked',
  )

const invalidCredentials = () =>
  problem(401, 'INVALID_CREDENTIALS', 'Wrong username or password.', undefined, 'Login failed')

export function newPasswordErrors(field: string, value: unknown, username: string) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    return [{ field, message: 'Password must be 8 to 72 characters' }]
  }
  if (value === username) return [{ field, message: 'Password must not be the same as the username' }]
  return []
}

export function pinErrors(field: string, value: unknown) {
  return typeof value === 'string' && /^\d{4,6}$/.test(value)
    ? []
    : [{ field, message: 'PIN must be 4 to 6 digits' }]
}

export const authHandlers = [
  http.post('/auth/login', async ({ request, response }) => {
    await latency()
    const body = await request.json()
    const terminalId = request.headers.get('X-Terminal-Id')
    // Terminal session: header + deviceToken. Personal session: neither (ADR-008). One alone is 422.
    if (Boolean(terminalId) !== Boolean(body.deviceToken)) {
      return response.untyped(
        validation([
          {
            field: 'deviceToken',
            message: 'Send the device token together with the X-Terminal-Id header, or neither',
          },
        ]),
      )
    }
    let terminal: MockTerminal | null = null
    if (terminalId) {
      terminal = db.terminals.find((t) => t.id === terminalId) ?? null
      if (!terminal || terminal.deviceToken !== body.deviceToken) {
        return response.untyped(
          problem(
            403,
            'TERMINAL_NOT_REGISTERED',
            'This device is not registered as a terminal. Ask the owner to set it up.',
          ),
        )
      }
      if (!terminal.active) {
        return response.untyped(
          problem(
            403,
            'TERMINAL_INACTIVE',
            'This terminal has been deactivated. Ask the owner to register it again.',
          ),
        )
      }
    }
    const fe = []
    if (!body.username) fe.push({ field: 'username', message: 'Username is required' })
    if (!body.password) fe.push({ field: 'password', message: 'Password is required' })
    if (fe.length) return response.untyped(validation(fe))

    const user = db.users.find((u) => u.username === body.username.trim().toLowerCase())
    if (!user) {
      audit('LOGIN_FAILED', 'AUTH_SESSION', { username: body.username, terminal })
      persist()
      return response.untyped(invalidCredentials())
    }
    const result = checkPassword(user, body.password, terminal)
    if (result === 'locked') {
      persist()
      return response.untyped(lockedProblem())
    }
    if (result === 'wrong' || !user.active) {
      audit('LOGIN_FAILED', 'AUTH_SESSION', { actor: user, terminal, entityId: user.id })
      persist()
      return response.untyped(invalidCredentials())
    }
    // The password was right, so this does not count towards the lock.
    if (!terminal && !permissionsOf(user).includes('LOGIN_ANY_DEVICE')) {
      audit('LOGIN_FAILED', 'AUTH_SESSION', {
        actor: user,
        entityId: user.id,
        reason: 'TERMINAL_REQUIRED_FOR_USER',
      })
      persist()
      return response.untyped(terminalRequiredForUser())
    }
    user.lastLoginAt = nowIso()
    if (terminal) terminal.lastLoginAt = user.lastLoginAt
    const session = issueSession(user, terminal)
    audit('LOGIN', 'AUTH_SESSION', { actor: user, terminal, entityId: user.id })
    persist()
    return response(200).json(session)
  }),

  http.post('/auth/refresh', async ({ request, response }) => {
    await latency()
    const { refreshToken } = await request.json()
    const terminalId = request.headers.get('X-Terminal-Id')
    const rec = db.refreshTokens[refreshToken]
    const invalid = () =>
      response.untyped(
        problem(
          401,
          'REFRESH_TOKEN_INVALID',
          'Your session has ended. Please log in again.',
          undefined,
          'Please log in',
        ),
      )
    // The header must match the session kind: the terminal for a terminal session, absent for a personal one.
    if (
      !rec ||
      rec.revoked ||
      rec.expiresAt <= Date.now() ||
      (rec.terminalId ?? null) !== (terminalId ?? null)
    ) {
      return invalid()
    }
    const user = db.users.find((u) => u.id === rec.userId)
    const terminal = rec.terminalId ? (db.terminals.find((t) => t.id === rec.terminalId) ?? null) : null
    if (!user?.active || (rec.terminalId && !terminal?.active)) return invalid()
    rec.revoked = true
    for (const [at, a] of Object.entries(db.accessTokens))
      if (a.refreshToken === refreshToken) delete db.accessTokens[at]
    if (!terminal && !permissionsOf(user).includes('LOGIN_ANY_DEVICE')) {
      persist()
      return response.untyped(terminalRequiredForUser())
    }
    const session = issueSession(user, terminal)
    persist()
    return response(200).json(session)
  }),
  http.post('/auth/logout', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const { refreshToken, reason } = await request.json()
    const rec = db.refreshTokens[refreshToken]
    if (rec && rec.userId === c.user.id) {
      rec.revoked = true
      for (const [at, a] of Object.entries(db.accessTokens))
        if (a.refreshToken === refreshToken) delete db.accessTokens[at]
      audit('LOGOUT', 'AUTH_SESSION', {
        actor: c.user,
        terminal: c.terminal,
        entityId: c.user.id,
        reason: reason ?? 'USER',
      })
      persist()
    }
    return response(204).empty()
  }),

  http.get('/auth/me', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const idle = idleMinutesFor(c.terminal)
    const permissions = db.accessTokens[request.headers.get('Authorization')?.slice(7) ?? '']?.permissions
    return response(200).json({
      user: authUser(c.user),
      permissions: (permissions ?? permissionsOf(c.user)) as ReturnType<typeof permissionsOf>,
      sessionType: c.terminal ? 'TERMINAL' : 'PERSONAL',
      ...(c.terminal ? { terminal: terminalSummaryOut(c.terminal) } : {}),
      ...(idle !== undefined ? { idleTimeoutMinutes: idle } : {}),
    })
  }),

  http.post('/auth/me/password', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const check = checkPassword(c.user, body.currentPassword, c.terminal)
    if (check === 'locked') {
      persist()
      return response.untyped(lockedProblem())
    }
    if (check === 'wrong') {
      persist()
      return response.untyped(
        validation([{ field: 'currentPassword', message: 'Current password is wrong' }]),
      )
    }
    const fe = newPasswordErrors('newPassword', body.newPassword, c.user.username)
    if (fe.length) return response.untyped(validation(fe))
    c.user.password = body.newPassword
    c.user.updatedAt = nowIso()
    // Other sessions of this user are revoked; the calling session stays logged in.
    revokeUserSessions(c.user.id, findRefreshOf(request))
    audit('PASSWORD_CHANGED', 'USER', { actor: c.user, terminal: c.terminal, entityId: c.user.id })
    persist()
    return response(204).empty()
  }),

  http.post('/auth/me/pin', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const check = checkPassword(c.user, body.currentPassword, c.terminal)
    if (check === 'locked') {
      persist()
      return response.untyped(lockedProblem())
    }
    if (check === 'wrong') {
      persist()
      return response.untyped(validation([{ field: 'currentPassword', message: 'Password is wrong' }]))
    }
    const fe = pinErrors('newPin', body.newPin)
    if (fe.length) return response.untyped(validation(fe))
    c.user.pin = body.newPin
    c.user.pinSet = true
    c.user.pinLocked = false
    c.user.failedPins = 0
    delete c.user.pinLockedUntil
    c.user.updatedAt = nowIso()
    audit('PIN_CHANGED', 'USER', { actor: c.user, terminal: c.terminal, entityId: c.user.id })
    persist()
    return response(204).empty()
  }),
]

function findRefreshOf(request: Request): string | undefined {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  return db.accessTokens[token]?.refreshToken
}
