import type { FieldError } from '@/api/errors'
import type { PermissionCode, Role, RoleSummary } from '@/api/types'
import { audit, db, newId, nowIso, persist, roleOut, userCountFor } from '../db'
import { http, latency, mustCaller, notFound, problem, validation, versionConflict } from '../http'
import { PERMISSIONS, ROLE_IDS } from '../seed'

const KNOWN = new Set<string>(PERMISSIONS.map((p) => p.code))

function summary(r: Role): RoleSummary {
  const s: RoleSummary = {
    id: r.id,
    name: r.name,
    system: r.system,
    permissionCount: r.permissionCodes.length,
    userCount: userCountFor(r.id),
  }
  if (r.description) s.description = r.description
  if (r.key) s.key = r.key
  return s
}

function checkBody(body: { name?: string; description?: string; permissionCodes?: unknown }): FieldError[] {
  const fe: FieldError[] = []
  const name = body.name?.trim() ?? ''
  if (!name || name.length > 50)
    fe.push({ field: 'name', message: 'Role name is required (up to 50 characters)' })
  if (body.description !== undefined && body.description.length > 200) {
    fe.push({ field: 'description', message: 'Description is up to 200 characters' })
  }
  if (!Array.isArray(body.permissionCodes)) {
    fe.push({ field: 'permissionCodes', message: 'Permission list is required' })
  } else {
    body.permissionCodes.forEach((c, i) => {
      if (!KNOWN.has(String(c))) fe.push({ field: `permissionCodes[${i}]`, message: 'Unknown permission' })
    })
  }
  return fe
}

function nameTaken(name: string, exceptId?: string): boolean {
  return db.roles.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.trim().toLowerCase())
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

export const roleHandlers = [
  // Before /roles/{roleId}, which would otherwise match "options" as an id.
  http.get('/roles/options', async ({ response }) => {
    await latency()
    const list = db.roles
      .slice()
      .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name))
      .map((r) => ({ id: r.id, name: r.name, ...(r.key ? { key: r.key } : {}) }))
    return response(200).json(list)
  }),

  http.get('/roles', async ({ response }) => {
    await latency()
    const list = db.roles
      .slice()
      .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name))
      .map(summary)
    return response(200).json(list)
  }),

  http.post('/roles', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe = checkBody(body)
    if (fe.length) return response.untyped(validation(fe))
    if (nameTaken(body.name)) {
      return response.untyped(
        problem(409, 'ROLE_NAME_TAKEN', `A role named "${body.name.trim()}" already exists.`),
      )
    }
    const now = nowIso()
    const role: Role = {
      id: newId(),
      name: body.name.trim(),
      ...(body.description ? { description: body.description } : {}),
      system: false,
      permissionCodes: [...new Set(body.permissionCodes)],
      userCount: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    db.roles.push(role)
    audit('CREATE', 'ROLE', {
      actor: c.user,
      terminal: c.terminal,
      entityId: role.id,
      after: { name: role.name, permissionCodes: role.permissionCodes },
    })
    persist()
    return response(201).json(roleOut(role))
  }),

  http.get('/roles/{roleId}', async ({ params, response }) => {
    await latency()
    const r = db.roles.find((x) => x.id === params.roleId)
    return r ? response(200).json(roleOut(r)) : response.untyped(notFound('role'))
  }),

  http.put('/roles/{roleId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const r = db.roles.find((x) => x.id === params.roleId)
    if (!r) return response.untyped(notFound('role'))
    const body = await request.json()
    const fe = checkBody(body)
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== r.version) return response.untyped(versionConflict('role'))
    const codes = [...new Set(body.permissionCodes)] as PermissionCode[]
    if (r.system && body.name.trim() !== r.name) {
      return response.untyped(problem(409, 'SYSTEM_ROLE_READ_ONLY', 'System roles cannot be renamed.'))
    }
    if (r.id === ROLE_IDS.owner && !sameSet(codes, r.permissionCodes)) {
      return response.untyped(
        problem(409, 'OWNER_ROLE_READ_ONLY', 'The Owner role always holds every permission.'),
      )
    }
    if (nameTaken(body.name, r.id)) {
      return response.untyped(
        problem(409, 'ROLE_NAME_TAKEN', `A role named "${body.name.trim()}" already exists.`),
      )
    }
    const before = { name: r.name, permissionCodes: r.permissionCodes }
    r.name = body.name.trim()
    if (body.description) r.description = body.description
    else delete r.description
    r.permissionCodes = codes
    r.version += 1
    r.updatedAt = nowIso()
    // Keep embedded role names in step.
    for (const u of db.users) for (const ref of u.roles) if (ref.id === r.id) ref.name = r.name
    audit('UPDATE', 'ROLE', {
      actor: c.user,
      terminal: c.terminal,
      entityId: r.id,
      before,
      after: { name: r.name, permissionCodes: r.permissionCodes },
    })
    persist()
    return response(200).json(roleOut(r))
  }),

  http.delete('/roles/{roleId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const idx = db.roles.findIndex((x) => x.id === params.roleId)
    const r = db.roles[idx]
    if (!r) return response.untyped(notFound('role'))
    if (r.system)
      return response.untyped(problem(409, 'SYSTEM_ROLE_READ_ONLY', 'System roles cannot be deleted.'))
    const holders = db.users.filter((u) => u.roles.some((x) => x.id === r.id))
    if (holders.length) {
      return response.untyped(
        problem(
          409,
          'ROLE_IN_USE',
          `This role is still assigned to ${holders.length} user(s). Give them another role first.`,
        ),
      )
    }
    db.roles.splice(idx, 1)
    audit('DELETE', 'ROLE', {
      actor: c.user,
      terminal: c.terminal,
      entityId: r.id,
      before: { name: r.name, permissionCodes: r.permissionCodes },
    })
    persist()
    return response(204).empty()
  }),

  http.get('/permissions', async ({ response }) => {
    await latency()
    return response(200).json(PERMISSIONS)
  }),
]
