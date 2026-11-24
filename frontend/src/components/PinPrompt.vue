<script setup lang="ts">
/**
 * Manager / owner PIN approval at the terminal (conventions.md "Approvals", P1-AUTH-05).
 * Emits the `Approval` object the action request carries inline; the server checks it.
 * Touch-first: on-screen keypad with 48 px+ keys, Enter submits, no double submit while `busy`.
 */
import { computed, nextTick, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import type { Approval } from '@/api/types'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    /** What is being approved, shown to the approver. */
    message?: string
    /** Who may approve, e.g. "Manager or owner". */
    approverHint?: string
    /** Pre-filled approver username (editable). */
    defaultApprover?: string
    busy?: boolean
    /** Server error to show (e.g. APPROVAL_INVALID detail, shown as-is). */
    error?: string | null
  }>(),
  {
    title: 'Approval needed',
    message: '',
    approverHint: 'Manager or owner',
    defaultApprover: '',
    busy: false,
    error: null,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  /** The generated `Approval` the action request carries inline. */
  submit: [approval: Approval]
  cancel: []
}>()

const approver = ref(props.defaultApprover)
const pin = ref('')
const touched = ref(false)

const PIN_RE = /^\d{4,6}$/

const localError = computed(() => {
  if (!touched.value) return null
  if (!approver.value.trim()) return 'Enter the approver username.'
  if (!PIN_RE.test(pin.value)) return 'PIN is 4 to 6 digits.'
  return null
})
const shownError = computed(() => localError.value ?? props.error)
const canSubmit = computed(() => !props.busy && approver.value.trim() !== '' && PIN_RE.test(pin.value))

watch(
  () => props.visible,
  async (open) => {
    if (open) {
      approver.value = props.defaultApprover
      pin.value = ''
      touched.value = false
      await nextTick()
      document.getElementById(approver.value ? 'pin-input' : 'pin-approver')?.focus()
    }
  },
)

// A failed attempt clears the PIN so the next try starts clean.
watch(
  () => props.error,
  (err) => {
    if (err) pin.value = ''
  },
)

function onPinInput(value: string | undefined) {
  pin.value = (value ?? '').replace(/\D/g, '').slice(0, 6)
}

function press(digit: string) {
  if (pin.value.length < 6) pin.value += digit
}

function backspace() {
  pin.value = pin.value.slice(0, -1)
}

function submit() {
  touched.value = true
  if (!canSubmit.value) return
  emit('submit', { approverUsername: approver.value.trim(), pin: pin.value })
}

function cancel() {
  emit('update:visible', false)
  emit('cancel')
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="title"
    :closable="!busy"
    :draggable="false"
    :style="{ width: 'min(400px, calc(100vw - 32px))' }"
    data-testid="pin-prompt"
    @update:visible="(v: boolean) => (v ? emit('update:visible', v) : cancel())"
  >
    <form class="pin-form" novalidate @submit.prevent="submit">
      <p v-if="message" class="pin-message">{{ message }}</p>
      <div class="field">
        <label for="pin-approver">Approver ({{ approverHint }})</label>
        <InputText
          id="pin-approver"
          v-model="approver"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          :disabled="busy"
          data-testid="pin-approver"
        />
      </div>
      <div class="field">
        <label for="pin-input">PIN</label>
        <InputText
          id="pin-input"
          :model-value="pin"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          maxlength="6"
          :disabled="busy"
          class="pin-input"
          data-testid="pin-input"
          @update:model-value="onPinInput"
        />
      </div>
      <div class="keypad" role="group" aria-label="PIN keypad">
        <button
          v-for="k in KEYS"
          :key="k"
          type="button"
          class="key"
          :disabled="busy"
          :data-testid="`pin-key-${k}`"
          @click="press(k)"
        >
          {{ k }}
        </button>
        <button
          type="button"
          class="key key-muted"
          :disabled="busy"
          data-testid="pin-key-clear"
          @click="pin = ''"
        >
          Clear
        </button>
        <button type="button" class="key" :disabled="busy" data-testid="pin-key-0" @click="press('0')">
          0
        </button>
        <button
          type="button"
          class="key key-muted"
          :disabled="busy"
          aria-label="Delete last digit"
          data-testid="pin-key-back"
          @click="backspace"
        >
          <i class="pi pi-delete-left" aria-hidden="true" />
        </button>
      </div>
      <p v-if="shownError" class="field-error" role="alert" data-testid="pin-error">{{ shownError }}</p>
      <div class="pin-actions">
        <Button
          type="button"
          label="Cancel"
          severity="secondary"
          text
          :disabled="busy"
          data-testid="pin-cancel"
          @click="cancel"
        />
        <Button
          type="submit"
          label="Approve"
          icon="pi pi-check"
          :loading="busy"
          :disabled="busy"
          data-testid="pin-submit"
        />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.pin-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pin-message {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--rms-warn-soft);
  color: #7c3a06;
}

.pin-input {
  letter-spacing: 0.4em;
  font-size: 1.3rem;
  text-align: center;
}

.keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.key {
  min-height: 56px;
  border-radius: 10px;
  border: 1px solid var(--rms-border);
  background: #fff;
  font-size: 1.35rem;
  font-weight: 600;
  cursor: pointer;
  color: inherit;
}

.key:active {
  background: var(--rms-primary-soft);
}

.key:disabled {
  opacity: 0.5;
  cursor: default;
}

.key-muted {
  font-size: 0.95rem;
  color: var(--rms-muted);
}

.pin-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.pin-actions :deep(.p-button) {
  min-height: 48px;
}
</style>
