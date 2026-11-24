import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import PinPrompt from '../PinPrompt.vue'

function mountPrompt(props: Record<string, unknown> = {}) {
  return mount(PinPrompt, {
    props: { visible: true, ...props },
    attachTo: document.body,
    global: { plugins: [[PrimeVue, { unstyled: true }]] },
  })
}

const q = <T extends Element = HTMLElement>(testid: string) =>
  document.body.querySelector<T & HTMLElement>(`[data-testid="${testid}"]`)

async function type(testid: string, value: string) {
  const el = q<HTMLInputElement>(testid)!
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function click(testid: string) {
  q(testid)!.click()
  await flushPromises()
}

describe('PinPrompt', () => {
  it('P1-AUTH-05 emits approver username + PIN on submit', async () => {
    const w = mountPrompt()
    await flushPromises()
    expect(q('pin-prompt')).not.toBeNull()
    await type('pin-approver', '  manager1 ')
    await type('pin-input', '1357')
    await click('pin-submit')
    expect(w.emitted('submit')).toEqual([[{ approverUsername: 'manager1', pin: '1357' }]])
    w.unmount()
  })

  it('P1-AUTH-05 the keypad enters digits and backspace removes them', async () => {
    const w = mountPrompt({ defaultApprover: 'owner1' })
    await flushPromises()
    for (const k of ['2', '4', '6', '8', '1']) await click(`pin-key-${k}`)
    await click('pin-key-back')
    expect(q<HTMLInputElement>('pin-input')!.value).toBe('2468')
    await click('pin-submit')
    expect(w.emitted('submit')).toEqual([[{ approverUsername: 'owner1', pin: '2468' }]])
    w.unmount()
  })

  it('P1-AUTH-05 rejects a PIN that is not 4 to 6 digits and does not emit', async () => {
    const w = mountPrompt({ defaultApprover: 'manager1' })
    await flushPromises()
    await type('pin-input', '12')
    await click('pin-submit')
    expect(w.emitted('submit')).toBeUndefined()
    expect(q('pin-error')?.textContent).toContain('4 to 6 digits')
    w.unmount()
  })

  it('strips non-digits and caps the PIN at 6 digits', async () => {
    const w = mountPrompt()
    await flushPromises()
    await type('pin-input', '12a34567')
    expect(q<HTMLInputElement>('pin-input')!.value).toBe('123456')
    w.unmount()
  })

  it('requires an approver', async () => {
    const w = mountPrompt()
    await flushPromises()
    await type('pin-input', '1234')
    await click('pin-submit')
    expect(w.emitted('submit')).toBeUndefined()
    expect(q('pin-error')?.textContent).toContain('approver')
    w.unmount()
  })

  it('shows the server error as-is and clears the PIN for the next try', async () => {
    const w = mountPrompt({ defaultApprover: 'manager1' })
    await flushPromises()
    await type('pin-input', '9999')
    await w.setProps({ error: 'Wrong PIN. 2 tries left before the PIN locks.' })
    await flushPromises()
    expect(q('pin-error')?.textContent).toBe('Wrong PIN. 2 tries left before the PIN locks.')
    expect(q<HTMLInputElement>('pin-input')!.value).toBe('')
    w.unmount()
  })

  it('prevents double submit while busy', async () => {
    const w = mountPrompt({ defaultApprover: 'manager1', busy: true })
    await flushPromises()
    expect(q<HTMLButtonElement>('pin-submit')!.disabled).toBe(true)
    q<HTMLFormElement>('pin-submit')!.closest('form')!.dispatchEvent(new Event('submit'))
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
    w.unmount()
  })

  it('cancel closes without submitting', async () => {
    const w = mountPrompt()
    await flushPromises()
    await click('pin-cancel')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('update:visible')).toEqual([[false]])
    expect(w.emitted('submit')).toBeUndefined()
    w.unmount()
  })
})
