import type { FieldError } from '@/api/errors'
import type { Category, MenuItem, MenuItemSummary, ModifierGroup, ModifierOption } from '@/api/types'
import { audit, db, newId, nowIso, persist } from '../db'
import { http, latency, mustCaller, notFound, paginate, problem, validation, versionConflict } from '../http'
import type { MockCategory, MockItem, MockModifierGroup } from '../seedCatalog'

const MONEY_RE = /^\d{1,10}\.\d{2}$/
const CODE_RE = /^[A-Z0-9-]{1,20}$/

const lower = (s: string) => s.trim().toLowerCase()

// ---------------------------------------------------------------- projections
function categoryOut(c: MockCategory): Category {
  return { ...c, itemCount: db.items.filter((i) => i.categoryId === c.id).length }
}

function groupRef(id: string) {
  const g = db.modifierGroups.find((x) => x.id === id)
  return g ? { id: g.id, name: g.name } : null
}

function itemSummary(i: MockItem): MenuItemSummary {
  const out: MenuItemSummary = {
    id: i.id,
    code: i.code,
    name: i.name,
    categoryId: i.categoryId,
    categoryName: db.categories.find((c) => c.id === i.categoryId)?.name ?? '',
    stationId: i.stationId,
    stationName: db.stations.find((s) => s.id === i.stationId)?.name ?? '',
    localPrice: i.localPrice,
    active: i.active,
    available: i.available,
    modifierGroupCount: i.groupIds.length,
    version: i.version,
  }
  if (i.foreignPrice) out.foreignPrice = i.foreignPrice
  return out
}

function itemOut(i: MockItem): MenuItem {
  const s = itemSummary(i)
  const out: MenuItem = {
    id: s.id,
    code: s.code,
    name: s.name,
    categoryId: s.categoryId,
    categoryName: s.categoryName,
    stationId: s.stationId,
    stationName: s.stationName,
    localPrice: s.localPrice,
    active: s.active,
    available: s.available,
    modifierGroups: i.groupIds.flatMap((id) => groupRef(id) ?? []),
    version: i.version,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  }
  if (s.foreignPrice) out.foreignPrice = s.foreignPrice
  return out
}

function groupOut(g: MockModifierGroup): ModifierGroup {
  return {
    ...g,
    options: g.options.map((o) => ({ ...o })),
    itemCount: db.items.filter((i) => i.groupIds.includes(g.id)).length,
  }
}

// ---------------------------------------------------------------- validation
interface ItemBody {
  code?: string
  name?: string
  categoryId?: string
  stationId?: string
  localPrice?: string
  foreignPrice?: string
  modifierGroupIds?: string[]
}

function itemErrors(body: ItemBody, exceptId?: string): FieldError[] {
  const fe: FieldError[] = []
  if (!body.code || !CODE_RE.test(body.code)) {
    fe.push({ field: 'code', message: 'Code is 1 to 20 characters: capital letters, digits and dash' })
  } else if (db.items.some((i) => i.id !== exceptId && i.code === body.code)) {
    fe.push({ field: 'code', message: `The code ${body.code} is already used by another item` })
  }
  if (!body.name?.trim() || body.name.length > 100)
    fe.push({ field: 'name', message: 'Name is required (up to 100 characters)' })
  if (!db.categories.some((c) => c.id === body.categoryId))
    fe.push({ field: 'categoryId', message: 'Choose a category' })
  if (!body.stationId)
    fe.push({ field: 'stationId', message: 'Choose the kitchen station that prepares this item' })
  else if (!db.stations.some((s) => s.id === body.stationId))
    fe.push({ field: 'stationId', message: 'Unknown kitchen station' })
  if (!body.localPrice || !MONEY_RE.test(body.localPrice))
    fe.push({ field: 'localPrice', message: 'Local price must be an amount like 950.00' })
  if (body.foreignPrice !== undefined && !MONEY_RE.test(body.foreignPrice)) {
    fe.push({ field: 'foreignPrice', message: 'Foreign price must be an amount like 1425.00' })
  }
  body.modifierGroupIds?.forEach((id, i) => {
    if (!db.modifierGroups.some((g) => g.id === id))
      fe.push({ field: `modifierGroupIds[${i}]`, message: 'Unknown modifier group' })
  })
  return fe
}

