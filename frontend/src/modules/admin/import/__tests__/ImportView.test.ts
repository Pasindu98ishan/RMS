import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'

vi.mock('@/api/importer', () => ({ importApi: { template: vi.fn(), importFile: vi.fn() } }))

const { default: ImportView } = await import('../ImportView.vue')
const { runImport } = await import('@/mocks/importer')
const { seedCategories, seedItems, seedModifierGroups, seedStations, seedTables } =
  await import('@/mocks/seedCatalog')
const { KITCHEN_STATION_IDS } = await import('@/mocks/seed')

describe('ImportView re-import note (P1-IMP-01)', () => {
  it('says a blank optional cell clears the value, and that active and table positions are kept when the column is absent', async () => {
    const w = mount(ImportView, {
      attachTo: document.body,
      global: { plugins: [[PrimeVue, { unstyled: true }], ToastService] },
    })
    await flushPromises()
    const note = document.body.querySelector('[data-testid="import-reimport-note"]')
    expect(note).not.toBeNull()
    const text = note!.textContent!.replace(/\s+/g, ' ')
    expect(text).toMatch(/blank optional cell clears the existing value/)
    expect(text).toContain('foreign_price')
    expect(text).toMatch(/left out of the file/)
    expect(text).toContain('active')
    expect(text).toMatch(/table positions/)
    w.unmount()
  })
})

describe('mock import follows the same rules', () => {
  const state = () => ({
    stations: seedStations(KITCHEN_STATION_IDS),
    categories: seedCategories(),
    modifierGroups: seedModifierGroups(),
    items: seedItems(KITCHEN_STATION_IDS),
    tables: seedTables(),
  })

  it('a blank foreign_price clears it; a file without an active column keeps the item inactive', () => {
    const s = state()
    const gr01 = s.items.find((i) => i.code === 'GR01')!
    gr01.active = false
    expect(gr01.foreignPrice).toBeTruthy()
    const csv =
      'code,name,category,station,local_price,foreign_price\nGR01,Grilled chicken (half),Grill,2,1800.00,\n'
    const r = runImport('MENU_ITEMS', csv, false, s)
    expect(r.ok).toBe(true)
    expect(gr01.foreignPrice).toBeUndefined()
    expect(gr01.active).toBe(false)
  })

  it('re-importing tables keeps their positions', () => {
    const s = state()
    const t1 = s.tables.find((t) => t.number === '1')!
    const { x, y } = t1
    const r = runImport('TABLES', 'number,section,seats\n1,Indoor,8\n', false, s)
    expect(r.counts.updated).toBe(1)
    expect(t1).toMatchObject({ seats: 8, x, y })
  })
})
