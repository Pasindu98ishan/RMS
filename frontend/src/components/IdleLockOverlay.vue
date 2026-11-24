<script setup lang="ts">
import Button from 'primevue/button'

defineProps<{ minutes: number | null }>()
const emit = defineEmits<{ unlock: [] }>()
</script>

<template>
  <div
    class="idle-overlay"
    data-testid="idle-lock-overlay"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="idle-title"
  >
    <div class="idle-box">
      <i class="pi pi-lock idle-icon" aria-hidden="true" />
      <h2 id="idle-title">Screen locked</h2>
      <p>
        You were logged out because this terminal was not used
        <template v-if="minutes">for {{ minutes }} minute{{ minutes === 1 ? '' : 's' }}</template
        >.
      </p>
      <Button
        label="Log in again"
        icon="pi pi-sign-in"
        size="large"
        data-testid="idle-unlock"
        autofocus
        @click="emit('unlock')"
      />
    </div>
  </div>
</template>

<style scoped>
.idle-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  background: rgba(15, 23, 42, 0.92);
  display: grid;
  place-items: center;
  padding: 16px;
}

.idle-box {
  background: #fff;
  border-radius: 14px;
  padding: 32px 28px;
  max-width: 420px;
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
}

.idle-icon {
  font-size: 2.4rem;
  color: var(--rms-primary);
}

.idle-box p {
  margin: 0;
  color: var(--rms-muted);
}
</style>
