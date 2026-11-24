import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { terminalsApi } from '@/api/terminals'
import type { RegisterTerminalRequest, TerminalSummary } from '@/api/types'
import { readJson, removeKey, STORAGE_KEYS, writeJson } from '@/utils/storage'

/** What this device keeps after registerTerminal (P1-AUTH-04). */
export interface DeviceRegistration {
  terminalId: string
  deviceToken: string
  /** Last known details, refreshed from each AuthSession. */
  terminal: TerminalSummary
  registeredAt: string
}

export const useTerminalStore = defineStore('terminal', () => {
  const registration = ref<DeviceRegistration | null>(readJson<DeviceRegistration>(STORAGE_KEYS.terminal))
  /** Set when the server says this device's registration is no longer valid. */
  const problem = ref<string | null>(null)

  const isRegistered = computed(() => registration.value !== null)
  const terminalId = computed(() => registration.value?.terminalId ?? null)
  const terminal = computed(() => registration.value?.terminal ?? null)

  function save(reg: DeviceRegistration | null) {
    registration.value = reg
    if (reg) writeJson(STORAGE_KEYS.terminal, reg)
    else removeKey(STORAGE_KEYS.terminal)
  }

  async function register(body: RegisterTerminalRequest): Promise<DeviceRegistration> {
    const res = await terminalsApi.register(body)
    const t = res.terminal
    const reg: DeviceRegistration = {
      terminalId: t.id,
      deviceToken: res.deviceToken,
      terminal: {
        id: t.id,
        name: t.name,
        type: t.type,
        active: t.active,
        ...(t.kitchenStationId ? { kitchenStationId: t.kitchenStationId } : {}),
        ...(t.kitchenStationName ? { kitchenStationName: t.kitchenStationName } : {}),
        ...(t.orderingPointId ? { orderingPointId: t.orderingPointId } : {}),
        ...(t.orderingPointName ? { orderingPointName: t.orderingPointName } : {}),
      },
      registeredAt: new Date().toISOString(),
    }
    save(reg)
    problem.value = null
    return reg
  }

  /** Stores a registration obtained elsewhere (mock tools adopt a seeded terminal). */
  function adopt(reg: DeviceRegistration) {
    save(reg)
    problem.value = null
  }

  /** Keeps the cached terminal details in step with what the server returned at login/refresh. */
  function updateDetails(summary: TerminalSummary) {
    if (!registration.value || registration.value.terminalId !== summary.id) return
    save({ ...registration.value, terminal: summary })
  }

  function forget() {
    save(null)
  }

  return { registration, problem, isRegistered, terminalId, terminal, register, adopt, updateDetails, forget }
})
