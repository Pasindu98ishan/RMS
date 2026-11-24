/**
 * Runs before every mock handler and does what the server's security filter does: bearer token,
 * X-Terminal-Id match and the operation's x-permission (from the generated operation metadata).
 * Falls through (returns nothing) when the request may proceed.
 */
import { http as mswHttp } from 'msw'
import { API_BASE } from '@/api/client'
import { OPERATIONS } from '@/api/generated/operations'
import { db } from '../db'
import { problem } from '../http'

// Literal paths win over templated ones (/users/options before /users/{userId}), as on the server.
const paramCount = (path: string) => (path.match(/\{/g) ?? []).length
const compiled = [...OPERATIONS]
  .sort((a, b) => paramCount(a.path) - paramCount(b.path))
  .map((op) => ({
    op,
    re: new RegExp(`^${op.path.replace(/\{[^}]+\}/g, '[^/]+')}$`),
  }))

export const gatekeeper = mswHttp.all(`${API_BASE}/*`, ({ request }) => {
  const url = new URL(request.url)
  const path = url.pathname.slice(API_BASE.length)
  const match = compiled.find((c) => c.op.method === request.method && c.re.test(path))
  if (!match) return problem(404, 'NOT_FOUND', `No such endpoint: ${request.method} ${path}`)
  const { op } = match
  if (op.noBearer) return undefined

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  const session = token ? db.accessTokens[token] : undefined
  if (!session) return problem(401, 'UNAUTHENTICATED', 'Your session has ended. Please log in again.')
  if (session.expiresAt <= Date.now()) {
    return problem(
      401,
      'TOKEN_EXPIRED',
      'Your session has expired. Please log in again.',
      undefined,
      'Session expired',
    )
  }
  // Terminal session: the header must match the token's terminal. Personal session: it must be absent (ADR-008).
  if ((request.headers.get('X-Terminal-Id') ?? null) !== session.terminalId) {
    return problem(403, 'TERMINAL_MISMATCH', 'This request did not come from the terminal you logged in on.')
  }
  if (op.terminalRequired && !session.terminalId) {
    return problem(403, 'TERMINAL_REQUIRED', 'Use a registered counter device for this.')
  }
  const user = db.users.find((u) => u.id === session.userId)
  if (!user || !user.active)
    return problem(401, 'UNAUTHENTICATED', 'Your session has ended. Please log in again.')
  if (op.permission !== 'AUTHENTICATED' && op.permission !== 'PUBLIC') {
    if (!session.permissions.includes(op.permission)) {
      return problem(403, 'FORBIDDEN', 'You do not have permission to do this.')
    }
  }
  return undefined
})
