<script setup lang="ts">
/** Label + control + hint + inline error. The error gets data-testid `field-error-<name>`. */
defineProps<{
  label: string
  /** id of the control (for the label). */
  for?: string
  /** Field name used in the error test id (matches the API field name). */
  name?: string
  error?: string | null
  hint?: string
}>()
</script>

<template>
  <div class="field">
    <label :for="$props.for">{{ label }}</label>
    <slot />
    <span v-if="hint" class="hint">{{ hint }}</span>
    <p v-if="error" class="field-error" :data-testid="name ? `field-error-${name}` : undefined">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.field p {
  margin: 0;
}
</style>
