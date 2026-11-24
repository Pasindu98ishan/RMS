<script setup lang="ts">
/**
 * Cash count by LKR denomination (shift close, M1.5). Stub for M1.0: counts and a local preview
 * total (string arithmetic, no floats). The server's expected-vs-counted figures are authoritative.
 */
import { computed } from 'vue'
import { formatMoney, LKR_DENOMINATIONS, multiplyMoney, sumMoney } from '@/utils/money'

const props = defineProps<{ modelValue: Record<string, number> }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, number>] }>()

function setCount(denomination: string, raw: string) {
  const n = /^\d{1,5}$/.test(raw) ? Number(raw) : 0
  emit('update:modelValue', { ...props.modelValue, [denomination]: n })
}

const total = computed(() =>
  sumMoney(LKR_DENOMINATIONS.map((d) => multiplyMoney(d, props.modelValue[d] ?? 0))),
)
</script>

<template>
  <div class="denoms" data-testid="denomination-counter">
    <div v-for="d in LKR_DENOMINATIONS" :key="d" class="denom">
      <label :for="`denom-${d}`">{{ formatMoney(d).replace('.00', '') }}</label>
      <span aria-hidden="true">x</span>
      <input
        :id="`denom-${d}`"
        class="native-input count"
        type="text"
        inputmode="numeric"
        :value="modelValue[d] ?? ''"
        :data-testid="`denom-${d}`"
        @input="setCount(d, ($event.target as HTMLInputElement).value)"
      />
      <span class="line">{{ formatMoney(multiplyMoney(d, modelValue[d] ?? 0)) }}</span>
    </div>
    <div class="denom total">
      <span>Counted (preview)</span>
      <strong data-testid="denomination-total">{{ formatMoney(total) }}</strong>
    </div>
  </div>
</template>

<style scoped>
.denoms {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.denom {
  display: grid;
  grid-template-columns: 110px 16px 90px 1fr;
  align-items: center;
  gap: 8px;
}

.count {
  min-height: 48px;
  text-align: right;
}

.line {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.total {
  grid-template-columns: 1fr auto;
  border-top: 1px solid var(--rms-border);
  padding-top: 8px;
}
</style>
