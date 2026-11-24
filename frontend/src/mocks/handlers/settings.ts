import type { FieldError } from '@/api/errors'
import { RATE_PATTERN } from '@/utils/money'
import { audit, db, nowIso, persist } from '../db'
import { http, latency, mustCaller, problem, validation, versionConflict, type Caller } from '../http'

function changed(
  c: Caller,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  audit('SETTINGS_CHANGED', 'SETTING', { actor: c.user, terminal: c.terminal, entityId, before, after })
}

export const settingsHandlers = [
  http.get('/settings/restaurant', async ({ response }) => {
    await latency()
    return response(200).json(db.settings.restaurant)
  }),

  http.put('/settings/restaurant', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe: FieldError[] = []
    const req = (field: 'name' | 'address' | 'phone', label: string, max: number) => {
      const v = body[field]?.trim() ?? ''
      if (!v) fe.push({ field, message: `${label} is required` })
      else if (v.length > max) fe.push({ field, message: `${label} is up to ${max} characters` })
    }
    req('name', 'Restaurant name', 60)
    req('address', 'Address', 200)
    req('phone', 'Phone', 40)
    if (body.receiptFooter !== undefined && body.receiptFooter.length > 300) {
      fe.push({ field: 'receiptFooter', message: 'Receipt footer is up to 300 characters' })
    }
    if (fe.length) return response.untyped(validation(fe))
    const cur = db.settings.restaurant
    if (body.version !== cur.version) return response.untyped(versionConflict('setting'))
    const before = { ...cur }
    db.settings.restaurant = {
      name: body.name.trim(),
      address: body.address,
      phone: body.phone.trim(),
      ...(body.receiptFooter ? { receiptFooter: body.receiptFooter } : {}),
      version: cur.version + 1,
      updatedAt: nowIso(),
    }
    changed(c, 'restaurant', before, { ...db.settings.restaurant })
    persist()
    return response(200).json(db.settings.restaurant)
  }),

  http.get('/settings/service-charges', async ({ response }) => {
    await latency()
    return response(200).json(db.settings.serviceCharges)
  }),

  http.put('/settings/service-charges', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe: FieldError[] = []
    const types = body.rules?.map((r) => r.orderType) ?? []
    if (types.length !== 3 || new Set(types).size !== 3) {
      fe.push({ field: 'rules', message: 'Send one rule for each of dine-in, takeaway and delivery' })
    }
    body.rules?.forEach((r, i) => {
      if (!RATE_PATTERN.test(r.rate))
        fe.push({ field: `rules[${i}].rate`, message: 'Rate must be 0.00 to 100.00' })
    })
    if (fe.length) return response.untyped(validation(fe))
    const cur = db.settings.serviceCharges
    if (body.version !== cur.version) return response.untyped(versionConflict('setting'))
    const before = Object.fromEntries(cur.rules.map((r) => [r.orderType, r.rate]))
    db.settings.serviceCharges = {
      rules: body.rules.map((r) => ({ orderType: r.orderType, rate: r.rate })),
      version: cur.version + 1,
      updatedAt: nowIso(),
    }
    changed(c, 'service-charges', before, Object.fromEntries(body.rules.map((r) => [r.orderType, r.rate])))
    persist()
    return response(200).json(db.settings.serviceCharges)
  }),

  http.get('/settings/tax', async ({ response }) => {
    await latency()
    return response(200).json(db.settings.tax)
  }),

  http.put('/settings/tax', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    if (!RATE_PATTERN.test(body.rate)) {
      return response.untyped(validation([{ field: 'rate', message: 'Rate must be 0.00 to 100.00' }]))
    }
    const cur = db.settings.tax
    if (body.version !== cur.version) return response.untyped(versionConflict('setting'))
    if (body.enabled) {
      return response.untyped(
        problem(
          409,
          'TAX_NOT_SUPPORTED',
          'Tax cannot be switched on yet. The client decided on no tax for now (ADR-002).',
          undefined,
          'Tax not supported',
        ),
      )
    }
    const before = { ...cur }
    db.settings.tax = {
      enabled: false,
      rate: body.rate,
      ...(body.label ? { label: body.label } : {}),
      version: cur.version + 1,
      updatedAt: nowIso(),
    }
    changed(c, 'tax', before, { ...db.settings.tax })
    persist()
    return response(200).json(db.settings.tax)
  }),

  http.get('/settings/business-day', async ({ response }) => {
    await latency()
    return response(200).json(db.settings.businessDay)
  }),

  http.put('/settings/business-day', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.dayStartTime ?? '')) {
      return response.untyped(
        validation([{ field: 'dayStartTime', message: 'Enter a time as HH:mm (24 h)' }]),
      )
    }
    const cur = db.settings.businessDay
    if (body.version !== cur.version) return response.untyped(versionConflict('setting'))
    const before = { dayStartTime: cur.dayStartTime }
    db.settings.businessDay = {
      ...cur,
      dayStartTime: body.dayStartTime,
      version: cur.version + 1,
      updatedAt: nowIso(),
    }
    changed(c, 'business-day', before, { dayStartTime: body.dayStartTime })
    persist()
    return response(200).json(db.settings.businessDay)
  }),

  http.get('/settings/idle-timeouts', async ({ response }) => {
    await latency()
    return response(200).json(db.settings.idleTimeouts)
  }),

  http.put('/settings/idle-timeouts', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe: FieldError[] = []
    const allowed = ['CASHIER_POS', 'RECEPTION_POS', 'ADMIN']
    const types = body.rules?.map((r) => r.terminalType) ?? []
    if (types.length !== 3 || new Set(types).size !== 3 || !types.every((t) => allowed.includes(t))) {
      fe.push({ field: 'rules', message: 'Send one rule for each of cashier POS, reception POS and admin' })
    }
    body.rules?.forEach((r, i) => {
      const m = r.idleTimeoutMinutes
      if (!Number.isInteger(m) || m < 1 || m > 240) {
        fe.push({ field: `rules[${i}].idleTimeoutMinutes`, message: 'Enter whole minutes from 1 to 240' })
      }
    })
    const pm = body.idleTimeoutPersonalMinutes
    if (pm !== undefined && (!Number.isInteger(pm) || pm < 1 || pm > 240)) {
      fe.push({ field: 'idleTimeoutPersonalMinutes', message: 'Enter whole minutes from 1 to 240' })
    }
    if (fe.length) return response.untyped(validation(fe))
    const cur = db.settings.idleTimeouts
    if (body.version !== cur.version) return response.untyped(versionConflict('setting'))
    const before = Object.fromEntries(
      cur.rules.map((r) => [r.terminalType, r.idleTimeoutMinutes ?? 'exempt']),
    )
    db.settings.idleTimeouts = {
      rules: cur.rules.map((r) => {
        const input = body.rules.find((x) => x.terminalType === r.terminalType)
        return input
          ? { terminalType: r.terminalType, exempt: false, idleTimeoutMinutes: input.idleTimeoutMinutes }
          : r
      }),
      // Optional in the request: absent keeps the current value.
      idleTimeoutPersonalMinutes: body.idleTimeoutPersonalMinutes ?? cur.idleTimeoutPersonalMinutes,
      version: cur.version + 1,
      updatedAt: nowIso(),
    }
    changed(
      c,
      'idle-timeouts',
      before,
      Object.fromEntries(body.rules.map((r) => [r.terminalType, r.idleTimeoutMinutes])),
    )
    persist()
    return response(200).json(db.settings.idleTimeouts)
  }),
]
