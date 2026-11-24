<script setup lang="ts">
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'

withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    busy?: boolean
    error?: string | null
  }>(),
  {
    title: 'Are you sure?',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    danger: false,
    busy: false,
    error: null,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: []
  cancel: []
}>()

function cancel() {
  emit('update:visible', false)
  emit('cancel')
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="title"
    :closable="!busy"
    :draggable="false"
    :style="{ width: 'min(440px, calc(100vw - 32px))' }"
    data-testid="confirm-dialog"
    @update:visible="(v: boolean) => (v ? emit('update:visible', v) : cancel())"
  >
    <div class="confirm-body">
      <slot>
        <p>{{ message }}</p>
      </slot>
      <p v-if="error" class="field-error" role="alert" data-testid="confirm-error">{{ error }}</p>
    </div>
    <template #footer>
      <Button
        :label="cancelLabel"
        text
        severity="secondary"
        :disabled="busy"
        data-testid="confirm-cancel"
        @click="cancel"
      />
      <Button
        :label="confirmLabel"
        :severity="danger ? 'danger' : undefined"
        :loading="busy"
        :disabled="busy"
        data-testid="confirm-accept"
        @click="emit('confirm')"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.confirm-body p {
  margin: 0 0 8px;
}
</style>
