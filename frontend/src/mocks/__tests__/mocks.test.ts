import { describe, expect, it } from 'vitest'
import { OPERATIONS } from '@/api/generated/operations'
import { handlers } from '../handlers'
import { runImport, parseCsv, templateCsv, type ImportState } from '../importer'
import {
  seedAreas,
  seedCategories,
  seedItems,
  seedModifierGroups,
  seedReasons,
  seedStations,
  seedTables,
} from '../seedCatalog'
import { KITCHEN_STATION_IDS } from '../seed'

const norm = (path: string) => path.replace(/\{[^}]+\}/g, ':p').replace(/:[A-Za-z]+/g, ':p')

describe('mock API', () => {
  it('covers every operation of the contract (method + path)', () => {
    const have = new Set(
      handlers.flatMap((h) => {
        const info = (h as unknown as { info: { method?: string; path?: string } }).info
        return info.method && info.path && typeof info.path === 'string'
          ? [`${String(info.method).toUpperCase()} ${norm(info.path.replace(/^\/api\/v1/, ''))}`]
          : []
      }),
    )
    const missing = OPERATIONS.filter((op) => !have.has(`${op.method} ${norm(op.path)}`)).map(
      (op) => `${op.method} ${op.path}`,
    )
    expect(missing).toEqual([])
  })
})

describe('M1.1 sample data (m1.1-scope.md)', () => {
  it('has the documented shape', () => {
    const stations = seedStations(KITCHEN_STATION_IDS)
    const items = seedItems(KITCHEN_STATION_IDS)
    expect(stations.map((s) => s.targetPrepMinutes)).toEqual([15, 20, 8])
    expect(seedCategories()).toHaveLength(6)
    expect(items.length).toBeGreaterThanOrEqual(38)
    expect(items.filter((i) => i.foreignPrice).length).toBeGreaterThanOrEqual(24)
    expect(new Set(items.map((i) => i.code)).size).toBe(items.length)
    expect(items.every((i) => stations.some((s) => s.id === i.stationId))).toBe(true)
    expect(seedModifierGroups().map((g) => g.name)).toEqual(['Spice level', 'Extras', 'Size'])
    const tables = seedTables()
    expect(tables).toHaveLength(12)
    expect(tables.filter((t) => t.section === 'Indoor')).toHaveLength(8)
    expect(tables.filter((t) => t.section === 'Garden').map((t) => t.number)).toEqual([
      'G1',
      'G2',
      'G3',
      'G4',
    ])
    expect(seedAreas().map((a) => a.fee)).toEqual(['150.00', '300.00', '500.00'])
    expect(new Set(seedReasons().map((r) => r.category))).toEqual(
      new Set(['CANCEL', 'VOID', 'REFUND', 'PETTY_CASH', 'DISCOUNT_OTHER']),
    )
  })
})

function state(): ImportState {
  return {
    stations: seedStations(KITCHEN_STATION_IDS),
    categories: seedCategories(),
    modifierGroups: seedModifierGroups(),
    items: seedItems(KITCHEN_STATION_IDS),
    tables: seedTables(),
  }
}

describe('mock import (P1-IMP-01)', () => {
  it('parses quoted CSV cells, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ])
  })

  it('P1-IMP-01 reports row, column, value and message for every bad row, and imports nothing', () => {
    const s = state()
    const before = s.items.length
    const csv = [
      'code,name,category,station,local_price,foreign_price,modifier_groups,active',
      'NEW1,Good dish,Grill,2,500.00,,,Y',
      'NEW2,Bad price,Grill,2,abc,,,Y',
      'NEW1,Duplicate code,Grill,2,100.00,,,Y',
      'NEW3,Unknown category,Pizza,2,100.00,,,Y',
      'NEW4,Unknown station,Grill,9,100.00,,,Y',
      'NEW5,Negative,Grill,2,-5.00,,,Y',
      'NEW6,Bad group,Grill,2,100.00,,Nope,Y',
    ].join('\n')
    const r = runImport('MENU_ITEMS', csv, false, s)
    expect(r.ok).toBe(false)
    expect(r.rowsRead).toBe(7)
    expect(s.items).toHaveLength(before)
    expect(r.counts).toEqual({ created: 0, updated: 0, unchanged: 0 })
    const find = (row: number, column: string) => r.errors.find((e) => e.row === row && e.column === column)
    expect(find(3, 'local_price')).toMatchObject({ value: 'abc', message: "'abc' is not a number" })
    expect(find(4, 'code')?.message).toMatch(/twice/)
    expect(find(5, 'category')?.message).toMatch(/unknown category 'Pizza'/)
    expect(find(6, 'station')?.message).toMatch(/unknown station/)
    expect(find(7, 'local_price')?.message).toMatch(/negative/)
    expect(find(8, 'modifier_groups')?.message).toMatch(/unknown modifier group 'Nope'/)
  })

  it('reports a missing header column as a file-level problem', () => {
    const r = runImport('TABLES', 'number,section\n1,Indoor', true, state())
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatchObject({ row: 1, column: 'seats' })
  })

  it('max_select below min_select is an error', () => {
    const csv =
      'group,required,min_select,max_select,option,price_delta\nSauce,Y,2,1,Mild,0.00\nSauce,Y,2,1,Hot,0.00'
    const r = runImport('MODIFIER_GROUPS', csv, true, state())
    expect(r.errors.some((e) => e.column === 'max_select' && /less than/.test(e.message))).toBe(true)
  })

  it('dry run counts but saves nothing; the real run saves; re-import updates instead of duplicating', () => {
    const s = state()
    const csv =
      'code,name,category,station,local_price,foreign_price,modifier_groups,active\nZZ01,Test dish,Grill,2,500.00,750.00,Spice level,Y'
    const dry = runImport('MENU_ITEMS', csv, true, s)
    expect(dry).toMatchObject({ ok: true, dryRun: true, counts: { created: 1, updated: 0, unchanged: 0 } })
    expect(s.items.some((i) => i.code === 'ZZ01')).toBe(false)

    expect(runImport('MENU_ITEMS', csv, false, s).counts.created).toBe(1)
    const created = s.items.find((i) => i.code === 'ZZ01')
    expect(created).toMatchObject({ localPrice: '500.00', foreignPrice: '750.00' })

    const same = runImport('MENU_ITEMS', csv, false, s)
    expect(same.counts).toEqual({ created: 0, updated: 0, unchanged: 1 })

    const changed = runImport('MENU_ITEMS', csv.replace('500.00', '550.00'), false, s)
    expect(changed.counts).toEqual({ created: 0, updated: 1, unchanged: 0 })
    expect(s.items.filter((i) => i.code === 'ZZ01')).toHaveLength(1)
    expect(s.items.find((i) => i.code === 'ZZ01')?.localPrice).toBe('550.00')
  })

  it('its own template imports cleanly (after its dependencies)', () => {
    const s = state()
    s.categories = []
    s.modifierGroups = []
    s.items = []
    s.tables = []
    for (const type of ['CATEGORIES', 'MODIFIER_GROUPS', 'MENU_ITEMS', 'TABLES'] as const) {
      const r = runImport(type, templateCsv(type), false, s)
      expect(r, `${type} ${JSON.stringify(r.errors)}`).toMatchObject({ ok: true })
    }
    expect(s.items.length).toBe(2)
  })
})
