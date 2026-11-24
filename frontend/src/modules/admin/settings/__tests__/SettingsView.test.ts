import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'

const idle = {
  rules: [
    { terminalType: 'CASHIER_POS', exempt: false, idleTimeoutMinutes: 10 },
    { terminalType: 'RECEPTION_POS', exempt: false, idleTimeoutMinutes: 10 },
    { terminalType: 'ADMIN', exempt: false, idleTimeoutMinutes: 30 },
    { terminalType: 'KITCHEN', exempt: true },
    { terminalType: 'DISPLAY', exempt: true },
  ],
  idleTimeoutPersonalMinutes: 30,
  version: 3,
  updatedAt: 'x',
}

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getRestaurant: vi.fn(async () => ({ name: 'S', address: 'A', phone: 'P', version: 1, updatedAt: 'x' })),
    getServiceCharges: vi.fn(async () => ({
      rules: [
        { orderType: 'DINE_IN', rate: '10.00' },
        { orderType: 'TAKEAWAY', rate: '0.00' },
        { orderType: 'DELIVERY', rate: '0.00' },
      ],
      version: 1,
      updatedAt: 'x',
    })),
    getTax: vi.fn(async () => ({ enabled: false, rate: '0.00', version: 1, updatedAt: 'x' })),
    getBusinessDay: vi.fn(async () => ({
      dayStartTime: '06:00',
      timeZone: 'Asia/Colombo',
      version: 1,
      updatedAt: 'x',
    })),
    getIdleTimeouts: vi.fn(async () => idle),
    getMenuSettings: vi.fn(async () => ({ resetAvailabilityDaily: true, version: 1, updatedAt: 'x' })),
    updateIdleTimeouts: vi.fn(async (b: object) => ({ ...idle, ...b, version: 4 })),
  },
}))

const { settingsApi } = await import('@/api/settings')
const { default: SettingsView } = await import('../SettingsView.vue')
const q = (id: string) => document.body.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)

describe('SettingsView personal idle timeout (ADR-008 #6)', () => {
  it('P1-AUTH-03 shows the personal-session idle timeout and saves it with the terminal rules', async () => {
    const w = mount(SettingsView, {
      attachTo: document.body,
      global: { plugins: [[PrimeVue, { unstyled: true }], ToastService] },
    })
    await flushPromises()
    const field = q('set-idle-PERSONAL')!
    expect(field.value).toBe('30')
    field.value = '45'
    field.dispatchEvent(new Event('input'))
    await flushPromises()
    q('settings-save')!.click()
    await flushPromises()
    expect(settingsApi.updateIdleTimeouts).toHaveBeenCalledWith({
      rules: [
        { terminalType: 'CASHIER_POS', idleTimeoutMinutes: 10 },
        { terminalType: 'RECEPTION_POS', idleTimeoutMinutes: 10 },
        { terminalType: 'ADMIN', idleTimeoutMinutes: 30 },
      ],
      idleTimeoutPersonalMinutes: 45,
      version: 3,
    })
    w.unmount()
  })

  it('rejects a personal timeout outside 1 to 240 before sending', async () => {
    vi.mocked(settingsApi.updateIdleTimeouts).mockClear()
    const w = mount(SettingsView, {
      attachTo: document.body,
      global: { plugins: [[PrimeVue, { unstyled: true }], ToastService] },
    })
    await flushPromises()
    const field = q('set-idle-PERSONAL')!
    field.value = '0'
    field.dispatchEvent(new Event('input'))
    await flushPromises()
    q('settings-save')!.click()
    await flushPromises()
    expect(settingsApi.updateIdleTimeouts).not.toHaveBeenCalled()
    expect(q('field-error-idleTimeoutPersonalMinutes')).not.toBeNull()
    w.unmount()
  })
})
