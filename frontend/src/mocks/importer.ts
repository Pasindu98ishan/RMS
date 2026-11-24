/**
 * Mock spreadsheet import (P1-IMP-01): CSV only, all-or-nothing, row and column reported for every
 * error. Mirrors m1.1-scope.md "Import format". The real server also reads .xlsx.
 */
import type { ImportError, ImportReport, ImportType } from '@/api/types'
import { newId, nowIso } from './db'
import type { MockCategory, MockItem, MockModifierGroup, MockStation, MockTable } from './seedCatalog'

export interface ImportState {
  stations: MockStation[]
  categories: MockCategory[]
  modifierGroups: MockModifierGroup[]
  items: MockItem[]
  tables: MockTable[]
}

export const IMPORT_COLUMNS: Record<
  ImportType,
  { required: string[]; optional: string[]; sample: string[][] }
> = {
  CATEGORIES: {
    required: ['name', 'sort_order'],
    optional: [],
    sample: [
      ['Rice & Curry', '1'],
      ['Short Eats', '2'],
    ],
  },
  MENU_ITEMS: {
    required: ['code', 'name', 'category', 'station', 'local_price'],
    optional: ['foreign_price', 'modifier_groups', 'active'],
    sample: [
      ['RC01', 'Chicken rice & curry', 'Rice & Curry', '1', '950.00', '1425.00', 'Spice level', 'Y'],
      ['SE01', 'Fish cutlet', 'Short Eats', '1', '120.00', '', '', 'Y'],
    ],
  },
  MODIFIER_GROUPS: {
    required: ['group', 'required', 'min_select', 'max_select', 'option', 'price_delta'],
    optional: [],
    sample: [
      ['Spice level', 'Y', '1', '1', 'Mild', '0.00'],
      ['Spice level', 'Y', '1', '1', 'Hot', '0.00'],
    ],
  },
  TABLES: {
    required: ['number', 'section', 'seats'],
    optional: [],
    sample: [
      ['1', 'Indoor', '4'],
      ['G1', 'Garden', '4'],
    ],
  },
}

/** The columns in template order (required first, then optional). */
export function importHeader(type: ImportType): string[] {
  const c = IMPORT_COLUMNS[type]
  return [...c.required, ...c.optional]
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function templateCsv(type: ImportType): string {
  const rows = [importHeader(type), ...IMPORT_COLUMNS[type].sample]
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** RFC 4180-ish CSV parser: quotes, escaped quotes, CRLF / LF, UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const MONEY_RE = /^\d+\.\d{2}$/
const lower = (s: string) => s.trim().toLowerCase()
const yn = (v: string, dflt: boolean | null): boolean | null => {
  const s = v.trim().toUpperCase()
  if (s === '') return dflt
  if (s === 'Y') return true
  if (s === 'N') return false
  return null
}

interface Ctx {
  errors: ImportError[]
  /** Spreadsheet row number (header = row 1). */
  err(row: number | undefined, column: string | undefined, value: string | undefined, message: string): void
}

function makeCtx(): Ctx {
  const errors: ImportError[] = []
  return {
    errors,
    err(row, column, value, message) {
      errors.push({
        ...(row !== undefined ? { row } : {}),
        ...(column ? { column } : {}),
        ...(value !== undefined ? { value } : {}),
        message,
      })
    },
  }
}

function money(
  ctx: Ctx,
  row: number,
  column: string,
  value: string,
  optional = false,
): string | null | undefined {
  if (value.trim() === '') {
    if (optional) return null
    ctx.err(row, column, value, 'is required')
    return undefined
  }
  if (!MONEY_RE.test(value.trim())) {
    const n = Number(value)
    ctx.err(
      row,
      column,
      value,
      Number.isNaN(n)
        ? `'${value}' is not a number`
        : n < 0
          ? `'${value}' is negative`
          : `'${value}' must have exactly 2 decimals, like 950.00`,
    )
    return undefined
  }
  return value.trim()
}

function whole(
  ctx: Ctx,
  row: number,
  column: string,
  value: string,
  min: number,
  max: number,
): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    ctx.err(row, column, value, `'${value}' is not a whole number`)
    return undefined
  }
  const n = Number(value)
  if (n < min || n > max) {
    ctx.err(row, column, value, `must be from ${min} to ${max}`)
    return undefined
  }
  return n
}

