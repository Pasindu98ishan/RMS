import { delay, HttpResponse } from 'msw'
import { createOpenApiHttp } from 'openapi-msw'
import type { paths } from '@/api/generated/schema'
import type { FieldError } from '@/api/errors'
import { API_BASE } from '@/api/client'
import { db, type MockSession } from './db'
import type { MockTerminal, MockUser } from './seed'

/** Typed handler factory: a handler whose path/body/response breaks the contract fails type-check. */
export const http = createOpenApiHttp<paths>({ baseUrl: API_BASE })

const TITLES: Record<number, string> = {
  400: 'Malformed request',
  401: 'Please log in',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict',
  422: 'Please check the highlighted fields',
  423: 'Locked',
}

/** RFC 7807 problem+json response, like the server's. */
export function problem(
  status: number,
  code: string,
  detail: string,
  fieldErrors?: FieldError[],
  title?: string,
): Response {
  return HttpResponse.json(
    {
      type: `https://rms/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: title ?? TITLES[status] ?? 'Error',
      status,
      code,
      detail,
      ...(fieldErrors && fieldErrors.length ? { fieldErrors } : {}),
      traceId: crypto.randomUUID().replace(/-/g, ''),
    },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )
}

export const validation = (fieldErrors: FieldError[]) =>
  problem(422, 'VALIDATION_FAILED', 'Some fields are missing or invalid.', fieldErrors)

export const notFound = (what = 'record') => problem(404, 'NOT_FOUND', `This ${what} does not exist.`)

export const versionConflict = (what = 'record') =>
  problem(
    409,
    'VERSION_CONFLICT',
    `This ${what} was changed by someone else. Reload and try again.`,
    undefined,
    'Someone else changed this record',
  )

/** Small random latency so loading states are visible. */
export function latency(): Promise<void> {
  return delay(120 + Math.floor(Math.random() * 180))
}

export interface Caller {
  user: MockUser
  /** null in a personal session (ADR-008). */
  terminal: MockTerminal | null
  session: MockSession
}

/** The caller of an authenticated request (the gatekeeper already validated the token). */
export function caller(request: Request): Caller | null {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const session = db.accessTokens[token]
  if (!session || session.expiresAt <= Date.now()) return null
  const user = db.users.find((u) => u.id === session.userId)
  const terminal = session.terminalId ? (db.terminals.find((t) => t.id === session.terminalId) ?? null) : null
  if (!user || (session.terminalId && !terminal)) return null
  return { user, terminal, session }
}

export function mustCaller(request: Request): Caller {
  const c = caller(request)
  if (!c) throw problem(401, 'UNAUTHENTICATED', 'Your session has ended. Please log in again.')
  return c
}

export function permissionsOf(user: MockUser) {
  const codes = new Set<string>()
  for (const ref of user.roles) {
    const role = db.roles.find((r) => r.id === ref.id)
    role?.permissionCodes.forEach((c) => codes.add(c))
  }
  return [...codes].sort() as (typeof db.roles)[number]['permissionCodes']
}

export function intParam(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === '') return fallback
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return n < min || n > max ? null : n
}

export function paginate<T>(items: T[], pageRaw: string | null, sizeRaw: string | null) {
  const page = intParam(pageRaw, 0, 0, Number.MAX_SAFE_INTEGER)
  const size = intParam(sizeRaw, 50, 1, 200)
  if (page === null || size === null) return null
  return { items: items.slice(page * size, page * size + size), page, size, totalItems: items.length }
}

export function parseSort(raw: string | null, allowed: string[], fallback: string) {
  const value = raw ?? fallback
  const m = /^([a-zA-Z]+),(asc|desc)$/.exec(value)
  if (!m || !allowed.includes(m[1] ?? '')) return null
  return { field: m[1] as string, dir: m[2] === 'desc' ? -1 : 1 }
}
