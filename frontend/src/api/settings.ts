import { api, data } from './client'
import type { components } from './generated/schema'
import type {
  BusinessDaySettings,
  CreateDeliveryAreaRequest,
  CreateReasonRequest,
  DeliveryArea,
  DeliveryAreaOption,
  MenuSettings,
  Reason,
  ReasonCategory,
  ReasonOption,
  UpdateDeliveryAreaRequest,
  UpdateReasonRequest,
  IdleTimeoutSettings,
  RestaurantDetails,
  ServiceChargeSettings,
  TaxSettings,
} from './types'

type S = components['schemas']

export const settingsApi = {
  getRestaurant() {
    return data<RestaurantDetails>(api.GET('/settings/restaurant'))
  },
  updateRestaurant(body: S['UpdateRestaurantDetailsRequest']) {
    return data<RestaurantDetails>(api.PUT('/settings/restaurant', { body }))
  },
  getServiceCharges() {
    return data<ServiceChargeSettings>(api.GET('/settings/service-charges'))
  },
  updateServiceCharges(body: S['UpdateServiceChargeSettingsRequest']) {
    return data<ServiceChargeSettings>(api.PUT('/settings/service-charges', { body }))
  },
  getTax() {
    return data<TaxSettings>(api.GET('/settings/tax'))
  },
  updateTax(body: S['UpdateTaxSettingsRequest']) {
    return data<TaxSettings>(api.PUT('/settings/tax', { body }))
  },
  getBusinessDay() {
    return data<BusinessDaySettings>(api.GET('/settings/business-day'))
  },
  updateBusinessDay(body: S['UpdateBusinessDaySettingsRequest']) {
    return data<BusinessDaySettings>(api.PUT('/settings/business-day', { body }))
  },
  getIdleTimeouts() {
    return data<IdleTimeoutSettings>(api.GET('/settings/idle-timeouts'))
  },
  updateIdleTimeouts(body: S['UpdateIdleTimeoutSettingsRequest']) {
    return data<IdleTimeoutSettings>(api.PUT('/settings/idle-timeouts', { body }))
  },

  // ---- M1.1
  getMenuSettings() {
    return data<MenuSettings>(api.GET('/settings/menu'))
  },
  updateMenuSettings(body: S['UpdateMenuSettingsRequest']) {
    return data<MenuSettings>(api.PUT('/settings/menu', { body }))
  },
  listDeliveryAreas() {
    return data<DeliveryArea[]>(api.GET('/delivery-areas'))
  },
  /** Active areas to pick on a delivery order (ORDER_CREATE). */
  deliveryAreaOptions() {
    return data<DeliveryAreaOption[]>(api.GET('/delivery-areas/options'))
  },
  createDeliveryArea(body: CreateDeliveryAreaRequest) {
    return data<DeliveryArea>(api.POST('/delivery-areas', { body }))
  },
  updateDeliveryArea(areaId: string, body: UpdateDeliveryAreaRequest) {
    return data<DeliveryArea>(api.PUT('/delivery-areas/{areaId}', { params: { path: { areaId } }, body }))
  },
  listReasons(category?: ReasonCategory) {
    return data<Reason[]>(api.GET('/reasons', { params: { query: category ? { category } : {} } }))
  },
  /** Active reasons for a dialog (ORDER_VIEW). */
  reasonOptions(category: ReasonCategory) {
    return data<ReasonOption[]>(api.GET('/reasons/options', { params: { query: { category } } }))
  },
  createReason(body: CreateReasonRequest) {
    return data<Reason>(api.POST('/reasons', { body }))
  },
  updateReason(reasonId: string, body: UpdateReasonRequest) {
    return data<Reason>(api.PUT('/reasons/{reasonId}', { params: { path: { reasonId } }, body }))
  },
}
