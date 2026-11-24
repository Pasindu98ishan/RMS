import type { FieldError } from '@/api/errors'
import type { DiningTable } from '@/api/types'
import { FLOOR_HEIGHT, FLOOR_WIDTH } from '@/api/types'
import { audit, db, newId, nowIso, persist } from '../db'
import { http, latency, mustCaller, notFound, validation, versionConflict } from '../http'
import type { MockTable } from '../seedCatalog'

const NUMBER_RE = /^[A-Za-z0-9-]{1,10}$/

const out = (t: MockTable): DiningTable => ({ ...t })
const lower = (s: string) => s.trim().toLowerCase()

function tableErrors(
  body: { number?: string; section?: string; seats?: number; x?: number; y?: number },
  exceptId?: string,
): FieldError[] {
  const fe: FieldError[] = []
  if (!body.number || !NUMBER_RE.test(body.number)) {
    fe.push({ field: 'number', message: 'Table number is 1 to 10 letters, digits or dashes' })
  } else if (db.tables.some((t) => t.id !== exceptId && lower(t.number) === lower(body.number as string))) {
    fe.push({ field: 'number', message: `Table ${body.number} already exists` })
  }
  if (!body.section?.trim() || body.section.length > 30)
    fe.push({ field: 'section', message: 'Section is required (up to 30 characters)' })
  if (!Number.isInteger(body.seats) || (body.seats as number) < 1 || (body.seats as number) > 50) {
    fe.push({ field: 'seats', message: 'Seats is a whole number from 1 to 50' })
  }
  if (body.x !== undefined && !(Number.isInteger(body.x) && body.x >= 0 && body.x <= FLOOR_WIDTH)) {
    fe.push({ field: 'x', message: `x is 0 to ${FLOOR_WIDTH}` })
  }
  if (body.y !== undefined && !(Number.isInteger(body.y) && body.y >= 0 && body.y <= FLOOR_HEIGHT)) {
    fe.push({ field: 'y', message: `y is 0 to ${FLOOR_HEIGHT}` })
  }
  return fe
}

export const floorHandlers = [
  http.get('/ordering-points', async ({ response }) => {
    await latency()
    return response(200).json(db.orderingPoints.map((p) => ({ ...p })))
  }),

  http.get('/tables', async ({ query, response }) => {
    await latency()
    let list = db.tables.slice()
    const active = query.get('active')
    const section = query.get('section')
    if (active === 'true' || active === 'false') list = list.filter((t) => t.active === (active === 'true'))
    if (section) list = list.filter((t) => lower(t.section) === lower(section))
    list.sort(
      (a, b) =>
        a.section.localeCompare(b.section) || a.number.localeCompare(b.number, undefined, { numeric: true }),
    )
    return response(200).json(list.map(out))
  }),

  http.post('/tables', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe = tableErrors(body)
    if (fe.length) return response.untyped(validation(fe))
    const n = db.tables.length
    const now = nowIso()
    const t: MockTable = {
      id: newId(),
      number: body.number,
      section: body.section.trim(),
      seats: body.seats,
      x: body.x ?? 120 + ((n * 60) % 760),
      y: body.y ?? 120 + ((n * 40) % 460),
      active: body.active ?? true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    db.tables.push(t)
    audit('CREATE', 'TABLE', {
      actor: c.user,
      terminal: c.terminal,
      entityId: t.id,
      after: { number: t.number, section: t.section, seats: t.seats },
    })
    persist()
    return response(201).json(out(t))
  }),

  // Before /tables/{tableId}, which would otherwise match "positions" as an id.
  http.put('/tables/positions', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe: FieldError[] = []
    const targets: Array<{ t: MockTable; x: number; y: number }> = []
    body.positions.forEach((p, i) => {
      const t = db.tables.find((x) => x.id === p.tableId)
      if (!t) {
        fe.push({ field: `positions[${i}].tableId`, message: 'Unknown table' })
        return
      }
      if (!(Number.isInteger(p.x) && p.x >= 0 && p.x <= FLOOR_WIDTH))
        fe.push({ field: `positions[${i}].x`, message: `x is 0 to ${FLOOR_WIDTH}` })
      if (!(Number.isInteger(p.y) && p.y >= 0 && p.y <= FLOOR_HEIGHT))
        fe.push({ field: `positions[${i}].y`, message: `y is 0 to ${FLOOR_HEIGHT}` })
      targets.push({ t, x: p.x, y: p.y })
    })
    if (fe.length) return response.untyped(validation(fe))
    // All or nothing: any stale version rejects the whole save.
    const stale = body.positions.find((p) => db.tables.find((x) => x.id === p.tableId)?.version !== p.version)
    if (stale) return response.untyped(versionConflict('floor plan'))
    const now = nowIso()
    for (const { t, x, y } of targets) {
      if (t.x !== x || t.y !== y) {
        t.x = x
        t.y = y
        t.version += 1
        t.updatedAt = now
      }
    }
    audit('UPDATE', 'FLOOR_PLAN', {
      actor: c.user,
      terminal: c.terminal,
      after: { tablesMoved: targets.length },
    })
    persist()
    return response(200).json(targets.map(({ t }) => out(t)))
  }),

  http.get('/tables/{tableId}', async ({ params, response }) => {
    await latency()
    const t = db.tables.find((x) => x.id === params.tableId)
    return t ? response(200).json(out(t)) : response.untyped(notFound('table'))
  }),

  http.put('/tables/{tableId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const t = db.tables.find((x) => x.id === params.tableId)
    if (!t) return response.untyped(notFound('table'))
    const body = await request.json()
    const fe = tableErrors(body, t.id)
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== t.version) return response.untyped(versionConflict('table'))
    const before = { number: t.number, section: t.section, seats: t.seats, active: t.active }
    t.number = body.number
    t.section = body.section.trim()
    t.seats = body.seats
    t.active = body.active
    t.version += 1
    t.updatedAt = nowIso()
    audit('UPDATE', 'TABLE', {
      actor: c.user,
      terminal: c.terminal,
      entityId: t.id,
      before,
      after: { number: t.number, section: t.section, seats: t.seats, active: t.active },
    })
    persist()
    return response(200).json(out(t))
  }),

  http.get('/floor/layout', async ({ response }) => {
    await latency()
    return response(200).json({
      width: FLOOR_WIDTH,
      height: FLOOR_HEIGHT,
      tables: db.tables
        .filter((t) => t.active)
        .map((t) => ({ id: t.id, number: t.number, section: t.section, seats: t.seats, x: t.x, y: t.y })),
    })
  }),
]
