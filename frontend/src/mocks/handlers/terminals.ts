import type { FieldError } from '@/api/errors'
import type { TerminalType } from '@/api/types'
import { audit, db, newId, newToken, nowIso, persist, terminalOut, terminalSummaryOut } from '../db'
import {
  http,
  latency,
  mustCaller,
  notFound,
  permissionsOf,
  problem,
  validation,
  versionConflict,
} from '../http'
import type { MockTerminal, MockUser } from '../seed'

const TYPES: TerminalType[] = ['CASHIER_POS', 'RECEPTION_POS', 'KITCHEN', 'ADMIN', 'DISPLAY']

function checkShape(body: {
  name?: string
  type?: TerminalType
  kitchenStationId?: string
  orderingPointId?: string
}): FieldError[] {
  const fe: FieldError[] = []
  const name = body.name?.trim() ?? ''
  if (!name || name.length > 50)
    fe.push({ field: 'name', message: 'Terminal name is required (up to 50 characters)' })
  if (!body.type || !TYPES.includes(body.type)) fe.push({ field: 'type', message: 'Choose a terminal type' })
  if (body.type === 'KITCHEN') {
    if (!body.kitchenStationId) {
      fe.push({ field: 'kitchenStationId', message: 'Kitchen screens need a kitchen station' })
    } else if (!db.stations.some((s) => s.id === body.kitchenStationId && s.active)) {
      fe.push({ field: 'kitchenStationId', message: 'Choose an active kitchen station' })
    }
  } else if (body.kitchenStationId) {
    fe.push({ field: 'kitchenStationId', message: 'Only kitchen screens have a kitchen station' })
  }
  if (body.orderingPointId && body.type !== 'CASHIER_POS' && body.type !== 'RECEPTION_POS') {
    fe.push({ field: 'orderingPointId', message: 'Only POS terminals have an ordering point' })
  } else if (body.orderingPointId && !db.orderingPoints.some((p) => p.id === body.orderingPointId)) {
    fe.push({ field: 'orderingPointId', message: 'Unknown ordering point' })
  }
  return fe
}

const nameTaken = (name: string, exceptId?: string) =>
  db.terminals.some((t) => t.id !== exceptId && t.name.toLowerCase() === name.trim().toLowerCase())

const MAX_FAILURES = 5
const FAILURE_WINDOW_MS = 15 * 60_000
/** Failed registerTerminal attempts from this browser (the mock's stand-in for the client IP). */
let registerFailures: number[] = []

/**
 * Inline owner credentials (registerTerminal, getTerminalSetupOptions: x-auth INLINE_CREDENTIALS).
 * Contract v0.1.1: wrong credentials do not count towards the account lock, but 5 failures from one
 * client IP within 15 minutes return 429 TOO_MANY_ATTEMPTS (Retry-After); both operations share it.
 */
function inlineAuth(
  credentials: { username?: string; password?: string } | undefined,
): { user: MockUser } | { error: Response } {
  const nowMs = Date.now()
  registerFailures = registerFailures.filter((t) => nowMs - t < FAILURE_WINDOW_MS)
  if (registerFailures.length >= MAX_FAILURES) {
    const oldest = registerFailures[0] ?? nowMs
    const res = problem(
      429,
      'TOO_MANY_ATTEMPTS',
      'Too many wrong usernames or passwords from this device. Try again in 15 minutes.',
      undefined,
      'Too many attempts',
    )
    res.headers.set(
      'Retry-After',
      String(Math.max(1, Math.ceil((oldest + FAILURE_WINDOW_MS - nowMs) / 1000))),
    )
    return { error: res }
  }
  const user = db.users.find((u) => u.username === credentials?.username?.trim().toLowerCase())
  if (user?.locked && user.lockedUntil && Date.parse(user.lockedUntil) > nowMs) {
    return {
      error: problem(
        423,
        'ACCOUNT_LOCKED',
        'This account is locked. Ask the owner to unlock it.',
        undefined,
        'Account locked',
      ),
    }
  }
  if (!user || !user.active || user.password !== credentials?.password) {
    registerFailures.push(nowMs)
    return {
      error: problem(401, 'INVALID_CREDENTIALS', 'Wrong username or password.', undefined, 'Login failed'),
    }
  }
  if (!permissionsOf(user).includes('TERMINAL_MANAGE')) {
    return { error: problem(403, 'FORBIDDEN', 'Only a user who manages terminals can register a device.') }
  }
  return { user }
}
const taken = (name: string) =>
  problem(409, 'TERMINAL_NAME_TAKEN', `A terminal named "${name.trim()}" already exists.`)

