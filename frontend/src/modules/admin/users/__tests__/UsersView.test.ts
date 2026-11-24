import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import type { UserPage } from '@/api/types'

vi.mock('@/api/users', () => ({
  usersApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    activate: vi.fn(),
    unlock: vi.fn(),
    resetPassword: vi.fn(),
    resetPin: vi.fn(),
    assignRoles: vi.fn(),
    options: vi.fn(),
  },
}))
vi.mock('@/api/roles', () => ({
  rolesApi: { options: vi.fn(async () => []) },
}))

const { usersApi } = await import('@/api/users')
const { default: UsersView } = await import('../UsersView.vue')

const role = { id: 'r1', name: 'Kitchen', system: true, key: 'KITCHEN' as const }

function page(pinSet: boolean): UserPage {
  return {
    page: 0,
    size: 25,
    totalItems: 1,
    items: [
      {
        id: 'u1',
        username: 'kitchen1',
        fullName: 'Ruwan Bandara',
        active: true,
        locked: false,
        pinSet,
        pinLocked: false,
        roles: [role],
      },
    ],
  }
}

function mountView() {
  setActivePinia(createPinia())
  return mount(UsersView, {
    attachTo: document.body,
    global: {
      plugins: [[PrimeVue, { unstyled: true }], ToastService],
      stubs: { UserFormDialog: true, AssignRolesDialog: true, ConfirmDialog: true },
    },
  })
}

const q = (testid: string) => document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`)

beforeEach(() => {
  vi.mocked(usersApi.list).mockReset()
  vi.mocked(usersApi.resetPin).mockReset()
})

describe('UsersView', () => {
  it('P1-AUTH-05 BUG-1-004 drops the "No PIN" chip right after a PIN reset (list reloads)', async () => {
    vi.mocked(usersApi.list).mockResolvedValueOnce(page(false)).mockResolvedValue(page(true))
    vi.mocked(usersApi.resetPin).mockResolvedValue()
    const w = mountView()
    await flushPromises()
    expect(q('user-no-pin-kitchen1')).not.toBeNull()

    q('user-reset-pin-kitchen1')!.click()
    await flushPromises()
    const input = q('user-pin') as HTMLInputElement
    input.value = '123456'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    q('user-save')!.click()
    await flushPromises()

    expect(usersApi.resetPin).toHaveBeenCalledWith('u1', '123456')
    expect(usersApi.list).toHaveBeenCalledTimes(2)
    expect(q('user-no-pin-kitchen1')).toBeNull()
    w.unmount()
  })

  it('reloads the list after a password reset too (it clears an account lock)', async () => {
    vi.mocked(usersApi.list).mockResolvedValue(page(true))
    vi.mocked(usersApi.resetPassword).mockResolvedValue()
    const w = mountView()
    await flushPromises()

    q('user-reset-password-kitchen1')!.click()
    await flushPromises()
    const input = q('user-password') as HTMLInputElement
    input.value = 'a-new-password'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    q('user-save')!.click()
    await flushPromises()

    expect(usersApi.resetPassword).toHaveBeenCalledWith('u1', 'a-new-password')
    expect(usersApi.list).toHaveBeenCalledTimes(2)
    w.unmount()
  })
})
