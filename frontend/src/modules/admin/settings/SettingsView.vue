<script setup lang="ts">
/**
 * /admin/settings - restaurant details (P1-SET-03), service charge per order type (P1-SET-01),
 * tax (off, P1-SET-02), business day start (P1-SET-04), idle timeouts (P1-AUTH-03).
 * Each block is its own versioned resource; "Save changes" saves the blocks that changed.
 */
import { computed, onMounted } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import ToggleSwitch from 'primevue/toggleswitch'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { settingsApi } from '@/api/settings'
import {
  ORDER_TYPE_LABEL,
  SERVICE_CHARGE_ORDER_TYPES,
  TERMINAL_TYPE_LABEL,
  type ServiceChargeOrderType,
  type TerminalType,
} from '@/api/types'
import { useNotify } from '@/composables/useNotify'
import { parseRateInput } from '@/utils/money'
import { formatDateTime } from '@/utils/time'
import { useSettingSection } from './useSettingSection'

const notify = useNotify()

// ---------------------------------------------------------------- restaurant
const restaurant = useSettingSection({
  get: settingsApi.getRestaurant,
  toForm: (d) => ({ name: d.name, address: d.address, phone: d.phone, receiptFooter: d.receiptFooter ?? '' }),
  put: (f, cur) => {
    const e: Record<string, string> = {}
    if (!f.name.trim()) e.name = 'Enter the restaurant name.'
    if (!f.address.trim()) e.address = 'Enter the address.'
    if (!f.phone.trim()) e.phone = 'Enter the phone number.'
    if (Object.keys(e).length) return e
    return settingsApi.updateRestaurant({
      name: f.name.trim(),
      address: f.address.trim(),
      phone: f.phone.trim(),
      version: cur.version,
      ...(f.receiptFooter.trim() ? { receiptFooter: f.receiptFooter.trim() } : {}),
    })
  },
})

// ---------------------------------------------------------------- service charges
type RateForm = Record<ServiceChargeOrderType, string>
const serviceCharges = useSettingSection({
  get: settingsApi.getServiceCharges,
  toForm: (d): RateForm => {
    const f = { DINE_IN: '0.00', TAKEAWAY: '0.00', DELIVERY: '0.00' }
    d.rules.forEach((r) => (f[r.orderType] = r.rate))
    return f
  },
  put: (f, cur) => {
    const e: Record<string, string> = {}
    const rules = SERVICE_CHARGE_ORDER_TYPES.map((orderType, i) => {
      const rate = parseRateInput(f[orderType])
      if (rate === null || rate === undefined) e[`rules[${i}].rate`] = 'Enter a rate from 0.00 to 100.00.'
      return { orderType, rate: rate ?? '0.00' }
    })
    if (Object.keys(e).length) return e
    return settingsApi.updateServiceCharges({ rules, version: cur.version })
  },
})
/** Server field errors index rules by their position in the request (same order as this list). */
const scError = (i: number) => serviceCharges.fieldErrors.value[`rules[${i}].rate`]

function normaliseRate(t: ServiceChargeOrderType) {
  const f = serviceCharges.form.value
  if (!f) return
  const parsed = parseRateInput(f[t])
  if (parsed) f[t] = parsed
}

// ---------------------------------------------------------------- tax (read-only in Phase 1)
const tax = useSettingSection({
  get: settingsApi.getTax,
  toForm: (d) => ({ enabled: d.enabled, rate: d.rate, label: d.label ?? '' }),
  put: () => ({}),
})

// ---------------------------------------------------------------- business day
const businessDay = useSettingSection({
  get: settingsApi.getBusinessDay,
  toForm: (d) => ({ dayStartTime: d.dayStartTime }),
  put: (f, cur) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.dayStartTime))
      return { dayStartTime: 'Enter a time as HH:mm (24 h).' }
    return settingsApi.updateBusinessDay({ dayStartTime: f.dayStartTime, version: cur.version })
  },
})

