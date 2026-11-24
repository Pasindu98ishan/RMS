import { api, data } from './client'
import type {
  AvailabilityItem,
  Category,
  CreateCategoryRequest,
  CreateMenuItemRequest,
  CreateModifierGroupRequest,
  ItemAvailability,
  KitchenStation,
  KitchenStationOption,
  ListMenuItemsQuery,
  MenuItem,
  MenuItemPage,
  ModifierGroup,
  PosMenu,
  UpdateCategoryRequest,
  UpdateKitchenStationRequest,
  UpdateMenuItemRequest,
  UpdateModifierGroupRequest,
} from './types'

export const menuApi = {
  // ---- kitchen stations
  listStations() {
    return data<KitchenStation[]>(api.GET('/kitchen-stations'))
  },
  /** Active stations for forms (terminal edit, item editor). Needs TERMINAL_MANAGE. */
  stationOptions() {
    return data<KitchenStationOption[]>(api.GET('/kitchen-stations/options'))
  },
  updateStation(stationId: string, body: UpdateKitchenStationRequest) {
    return data<KitchenStation>(
      api.PUT('/kitchen-stations/{stationId}', { params: { path: { stationId } }, body }),
    )
  },

  // ---- categories
  listCategories() {
    return data<Category[]>(api.GET('/categories'))
  },
  createCategory(body: CreateCategoryRequest) {
    return data<Category>(api.POST('/categories', { body }))
  },
  updateCategory(categoryId: string, body: UpdateCategoryRequest) {
    return data<Category>(api.PUT('/categories/{categoryId}', { params: { path: { categoryId } }, body }))
  },

  // ---- menu items
  listItems(query: ListMenuItemsQuery) {
    return data<MenuItemPage>(api.GET('/menu-items', { params: { query } }))
  },
  getItem(itemId: string) {
    return data<MenuItem>(api.GET('/menu-items/{itemId}', { params: { path: { itemId } } }))
  },
  createItem(body: CreateMenuItemRequest) {
    return data<MenuItem>(api.POST('/menu-items', { body }))
  },
  updateItem(itemId: string, body: UpdateMenuItemRequest) {
    return data<MenuItem>(api.PUT('/menu-items/{itemId}', { params: { path: { itemId } }, body }))
  },
  /** Sold-out toggle (MENU_AVAILABILITY). */
  setAvailability(itemId: string, available: boolean) {
    return data<ItemAvailability>(
      api.PUT('/menu-items/{itemId}/availability', { params: { path: { itemId } }, body: { available } }),
    )
  },
  availabilityBoard() {
    return data<AvailabilityItem[]>(api.GET('/menu/availability'))
  },
  /** Whole sellable menu for the order screen (M1.2). Needs ORDER_CREATE. */
  posMenu() {
    return data<PosMenu>(api.GET('/menu/pos'))
  },

  // ---- modifier groups
  listModifierGroups() {
    return data<ModifierGroup[]>(api.GET('/modifier-groups'))
  },
  getModifierGroup(groupId: string) {
    return data<ModifierGroup>(api.GET('/modifier-groups/{groupId}', { params: { path: { groupId } } }))
  },
  createModifierGroup(body: CreateModifierGroupRequest) {
    return data<ModifierGroup>(api.POST('/modifier-groups', { body }))
  },
  updateModifierGroup(groupId: string, body: UpdateModifierGroupRequest) {
    return data<ModifierGroup>(api.PUT('/modifier-groups/{groupId}', { params: { path: { groupId } }, body }))
  },
}
