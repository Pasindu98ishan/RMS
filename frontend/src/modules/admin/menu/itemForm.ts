import type { CreateMenuItemRequest } from '@/api/types'

export interface ItemForm {
  code: string
  name: string
  categoryId: string
  stationId: string
  localPrice: string
  /** null / empty = no foreign price. */
  foreignPrice: string | null
  active: boolean
  modifierGroupIds: string[]
}

/**
 * Builds the create / update body (one request, PUT is a full replacement): an empty foreign price
 * is omitted, never sent as null or "".
 */
export function buildItemBody(f: ItemForm): CreateMenuItemRequest & { active: boolean } {
  return {
    code: f.code.trim(),
    name: f.name.trim(),
    categoryId: f.categoryId,
    stationId: f.stationId,
    localPrice: f.localPrice,
    ...(f.foreignPrice ? { foreignPrice: f.foreignPrice } : {}),
    active: f.active,
    modifierGroupIds: [...f.modifierGroupIds],
  }
}

/** Moves the element at `index` by `delta` positions (clamped); returns a new array. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta
  const out = [...list]
  if (index < 0 || index >= out.length || target < 0 || target >= out.length) return out
  const [moved] = out.splice(index, 1)
  out.splice(target, 0, moved as T)
  return out
}
