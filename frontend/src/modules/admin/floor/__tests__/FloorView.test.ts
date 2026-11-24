import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'

vi.mock('@/api/floor', () => ({
  floorApi: { listTables: vi.fn(), savePositions: vi.fn(), createTable: vi.fn(), updateTable: vi.fn() },
}))

const { floorApi } = await import('@/api/floor')
const { default: FloorView } = await import('../FloorView.vue')

const table = (id: string, number: string, x: number, y: number, version = 1) => ({
  id,
  number,
  section: 'Indoor',
  seats: 4,
  x,
  y,
  active: true,
  version,
  createdAt: 'x',
  updatedAt: 'x',
})

const q = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)

function pointer(el: Element, type: string, x: number, y: number) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}

beforeEach(() => {
  vi.mocked(floorApi.listTables).mockReset()
  vi.mocked(floorApi.savePositions).mockReset()
  // jsdom does no layout: a 1:1 canvas makes pixels equal grid units.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 700,
    right: 1000,
    bottom: 700,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  ;(HTMLElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = vi.fn()
})

function mountView() {
  return mount(FloorView, {
    attachTo: document.body,
    global: { plugins: [[PrimeVue, { unstyled: true }], ToastService] },
  })
}

describe('FloorView (drag-to-arrange)', () => {
  it('P1-FLOOR-01 dragging a table moves it (snapped) and Save plan sends one call with its version', async () => {
    vi.mocked(floorApi.listTables).mockResolvedValue([
      table('t1', '1', 130, 130, 4),
      table('t2', '2', 360, 130),
    ])
    vi.mocked(floorApi.savePositions).mockResolvedValue([table('t1', '1', 330, 230, 5)])
    const w = mountView()
    await flushPromises()

    expect(q('floor-save')!.hasAttribute('disabled')).toBe(true)
    const t1 = q('floor-table-1')!
    pointer(t1, 'pointerdown', 130, 130)
    pointer(t1, 'pointermove', 333, 228)
    pointer(t1, 'pointerup', 333, 228)
    await flushPromises()

    expect(t1.getAttribute('data-x')).toBe('330')
    expect(t1.getAttribute('data-y')).toBe('230')
    expect(q('floor-dirty')?.textContent).toMatch(/1 table moved/)
    expect(q('floor-table-2')!.getAttribute('data-x')).toBe('360')

    q('floor-save')!.click()
    await flushPromises()
    expect(floorApi.savePositions).toHaveBeenCalledTimes(1)
    expect(floorApi.savePositions).toHaveBeenCalledWith([{ tableId: 't1', x: 330, y: 230, version: 4 }])
    expect(q('floor-dirty')).toBeNull()
    w.unmount()
  })

  it('keeps the table inside the grid', async () => {
    vi.mocked(floorApi.listTables).mockResolvedValue([table('t1', '1', 130, 130)])
    const w = mountView()
    await flushPromises()
    const t1 = q('floor-table-1')!
    pointer(t1, 'pointerdown', 130, 130)
    pointer(t1, 'pointermove', 5000, -300)
    pointer(t1, 'pointerup', 5000, -300)
    await flushPromises()
    expect(t1.getAttribute('data-x')).toBe('1000')
    expect(t1.getAttribute('data-y')).toBe('0')
    w.unmount()
  })

  it('arrow keys nudge the focused table and Discard puts it back', async () => {
    vi.mocked(floorApi.listTables).mockResolvedValue([table('t1', '1', 130, 130)])
    const w = mountView()
    await flushPromises()
    const t1 = q('floor-table-1')!
    t1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(t1.getAttribute('data-x')).toBe('140')
    q('floor-discard')!.click()
    await flushPromises()
    expect(t1.getAttribute('data-x')).toBe('130')
    expect(floorApi.savePositions).not.toHaveBeenCalled()
    w.unmount()
  })

  it('a stale version on save shows the version-conflict banner and keeps the drag', async () => {
    const { ApiError } = await import('@/api/errors')
    vi.mocked(floorApi.listTables).mockResolvedValue([table('t1', '1', 130, 130)])
    vi.mocked(floorApi.savePositions).mockRejectedValue(
      new ApiError({ status: 409, code: 'VERSION_CONFLICT', title: 'x', detail: 'changed' }),
    )
    const w = mountView()
    await flushPromises()
    q('floor-table-1')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await flushPromises()
    q('floor-save')!.click()
    await flushPromises()
    expect(q('version-conflict')).not.toBeNull()
    expect(q('floor-table-1')!.getAttribute('data-y')).toBe('140')
    w.unmount()
  })
})
