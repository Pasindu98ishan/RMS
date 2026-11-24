import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TerminalBadge from '../TerminalBadge.vue'
import { useAuthStore } from '@/stores/auth'
import { useTerminalStore } from '@/stores/terminal'

describe('TerminalBadge (header)', () => {
  it('P1-AUTH-04 ADR-008 shows "Personal device" in a personal session, even on a registered browser', () => {
    setActivePinia(createPinia())
    useTerminalStore().adopt({
      terminalId: 't1',
      deviceToken: 'd',
      terminal: { id: 't1', name: 'Cashier counter', type: 'CASHIER_POS', active: true },
      registeredAt: 'x',
    })
    const auth = useAuthStore()
    auth.sessionType = 'PERSONAL'
    const w = mount(TerminalBadge)
    expect(w.get('[data-testid="header-terminal"]').text()).toBe('Personal device')
  })

  it('shows the terminal name in a terminal session', () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.sessionType = 'TERMINAL'
    auth.terminal = { id: 't1', name: 'Owner office', type: 'ADMIN', active: true }
    const w = mount(TerminalBadge)
    expect(w.get('[data-testid="header-terminal"]').text()).toBe('Owner office')
  })
})
