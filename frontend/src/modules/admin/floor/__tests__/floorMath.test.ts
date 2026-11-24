import { describe, expect, it } from 'vitest'
import { clampPoint, gridToPercent, nudge, pointerToGrid, snapPoint } from '../floorMath'

describe('floor math (1000 x 700 grid)', () => {
  it('P1-FLOOR-01 converts a pointer position on a scaled canvas to grid units', () => {
    const rect = { left: 100, top: 50, width: 500, height: 350 } // half scale
    expect(pointerToGrid(350, 225, rect)).toEqual({ x: 500, y: 350 })
    expect(pointerToGrid(100, 50, rect)).toEqual({ x: 0, y: 0 })
    expect(pointerToGrid(600, 400, rect)).toEqual({ x: 1000, y: 700 })
  })

  it('returns the origin for an unmeasured canvas', () => {
    expect(pointerToGrid(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('clamps to the grid and rounds to integers (the API takes integers)', () => {
    expect(clampPoint({ x: -20, y: 900.4 })).toEqual({ x: 0, y: 700 })
    expect(clampPoint({ x: 10.6, y: 20.4 })).toEqual({ x: 11, y: 20 })
  })

  it('snaps to a 10 unit grid', () => {
    expect(snapPoint({ x: 134, y: 266 })).toEqual({ x: 130, y: 270 })
    expect(snapPoint({ x: 1004, y: 3 })).toEqual({ x: 1000, y: 0 })
  })

  it('positions tables by percentage of the canvas', () => {
    expect(gridToPercent({ x: 500, y: 350 })).toEqual({ left: '50%', top: '50%' })
  })

  it('nudges with arrow keys: 10 units, 50 with Shift, nothing else', () => {
    expect(nudge('ArrowRight', false, { x: 100, y: 100 })).toEqual({ x: 110, y: 100 })
    expect(nudge('ArrowUp', true, { x: 100, y: 100 })).toEqual({ x: 100, y: 50 })
    expect(nudge('ArrowLeft', false, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(nudge('a', false, { x: 1, y: 1 })).toBeNull()
  })
})
