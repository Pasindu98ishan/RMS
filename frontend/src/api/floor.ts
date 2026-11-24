import { api, data } from './client'
import type {
  CreateTableRequest,
  DiningTable,
  FloorLayout,
  OrderingPoint,
  TablePosition,
  UpdateTableRequest,
} from './types'

export const floorApi = {
  orderingPoints() {
    return data<OrderingPoint[]>(api.GET('/ordering-points'))
  },
  listTables(query: { active?: boolean; section?: string } = {}) {
    return data<DiningTable[]>(api.GET('/tables', { params: { query } }))
  },
  createTable(body: CreateTableRequest) {
    return data<DiningTable>(api.POST('/tables', { body }))
  },
  updateTable(tableId: string, body: UpdateTableRequest) {
    return data<DiningTable>(api.PUT('/tables/{tableId}', { params: { path: { tableId } }, body }))
  },
  /** One call saves every moved table (each with its version). */
  savePositions(positions: TablePosition[]) {
    return data<DiningTable[]>(api.PUT('/tables/positions', { body: { positions } }))
  },
  /** Active tables with positions, for the POS floor view (ORDER_VIEW). */
  layout() {
    return data<FloorLayout>(api.GET('/floor/layout'))
  },
}