interface GroupBody {
  name?: string
  required?: boolean
  minSelect?: number
  maxSelect?: number
  options?: Array<{ id?: string; name?: string; priceDelta?: string }>
}

function groupErrors(body: GroupBody, exceptId?: string): FieldError[] {
  const fe: FieldError[] = []
  if (!body.name?.trim() || body.name.length > 50)
    fe.push({ field: 'name', message: 'Group name is required (up to 50 characters)' })
  else if (db.modifierGroups.some((g) => g.id !== exceptId && lower(g.name) === lower(body.name as string))) {
    fe.push({ field: 'name', message: `A modifier group named "${body.name.trim()}" already exists` })
  }
  const options = body.options ?? []
  if (options.length === 0) fe.push({ field: 'options', message: 'Add at least one option' })
  options.forEach((o, i) => {
    if (!o.name?.trim() || o.name.length > 50)
      fe.push({ field: `options[${i}].name`, message: 'Option name is required (up to 50 characters)' })
    if (!o.priceDelta || !MONEY_RE.test(o.priceDelta))
      fe.push({
        field: `options[${i}].priceDelta`,
        message: 'Price must be an amount like 100.00 (0.00 for none)',
      })
  })
  const min = body.minSelect ?? 0
  const max = body.maxSelect ?? 0
  if (body.required && min < 1)
    fe.push({ field: 'minSelect', message: 'A required group needs a minimum of at least 1' })
  if (!body.required && min !== 0)
    fe.push({ field: 'minSelect', message: 'An optional group has a minimum of 0' })
  if (max < 1) fe.push({ field: 'maxSelect', message: 'Maximum is at least 1' })
  else if (max < min) fe.push({ field: 'maxSelect', message: 'Maximum cannot be less than the minimum' })
  else if (options.length > 0 && max > options.length)
    fe.push({ field: 'maxSelect', message: 'Maximum cannot be more than the number of options' })
  return fe
}

function toOptions(input: GroupBody['options'], existing: ModifierOption[] = []): ModifierOption[] {
  return (input ?? []).map((o) => ({
    id: o.id && existing.some((e) => e.id === o.id) ? o.id : newId(),
    name: (o.name as string).trim(),
    priceDelta: o.priceDelta as string,
  }))
}

