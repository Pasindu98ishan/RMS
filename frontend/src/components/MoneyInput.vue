<script setup lang="ts">
/**
 * LKR amount input. The model is the canonical money string the API uses ("1250.00") or null;
 * parsing is string-based (no floats). Shows thousands separators when not focused.
 * `data-testid` and other attributes land on the <input>.
 */
import { computed, ref, watch } from 'vue'
import { compareMoney, CURRENCY, groupMoney, parseMoneyInput } from '@/utils/money'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: string | null
    id?: string
    disabled?: boolean
    placeholder?: string
    allowNegative?: boolean
    /** Inclusive bounds, canonical money strings. */
    min?: string
    max?: string
    /** Extra error from the server (field error), shown below. */
    error?: string | null
  }>(),
  {
    id: undefined,
    disabled: false,
    placeholder: '0.00',
    allowNegative: false,
    min: undefined,
    max: undefined,
    error: null,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
  /** Fires on every edit: true while the typed text is not a valid amount. */
  invalid: [value: boolean]
}>()

const focused = ref(false)
const text = ref(display(props.modelValue))
const localError = ref<string | null>(null)

function display(v: string | null): string {
  return v === null ? '' : groupMoney(v)
}

watch(
  () => props.modelValue,
  (v) => {
    // External change (or our own emit): sync the text unless the user is mid-edit.
    if (!focused.value) text.value = display(v)
  },
)

function validate(parsed: string | null | undefined): string | null {
  if (parsed === undefined) return 'Enter an amount like 1250.00 (up to 2 decimals).'
  if (parsed === null) return null
  if (props.min !== undefined && compareMoney(parsed, props.min) < 0)
    return `Must be at least ${groupMoney(props.min)}.`
  if (props.max !== undefined && compareMoney(parsed, props.max) > 0)
    return `Must be at most ${groupMoney(props.max)}.`
  return null
}

function onInput(e: Event) {
  const el = e.target as HTMLInputElement
  // Keep only characters that can form an amount.
  const cleaned = el.value.replace(props.allowNegative ? /[^\d.,-]/g : /[^\d.,]/g, '')
  if (cleaned !== el.value) el.value = cleaned
  text.value = cleaned
  const parsed = parseMoneyInput(cleaned, { allowNegative: props.allowNegative })
  localError.value = validate(parsed)
  emit('invalid', localError.value !== null)
  if (parsed !== undefined && localError.value === null) emit('update:modelValue', parsed)
}

function onFocus() {
  focused.value = true
  text.value = props.modelValue ?? text.value.replace(/,/g, '')
}

function onBlur() {
  focused.value = false
  const parsed = parseMoneyInput(text.value, { allowNegative: props.allowNegative })
  if (parsed !== undefined && validate(parsed) === null) text.value = display(parsed)
}

const shownError = computed(() => localError.value ?? props.error)
</script>

<template>
  <div class="money-input" :class="{ invalid: shownError, disabled }">
    <span class="currency" aria-hidden="true">{{ CURRENCY }}</span>
    <input
      :id="id"
      v-bind="$attrs"
      class="money-field"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :value="text"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="shownError ? 'true' : 'false'"
      :aria-describedby="shownError && id ? `${id}-error` : undefined"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
    />
  </div>
  <p v-if="shownError" :id="id ? `${id}-error` : undefined" class="field-error money-error" role="alert">
    {{ shownError }}
  </p>
</template>

<style scoped>
.money-input {
  display: flex;
  align-items: stretch;
  border: 1px solid #cbd2d9;
  border-radius: 6px;
  background: #fff;
  min-height: 42px;
  overflow: hidden;
}

.money-input:focus-within {
  outline: 2px solid var(--rms-primary);
  border-color: var(--rms-primary);
}

.money-input.invalid {
  border-color: var(--rms-danger);
}

.money-input.disabled {
  background: #f3f4f6;
}

.currency {
  display: flex;
  align-items: center;
  padding: 0 10px;
  background: #f3f5f7;
  color: var(--rms-muted);
  font-weight: 600;
  font-size: 0.85rem;
  border-right: 1px solid #e1e5ea;
}

.money-field {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  padding: 8px 10px;
  font: inherit;
  text-align: right;
  font-variant-numeric: tabular-nums;
  background: transparent;
}

.money-error {
  margin: 4px 0 0;
}
</style>
