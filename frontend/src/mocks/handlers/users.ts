import type { FieldError } from '@/api/errors'
import type { RoleRef } from '@/api/types'
import { audit, db, newId, nowIso, persist, roleRef, userOut, userSummaryOut } from '../db'
import {
  http,
  latency,
  mustCaller,
  notFound,
  paginate,
  parseSort,
  problem,
  validation,
  versionConflict,
} from '../http'
import { ROLE_IDS, type MockUser } from '../seed'
import { newPasswordErrors, pinErrors, revokeUserSessions } from './auth'

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/
const PHONE_RE = /^\+?[0-9][0-9 -]{6,18}$/

function findUser(id: string): MockUser | undefined {
  return db.users.find((u) => u.id === id)
}

function resolveRoles(roleIds: unknown, field = 'roleIds'): { refs: RoleRef[]; errors: FieldError[] } {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return { refs: [], errors: [{ field, message: 'Choose at least one role' }] }
  }
  const refs: RoleRef[] = []
  const errors: FieldError[] = []
  roleIds.forEach((id, i) => {
    const r = db.roles.find((x) => x.id === id)
    if (r) refs.push(roleRef(r))
    else errors.push({ field: `${field}[${i}]`, message: 'Unknown role' })
  })
  return { refs, errors }
}

function isOwner(u: MockUser): boolean {
  return u.roles.some((r) => r.id === ROLE_IDS.owner)
}

/** True when removing `u` from the active owners would leave none. */
function wouldLeaveNoOwner(u: MockUser): boolean {
  if (!u.active || !isOwner(u)) return false
  return db.users.filter((x) => x.active && isOwner(x)).length <= 1
}

const lastOwner = () =>
  problem(409, 'LAST_OWNER', 'This is the last active owner. Give another user the Owner role first.')

