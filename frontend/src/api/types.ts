/** Short aliases for generated schema types (never hand-written DTOs - ADR-005). */
import type { components, paths } from './generated/schema'

type S = components['schemas']

export type PermissionCode = S['PermissionCode']
export type PermissionModule = S['PermissionModule']
export type Permission = S['Permission']
export type TerminalType = S['TerminalType']
export type TerminalSummary = S['TerminalSummary']
export type Terminal = S['Terminal']
export type TerminalRegistration = S['TerminalRegistration']
export type RegisterTerminalRequest = S['RegisterTerminalRequest']
export type UpdateTerminalRequest = S['UpdateTerminalRequest']
export type AuthSession = S['AuthSession']
export type AuthUser = S['AuthUser']
export type CurrentUserProfile = S['CurrentUserProfile']
export type LogoutReason = S['LogoutReason']
export type SessionType = S['SessionType']
export type RoleRef = S['RoleRef']
export type RoleKey = S['RoleKey']
export type RoleOption = S['RoleOption']
export type UserOption = S['UserOption']
export type Approval = S['Approval']
export type UserSummary = S['UserSummary']
export type UserPage = S['UserPage']
export type User = S['User']
export type CreateUserRequest = S['CreateUserRequest']
export type UpdateUserRequest = S['UpdateUserRequest']
export type RoleSummary = S['RoleSummary']
export type Role = S['Role']
export type CreateRoleRequest = S['CreateRoleRequest']
export type UpdateRoleRequest = S['UpdateRoleRequest']
export type AuditAction = S['AuditAction']
export type AuditEntry = S['AuditEntry']
export type AuditLogPage = S['AuditLogPage']
export type RestaurantDetails = S['RestaurantDetails']
export type ServiceChargeSettings = S['ServiceChargeSettings']
export type ServiceChargeOrderType = S['ServiceChargeOrderType']
export type TaxSettings = S['TaxSettings']
export type BusinessDaySettings = S['BusinessDaySettings']
export type IdleTimeoutSettings = S['IdleTimeoutSettings']
export type IdleTimeoutRule = S['IdleTimeoutRule']
export type Problem = S['Problem']

export type ListUsersQuery = NonNullable<paths['/users']['get']['parameters']['query']>
export type ListTerminalsQuery = NonNullable<paths['/terminals']['get']['parameters']['query']>
export type AuditQuery = NonNullable<paths['/audit-log']['get']['parameters']['query']>
export type AuditExportQuery = NonNullable<paths['/audit-log/export']['get']['parameters']['query']>

/** Enum values as runtime arrays. `satisfies` keeps them in step with the generated types. */
export const TERMINAL_TYPES = [
  'CASHIER_POS',
  'RECEPTION_POS',
  'KITCHEN',
  'ADMIN',
  'DISPLAY',
] as const satisfies readonly TerminalType[]

export const PERMISSION_MODULES = [
  'ADMIN',
  'ORDERS',
  'BILLING',
  'DISCOUNTS',
  'KITCHEN',
  'SHIFTS',
  'REPORTS',
] as const satisfies readonly PermissionModule[]

export const SERVICE_CHARGE_ORDER_TYPES = [
  'DINE_IN',
  'TAKEAWAY',
  'DELIVERY',
] as const satisfies readonly ServiceChargeOrderType[]

export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'ACCOUNT_LOCKED',
  'ACCOUNT_UNLOCKED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'PIN_CHANGED',
  'PIN_RESET',
  'PIN_FAILED',
  'PIN_LOCKED',
  'CREATE',
  'UPDATE',
  'DELETE',
  'ACTIVATE',
  'DEACTIVATE',
  'ROLES_ASSIGNED',
  'TERMINAL_REGISTERED',
  'SETTINGS_CHANGED',
  'PRICE_CHANGED',
  'DISCOUNT_APPLIED',
  'DISCOUNT_REMOVED',
  'LINE_CANCELLED',
  'BILL_VOIDED',
  'REFUND',
  'SHIFT_OPENED',
  'SHIFT_CLOSED',
  'DAY_END',
  'AUDIT_EXPORTED',
  'DATA_IMPORTED',
] as const satisfies readonly AuditAction[]

/** Compile-time check that the arrays above list every enum value. */
type Exhaustive<All, Listed> = [All] extends [Listed] ? true : never
export const _exhaustive: [
  Exhaustive<TerminalType, (typeof TERMINAL_TYPES)[number]>,
  Exhaustive<PermissionModule, (typeof PERMISSION_MODULES)[number]>,
  Exhaustive<ServiceChargeOrderType, (typeof SERVICE_CHARGE_ORDER_TYPES)[number]>,
  Exhaustive<AuditAction, (typeof AUDIT_ACTIONS)[number]>,
] = [true, true, true, true]

