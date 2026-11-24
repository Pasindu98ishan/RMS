import { describe, expect, it } from 'vitest'
import { buildItemBody, moveItem } from '../itemForm'

const base = {
  code: ' RC01 ',
  name: ' Chicken rice ',
  categoryId: 'c1',
  stationId: 's1',
  localPrice: '950.00',
  foreignPrice: null as string | null,
  active: true,
  modifierGroupIds: ['g1', 'g2'],
}

describe('buildItemBody (one request: station, category, prices, ordered groups)', () => {
  it('P1-MENU-02 sends station, category, prices and groups in order; trims text', () => {
    expect(buildItemBody({ ...base, foreignPrice: '1425.00' })).toEqual({
      code: 'RC01',
      name: 'Chicken rice',
      categoryId: 'c1',
      stationId: 's1',
      localPrice: '950.00',
      foreignPrice: '1425.00',
      active: true,
      modifierGroupIds: ['g1', 'g2'],
    })
  })

  it('P1-MENU-04 omits an empty foreign price (never null or "")', () => {
    expect('foreignPrice' in buildItemBody(base)).toBe(false)
    expect('foreignPrice' in buildItemBody({ ...base, foreignPrice: '' })).toBe(false)
  })
})

describe('moveItem', () => {
  it('moves within bounds and returns a new array', () => {
    const list = ['a', 'b', 'c']
    expect(moveItem(list, 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(list, 2, -1)).toEqual(['a', 'c', 'b'])
    expect(list).toEqual(['a', 'b', 'c'])
  })

  it('ignores moves off the ends', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})
