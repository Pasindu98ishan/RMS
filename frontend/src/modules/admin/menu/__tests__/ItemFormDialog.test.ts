import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'

vi.mock('@/api/menu', () => ({
  menuApi: { createItem: vi.fn(), updateItem: vi.fn(), getItem: vi.fn() },
}))

const { menuApi } = await import('@/api/menu')
const { default: ItemFormDialog } = await import('../ItemFormDialog.vue')

const categories = [
  {
    id: 'c1',
    name: 'Grill',
    sortOrder: 1,
    active: true,
    itemCount: 0,
    version: 1,
    createdAt: 'x',
    updatedAt: 'x',
  },
]
const stations = [
  {
    id: 's2',
    number: 2,
    name: 'Kitchen 2 Grill',
    targetPrepMinutes: 20,
    active: true,
    activeItemCount: 0,
    version: 1,
    updatedAt: 'x',
  },
]
const groups = [
  {
    id: 'g1',
    name: 'Spice level',
    required: true,
    minSelect: 1,
    maxSelect: 1,
    active: true,
    options: [],
    itemCount: 0,
    version: 1,
    createdAt: 'x',
    updatedAt: 'x',
  },
]

const q = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

async function type(id: string, value: string) {
  const el = q<HTMLInputElement>(id)!
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true })) // real input events bubble
  await flushPromises()
}
async function choose(id: string, value: string) {
  const el = q<HTMLSelectElement>(id)!
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
}

function mountDialog() {
  return mount(ItemFormDialog, {
    props: { visible: true, itemId: null, categories, stations, groups },
    attachTo: document.body,
    global: { plugins: [[PrimeVue, { unstyled: true }]] },
  })
}

const created = {
  id: 'i1',
  code: 'GR99',
  name: 'Test',
  categoryId: 'c1',
  categoryName: 'Grill',
  stationId: 's2',
  stationName: 'K2',
  localPrice: '500.00',
  active: true,
  available: true,
  modifierGroups: [],
  version: 1,
  createdAt: 'x',
  updatedAt: 'x',
}

beforeEach(() => {
  vi.mocked(menuApi.createItem).mockReset()
  vi.mocked(menuApi.createItem).mockResolvedValue(created)
})