export const TERMINAL_TYPE_LABEL: Record<TerminalType, string> = {
  CASHIER_POS: 'Cashier POS',
  RECEPTION_POS: 'Reception POS',
  KITCHEN: 'Kitchen screen',
  ADMIN: 'Admin',
  DISPLAY: 'Display screen',
}

export const ORDER_TYPE_LABEL: Record<ServiceChargeOrderType, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
}

export const MODULE_LABEL: Record<PermissionModule, string> = {
  ADMIN: 'Admin',
  ORDERS: 'Orders',
  BILLING: 'Billing',
  DISCOUNTS: 'Discounts',
  KITCHEN: 'Kitchen',
  SHIFTS: 'Shifts',
  REPORTS: 'Reports',
}

// ---------------------------------------------------------------- M1.1 catalog and floor
export type KitchenStation = S['KitchenStation']
export type KitchenStationOption = S['KitchenStationOption']
export type UpdateKitchenStationRequest = S['UpdateKitchenStationRequest']
export type OrderingPoint = S['OrderingPoint']
export type TerminalSetupOptions = S['TerminalSetupOptions']
export type Category = S['Category']
export type CreateCategoryRequest = S['CreateCategoryRequest']
export type UpdateCategoryRequest = S['UpdateCategoryRequest']
export type MenuItem = S['MenuItem']
export type MenuItemSummary = S['MenuItemSummary']
export type MenuItemPage = S['MenuItemPage']
export type CreateMenuItemRequest = S['CreateMenuItemRequest']
export type UpdateMenuItemRequest = S['UpdateMenuItemRequest']
export type ItemAvailability = S['ItemAvailability']
export type AvailabilityItem = S['AvailabilityItem']
export type PosMenu = S['PosMenu']
export type ModifierGroup = S['ModifierGroup']
export type ModifierGroupRef = S['ModifierGroupRef']
export type ModifierOption = S['ModifierOption']
export type ModifierOptionInput = S['ModifierOptionInput']
export type CreateModifierGroupRequest = S['CreateModifierGroupRequest']
export type UpdateModifierGroupRequest = S['UpdateModifierGroupRequest']
export type DiningTable = S['DiningTable']
export type CreateTableRequest = S['CreateTableRequest']
export type UpdateTableRequest = S['UpdateTableRequest']
export type TablePosition = S['TablePosition']
export type FloorLayout = S['FloorLayout']
export type FloorTable = S['FloorTable']
export type DeliveryArea = S['DeliveryArea']
export type DeliveryAreaOption = S['DeliveryAreaOption']
export type CreateDeliveryAreaRequest = S['CreateDeliveryAreaRequest']
export type UpdateDeliveryAreaRequest = S['UpdateDeliveryAreaRequest']
export type Reason = S['Reason']
export type ReasonCategory = S['ReasonCategory']
export type ReasonOption = S['ReasonOption']
export type CreateReasonRequest = S['CreateReasonRequest']
export type UpdateReasonRequest = S['UpdateReasonRequest']
export type MenuSettings = S['MenuSettings']
export type ImportType = S['ImportType']
export type ImportFileFormat = S['ImportFileFormat']
export type ImportReport = S['ImportReport']
export type ImportError = S['ImportError']

export type ListMenuItemsQuery = NonNullable<paths['/menu-items']['get']['parameters']['query']>

export const IMPORT_TYPES = [
  'CATEGORIES',
  'MODIFIER_GROUPS',
  'MENU_ITEMS',
  'TABLES',
] as const satisfies readonly ImportType[]

export const REASON_CATEGORIES = [
  'CANCEL',
  'VOID',
  'REFUND',
  'PETTY_CASH',
  'DISCOUNT_OTHER',
] as const satisfies readonly ReasonCategory[]

export const IMPORT_TYPE_LABEL: Record<ImportType, string> = {
  CATEGORIES: 'Categories',
  MODIFIER_GROUPS: 'Modifier groups',
  MENU_ITEMS: 'Menu items',
  TABLES: 'Tables',
}

export const REASON_CATEGORY_LABEL: Record<ReasonCategory, string> = {
  CANCEL: 'Cancel line',
  VOID: 'Void bill',
  REFUND: 'Refund',
  PETTY_CASH: 'Petty cash',
  DISCOUNT_OTHER: 'Discount (other)',
}

/** Floor-plan logical grid (m1.1-scope.md decision 7). */
export const FLOOR_WIDTH = 1000
export const FLOOR_HEIGHT = 700

export const _exhaustiveM11: [
  Exhaustive<ImportType, (typeof IMPORT_TYPES)[number]>,
  Exhaustive<ReasonCategory, (typeof REASON_CATEGORIES)[number]>,
] = [true, true]
