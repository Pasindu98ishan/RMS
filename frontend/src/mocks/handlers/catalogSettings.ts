import type { FieldError } from '@/api/errors'
import { REASON_CATEGORIES } from '@/api/types'
import { audit, db, newId, nowIso, persist } from '../db'
import { http, latency, mustCaller, notFound, validation, versionConflict } from '../http'
import type { MockArea, MockReason } from '../seedCatalog'

const MONEY_RE = /^\d{1,10}\.\d{2}$/
const lower = (s: string) => s.trim().toLowerCase()

function areaErrors(body: { name?: string; fee?: string }, exceptId?: string): FieldError[] {
  const fe: FieldError[] = []
  if (!body.name?.trim() || body.name.length > 100)
    fe.push({ field: 'name', message: 'Area name is required (up to 100 characters)' })
  else if (db.areas.some((a) => a.id !== exceptId && lower(a.name) === lower(body.name as string))) {
    fe.push({ field: 'name', message: `An area named "${body.name.trim()}" already exists` })
  }
  if (!body.fee || !MONEY_RE.test(body.fee))
    fe.push({ field: 'fee', message: 'Fee must be an amount like 150.00 (0.00 for free)' })
  return fe
}

function reasonErrors(
  body: { category?: string; text?: string },
  exceptId?: string,
  category?: string,
): FieldError[] {
  const fe: FieldError[] = []
  const cat = category ?? body.category
  if (!REASON_CATEGORIES.includes(cat as never))
    fe.push({ field: 'category', message: 'Choose a reason list' })
  if (!body.text?.trim() || body.text.length > 200)
    fe.push({ field: 'text', message: 'Reason text is required (up to 200 characters)' })
  else if (
    db.reasons.some(
      (r) => r.id !== exceptId && r.category === cat && lower(r.text) === lower(body.text as string),
    )
  ) {
    fe.push({ field: 'text', message: 'This reason is already in the list' })
  }
  return fe
}

export const catalogSettingsHandlers = [
  // ---------------------------------------------------------------- menu setting
  http.get('/settings/menu', async ({ response }) => {
    await latency()
    return response(200).json({ ...db.menuSettings })
  }),
  http.put('/settings/menu', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    if (body.version !== db.menuSettings.version) return response.untyped(versionConflict('setting'))
    const before = { resetAvailabilityDaily: db.menuSettings.resetAvailabilityDaily }
    db.menuSettings = {
      resetAvailabilityDaily: body.resetAvailabilityDaily,
      version: db.menuSettings.version + 1,
      updatedAt: nowIso(),
    }
    audit('SETTINGS_CHANGED', 'SETTING', {
      actor: c.user,
      terminal: c.terminal,
      entityId: 'menu',
      before,
      after: { resetAvailabilityDaily: body.resetAvailabilityDaily },
    })
    persist()
    return response(200).json({ ...db.menuSettings })
  }),

  // ---------------------------------------------------------------- delivery areas
  http.get('/delivery-areas/options', async ({ response }) => {
    await latency()
    return response(200).json(
      db.areas
        .filter((a) => a.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ id: a.id, name: a.name, fee: a.fee })),
    )
  }),
  http.get('/delivery-areas', async ({ response }) => {
    await latency()
    return response(200).json(
      db.areas
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ ...a })),
    )
  }),
  http.post('/delivery-areas', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe = areaErrors(body)
    if (fe.length) return response.untyped(validation(fe))
    const now = nowIso()
    const area: MockArea = {
      id: newId(),
      name: body.name.trim(),
      fee: body.fee,
      active: body.active ?? true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    db.areas.push(area)
    audit('CREATE', 'DELIVERY_AREA', {
      actor: c.user,
      terminal: c.terminal,
      entityId: area.id,
      after: { name: area.name, fee: area.fee },
    })
    persist()
    return response(201).json({ ...area })
  }),
  http.get('/delivery-areas/{areaId}', async ({ params, response }) => {
    await latency()
    const a = db.areas.find((x) => x.id === params.areaId)
    return a ? response(200).json({ ...a }) : response.untyped(notFound('delivery area'))
  }),
  http.put('/delivery-areas/{areaId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const a = db.areas.find((x) => x.id === params.areaId)
    if (!a) return response.untyped(notFound('delivery area'))
    const body = await request.json()
    const fe = areaErrors(body, a.id)
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== a.version) return response.untyped(versionConflict('delivery area'))
    const before = { name: a.name, fee: a.fee, active: a.active }
    a.name = body.name.trim()
    a.fee = body.fee
    a.active = body.active
    a.version += 1
    a.updatedAt = nowIso()
    audit('UPDATE', 'DELIVERY_AREA', {
      actor: c.user,
      terminal: c.terminal,
      entityId: a.id,
      before,
      after: { name: a.name, fee: a.fee, active: a.active },
    })
    persist()
    return response(200).json({ ...a })
  }),

  // ---------------------------------------------------------------- reasons
  http.get('/reasons/options', async ({ query, response }) => {
    await latency()
    const category = query.get('category')
    return response(200).json(
      db.reasons.filter((r) => r.active && r.category === category).map((r) => ({ id: r.id, text: r.text })),
    )
  }),
  http.get('/reasons', async ({ query, response }) => {
    await latency()
    const category = query.get('category')
    return response(200).json(
      db.reasons.filter((r) => !category || r.category === category).map((r) => ({ ...r })),
    )
  }),
  http.post('/reasons', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe = reasonErrors(body)
    if (fe.length) return response.untyped(validation(fe))
    const now = nowIso()
    const r: MockReason = {
      id: newId(),
      category: body.category,
      text: body.text.trim(),
      active: body.active ?? true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    db.reasons.push(r)
    audit('CREATE', 'REASON', {
      actor: c.user,
      terminal: c.terminal,
      entityId: r.id,
      after: { category: r.category, text: r.text },
    })
    persist()
    return response(201).json({ ...r })
  }),
  http.put('/reasons/{reasonId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const r = db.reasons.find((x) => x.id === params.reasonId)
    if (!r) return response.untyped(notFound('reason'))
    const body = await request.json()
    const fe = reasonErrors(body, r.id, r.category)
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== r.version) return response.untyped(versionConflict('reason'))
    const before = { text: r.text, active: r.active }
    r.text = body.text.trim()
    r.active = body.active
    r.version += 1
    r.updatedAt = nowIso()
    audit('UPDATE', 'REASON', {
      actor: c.user,
      terminal: c.terminal,
      entityId: r.id,
      before,
      after: { text: r.text, active: r.active },
    })
    persist()
    return response(200).json({ ...r })
  }),
]