describe('ItemFormDialog', () => {
  it('P1-MENU-02 cannot be saved without a kitchen station', async () => {
    const w = mountDialog()
    await flushPromises()
    await type('item-code', 'gr99')
    await type('item-name', 'Test')
    await choose('item-category', 'c1')
    await type('item-local-price', '500')
    q('item-save')!.click()
    await flushPromises()
    expect(menuApi.createItem).not.toHaveBeenCalled()
    expect(q('field-error-stationId')?.textContent).toMatch(/kitchen station/i)
    w.unmount()
  })

  it('P1-MENU-02/04 saves station, category, local price and ordered groups in one request; empty foreign price is omitted', async () => {
    const w = mountDialog()
    await flushPromises()
    await type('item-code', 'gr99')
    expect(q<HTMLInputElement>('item-code')!.value).toBe('GR99')
    await type('item-name', ' Test ')
    await choose('item-category', 'c1')
    await choose('item-station', 's2')
    await type('item-local-price', '500')
    await choose('item-group-add', 'g1')
    q('item-group-add-button')!.click()
    await flushPromises()
    q('item-save')!.click()
    await flushPromises()
    expect(menuApi.createItem).toHaveBeenCalledTimes(1)
    expect(menuApi.createItem).toHaveBeenCalledWith({
      code: 'GR99',
      name: 'Test',
      categoryId: 'c1',
      stationId: 's2',
      localPrice: '500.00',
      active: true,
      modifierGroupIds: ['g1'],
    })
    expect(w.emitted('saved')).toHaveLength(1)
    w.unmount()
  })

  it('P1-MENU-04 sends the foreign price when given', async () => {
    const w = mountDialog()
    await flushPromises()
    await type('item-code', 'GR98')
    await type('item-name', 'Other')
    await choose('item-category', 'c1')
    await choose('item-station', 's2')
    await type('item-local-price', '1000')
    await type('item-foreign-price', '1500.5')
    q('item-save')!.click()
    await flushPromises()
    expect(vi.mocked(menuApi.createItem).mock.calls[0]?.[0]).toMatchObject({
      localPrice: '1000.00',
      foreignPrice: '1500.50',
    })
    w.unmount()
  })

  it('shows the server field error for a duplicate code', async () => {
    const { ApiError } = await import('@/api/errors')
    vi.mocked(menuApi.createItem).mockRejectedValue(
      new ApiError({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'x',
        fieldErrors: [{ field: 'code', message: 'The code GR99 is already used by another item' }],
      }),
    )
    const w = mountDialog()
    await flushPromises()
    await type('item-code', 'GR99')
    await type('item-name', 'Test')
    await choose('item-category', 'c1')
    await choose('item-station', 's2')
    await type('item-local-price', '500')
    q('item-save')!.click()
    await flushPromises()
    expect(q('field-error-code')?.textContent).toBe('The code GR99 is already used by another item')
    expect(w.emitted('saved')).toBeUndefined()
    w.unmount()
  })

  describe('editing an existing item (Q38)', () => {
    const existing = {
      ...created,
      id: 'i9',
      code: 'GR01',
      name: 'Grilled chicken',
      foreignPrice: '2700.00',
      version: 4,
    }

    function deferred<T>() {
      let resolve!: (v: T) => void
      const promise = new Promise<T>((r) => (resolve = r))
      return { promise, resolve }
    }

    function mountEdit() {
      return mount(ItemFormDialog, {
        props: { visible: false, itemId: 'i9', categories, stations, groups },
        attachTo: document.body,
        global: { plugins: [[PrimeVue, { unstyled: true }]] },
      })
    }

    it('P1-MENU-02 disables the form until the item has loaded, then fills it', async () => {
      const d = deferred<typeof existing>()
      vi.mocked(menuApi.getItem).mockReturnValue(d.promise)
      const w = mountEdit()
      await w.setProps({ visible: true })
      await flushPromises()
      // A fieldset[disabled] ancestor disables the controls (:disabled), not their own attribute.
      expect(q<HTMLInputElement>('item-name')!.matches(':disabled')).toBe(true)
      expect(q<HTMLInputElement>('item-code')!.matches(':disabled')).toBe(true)
      d.resolve(existing)
      await flushPromises()
      expect(q<HTMLInputElement>('item-name')!.matches(':disabled')).toBe(false)
      expect(q<HTMLInputElement>('item-name')!.value).toBe('Grilled chicken')
      expect(q<HTMLInputElement>('item-code')!.value).toBe('GR01')
      w.unmount()
    })

    it('never overwrites text the user already typed when the load finishes later', async () => {
      const d = deferred<typeof existing>()
      vi.mocked(menuApi.getItem).mockReturnValue(d.promise)
      const w = mountEdit()
      await w.setProps({ visible: true })
      await flushPromises()
      // Even if input still reaches the form (e.g. autofill, a fast key press), it wins over the loaded value.
      await type('item-name', 'My early text')
      d.resolve(existing)
      await flushPromises()
      expect(q<HTMLInputElement>('item-name')!.value).toBe('My early text')
      // The loaded item's id and version are still used for the save.
      vi.mocked(menuApi.updateItem).mockResolvedValue(existing)
      await choose('item-category', 'c1')
      await choose('item-station', 's2')
      await type('item-code', 'GR01')
      await type('item-local-price', '500')
      q('item-save')!.click()
      await flushPromises()
      expect(menuApi.updateItem).toHaveBeenCalledWith(
        'i9',
        expect.objectContaining({ name: 'My early text', version: 4 }),
      )
      w.unmount()
    })
  })
})