// ---------------------------------------------------------------- idle timeouts
const EDITABLE_IDLE = ['CASHIER_POS', 'RECEPTION_POS', 'ADMIN'] as const satisfies readonly TerminalType[]
type IdleForm = Record<(typeof EDITABLE_IDLE)[number], string> & { personal: string }
const idle = useSettingSection({
  get: settingsApi.getIdleTimeouts,
  toForm: (d): IdleForm => {
    const f = {
      CASHIER_POS: '',
      RECEPTION_POS: '',
      ADMIN: '',
      personal: String(d.idleTimeoutPersonalMinutes),
    }
    d.rules.forEach((r) => {
      if (r.terminalType in f && r.idleTimeoutMinutes !== undefined) {
        f[r.terminalType as keyof IdleForm] = String(r.idleTimeoutMinutes)
      }
    })
    return f
  },
  put: (f, cur) => {
    const e: Record<string, string> = {}
    const rules = EDITABLE_IDLE.map((terminalType, i) => {
      const v = f[terminalType].trim()
      const n = /^\d{1,3}$/.test(v) ? Number(v) : NaN
      if (!(n >= 1 && n <= 240)) e[`rules[${i}].idleTimeoutMinutes`] = 'Enter whole minutes from 1 to 240.'
      return { terminalType, idleTimeoutMinutes: n }
    })
    const pv = f.personal.trim()
    const personal = /^\d{1,3}$/.test(pv) ? Number(pv) : NaN
    if (!(personal >= 1 && personal <= 240))
      e.idleTimeoutPersonalMinutes = 'Enter whole minutes from 1 to 240.'
    if (Object.keys(e).length) return e
    return settingsApi.updateIdleTimeouts({
      rules,
      idleTimeoutPersonalMinutes: personal,
      version: cur.version,
    })
  },
})
const idleError = (i: number) => idle.fieldErrors.value[`rules[${i}].idleTimeoutMinutes`]
const exemptTypes = computed(() => idle.data.value?.rules.filter((r) => r.exempt) ?? [])

// ---------------------------------------------------------------- menu (M1.1)
const menu = useSettingSection({
  get: settingsApi.getMenuSettings,
  toForm: (d) => ({ resetAvailabilityDaily: d.resetAvailabilityDaily }),
  put: (f, cur) =>
    settingsApi.updateMenuSettings({
      resetAvailabilityDaily: f.resetAvailabilityDaily,
      version: cur.version,
    }),
})

// ---------------------------------------------------------------- page
const sections = [restaurant, serviceCharges, businessDay, idle, menu]
const dirty = computed(() => sections.some((s) => s.dirty.value))
const saving = computed(() => sections.some((s) => s.saving.value))
const loading = computed(() => [...sections, tax].some((s) => s.loading.value))

onMounted(async () => {
  const results = await Promise.allSettled([...sections, tax].map((s) => s.load()))
  const failed = results.find((r) => r.status === 'rejected')
  if (failed && failed.status === 'rejected') notify.error(failed.reason, 'Could not load settings')
})

async function saveAll() {
  if (saving.value) return
  const toSave = sections.filter((s) => s.dirty.value)
  const results = []
  for (const s of toSave) results.push(await s.save())
  const failed = results.filter((ok) => !ok).length
  if (failed === 0) notify.success('Settings saved')
  else
    notify.error(
      new Error(
        failed === results.length
          ? 'Nothing was saved. Check the highlighted fields.'
          : 'Some changes were saved; check the highlighted fields.',
      ),
      'Not all changes were saved',
    )
}

function revertAll() {
  sections.forEach((s) => s.revert())
}

async function reload(section: (typeof sections)[number]) {
  await section.load().catch((e) => notify.error(e, 'Could not reload'))
}

const generalError = (s: (typeof sections)[number]) => {
  const e = s.error.value
  return e && !e.fieldErrors.length && !e.isVersionConflict ? e.userMessage : null
}
</script>

