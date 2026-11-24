import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MoneyInput from '../MoneyInput.vue'
import { compareMoney, formatMoney, multiplyMoney, parseMoneyInput, sumMoney } from '@/utils/money'

describe('money utils (LKR, 2 decimals, no floats)', () => {
  it.each([
    ['1250', '1250.00'],
    ['1,250.5', '1250.50'],
    ['0.1', '0.10'],
    ['.5', '0.50'],
    ['007', '7.00'],
    ['LKR 99.', '99.00'],
    ['', null],
    ['12.345', undefined],
    ['1.2.3', undefined],
    ['abc', undefined],
    ['-5', undefined],
  ])('parseMoneyInput(%j) -> %j', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected)
  })

  it('allows negatives only when asked', () => {
    expect(parseMoneyInput('-5', { allowNegative: true })).toBe('-5.00')
  })

  it('formats server values as LKR with separators, unchanged otherwise', () => {
    expect(formatMoney('1100.00')).toBe('LKR 1,100.00')
    expect(formatMoney('1234567.05')).toBe('LKR 1,234,567.05')
    expect(formatMoney('-770.00')).toBe('LKR -770.00')
    expect(formatMoney('0.00')).toBe('LKR 0.00')
  })

  it('does exact arithmetic for local previews', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30')
    expect(multiplyMoney('5000.00', 3)).toBe('15000.00')
    expect(compareMoney('10.00', '9.99')).toBe(1)
  })
})

function mountInput(props: Record<string, unknown> = {}) {
  return mount(MoneyInput, {
    props: { modelValue: null, ...props },
    attrs: { 'data-testid': 'amount' },
  })
}

describe('MoneyInput', () => {
  it('puts data-testid on the <input> and shows the LKR prefix', () => {
    const w = mountInput()
    expect(w.find('input').attributes('data-testid')).toBe('amount')
    expect(w.text()).toContain('LKR')
  })

  it('shows the model grouped with 2 decimals', () => {
    const w = mountInput({ modelValue: '1100.00' })
    expect((w.find('input').element as HTMLInputElement).value).toBe('1,100.00')
  })

  it('emits the canonical money string while typing and formats on blur', async () => {
    const w = mountInput()
    const input = w.find('input')
    await input.trigger('focus')
    await input.setValue('1250.5')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['1250.50'])
    await w.setProps({ modelValue: '1250.50' })
    await input.trigger('blur')
    expect((input.element as HTMLInputElement).value).toBe('1,250.50')
  })

  it('strips letters as they are typed', async () => {
    const w = mountInput()
    const input = w.find('input')
    await input.setValue('12a3')
    expect((input.element as HTMLInputElement).value).toBe('123')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['123.00'])
  })

  it('flags more than 2 decimals and does not emit a value', async () => {
    const w = mountInput()
    await w.find('input').setValue('10.555')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    expect(w.emitted('invalid')?.at(-1)).toEqual([true])
    expect(w.find('[role="alert"]').text()).toContain('up to 2 decimals')
  })

  it('emits null when cleared', async () => {
    const w = mountInput({ modelValue: '50.00' })
    await w.find('input').setValue('')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([null])
  })

  it('enforces min / max without floats', async () => {
    const w = mountInput({ min: '1.00', max: '5000.00' })
    await w.find('input').setValue('5000.01')
    expect(w.find('[role="alert"]').text()).toContain('at most 5,000.00')
    await w.find('input').setValue('0.99')
    expect(w.find('[role="alert"]').text()).toContain('at least 1.00')
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('shows a server field error passed in', () => {
    const w = mountInput({ error: 'Price must be more than 0' })
    expect(w.find('[role="alert"]').text()).toBe('Price must be more than 0')
  })
})