export const userHandlers = [
  // Before /users/{userId}, which would otherwise match "options" as an id.
  http.get('/users/options', async ({ response }) => {
    await latency()
    const list = db.users
      .slice()
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((u) => ({ id: u.id, username: u.username, fullName: u.fullName }))
    return response(200).json(list)
  }),

  http.get('/users', async ({ query, response }) => {
    await latency()
    const sort = parseSort(
      query.get('sort'),
      ['username', 'fullName', 'lastLoginAt', 'createdAt'],
      'username,asc',
    )
    if (!sort) return response.untyped(problem(400, 'MALFORMED_REQUEST', 'Unknown sort field.'))
    const active = query.get('active')
    const roleId = query.get('roleId')
    const search = query.get('search')?.trim().toLowerCase()
    let items = db.users.slice()
    if (active === 'true' || active === 'false') items = items.filter((u) => u.active === (active === 'true'))
    if (roleId) items = items.filter((u) => u.roles.some((r) => r.id === roleId))
    if (search) {
      items = items.filter((u) => u.username.includes(search) || u.fullName.toLowerCase().includes(search))
    }
    const key = sort.field as keyof MockUser
    items.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * sort.dir)
    const page = paginate(items.map(userSummaryOut), query.get('page'), query.get('size'))
    if (!page) return response.untyped(problem(400, 'MALFORMED_REQUEST', 'Bad page or size.'))
    return response(200).json(page)
  }),

  http.post('/users', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe: FieldError[] = []
    const username = typeof body.username === 'string' ? body.username : ''
    if (!USERNAME_RE.test(username)) {
      fe.push({
        field: 'username',
        message: 'Use 3 to 32 lower-case letters, digits, dot, dash or underscore',
      })
    }
    if (!body.fullName?.trim()) fe.push({ field: 'fullName', message: 'Full name is required' })
    if (body.phone !== undefined && !PHONE_RE.test(body.phone)) {
      fe.push({ field: 'phone', message: 'Enter a valid phone number' })
    }
    fe.push(...newPasswordErrors('password', body.password, username))
    if (body.pin !== undefined) fe.push(...pinErrors('pin', body.pin))
    const roles = resolveRoles(body.roleIds)
    fe.push(...roles.errors)
    if (fe.length) return response.untyped(validation(fe))
    if (db.users.some((u) => u.username === username)) {
      return response.untyped(problem(409, 'USERNAME_TAKEN', `The username "${username}" is already taken.`))
    }
    const now = nowIso()
    const user: MockUser = {
      id: newId(),
      username,
      fullName: body.fullName.trim(),
      ...(body.phone ? { phone: body.phone } : {}),
      active: true,
      locked: false,
      pinSet: Boolean(body.pin),
      pinLocked: false,
      roles: roles.refs,
      version: 1,
      createdAt: now,
      updatedAt: now,
      password: body.password,
      ...(body.pin ? { pin: body.pin } : {}),
      failedLogins: 0,
      failedPins: 0,
    }
    db.users.push(user)
    audit('CREATE', 'USER', {
      actor: c.user,
      terminal: c.terminal,
      entityId: user.id,
      after: { username, fullName: user.fullName, roles: roles.refs.map((r) => r.name) },
    })
    persist()
    return response(201).json(userOut(user))
  }),

  http.get('/users/{userId}', async ({ params, response }) => {
    await latency()
    const u = findUser(params.userId)
    return u ? response(200).json(userOut(u)) : response.untyped(notFound('user'))
  }),

  http.put('/users/{userId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const u = findUser(params.userId)
    if (!u) return response.untyped(notFound('user'))
    const body = await request.json()
    const fe: FieldError[] = []
    if (!body.fullName?.trim()) fe.push({ field: 'fullName', message: 'Full name is required' })
    if (body.phone !== undefined && !PHONE_RE.test(body.phone)) {
      fe.push({ field: 'phone', message: 'Enter a valid phone number' })
    }
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== u.version) return response.untyped(versionConflict('user'))
    const before = { fullName: u.fullName, phone: u.phone ?? '' }
    u.fullName = body.fullName.trim()
    // PUT is a full replacement: an omitted optional field is cleared.
    if (body.phone) u.phone = body.phone
    else delete u.phone
    u.version += 1
    u.updatedAt = nowIso()
    audit('UPDATE', 'USER', {
      actor: c.user,
      terminal: c.terminal,
      entityId: u.id,
      before,
      after: { fullName: u.fullName, phone: u.phone ?? '' },
    })
    persist()
    return response(200).json(userOut(u))
  }),

  http.post('/users/{userId}/deactivate', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const u = findUser(params.userId)
    if (!u) return response.untyped(notFound('user'))
    if (u.id === c.user.id) {
      return response.untyped(
        problem(409, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account.'),
      )
    }
    if (wouldLeaveNoOwner(u)) return response.untyped(lastOwner())
    if (u.active) {
      u.active = false
      u.version += 1
      u.updatedAt = nowIso()
      revokeUserSessions(u.id)
      audit('DEACTIVATE', 'USER', { actor: c.user, terminal: c.terminal, entityId: u.id })
      persist()
    }
    return response(200).json(userOut(u))
  }),

  http.post('/users/{userId}/activate', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const u = findUser(params.userId)
    if (!u) return response.untyped(notFound('user'))
    if (!u.active) {
      u.active = true
      u.version += 1
      u.updatedAt = nowIso()
      audit('ACTIVATE', 'USER', { actor: c.user, terminal: c.terminal, entityId: u.id })
      persist()
    }
    return response(200).json(userOut(u))
  }),

  http.post('/users/{userId}/unlock', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const u = findUser(params.userId)
    if (!u) return response.untyped(notFound('user'))
    if (u.locked || u.pinLocked || u.failedLogins || u.failedPins) {
      u.locked = false
      u.pinLocked = false
      delete u.lockedUntil
      delete u.pinLockedUntil
      u.failedLogins = 0
      u.failedPins = 0
      u.version += 1
      u.updatedAt = nowIso()
      audit('ACCOUNT_UNLOCKED', 'USER', { actor: c.user, terminal: c.terminal, entityId: u.id })
      persist()
    }
    return response(200).json(userOut(u))
  }),

  http.post('/users/{userId}/reset-password', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const u = findUser(params.userId)
    if (!u) return response.untyped(notFound('user'))
    const body = await request.json()
    const fe = newPasswordErrors('newPassword', body.newPassword, u.username)
    if (fe.length) return response.untyped(validation(fe))
    u.password = body.newPassword
    u.locked = false
    delete u.lockedUntil
    u.failedLogins = 0
    u.version += 1
    u.updatedAt = nowIso()
    revokeUserSessions(u.id)
    audit('PASSWORD_RESET', 'USER', { actor: c.user, terminal: c.terminal, entityId: u.id })
    persist()
    return response(204).empty()
  }),

  http.post('/users/{userId}/reset-pin', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const u = findUser(params.userId)
    if (!u) return response.untyped(notFound('user'))
    const body = await request.json()
    const fe = pinErrors('newPin', body.newPin)
    if (fe.length) return response.untyped(validation(fe))
    u.pin = body.newPin
    u.pinSet = true
    u.pinLocked = false
    delete u.pinLockedUntil
    u.failedPins = 0
    u.version += 1
    u.updatedAt = nowIso()
    audit('PIN_RESET', 'USER', { actor: c.user, terminal: c.terminal, entityId: u.id })
    persist()
    return response(204).empty()
  }),

  http.put('/users/{userId}/roles', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const u = findUser(params.userId)
    if (!u) return response.untyped(notFound('user'))
    const body = await request.json()
    const roles = resolveRoles(body.roleIds)
    if (roles.errors.length) return response.untyped(validation(roles.errors))
    if (body.version !== u.version) return response.untyped(versionConflict('user'))
    const keepsOwner = roles.refs.some((r) => r.id === ROLE_IDS.owner)
    if (!keepsOwner && wouldLeaveNoOwner(u)) return response.untyped(lastOwner())
    const before = u.roles.map((r) => r.name)
    u.roles = roles.refs
    u.version += 1
    u.updatedAt = nowIso()
    audit('ROLES_ASSIGNED', 'USER', {
      actor: c.user,
      terminal: c.terminal,
      entityId: u.id,
      before: { roles: before },
      after: { roles: u.roles.map((r) => r.name) },
    })
    persist()
    return response(200).json(userOut(u))
  }),
]