<template>
  <div class="page settings" :aria-busy="loading">
    <div class="page-header">
      <h1>Settings</h1>
    </div>

    <!-- Restaurant details -->
    <section class="card" data-testid="settings-restaurant">
      <h2>Restaurant details <span class="muted small">(printed on every receipt)</span></h2>
      <VersionConflictBanner v-if="restaurant.conflict.value" @reload="reload(restaurant)" />
      <div v-if="restaurant.form.value" class="form-grid">
        <div class="field">
          <label for="set-restaurant-name">Name</label>
          <InputText
            id="set-restaurant-name"
            v-model="restaurant.form.value.name"
            maxlength="60"
            data-testid="set-restaurant-name"
          />
          <p v-if="restaurant.fieldErrors.value.name" class="field-error" data-testid="field-error-name">
            {{ restaurant.fieldErrors.value.name }}
          </p>
        </div>
        <div class="field">
          <label for="set-restaurant-phone">Phone</label>
          <InputText
            id="set-restaurant-phone"
            v-model="restaurant.form.value.phone"
            maxlength="40"
            type="tel"
            data-testid="set-restaurant-phone"
          />
          <p v-if="restaurant.fieldErrors.value.phone" class="field-error" data-testid="field-error-phone">
            {{ restaurant.fieldErrors.value.phone }}
          </p>
        </div>
        <div class="field">
          <label for="set-restaurant-address">Address</label>
          <Textarea
            id="set-restaurant-address"
            v-model="restaurant.form.value.address"
            rows="2"
            auto-resize
            maxlength="200"
            data-testid="set-restaurant-address"
          />
          <span class="hint">Each line prints as a receipt line.</span>
          <p
            v-if="restaurant.fieldErrors.value.address"
            class="field-error"
            data-testid="field-error-address"
          >
            {{ restaurant.fieldErrors.value.address }}
          </p>
        </div>
        <div class="field">
          <label for="set-receipt-footer">Receipt footer</label>
          <Textarea
            id="set-receipt-footer"
            v-model="restaurant.form.value.receiptFooter"
            rows="2"
            auto-resize
            maxlength="300"
            data-testid="set-receipt-footer"
          />
          <p
            v-if="restaurant.fieldErrors.value.receiptFooter"
            class="field-error"
            data-testid="field-error-receiptFooter"
          >
            {{ restaurant.fieldErrors.value.receiptFooter }}
          </p>
        </div>
      </div>
      <p v-if="generalError(restaurant)" class="field-error" role="alert">{{ generalError(restaurant) }}</p>
      <p v-if="restaurant.data.value" class="muted small foot">
        Applies to receipts printed from now on, including reprints.
      </p>
    </section>

    <!-- Service charge -->
    <section class="card" data-testid="settings-service-charges">
      <h2>Service charge</h2>
      <VersionConflictBanner v-if="serviceCharges.conflict.value" @reload="reload(serviceCharges)" />
      <div v-if="serviceCharges.form.value" class="rate-grid">
        <div v-for="(t, i) in SERVICE_CHARGE_ORDER_TYPES" :key="t" class="field">
          <label :for="`set-sc-${t}`">{{ ORDER_TYPE_LABEL[t] }}</label>
          <div class="suffix-input">
            <input
              :id="`set-sc-${t}`"
              v-model="serviceCharges.form.value[t]"
              class="native-input"
              inputmode="decimal"
              autocomplete="off"
              :data-testid="`set-sc-${t}`"
              @blur="normaliseRate(t)"
            />
            <span aria-hidden="true">%</span>
          </div>
          <p v-if="scError(i)" class="field-error" :data-testid="`field-error-rules[${i}].rate`">
            {{ scError(i) }}
          </p>
        </div>
      </div>
      <p v-if="serviceCharges.fieldErrors.value.rules" class="field-error" data-testid="field-error-rules">
        {{ serviceCharges.fieldErrors.value.rules }}
      </p>
      <p v-if="generalError(serviceCharges)" class="field-error" role="alert">
        {{ generalError(serviceCharges) }}
      </p>
      <p class="muted small foot">
        Credit orders use the rate of their service mode. New rates apply to orders created from now on; open
        orders keep their rate.
      </p>
    </section>

    <!-- Tax -->
    <section class="card" data-testid="settings-tax">
      <h2>Tax</h2>
      <div v-if="tax.data.value" class="tax-row">
        <label class="tax-toggle">
          <ToggleSwitch
            :model-value="tax.data.value.enabled"
            disabled
            input-id="set-tax-enabled"
            data-testid="set-tax-enabled"
          />
          <span>{{ tax.data.value.enabled ? 'On' : 'Off' }}</span>
        </label>
        <div class="field tax-rate">
          <label for="set-tax-rate">Rate</label>
          <div class="suffix-input">
            <input
              id="set-tax-rate"
              class="native-input"
              :value="tax.data.value.rate"
              disabled
              data-testid="set-tax-rate"
            />
            <span aria-hidden="true">%</span>
          </div>
        </div>
        <span class="chip chip-muted" data-testid="tax-not-in-use">Not in use</span>
      </div>
      <p class="muted small foot">
        The restaurant charges no tax for now (client decision #2). Bills show no tax line. Turning tax on
        needs a change to the bill calculation first (ADR-002).
      </p>
    </section>

    <!-- Business day -->
    <section class="card" data-testid="settings-business-day">
      <h2>Business day</h2>
      <VersionConflictBanner v-if="businessDay.conflict.value" @reload="reload(businessDay)" />
      <div v-if="businessDay.form.value" class="form-grid narrow">
        <div class="field">
          <label for="set-business-day-start">New business day starts at</label>
          <input
            id="set-business-day-start"
            v-model="businessDay.form.value.dayStartTime"
            type="time"
            step="60"
            class="native-input"
            data-testid="set-business-day-start"
          />
          <p
            v-if="businessDay.fieldErrors.value.dayStartTime"
            class="field-error"
            data-testid="field-error-dayStartTime"
          >
            {{ businessDay.fieldErrors.value.dayStartTime }}
          </p>
        </div>
        <div class="field">
          <span class="label">Time zone</span>
          <span class="tz">{{ businessDay.data.value?.timeZone }}</span>
        </div>
      </div>
      <p v-if="generalError(businessDay)" class="field-error" role="alert">{{ generalError(businessDay) }}</p>
      <p class="muted small foot">
        Orders after midnight but before day-end belong to the open business day. A change applies from the
        next business day.
      </p>
    </section>

    <!-- Idle timeouts -->
    <section class="card" data-testid="settings-idle-timeouts">
      <h2>Automatic logout when idle</h2>
      <VersionConflictBanner v-if="idle.conflict.value" @reload="reload(idle)" />
      <div v-if="idle.form.value" class="rate-grid">
        <div v-for="(t, i) in EDITABLE_IDLE" :key="t" class="field">
          <label :for="`set-idle-${t}`">{{ TERMINAL_TYPE_LABEL[t] }}</label>
          <div class="suffix-input">
            <input
              :id="`set-idle-${t}`"
              v-model="idle.form.value[t]"
              class="native-input"
              inputmode="numeric"
              autocomplete="off"
              :data-testid="`set-idle-${t}`"
            />
            <span aria-hidden="true">min</span>
          </div>
          <p
            v-if="idleError(i)"
            class="field-error"
            :data-testid="`field-error-rules[${i}].idleTimeoutMinutes`"
          >
            {{ idleError(i) }}
          </p>
        </div>
        <div class="field">
          <label for="set-idle-PERSONAL">Personal devices</label>
          <div class="suffix-input">
            <input
              id="set-idle-PERSONAL"
              v-model="idle.form.value.personal"
              class="native-input"
              inputmode="numeric"
              autocomplete="off"
              data-testid="set-idle-PERSONAL"
            />
            <span aria-hidden="true">min</span>
          </div>
          <span class="hint">Owner, manager and others signed in on their own phone or computer.</span>
          <p
            v-if="idle.fieldErrors.value.idleTimeoutPersonalMinutes"
            class="field-error"
            data-testid="field-error-idleTimeoutPersonalMinutes"
          >
            {{ idle.fieldErrors.value.idleTimeoutPersonalMinutes }}
          </p>
        </div>
        <div v-for="r in exemptTypes" :key="r.terminalType" class="field">
          <span class="label">{{ TERMINAL_TYPE_LABEL[r.terminalType] }}</span>
          <span class="chip chip-muted exempt" :data-testid="`set-idle-${r.terminalType}`"
            >Never (stays logged in)</span
          >
        </div>
      </div>
      <p v-if="idle.fieldErrors.value.rules" class="field-error" data-testid="field-error-rules">
        {{ idle.fieldErrors.value.rules }}
      </p>
      <p v-if="generalError(idle)" class="field-error" role="alert">{{ generalError(idle) }}</p>
      <p class="muted small foot">
        1 to 240 minutes. Terminals pick up a new value at their next login or token refresh.
      </p>
    </section>

    <!-- Menu -->
    <section class="card" data-testid="settings-menu">
      <h2>Menu</h2>
      <VersionConflictBanner v-if="menu.conflict.value" @reload="reload(menu)" />
      <div v-if="menu.form.value" class="tax-row">
        <label class="tax-toggle">
          <ToggleSwitch
            v-model="menu.form.value.resetAvailabilityDaily"
            input-id="set-menu-reset"
            data-testid="set-menu-reset"
          />
          <span>Reset "sold out" at the start of each business day</span>
        </label>
      </div>
      <p v-if="generalError(menu)" class="field-error" role="alert">{{ generalError(menu) }}</p>
      <p class="muted small foot">
        When on (the default), every item is set available again at the start of each business day, so a
        forgotten sold-out toggle cannot hide an item for good.
      </p>
    </section>

    <div class="save-bar" :class="{ show: dirty }">
      <span v-if="dirty" class="small" data-testid="settings-dirty"
        ><i class="pi pi-circle-fill dot" aria-hidden="true" /> Unsaved changes</span
      >
      <span v-else class="muted small">
        <template v-if="restaurant.data.value"
          >All changes saved - last change {{ formatDateTime(restaurant.data.value.updatedAt) }}</template
        >
      </span>
      <span class="spacer" />
      <Button
        label="Discard"
        text
        severity="secondary"
        :disabled="!dirty || saving"
        data-testid="settings-discard"
        @click="revertAll"
      />
      <Button
        label="Save changes"
        icon="pi pi-check"
        :loading="saving"
        :disabled="!dirty || saving"
        data-testid="settings-save"
        @click="saveAll"
      />
    </div>
  </div>
</template>

<style scoped>
.settings {
  max-width: 960px;
  padding-bottom: 72px;
}

.rate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
}

.narrow {
  grid-template-columns: repeat(auto-fit, minmax(200px, 280px));
}

.suffix-input {
  display: flex;
  align-items: center;
  gap: 6px;
}

.suffix-input input {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.suffix-input span {
  color: var(--rms-muted);
  min-width: 28px;
}

.foot {
  margin: 12px 0 0;
}

.tax-row {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 16px;
}

.tax-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  font-weight: 600;
}

.tax-rate {
  width: 150px;
}

.tz {
  min-height: 42px;
  display: flex;
  align-items: center;
}

.exempt {
  align-self: flex-start;
  margin-top: 8px;
}

.save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #fff;
  border: 1px solid var(--rms-border);
  border-radius: 10px;
  box-shadow: 0 -4px 16px rgba(15, 23, 42, 0.06);
}

.save-bar.show {
  border-color: var(--rms-primary);
}

.dot {
  color: var(--rms-warn);
  font-size: 0.6rem;
}

.spacer {
  flex: 1;
}
</style>
