import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import PrimeVue from 'primevue/config'
import Select from 'primevue/select'
import ToastService from 'primevue/toastservice'
import { ApiError } from '@/api/errors'

vi.mock('@/api/terminals', () => ({
  terminalsApi: { setupOptions: vi.fn(), register: vi.fn() },
}))

const { terminalsApi } = await import('@/api/terminals')
const { default: TerminalSetupView } = await import('../TerminalSetupView.vue')

const options = {
  kitchenStations: [
    { id: 's1', number: 1, name: 'Kitchen 1 Rice & Curry' },
    { id: 's2', number: 2, name: 'Kitchen 2 Grill' },
  ],
  orderingPoints: [
    { id: 'p1', name: 'Cashier counter' },
    { id: 'p2', name: 'Reception' },
  ],
}

const q = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

async function fill(id: string, value: string) {
  const el = q<HTMLInputElement>(id)!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

function mountView() {
  setActivePinia(createPinia())
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: { template: '<div />' } },
      { path: '/', component: { template: '<div />' } },
    ],
  })
  return mount(TerminalSetupView, {
    attachTo: document.body,
    global: { plugins: [[PrimeVue, { unstyled: true }], ToastService, router] },
  })
}

const setType = async (w: ReturnType<typeof mountView>, t: string) => {
  w.findAllComponents(Select)[0]!.vm.$emit('update:modelValue', t)
  await flushPromises()
}

beforeEach(() => {
  vi.mocked(terminalsApi.setupOptions).mockReset()
  vi.mocked(terminalsApi.register).mockReset()
  vi.mocked(terminalsApi.setupOptions).mockResolvedValue(options)
})

describe('TerminalSetupView (stations and ordering points from the server)', () => {
  it('P1-AUTH-04 loads the stations with the owner credentials when a KITCHEN type is chosen', async () => {
    const w = mountView()
    await fill('setup-username', 'owner1')
    await fill('setup-password', 'pw')
    await setType(w, 'KITCHEN')
    expect(terminalsApi.setupOptions).toHaveBeenCalledTimes(1)
    expect(terminalsApi.setupOptions).toHaveBeenCalledWith({ username: 'owner1', password: 'pw' })
    const selects = w.findAllComponents(Select)
    expect(selects[1]!.props('options')).toEqual(options.kitchenStations)
    w.unmount()
  })

  it('loads after the password is entered when the type was chosen first, and does not retry the same credentials', async () => {
    const w = mountView()
    await setType(w, 'KITCHEN')
    expect(terminalsApi.setupOptions).not.toHaveBeenCalled()
    await fill('setup-username', 'owner1')
    await fill('setup-password', 'pw')
    q('setup-password')!.dispatchEvent(new Event('blur'))
    await flushPromises()
    q('setup-password')!.dispatchEvent(new Event('blur'))
    await flushPromises()
    expect(terminalsApi.setupOptions).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('shows the server message (and wait time) when the options cannot be loaded, e.g. 429 or wrong password', async () => {
    vi.mocked(terminalsApi.setupOptions).mockRejectedValue(
      new ApiError({
        status: 429,
        code: 'TOO_MANY_ATTEMPTS',
        title: 'x',
        detail: 'Too many wrong usernames or passwords.',
        retryAfterSeconds: 600,
      }),
    )
    const w = mountView()
    await fill('setup-username', 'owner1')
    await fill('setup-password', 'bad')
    await setType(w, 'KITCHEN')
    expect(q('terminal-options-error')?.textContent).toContain('Too many wrong usernames or passwords.')
    expect(q('terminal-options-error')?.textContent).toContain('Try again in 10 minutes.')
    w.unmount()
  })

  it('registers a Cashier POS with the preselected ordering point', async () => {
    vi.mocked(terminalsApi.register).mockResolvedValue({
      terminal: {
        id: 't1',
        name: 'Counter',
        type: 'CASHIER_POS',
        orderingPointId: 'p1',
        orderingPointName: 'Cashier counter',
        active: true,
        version: 1,
        createdAt: 'x',
        updatedAt: 'x',
      },
      deviceToken: 'd'.repeat(40),
    })
    const w = mountView()
    await fill('setup-username', 'owner1')
    await fill('setup-password', 'pw')
    await fill('terminal-name', 'Counter')
    await setType(w, 'CASHIER_POS')
    q('terminal-register')!.click()
    await flushPromises()
    expect(terminalsApi.register).toHaveBeenCalledWith({
      credentials: { username: 'owner1', password: 'pw' },
      name: 'Counter',
      type: 'CASHIER_POS',
      orderingPointId: 'p1',
    })
    expect(q('terminal-registered')).not.toBeNull()
    expect(q('terminal-goto-login')).not.toBeNull()
    w.unmount()
  })

  it('a KITCHEN terminal cannot be registered without a station', async () => {
    const w = mountView()
    await fill('setup-username', 'owner1')
    await fill('setup-password', 'pw')
    await fill('terminal-name', 'Kitchen 1 screen')
    await setType(w, 'KITCHEN')
    q('terminal-register')!.click()
    await flushPromises()
    expect(terminalsApi.register).not.toHaveBeenCalled()
    expect(q('field-error-kitchenStationId')).not.toBeNull()
    w.unmount()
  })
})