export const terminalHandlers = [
  http.get('/terminals', async ({ query, response }) => {
    await latency()
    const active = query.get('active')
    const type = query.get('type')
    let list = db.terminals.slice()
    if (active === 'true' || active === 'false') list = list.filter((t) => t.active === (active === 'true'))
    if (type) list = list.filter((t) => t.type === type)
    list.sort((a, b) => a.name.localeCompare(b.name))
    return response(200).json(list.map(terminalSummaryOut))
  }),

  http.post('/terminals/setup-options', async ({ request, response }) => {
    await latency()
    const creds = await request.json()
    const auth = inlineAuth(creds)
    if ('error' in auth) return response.untyped(auth.error)
    return response(200).json({
      kitchenStations: db.stations
        .filter((s) => s.active)
        .sort((a, b) => a.number - b.number)
        .map((s) => ({ id: s.id, number: s.number, name: s.name })),
      orderingPoints: db.orderingPoints.map((p) => ({ ...p })),
    })
  }),

  http.post('/terminals', async ({ request, response }) => {
    await latency()
    const body = await request.json()
    const auth = inlineAuth(body.credentials)
    if ('error' in auth) return response.untyped(auth.error)
    const user = auth.user
    const fe = checkShape(body)
    if (fe.length) return response.untyped(validation(fe))
    if (nameTaken(body.name)) return response.untyped(taken(body.name))
    const now = nowIso()
    const terminal: MockTerminal = {
      id: newId(),
      name: body.name.trim(),
      type: body.type,
      ...(body.kitchenStationId ? { kitchenStationId: body.kitchenStationId } : {}),
      ...(body.orderingPointId ? { orderingPointId: body.orderingPointId } : {}),
      active: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deviceToken: newToken('mock-dt'),
    }
    db.terminals.push(terminal)
    audit('TERMINAL_REGISTERED', 'TERMINAL', {
      actor: user,
      terminal,
      entityId: terminal.id,
      after: { name: terminal.name, type: terminal.type },
    })
    persist()
    return response(201).json({ terminal: terminalOut(terminal), deviceToken: terminal.deviceToken })
  }),

  http.get('/terminals/{terminalId}', async ({ params, response }) => {
    await latency()
    const t = db.terminals.find((x) => x.id === params.terminalId)
    return t ? response(200).json(terminalOut(t)) : response.untyped(notFound('terminal'))
  }),

  http.put('/terminals/{terminalId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const t = db.terminals.find((x) => x.id === params.terminalId)
    if (!t) return response.untyped(notFound('terminal'))
    const body = await request.json()
    const fe = checkShape(body)
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== t.version) return response.untyped(versionConflict('terminal'))
    if (nameTaken(body.name, t.id)) return response.untyped(taken(body.name))
    const before = { name: t.name, type: t.type }
    t.name = body.name.trim()
    t.type = body.type
    if (body.kitchenStationId) t.kitchenStationId = body.kitchenStationId
    else delete t.kitchenStationId
    if (body.orderingPointId) t.orderingPointId = body.orderingPointId
    else delete t.orderingPointId
    t.version += 1
    t.updatedAt = nowIso()
    audit('UPDATE', 'TERMINAL', {
      actor: c.user,
      terminal: c.terminal,
      entityId: t.id,
      before,
      after: { name: t.name, type: t.type },
    })
    persist()
    return response(200).json(terminalOut(t))
  }),

  http.post('/terminals/{terminalId}/deactivate', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const t = db.terminals.find((x) => x.id === params.terminalId)
    if (!t) return response.untyped(notFound('terminal'))
    if (t.active) {
      t.active = false
      t.deviceToken = newToken('revoked')
      t.version += 1
      t.updatedAt = nowIso()
      for (const rec of Object.values(db.refreshTokens)) if (rec.terminalId === t.id) rec.revoked = true
      audit('DEACTIVATE', 'TERMINAL', { actor: c.user, terminal: c.terminal, entityId: t.id })
      persist()
    }
    return response(200).json(terminalOut(t))
  }),
]