/** Runs (or, with dryRun, only checks) an import against `state`. Nothing changes when `ok` is false. */
export function runImport(type: ImportType, text: string, dryRun: boolean, state: ImportState): ImportReport {
  const ctx = makeCtx()
  const rows = parseCsv(text)
  const header = (rows[0] ?? []).map((h) => h.trim())
  const body = rows.slice(1)
  const spec = IMPORT_COLUMNS[type]
  const counts = { created: 0, updated: 0, unchanged: 0 }
  const apply: Array<() => void> = []
  const report = (): ImportReport => {
    const ok = ctx.errors.length === 0
    if (ok && !dryRun) apply.forEach((fn) => fn())
    return {
      importType: type,
      dryRun,
      ok,
      rowsRead: body.length,
      counts: ok ? counts : { created: 0, updated: 0, unchanged: 0 },
      errors: ctx.errors.slice(0, 200),
      errorsTruncated: ctx.errors.length > 200,
    }
  }

  if (rows.length === 0) {
    ctx.err(undefined, undefined, undefined, 'The file is empty. The first row must be the header.')
    return report()
  }
  for (const col of spec.required) {
    if (!header.includes(col)) ctx.err(1, col, undefined, `The column "${col}" is missing from the header`)
  }
  if (ctx.errors.length) return report()
  const idx = (col: string) => header.indexOf(col)
  const cell = (r: string[], col: string) => (idx(col) >= 0 ? (r[idx(col)] ?? '').trim() : '')
  const now = nowIso()

  if (type === 'CATEGORIES') {
    const seen = new Set<string>()
    body.forEach((r, i) => {
      const row = i + 2
      const name = cell(r, 'name')
      if (!name || name.length > 50) ctx.err(row, 'name', name, 'is required (up to 50 characters)')
      else if (seen.has(lower(name))) ctx.err(row, 'name', name, 'appears twice in the file')
      seen.add(lower(name))
      const sort = whole(ctx, row, 'sort_order', cell(r, 'sort_order'), 0, 100000)
      if (!name || sort === undefined) return
      const existing = state.categories.find((c) => lower(c.name) === lower(name))
      if (!existing) {
        counts.created++
        apply.push(() =>
          state.categories.push({
            id: newId(),
            name,
            sortOrder: sort,
            active: true,
            version: 1,
            createdAt: now,
            updatedAt: now,
          }),
        )
      } else if (existing.sortOrder !== sort) {
        counts.updated++
        apply.push(() =>
          Object.assign(existing, { sortOrder: sort, version: existing.version + 1, updatedAt: now }),
        )
      } else counts.unchanged++
    })
  }

  if (type === 'TABLES') {
    const seen = new Set<string>()
    body.forEach((r, i) => {
      const row = i + 2
      const number = cell(r, 'number')
      if (!/^[A-Za-z0-9-]{1,10}$/.test(number))
        ctx.err(row, 'number', number, 'must be 1 to 10 letters, digits or dashes')
      else if (seen.has(lower(number))) ctx.err(row, 'number', number, 'appears twice in the file')
      seen.add(lower(number))
      const section = cell(r, 'section')
      if (!section || section.length > 30)
        ctx.err(row, 'section', section, 'is required (up to 30 characters)')
      const seats = whole(ctx, row, 'seats', cell(r, 'seats'), 1, 50)
      if (!/^[A-Za-z0-9-]{1,10}$/.test(number) || !section || seats === undefined) return
      const existing = state.tables.find((t) => lower(t.number) === lower(number))
      if (!existing) {
        counts.created++
        apply.push(() => {
          const n = state.tables.length
          state.tables.push({
            id: newId(),
            number,
            section,
            seats,
            x: 120 + ((n * 60) % 760),
            y: 120 + ((n * 40) % 460),
            active: true,
            version: 1,
            createdAt: now,
            updatedAt: now,
          })
        })
      } else if (existing.section !== section || existing.seats !== seats) {
        counts.updated++
        apply.push(() =>
          Object.assign(existing, { section, seats, version: existing.version + 1, updatedAt: now }),
        )
      } else counts.unchanged++
    })
  }

  if (type === 'MODIFIER_GROUPS') {
    const groups = new Map<
      string,
      {
        row: number
        required: boolean
        min: number
        max: number
        options: Array<{ name: string; priceDelta: string }>
      }
    >()
    body.forEach((r, i) => {
      const row = i + 2
      const name = cell(r, 'group')
      if (!name || name.length > 50) ctx.err(row, 'group', name, 'is required (up to 50 characters)')
      const required = yn(cell(r, 'required'), null)
      if (required === null) ctx.err(row, 'required', cell(r, 'required'), 'must be Y or N')
      const min = whole(ctx, row, 'min_select', cell(r, 'min_select'), 0, 50)
      const max = whole(ctx, row, 'max_select', cell(r, 'max_select'), 1, 50)
      if (min !== undefined && max !== undefined && max < min)
        ctx.err(row, 'max_select', cell(r, 'max_select'), 'cannot be less than min_select')
      const option = cell(r, 'option')
      if (!option || option.length > 50) ctx.err(row, 'option', option, 'is required (up to 50 characters)')
      const delta = money(ctx, row, 'price_delta', cell(r, 'price_delta'))
      if (
        !name ||
        required === null ||
        min === undefined ||
        max === undefined ||
        !option ||
        delta === undefined ||
        delta === null
      )
        return
      const key = lower(name)
      const g = groups.get(key) ?? { row, required, min, max, options: [] }
      if (g.required !== required || g.min !== min || g.max !== max) {
        ctx.err(row, 'required', cell(r, 'required'), `settings of group "${name}" differ from its first row`)
      }
      if (g.options.some((o) => lower(o.name) === lower(option)))
        ctx.err(row, 'option', option, `the option appears twice in group "${name}"`)
      g.options.push({ name: option, priceDelta: delta })
      groups.set(key, g)
    })
    if (ctx.errors.length === 0) {
      for (const g of groups.values()) {
        if (g.max > g.options.length)
          ctx.err(g.row, 'max_select', String(g.max), 'cannot be more than the number of options')
        if (g.required && g.min < 1)
          ctx.err(g.row, 'min_select', String(g.min), 'a required group needs a minimum of at least 1')
        if (!g.required && g.min !== 0)
          ctx.err(g.row, 'min_select', String(g.min), 'an optional group has a minimum of 0')
      }
    }
    if (ctx.errors.length === 0) {
      for (const [key, g] of groups) {
        const name = body.map((r) => cell(r, 'group')).find((n) => lower(n) === key) as string
        const existing = state.modifierGroups.find((x) => lower(x.name) === key)
        const sig = (opts: Array<{ name: string; priceDelta: string }>) =>
          JSON.stringify(opts.map((o) => [lower(o.name), o.priceDelta]))
        if (!existing) {
          counts.created++
          apply.push(() =>
            state.modifierGroups.push({
              id: newId(),
              name,
              required: g.required,
              minSelect: g.min,
              maxSelect: g.max,
              active: true,
              options: g.options.map((o) => ({ id: newId(), ...o })),
              version: 1,
              createdAt: now,
              updatedAt: now,
            }),
          )
        } else if (
          existing.required !== g.required ||
          existing.minSelect !== g.min ||
          existing.maxSelect !== g.max ||
          sig(existing.options) !== sig(g.options)
        ) {
          counts.updated++
          apply.push(() => {
            existing.required = g.required
            existing.minSelect = g.min
            existing.maxSelect = g.max
            existing.options = g.options.map((o) => ({
              id: existing.options.find((e) => lower(e.name) === lower(o.name))?.id ?? newId(),
              ...o,
            }))
            existing.version += 1
            existing.updatedAt = now
          })
        } else counts.unchanged++
      }
    }
  }

  if (type === 'MENU_ITEMS') {
    const seen = new Set<string>()
    body.forEach((r, i) => {
      const row = i + 2
      const code = cell(r, 'code')
      if (!/^[A-Z0-9-]{1,20}$/.test(code))
        ctx.err(row, 'code', code, 'must be 1 to 20 capital letters, digits or dashes')
      else if (seen.has(code)) ctx.err(row, 'code', code, 'appears twice in the file')
      seen.add(code)
      const name = cell(r, 'name')
      if (!name || name.length > 100) ctx.err(row, 'name', name, 'is required (up to 100 characters)')
      const catName = cell(r, 'category')
      const category = state.categories.find((c) => lower(c.name) === lower(catName))
      if (!category)
        ctx.err(
          row,
          'category',
          catName,
          catName ? `unknown category '${catName}' (import categories first)` : 'is required',
        )
      const stationNo = cell(r, 'station')
      const station = state.stations.find((s) => String(s.number) === stationNo)
      if (!station)
        ctx.err(
          row,
          'station',
          stationNo,
          stationNo ? `unknown station '${stationNo}' (use 1, 2 or 3)` : 'is required',
        )
      const local = money(ctx, row, 'local_price', cell(r, 'local_price'))
      const foreign = money(ctx, row, 'foreign_price', cell(r, 'foreign_price'), true)
      // No ctive column: keep an existing item's flag (new items are active). A blank cell means Y.
      const activeParsed = header.includes('active') ? yn(cell(r, 'active'), true) : undefined
      if (activeParsed === null) ctx.err(row, 'active', cell(r, 'active'), 'must be Y or N')
      const groupNames = cell(r, 'modifier_groups')
        .split('|')
        .map((g) => g.trim())
        .filter(Boolean)
      const groupIds: string[] = []
      for (const g of groupNames) {
        const found = state.modifierGroups.find((x) => lower(x.name) === lower(g))
        if (found) groupIds.push(found.id)
        else
          ctx.err(row, 'modifier_groups', g, `unknown modifier group '${g}' (import modifier groups first)`)
      }
      if (
        !/^[A-Z0-9-]{1,20}$/.test(code) ||
        !name ||
        !category ||
        !station ||
        local === undefined ||
        local === null ||
        foreign === undefined ||
        activeParsed === null
      )
        return
      if (groupIds.length !== groupNames.length) return
      const existing = state.items.find((x) => x.code === code)
      const active = activeParsed ?? existing?.active ?? true
      if (!existing) {
        counts.created++
        apply.push(() =>
          state.items.push({
            id: newId(),
            code,
            name,
            categoryId: category.id,
            stationId: station.id,
            localPrice: local,
            ...(foreign ? { foreignPrice: foreign } : {}),
            active,
            available: true,
            groupIds,
            version: 1,
            createdAt: now,
            updatedAt: now,
          }),
        )
      } else {
        const same =
          existing.name === name &&
          existing.categoryId === category.id &&
          existing.stationId === station.id &&
          existing.localPrice === local &&
          (existing.foreignPrice ?? null) === foreign &&
          existing.active === active &&
          JSON.stringify(existing.groupIds) === JSON.stringify(groupIds)
        if (same) counts.unchanged++
        else {
          counts.updated++
          apply.push(() => {
            Object.assign(existing, {
              name,
              categoryId: category.id,
              stationId: station.id,
              localPrice: local,
              active,
              groupIds,
              version: existing.version + 1,
              updatedAt: now,
            })
            if (foreign) existing.foreignPrice = foreign
            else delete existing.foreignPrice
          })
        }
      }
    })
  }

  return report()
}
