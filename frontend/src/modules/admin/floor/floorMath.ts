import { FLOOR_HEIGHT, FLOOR_WIDTH } from '@/api/types'

export interface Point {
  x: number
  y: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Grid step tables snap to while dragging (keeps the plan tidy). */
export const SNAP = 10

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Clamps a point to the 1000 x 700 logical grid and rounds to whole numbers (the API takes integers). */
export function clampPoint(p: Point): Point {
  return { x: clamp(Math.round(p.x), 0, FLOOR_WIDTH), y: clamp(Math.round(p.y), 0, FLOOR_HEIGHT) }
}

export function snapPoint(p: Point, step = SNAP): Point {
  return clampPoint({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step })
}

/** Screen pointer position -> logical grid position, for a canvas drawn at `rect` (any scale). */
export function pointerToGrid(clientX: number, clientY: number, rect: Rect): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: ((clientX - rect.left) / rect.width) * FLOOR_WIDTH,
    y: ((clientY - rect.top) / rect.height) * FLOOR_HEIGHT,
  }
}

/** Logical grid position -> CSS percentages for absolute positioning (centre of the table). */
export function gridToPercent(p: Point): { left: string; top: string } {
  return { left: `${(p.x / FLOOR_WIDTH) * 100}%`, top: `${(p.y / FLOOR_HEIGHT) * 100}%` }
}

/** Arrow-key nudge: 10 grid units, 50 with Shift. Returns null for other keys. */
export function nudge(key: string, shift: boolean, p: Point): Point | null {
  const d = shift ? 50 : SNAP
  switch (key) {
    case 'ArrowLeft':
      return snapPoint({ x: p.x - d, y: p.y })
    case 'ArrowRight':
      return snapPoint({ x: p.x + d, y: p.y })
    case 'ArrowUp':
      return snapPoint({ x: p.x, y: p.y - d })
    case 'ArrowDown':
      return snapPoint({ x: p.x, y: p.y + d })
    default:
      return null
  }
}
