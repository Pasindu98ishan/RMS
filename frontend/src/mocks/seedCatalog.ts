/**
 * Sample catalog and floor data for the mocks (m1.1-scope.md "Sample data for testing"): 3 stations,
 * 2 ordering points, 6 categories, ~40 items (about 25 with a foreign price), 3 modifier groups,
 * 12 tables in two sections, 3 delivery areas and default reasons. Test values only.
 */
import type { ModifierOption, ReasonCategory } from '@/api/types'
import { seedId } from './seed'

const SEED_TIME = '2026-11-01T02:30:00Z'

export const ORDERING_POINT_IDS = { cashier: seedId(0x4, 1), reception: seedId(0x4, 2) } as const

export interface MockStation {
  id: string
  number: number
  name: string
  targetPrepMinutes: number
  active: boolean
  version: number
  updatedAt: string
}

export function seedStations(stationIds: readonly string[]): MockStation[] {
  const rows: Array<[string, number]> = [
    ['Kitchen 1 Rice & Curry', 15],
    ['Kitchen 2 Grill', 20],
    ['Kitchen 3 Juice & Dessert', 8],
  ]
  return rows.map(([name, targetPrepMinutes], i) => ({
    id: stationIds[i] as string,
    number: i + 1,
    name,
    targetPrepMinutes,
    active: true,
    version: 1,
    updatedAt: SEED_TIME,
  }))
}

export function seedOrderingPoints() {
  return [
    { id: ORDERING_POINT_IDS.cashier, name: 'Cashier counter' },
    { id: ORDERING_POINT_IDS.reception, name: 'Reception' },
  ]
}

export interface MockCategory {
  id: string
  name: string
  sortOrder: number
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
}

const CATEGORY_NAMES = ['Rice & Curry', 'Short Eats', 'Grill', 'Beverages', 'Desserts', 'Liquor']

export function seedCategories(): MockCategory[] {
  return CATEGORY_NAMES.map((name, i) => ({
    id: seedId(0x8, i + 1),
    name,
    sortOrder: i + 1,
    active: true,
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  }))
}

export interface MockModifierGroup {
  id: string
  name: string
  required: boolean
  minSelect: number
  maxSelect: number
  active: boolean
  options: ModifierOption[]
  version: number
  createdAt: string
  updatedAt: string
}

export const GROUP_IDS = { spice: seedId(0xa, 1), extras: seedId(0xa, 2), size: seedId(0xa, 3) } as const

export function seedModifierGroups(): MockModifierGroup[] {
  let o = 0
  const opt = (name: string, priceDelta: string): ModifierOption => ({
    id: seedId(0xb, ++o),
    name,
    priceDelta,
  })
  const g = (
    id: string,
    name: string,
    required: boolean,
    minSelect: number,
    maxSelect: number,
    options: ModifierOption[],
  ): MockModifierGroup => ({
    id,
    name,
    required,
    minSelect,
    maxSelect,
    active: true,
    options,
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  })
  return [
    g(GROUP_IDS.spice, 'Spice level', true, 1, 1, [
      opt('Mild', '0.00'),
      opt('Medium', '0.00'),
      opt('Hot', '0.00'),
    ]),
    g(GROUP_IDS.extras, 'Extras', false, 0, 3, [
      opt('Egg', '100.00'),
      opt('Cheese', '150.00'),
      opt('Extra chicken', '300.00'),
    ]),
    g(GROUP_IDS.size, 'Size', true, 1, 1, [
      opt('Small', '0.00'),
      opt('Medium', '100.00'),
      opt('Large', '200.00'),
    ]),
  ]
}

export interface MockItem {
  id: string
  code: string
  name: string
  categoryId: string
  stationId: string
  localPrice: string
  foreignPrice?: string
  active: boolean
  available: boolean
  groupIds: string[]
  version: number
  createdAt: string
  updatedAt: string
}

type Row = [
  code: string,
  name: string,
  cat: number,
  station: number,
  local: number,
  foreign: number | null,
  groups: string[],
]

