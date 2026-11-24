<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { authApi } from '@/api/auth'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const notify = useNotify()
const current = ref('')
const next = ref('')
const confirm = ref('')
const touched = ref(false)
const action = useAction(() => authApi.changeOwnPassword(current.value, next.value))

watch(
  () => props.visible,
  (open) => {
    if (open) {
      current.value = next.value = confirm.value = ''
      touched.value = false
      action.reset()
    }
  },
)

const errors = computed(() => {
  const e: Record<string, string> = { ...action.fieldErrors.value }
  if (touched.value) {
    if (!current.value) e.currentPassword ??= 'Enter your current password.'
    if (next.value.length < 8 || next.value.length > 72) e.newPassword ??= 'Use 8 to 72 characters.'
    if (confirm.value !== next.value) e.confirm = 'The two new passwords do not match.'
  }
  return e
})

async function save() {
  touched.value = true
  action.reset()
  if (Object.keys(errors.value).length) return
  try {
    await action.run()
    notify.success('Password changed', 'Your other sessions were logged out.')
    emit('update:visible', false)
  } catch {
    /* shown inline */
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Change my password"
    :draggable="false"
    :closable="!action.busy.value"
    :style="{ width: 'min(420px, calc(100vw - 32px))' }"
    data-testid="change-password-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <form class="stack" novalidate @submit.prevent="save">
      <div class="field">
        <label for="pw-current">Current password</label>
        <InputText
          id="pw-current"
          v-model="current"
          type="password"
          autocomplete="current-password"
          data-testid="pw-current"
        />
        <p v-if="errors.currentPassword" class="field-error" data-testid="field-error-currentPassword">
          {{ errors.currentPassword }}
        </p>
      </div>
      <div class="field">
        <label for="pw-new">New password</label>
        <InputText
          id="pw-new"
          v-model="next"
          type="password"
          autocomplete="new-password"
          data-testid="pw-new"
        />
        <span class="hint">8 to 72 characters, not your username.</span>
        <p v-if="errors.newPassword" class="field-error" data-testid="field-error-newPassword">
          {{ errors.newPassword }}
        </p>
      </div>
      <div class="field">
        <label for="pw-confirm">Repeat new password</label>
        <InputText
          id="pw-confirm"
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          data-testid="pw-confirm"
        />
        <p v-if="errors.confirm" class="field-error">{{ errors.confirm }}</p>
      </div>
      <p
        v-if="action.error.value && !action.error.value.fieldErrors.length"
        class="field-error"
        role="alert"
        data-testid="pw-error"
      >
        {{ action.error.value.userMessage }}
      </p>
      <div class="actions">
        <Button
          type="button"
          label="Cancel"
          text
          severity="secondary"
          @click="emit('update:visible', false)"
        />
        <Button type="submit" label="Change password" :loading="action.busy.value" data-testid="pw-save" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
