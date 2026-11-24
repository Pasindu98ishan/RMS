<script setup lang="ts">
/**
 * Registers this device as a terminal (P1-AUTH-04). Needs no login: the owner's credentials go in the
 * request body (registerTerminal, x-auth: INLINE_CREDENTIALS). The device keeps terminalId +
 * deviceToken in localStorage and sends them on every login.
 */
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import AuthCard from './AuthCard.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useTerminalStore } from '@/stores/terminal'
import { useAuthStore } from '@/stores/auth'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'
import { terminalsApi } from '@/api/terminals'
import {
  TERMINAL_TYPE_LABEL,
  TERMINAL_TYPES,
  type TerminalSetupOptions,
  type TerminalType,
} from '@/api/types'
import { formatDateTime } from '@/utils/time'
import { LOGIN_PATH } from '@/router/guard'

const terminalStore = useTerminalStore()
const auth = useAuthStore()
const router = useRouter()
const notify = useNotify()

const ownerUsername = ref('')
const ownerPassword = ref('')
const name = ref('')
const type = ref<TerminalType | null>(null)
const stationId = ref<string | null>(null)
const orderingPointId = ref<string | null>(null)
/** Stations and ordering points from the server (needs the owner credentials, so loaded on demand). */
const options = ref<TerminalSetupOptions | null>(null)
const touched = ref(false)
const showForm = ref(!terminalStore.isRegistered)
const confirmForget = ref(false)
/** Set after a successful registration: shows the success state instead of the form. */
const justRegistered = ref(false)

const typeOptions = TERMINAL_TYPES.map((t) => ({ value: t, label: TERMINAL_TYPE_LABEL[t] }))

const isPos = computed(() => type.value === 'CASHIER_POS' || type.value === 'RECEPTION_POS')
const needsOptions = computed(() => type.value === 'KITCHEN' || isPos.value)
const creds = computed(() => ({ username: ownerUsername.value.trim(), password: ownerPassword.value }))
/** The credentials the current options were loaded (or failed) with: never retried automatically. */
let optionsKey = ''

const optionsLoader = useAction(async () => {
  options.value = await terminalsApi.setupOptions(creds.value)
  preselectOrderingPoint()
})

/** Cashier POS -> "Cashier..." point, Reception POS -> "Reception...", when the owner has not chosen. */
function preselectOrderingPoint() {
  if (orderingPointId.value || !isPos.value || !options.value) return
  const wanted = type.value === 'CASHIER_POS' ? 'cashier' : 'reception'
  orderingPointId.value =
    options.value.orderingPoints.find((p) => p.name.toLowerCase().includes(wanted))?.id ?? null
}

/** Loads stations / ordering points. Automatic only once per set of credentials, so a wrong password is not retried. */
async function loadOptions(force = false) {
  if (!needsOptions.value || !creds.value.username || !creds.value.password) return
  const key = `${creds.value.username}\n${creds.value.password}`
  if (!force && key === optionsKey) return
  optionsKey = key
  optionsLoader.reset()
  try {
    await optionsLoader.run()
  } catch {
    /* shown under the station / ordering point fields */
  }
}

watch(type, (t) => {
  if (t !== 'KITCHEN') stationId.value = null
  orderingPointId.value = null
  if (options.value) preselectOrderingPoint()
  void loadOptions()
})

const register = useAction(() =>
  terminalStore.register({
    credentials: creds.value,
    name: name.value.trim(),
    type: type.value as TerminalType,
    ...(type.value === 'KITCHEN' && stationId.value ? { kitchenStationId: stationId.value } : {}),
    ...(isPos.value && orderingPointId.value ? { orderingPointId: orderingPointId.value } : {}),
  }),
)

const errors = computed(() => {
  const e: Record<string, string> = { ...register.fieldErrors.value }
  if (touched.value) {
    if (!ownerUsername.value.trim()) e['credentials.username'] ??= 'Enter the owner username.'
    if (!ownerPassword.value) e['credentials.password'] ??= 'Enter the owner password.'
    if (!name.value.trim()) e.name ??= 'Give this terminal a name, e.g. "Cashier counter".'
    if (!type.value) e.type ??= 'Choose what this device is used for.'
    if (type.value === 'KITCHEN' && !stationId.value) e.kitchenStationId ??= 'Choose the kitchen station.'
  }
  return e
})