export function seedItems(stationIds: readonly string[]): MockItem[] {
  const { spice, extras, size } = GROUP_IDS
  const rows: Row[] = [
    ['RC01', 'Chicken rice & curry', 1, 1, 950, 1425, [spice, extras]],
    ['RC02', 'Fish rice & curry', 1, 1, 1050, 1575, [spice]],
    ['RC03', 'Vegetable rice & curry', 1, 1, 750, null, [spice, extras]],
    ['RC04', 'Egg rice & curry', 1, 1, 800, null, [spice, extras]],
    ['RC05', 'Pork rice & curry', 1, 1, 1150, 1725, [spice]],
    ['RC06', 'Prawn rice & curry', 1, 1, 1450, 2175, [spice]],
    ['RC07', 'Dhal curry (extra)', 1, 1, 250, null, []],
    ['RC08', 'Chicken kottu', 1, 1, 1100, 1650, [spice, extras]],
    ['SE01', 'Fish cutlet', 2, 1, 120, null, []],
    ['SE02', 'Vegetable roll', 2, 1, 100, null, []],
    ['SE03', 'Chicken patty', 2, 1, 150, 225, []],
    ['SE04', 'Egg roti', 2, 1, 180, null, []],
    ['SE05', 'Isso wade', 2, 1, 250, 375, [spice]],
    ['SE06', 'Fish bun', 2, 1, 90, null, []],
    ['GR01', 'Grilled chicken (half)', 3, 2, 1800, 2700, [spice]],
    ['GR02', 'Grilled chicken (full)', 3, 2, 3200, 4800, [spice]],
    ['GR03', 'Beef steak', 3, 2, 2900, 4350, [spice]],
    ['GR04', 'Pork chops', 3, 2, 2600, 3900, [spice]],
    ['GR05', 'Chicken skewers', 3, 2, 1500, 2250, [spice]],
    ['GR06', 'BBQ platter', 3, 2, 4800, 7200, [spice]],
    ['GR07', 'Grilled vegetables', 3, 2, 1100, null, []],
    ['GR08', 'Grilled fish fillet', 3, 2, 2200, 3300, [spice]],
    ['BV01', 'Lime juice', 4, 3, 350, 525, [size]],
    ['BV02', 'Mango juice', 4, 3, 550, 825, [size]],
    ['BV03', 'Passion fruit juice', 4, 3, 500, 750, [size]],
    ['BV04', 'Papaya juice', 4, 3, 450, null, [size]],
    ['BV05', 'Watermelon juice', 4, 3, 450, null, [size]],
    ['BV06', 'King coconut', 4, 3, 300, 450, []],
    ['BV07', 'Faluda', 4, 3, 650, 975, [size]],
    ['BV08', 'Ceylon tea', 4, 3, 150, null, []],
    ['BV09', 'Coffee', 4, 3, 250, 375, [size]],
    ['DS01', 'Watalappan', 5, 3, 450, 675, []],
    ['DS02', 'Curd & treacle', 5, 3, 550, 825, []],
    ['DS03', 'Ice cream (2 scoops)', 5, 3, 400, null, []],
    ['DS04', 'Fruit salad', 5, 3, 500, 750, []],
    ['DS05', 'Chocolate biscuit pudding', 5, 3, 600, null, []],
    ['DS06', 'Caramel pudding', 5, 3, 450, null, []],
    ['LQ01', 'Local beer', 6, 3, 650, 975, []],
    ['LQ02', 'Imported beer', 6, 3, 950, 1425, []],
    ['LQ03', 'Arrack (shot)', 6, 3, 400, null, []],
    ['LQ04', 'Red wine (glass)', 6, 3, 1200, 1800, []],
  ]
  return rows.map(([code, name, cat, station, local, foreign, groupIds], i) => ({
    id: seedId(0x9, i + 1),
    code,
    name,
    categoryId: seedId(0x8, cat),
    stationId: stationIds[station - 1] as string,
    localPrice: `${local}.00`,
    ...(foreign !== null ? { foreignPrice: `${foreign}.00` } : {}),
    active: true,
    available: true,
    groupIds,
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  }))
}

export interface MockTable {
  id: string
  number: string
  section: string
  seats: number
  x: number
  y: number
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
}

/** Indoor 1-8 (two rows of four), Garden G1-G4. Positions are table centres on the 1000 x 700 grid. */
export function seedTables(): MockTable[] {
  const t = (n: number, number: string, section: string, seats: number, x: number, y: number): MockTable => ({
    id: seedId(0xc, n),
    number,
    section,
    seats,
    x,
    y,
    active: true,
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  })
  const out: MockTable[] = []
  for (let i = 0; i < 8; i++) {
    out.push(
      t(
        i + 1,
        String(i + 1),
        'Indoor',
        i % 3 === 2 ? 6 : i % 2 === 0 ? 4 : 2,
        130 + (i % 4) * 230,
        130 + Math.floor(i / 4) * 170,
      ),
    )
  }
  for (let i = 0; i < 4; i++) out.push(t(9 + i, `G${i + 1}`, 'Garden', 4, 130 + i * 230, 520))
  return out
}

export interface MockArea {
  id: string
  name: string
  fee: string
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export function seedAreas(): MockArea[] {
  return [
    ['Netolpitiya', '150.00'],
    ['Nearby', '300.00'],
    ['Far', '500.00'],
  ].map(([name, fee], i) => ({
    id: seedId(0xd, i + 1),
    name: name as string,
    fee: fee as string,
    active: true,
    version: 1,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  }))
}

export interface MockReason {
  id: string
  category: ReasonCategory
  text: string
  active: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export function seedReasons(): MockReason[] {
  const defaults: Record<ReasonCategory, string[]> = {
    CANCEL: ['Customer changed mind', 'Wrong item entered', 'Kitchen ran out of item', 'Waited too long'],
    VOID: ['Order entered by mistake', 'Customer left without paying', 'Duplicate bill'],
    REFUND: ['Food quality complaint', 'Wrong item served', 'Overcharged'],
    PETTY_CASH: ['Ice', 'Gas cylinder', 'Cleaning supplies', 'Staff transport'],
    DISCOUNT_OTHER: ['Regular customer', 'Complaint compensation', 'Manager special'],
  }
  let n = 0
  return (Object.entries(defaults) as Array<[ReasonCategory, string[]]>).flatMap(([category, texts]) =>
    texts.map((text) => ({
      id: seedId(0xe, ++n),
      category,
      text,
      active: true,
      version: 1,
      createdAt: SEED_TIME,
      updatedAt: SEED_TIME,
    })),
  )
}
