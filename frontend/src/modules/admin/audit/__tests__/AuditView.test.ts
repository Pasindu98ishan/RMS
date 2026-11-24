import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'

const entries = [
  {
    id: 'a1',
    at: '2026-11-24T04:00:00Z',
    user: { id: 'u1', username: 'owner1', fullName: 'Sunil' },
    action: 'LOGIN',
    entityType: 'AUTH_SESSION',
    clientInfo: '203.0.113.7 | Mozilla/5.0 (Android 14)',
  },
  {
    id: 'a2',
    at: '2026-11-24T03:00:00Z',
    user: { id: 'u2', username: 'cashier1', fullName: 'Nimal' },
    terminal: { id: 't1', name: 'Cashier counter' },
    action: 'LOGIN',
    entityType: 'AUTH_SESSION',
    clientInfo: '192.168.1.20 | Chrome',
  },
  { id: 'a3', at: '2026-11-24T02:00:00Z', action: 'SETTINGS_CHANGED', entityType: 'SETTING' },
]

vi.mock('@/api/audit', () => ({
  auditApi: {
    search: vi.fn(async () => ({ items: entries, page: 0, size: 50, totalItems: 3 })),
    export: vi.fn(),
  },
}))
vi.mock('@/api/users', () => ({ usersApi: { options: vi.fn(async () => []) } }))

const { default: AuditView } = await import('../AuditView.vue')

describe('AuditView (ADR-008 client info)', () => {
  it('P1-AUD-01 shows "Personal" for a user action without a terminal, "-" for system rows, and the client info', async () => {
    const w = mount(AuditView, {
      attachTo: document.body,
      global: { plugins: [[PrimeVue, { unstyled: true }], ToastService] },
    })
    await flushPromises()
    const cells = [...document.body.querySelectorAll('[data-testid="audit-terminal"]')].map((c) =>
      c.textContent?.replace(/\s+/g, ' ').trim(),
    )
    expect(cells[0]).toContain('Personal')
    expect(cells[0]).toContain('203.0.113.7')
    expect(cells[1]).toContain('Cashier counter')
    expect(cells[2]).toBe('-')
    w.unmount()
  })
})