const clientInvalid = computed(
  () =>
    !ownerUsername.value.trim() ||
    !ownerPassword.value ||
    !name.value.trim() ||
    !type.value ||
    (type.value === 'KITCHEN' && !stationId.value),
)

async function submit() {
  touched.value = true
  register.reset()
  if (clientInvalid.value) return
  try {
    const reg = await register.run()
    if (!reg) return
    touched.value = false
    ownerPassword.value = ''
    showForm.value = false
    justRegistered.value = true
    notify.success('Terminal registered', `This device is now "${reg.terminal.name}".`)
  } catch {
    // The server's message is shown; don't add a "password required" hint for the cleared field.
    touched.value = false
    ownerPassword.value = ''
  }
}

async function forget() {
  if (auth.isAuthenticated) await auth.logout('USER')
  terminalStore.forget()
  confirmForget.value = false
  justRegistered.value = false
  showForm.value = true
}

/** Dev-only panel; the import is dead code (and dropped) when mocks are off. */
const MockTools = __RMS_USE_MOCKS__ ? defineAsyncComponent(() => import('./MockTools.vue')) : null
</script>

<template>
  <AuthCard title="Terminal setup" subtitle="Register this device as a terminal" wide>
    <div v-if="terminalStore.registration" class="current card" data-testid="terminal-current">
      <div class="current-row">
        <i class="pi pi-check-circle ok" aria-hidden="true" />
        <div>
          <p v-if="justRegistered" class="success-title" role="status" data-testid="terminal-registered">
            Device registered
          </p>
          <strong>{{ terminalStore.registration.terminal.name }}</strong>
          <div class="muted small">
            {{ TERMINAL_TYPE_LABEL[terminalStore.registration.terminal.type] }} - registered
            {{ formatDateTime(terminalStore.registration.registeredAt) }}
          </div>
        </div>
      </div>
      <p v-if="terminalStore.problem" class="field-error" role="alert">{{ terminalStore.problem }}</p>
      <div class="current-actions">
        <Button
          label="Go to login"
          icon="pi pi-sign-in"
          data-testid="terminal-goto-login"
          @click="router.push(LOGIN_PATH)"
        />
        <Button
          label="Register this device again"
          severity="secondary"
          outlined
          data-testid="terminal-forget"
          @click="confirmForget = true"
        />
      </div>
    </div>

    <form v-if="showForm" class="stack" novalidate @submit.prevent="submit">
      <fieldset class="group">
        <legend>Owner sign-in</legend>
        <p class="muted small">A user who manages terminals (normally the owner) must approve this device.</p>
        <div class="form-grid">
          <div class="field">
            <label for="setup-username">Username</label>
            <InputText
              id="setup-username"
              v-model="ownerUsername"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              data-testid="setup-username"
            />
            <p v-if="errors['credentials.username']" class="field-error">
              {{ errors['credentials.username'] }}
            </p>
          </div>
          <div class="field">
            <label for="setup-password">Password</label>
            <InputText
              id="setup-password"
              v-model="ownerPassword"
              type="password"
              autocomplete="off"
              data-testid="setup-password"
              @blur="loadOptions()"
            />
            <p v-if="errors['credentials.password']" class="field-error">
              {{ errors['credentials.password'] }}
            </p>
          </div>
        </div>
      </fieldset>

      <fieldset class="group">
        <legend>This device</legend>
        <div class="form-grid">
          <div class="field">
            <label for="terminal-name">Terminal name</label>
            <InputText
              id="terminal-name"
              v-model="name"
              maxlength="50"
              placeholder="Cashier counter"
              data-testid="terminal-name"
            />
            <p v-if="errors.name" class="field-error" data-testid="field-error-name">{{ errors.name }}</p>
          </div>
          <div class="field">
            <label for="terminal-type">Used as</label>
            <Select
              v-model="type"
              input-id="terminal-type"
              :options="typeOptions"
              option-label="label"
              option-value="value"
              placeholder="Choose..."
              data-testid="terminal-type"
            />
            <p v-if="errors.type" class="field-error" data-testid="field-error-type">{{ errors.type }}</p>
          </div>
          <div v-if="type === 'KITCHEN'" class="field">
            <label for="terminal-station">Kitchen station</label>
            <Select
              v-model="stationId"
              input-id="terminal-station"
              :options="options?.kitchenStations ?? []"
              option-label="name"
              option-value="id"
              placeholder="Choose..."
              :disabled="!options?.kitchenStations.length"
              data-testid="terminal-station"
            />
            <p v-if="errors.kitchenStationId" class="field-error" data-testid="field-error-kitchenStationId">
              {{ errors.kitchenStationId }}
            </p>
          </div>
          <div v-if="isPos" class="field">
            <label for="terminal-ordering-point">Ordering point (optional)</label>
            <Select
              v-model="orderingPointId"
              input-id="terminal-ordering-point"
              :options="options?.orderingPoints ?? []"
              option-label="name"
              option-value="id"
              placeholder="None"
              show-clear
              :disabled="!options?.orderingPoints.length"
              data-testid="terminal-ordering-point"
            />
            <span class="hint">Orders taken here default to this ordering point.</span>
            <p v-if="errors.orderingPointId" class="field-error" data-testid="field-error-orderingPointId">
              {{ errors.orderingPointId }}
            </p>
          </div>
        </div>
        <div v-if="needsOptions" class="options-line" data-testid="terminal-options-status">
          <span v-if="optionsLoader.busy.value" class="muted small">Loading choices...</span>
          <span v-else-if="options" class="muted small">
            {{ options.kitchenStations.length }} kitchen station{{
              options.kitchenStations.length === 1 ? '' : 's'
            }}, {{ options.orderingPoints.length }} ordering point{{
              options.orderingPoints.length === 1 ? '' : 's'
            }}
            loaded.
          </span>
          <span v-else class="muted small">
            Enter the owner sign-in above to load the
            {{ type === 'KITCHEN' ? 'stations' : 'ordering points' }}.
          </span>
          <Button
            type="button"
            label="Load choices"
            icon="pi pi-refresh"
            size="small"
            text
            :loading="optionsLoader.busy.value"
            :disabled="optionsLoader.busy.value || !creds.username || !creds.password"
            data-testid="terminal-load-options"
            @click="loadOptions(true)"
          />
        </div>
        <p
          v-if="optionsLoader.error.value"
          class="field-error"
          role="alert"
          data-testid="terminal-options-error"
        >
          {{ optionsLoader.error.value.userMessage }}
          <span v-if="optionsLoader.error.value.retryAfterText" class="retry">
            {{ optionsLoader.error.value.retryAfterText }}
          </span>
        </p>
      </fieldset>

      <p
        v-if="register.error.value && !register.error.value.fieldErrors.length"
        class="field-error"
        role="alert"
        data-testid="terminal-error"
      >
        {{ register.error.value.userMessage }}
        <span v-if="register.error.value.retryAfterText" class="retry" data-testid="terminal-retry-after">
          {{ register.error.value.retryAfterText }}
        </span>
      </p>
      <Button
        type="submit"
        label="Register this device"
        icon="pi pi-check"
        size="large"
        :loading="register.busy.value"
        :disabled="register.busy.value"
        data-testid="terminal-register"
      />
    </form>

    <ConfirmDialog
      v-model:visible="confirmForget"
      title="Register this device again?"
      message="This device forgets its terminal registration and must be registered again with owner sign-in. Deactivate the old terminal in Admin > Terminals so it cannot be used."
      confirm-label="Forget registration"
      danger
      @confirm="forget"
    />

    <template #after>
      <component :is="MockTools" v-if="MockTools" @reset="showForm = true" />
    </template>
  </AuthCard>
</template>

<style scoped>
.success-title {
  margin: 0 0 2px;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--rms-ok);
}

.options-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.retry {
  display: block;
  font-weight: 600;
  margin-top: 2px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.group {
  border: 1px solid var(--rms-border);
  border-radius: 10px;
  padding: 12px 14px 14px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group legend {
  font-weight: 700;
  padding: 0 6px;
}

.group p {
  margin: 0;
}

.current {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--rms-ok-soft);
  border-color: #b7e2c5;
}

.current-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.ok {
  color: var(--rms-ok);
  font-size: 1.5rem;
}

.current-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