export const menuHandlers = [
  // ---------------------------------------------------------------- kitchen stations
  http.get('/kitchen-stations/options', async ({ response }) => {
    await latency()
    return response(200).json(
      db.stations
        .filter((s) => s.active)
        .sort((a, b) => a.number - b.number)
        .map((s) => ({ id: s.id, number: s.number, name: s.name })),
    )
  }),
  http.get('/kitchen-stations', async ({ response }) => {
    await latency()
    return response(200).json(
      db.stations
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((s) => ({
          ...s,
          activeItemCount: db.items.filter((i) => i.active && i.stationId === s.id).length,
        })),
    )
  }),
  http.get('/kitchen-stations/{stationId}', async ({ params, response }) => {
    await latency()
    const s = db.stations.find((x) => x.id === params.stationId)
    return s
      ? response(200).json({
          ...s,
          activeItemCount: db.items.filter((i) => i.active && i.stationId === s.id).length,
        })
      : response.untyped(notFound('kitchen station'))
  }),
  http.put('/kitchen-stations/{stationId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const s = db.stations.find((x) => x.id === params.stationId)
    if (!s) return response.untyped(notFound('kitchen station'))
    const body = await request.json()
    const fe: FieldError[] = []
    if (!body.name?.trim() || body.name.length > 50)
      fe.push({ field: 'name', message: 'Station name is required (up to 50 characters)' })
    else if (db.stations.some((x) => x.id !== s.id && lower(x.name) === lower(body.name))) {
      fe.push({ field: 'name', message: `A station named "${body.name.trim()}" already exists` })
    }
    if (
      !Number.isInteger(body.targetPrepMinutes) ||
      body.targetPrepMinutes < 1 ||
      body.targetPrepMinutes > 240
    ) {
      fe.push({ field: 'targetPrepMinutes', message: 'Enter whole minutes from 1 to 240' })
    }
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== s.version) return response.untyped(versionConflict('station'))
    const active = db.items.filter((i) => i.active && i.stationId === s.id).length
    if (!body.active && s.active && active > 0) {
      return response.untyped(
        problem(
          409,
          'STATION_IN_USE',
          `${active} active menu item(s) are mapped to this station. Move them to another station first.`,
        ),
      )
    }
    const before = { name: s.name, targetPrepMinutes: s.targetPrepMinutes, active: s.active }
    s.name = body.name.trim()
    s.targetPrepMinutes = body.targetPrepMinutes
    s.active = body.active
    s.version += 1
    s.updatedAt = nowIso()
    audit('UPDATE', 'KITCHEN_STATION', {
      actor: c.user,
      terminal: c.terminal,
      entityId: s.id,
      before,
      after: { name: s.name, targetPrepMinutes: s.targetPrepMinutes, active: s.active },
    })
    persist()
    return response(200).json({ ...s, activeItemCount: active })
  }),

  // ---------------------------------------------------------------- categories
  http.get('/categories', async ({ response }) => {
    await latency()
    return response(200).json(
      db.categories
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map(categoryOut),
    )
  }),
  http.post('/categories', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe: FieldError[] = []
    if (!body.name?.trim() || body.name.length > 50)
      fe.push({ field: 'name', message: 'Category name is required (up to 50 characters)' })
    else if (db.categories.some((x) => lower(x.name) === lower(body.name)))
      fe.push({ field: 'name', message: `A category named "${body.name.trim()}" already exists` })
    if (body.sortOrder !== undefined && (!Number.isInteger(body.sortOrder) || body.sortOrder < 0))
      fe.push({ field: 'sortOrder', message: 'Display order is a whole number, 0 or more' })
    if (fe.length) return response.untyped(validation(fe))
    const now = nowIso()
    const cat: MockCategory = {
      id: newId(),
      name: body.name.trim(),
      sortOrder: body.sortOrder ?? Math.max(0, ...db.categories.map((x) => x.sortOrder)) + 1,
      active: body.active ?? true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    db.categories.push(cat)
    audit('CREATE', 'CATEGORY', {
      actor: c.user,
      terminal: c.terminal,
      entityId: cat.id,
      after: { name: cat.name },
    })
    persist()
    return response(201).json(categoryOut(cat))
  }),
  http.get('/categories/{categoryId}', async ({ params, response }) => {
    await latency()
    const cat = db.categories.find((x) => x.id === params.categoryId)
    return cat ? response(200).json(categoryOut(cat)) : response.untyped(notFound('category'))
  }),
  http.put('/categories/{categoryId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const cat = db.categories.find((x) => x.id === params.categoryId)
    if (!cat) return response.untyped(notFound('category'))
    const body = await request.json()
    const fe: FieldError[] = []
    if (!body.name?.trim() || body.name.length > 50)
      fe.push({ field: 'name', message: 'Category name is required (up to 50 characters)' })
    else if (db.categories.some((x) => x.id !== cat.id && lower(x.name) === lower(body.name)))
      fe.push({ field: 'name', message: `A category named "${body.name.trim()}" already exists` })
    if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0)
      fe.push({ field: 'sortOrder', message: 'Display order is a whole number, 0 or more' })
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== cat.version) return response.untyped(versionConflict('category'))
    const before = { name: cat.name, sortOrder: cat.sortOrder, active: cat.active }
    cat.name = body.name.trim()
    cat.sortOrder = body.sortOrder
    cat.active = body.active
    cat.version += 1
    cat.updatedAt = nowIso()
    audit('UPDATE', 'CATEGORY', {
      actor: c.user,
      terminal: c.terminal,
      entityId: cat.id,
      before,
      after: { name: cat.name, sortOrder: cat.sortOrder, active: cat.active },
    })
    persist()
    return response(200).json(categoryOut(cat))
  }),

  // ---------------------------------------------------------------- menu items
  http.get('/menu-items', async ({ query, response }) => {
    await latency()
    let list = db.items.slice()
    const categoryId = query.get('categoryId')
    const stationId = query.get('stationId')
    const active = query.get('active')
    const available = query.get('available')
    const search = query.get('search')?.trim().toLowerCase()
    if (categoryId) list = list.filter((i) => i.categoryId === categoryId)
    if (stationId) list = list.filter((i) => i.stationId === stationId)
    if (active === 'true' || active === 'false') list = list.filter((i) => i.active === (active === 'true'))
    if (available === 'true' || available === 'false')
      list = list.filter((i) => i.available === (available === 'true'))
    if (search)
      list = list.filter(
        (i) => i.code.toLowerCase().includes(search) || i.name.toLowerCase().includes(search),
      )
    list.sort((a, b) => a.code.localeCompare(b.code))
    const page = paginate(list.map(itemSummary), query.get('page'), query.get('size'))
    if (!page) return response.untyped(problem(400, 'MALFORMED_REQUEST', 'Bad page or size.'))
    return response(200).json(page)
  }),
  http.post('/menu-items', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe = itemErrors(body)
    if (fe.length) return response.untyped(validation(fe))
    const now = nowIso()
    const item: MockItem = {
      id: newId(),
      code: body.code,
      name: body.name.trim(),
      categoryId: body.categoryId,
      stationId: body.stationId,
      localPrice: body.localPrice,
      ...(body.foreignPrice ? { foreignPrice: body.foreignPrice } : {}),
      active: body.active ?? true,
      available: true,
      groupIds: body.modifierGroupIds ?? [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    db.items.push(item)
    audit('CREATE', 'MENU_ITEM', {
      actor: c.user,
      terminal: c.terminal,
      entityId: item.id,
      after: {
        code: item.code,
        name: item.name,
        localPrice: item.localPrice,
        foreignPrice: item.foreignPrice ?? null,
      },
    })
    persist()
    return response(201).json(itemOut(item))
  }),
  http.get('/menu-items/{itemId}', async ({ params, response }) => {
    await latency()
    const i = db.items.find((x) => x.id === params.itemId)
    return i ? response(200).json(itemOut(i)) : response.untyped(notFound('menu item'))
  }),
  http.put('/menu-items/{itemId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const item = db.items.find((x) => x.id === params.itemId)
    if (!item) return response.untyped(notFound('menu item'))
    const body = await request.json()
    const fe = itemErrors(body, item.id)
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== item.version) return response.untyped(versionConflict('menu item'))
    const before = {
      code: item.code,
      name: item.name,
      localPrice: item.localPrice,
      foreignPrice: item.foreignPrice ?? null,
    }
    const priceChanged =
      item.localPrice !== body.localPrice || (item.foreignPrice ?? null) !== (body.foreignPrice ?? null)
    item.code = body.code
    item.name = body.name.trim()
    item.categoryId = body.categoryId
    item.stationId = body.stationId
    item.localPrice = body.localPrice
    // PUT is a full replacement: an omitted optional field is cleared.
    if (body.foreignPrice) item.foreignPrice = body.foreignPrice
    else delete item.foreignPrice
    item.active = body.active
    item.groupIds = body.modifierGroupIds ?? []
    item.version += 1
    item.updatedAt = nowIso()
    const after = {
      code: item.code,
      name: item.name,
      localPrice: item.localPrice,
      foreignPrice: item.foreignPrice ?? null,
    }
    audit(priceChanged ? 'PRICE_CHANGED' : 'UPDATE', 'MENU_ITEM', {
      actor: c.user,
      terminal: c.terminal,
      entityId: item.id,
      before,
      after,
    })
    persist()
    return response(200).json(itemOut(item))
  }),
  http.put('/menu-items/{itemId}/availability', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const item = db.items.find((x) => x.id === params.itemId)
    if (!item) return response.untyped(notFound('menu item'))
    const body = await request.json()
    if (item.available !== body.available) {
      item.available = body.available
      audit('UPDATE', 'MENU_ITEM', {
        actor: c.user,
        terminal: c.terminal,
        entityId: item.id,
        before: { available: !body.available },
        after: { available: body.available },
      })
      persist()
    }
    return response(200).json({ id: item.id, code: item.code, name: item.name, available: item.available })
  }),
  http.get('/menu/availability', async ({ response }) => {
    await latency()
    const list = db.items
      .filter((i) => i.active)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        categoryName: db.categories.find((c) => c.id === i.categoryId)?.name ?? '',
        available: i.available,
      }))
    return response(200).json(list)
  }),
  http.get('/menu/pos', async ({ response }) => {
    await latency()
    const groups = db.modifierGroups.filter((g) => g.active)
    const groupIds = new Set(groups.map((g) => g.id))
    return response(200).json({
      generatedAt: nowIso(),
      categories: db.categories
        .filter((c) => c.active)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({
          id: c.id,
          name: c.name,
          sortOrder: c.sortOrder,
          items: db.items
            .filter((i) => i.active && i.categoryId === c.id)
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((i) => ({
              id: i.id,
              code: i.code,
              name: i.name,
              stationId: i.stationId,
              localPrice: i.localPrice,
              ...(i.foreignPrice ? { foreignPrice: i.foreignPrice } : {}),
              available: i.available,
              modifierGroupIds: i.groupIds.filter((id) => groupIds.has(id)),
            })),
        })),
      modifierGroups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        options: g.options.map((o) => ({ ...o })),
      })),
      kitchenStations: db.stations
        .filter((s) => s.active)
        .sort((a, b) => a.number - b.number)
        .map((s) => ({ id: s.id, number: s.number, name: s.name })),
    })
  }),

  // ---------------------------------------------------------------- modifier groups
  http.get('/modifier-groups', async ({ response }) => {
    await latency()
    return response(200).json(
      db.modifierGroups
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(groupOut),
    )
  }),
  http.post('/modifier-groups', async ({ request, response }) => {
    await latency()
    const c = mustCaller(request)
    const body = await request.json()
    const fe = groupErrors(body)
    if (fe.length) return response.untyped(validation(fe))
    const now = nowIso()
    const g: MockModifierGroup = {
      id: newId(),
      name: body.name.trim(),
      required: body.required,
      minSelect: body.minSelect,
      maxSelect: body.maxSelect,
      active: body.active ?? true,
      options: toOptions(body.options),
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    db.modifierGroups.push(g)
    audit('CREATE', 'MODIFIER_GROUP', {
      actor: c.user,
      terminal: c.terminal,
      entityId: g.id,
      after: { name: g.name, options: g.options.length },
    })
    persist()
    return response(201).json(groupOut(g))
  }),
  http.get('/modifier-groups/{groupId}', async ({ params, response }) => {
    await latency()
    const g = db.modifierGroups.find((x) => x.id === params.groupId)
    return g ? response(200).json(groupOut(g)) : response.untyped(notFound('modifier group'))
  }),
  http.put('/modifier-groups/{groupId}', async ({ params, request, response }) => {
    await latency()
    const c = mustCaller(request)
    const g = db.modifierGroups.find((x) => x.id === params.groupId)
    if (!g) return response.untyped(notFound('modifier group'))
    const body = await request.json()
    const fe = groupErrors(body, g.id)
    if (fe.length) return response.untyped(validation(fe))
    if (body.version !== g.version) return response.untyped(versionConflict('modifier group'))
    const before = { name: g.name, options: g.options.map((o) => `${o.name} ${o.priceDelta}`) }
    g.name = body.name.trim()
    g.required = body.required
    g.minSelect = body.minSelect
    g.maxSelect = body.maxSelect
    g.active = body.active
    g.options = toOptions(body.options, g.options)
    g.version += 1
    g.updatedAt = nowIso()
    audit('UPDATE', 'MODIFIER_GROUP', {
      actor: c.user,
      terminal: c.terminal,
      entityId: g.id,
      before,
      after: { name: g.name, options: g.options.map((o) => `${o.name} ${o.priceDelta}`) },
    })
    persist()
    return response(200).json(groupOut(g))
  }),
]
