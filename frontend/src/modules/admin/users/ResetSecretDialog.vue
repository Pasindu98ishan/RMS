<script setup lang="ts">
/** Owner sets a new password or approval PIN for a user. */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { usersApi } from '@/api/users'
import type { UserSummary } from '@/api/types'
import { useAction } from '@/composables/useAction'

const props = defineProps<{ visible: boolean; kind: 'password' | 'pin'; user: UserSummary | null }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [] }>()

const value = ref('')
const touched = ref(false)
const saver = useAction(() => {
  const id = (props.user as UserSummary).id
  return props.kind === 'password'
    ? usersApi.resetPassword(id, value.value)
    : usersApi.resetPin(id, value.value)
})

watch(
  () => props.visible,
  (open) => {
    if (open) {
      value.value = ''
      touched.value = false
      saver.reset()
    }
  },
)

const isPin = computed(() => props.kind === 'pin')
const localError = computed(() => {
  if (!touched.value) return null
  if (isPin.value) return /^\d{4,6}$/.test(value.value) ? null : 'PIN is 4 to 6 digits.'
  if (value.value.length < 8 || value.value.length > 72) return 'Use 8 to 72 characters.'
  if (value.value === props.user?.username) return 'The password must not be the same as the username.'
  return null
})
const error = computed(
  () =>
    localError.value ?? Object.values(saver.fieldErrors.value)[0] ?? saver.error.value?.userMessage ?? null,
)

function onInput(v: string | undefined) {
  value.value = isPin.value ? (v ?? '').replace(/\D/g, '').slice(0, 6) : (v ?? '')
}

async function save() {
  touched.value = true
  saver.reset()
  if (localError.value) return
  try {
    await saver.run()
    emit('saved')
    emit('update:visible', false)
  } catch {
    /* inline */
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="`${isPin ? 'Reset PIN' : 'Reset password'} - ${user?.fullName ?? ''}`"
    :draggable="false"
    :closable="!saver.busy.value"
    :style="{ width: 'min(420px, calc(100vw - 24px))' }"
    :data-testid="isPin ? 'reset-pin-dialog' : 'reset-password-dialog'"
    @update:visible="emit('update:visible', $event)"
  >
    <form class="stack" novalidate @submit.prevent="save">
      <p class="muted small">
        <template v-if="isPin">The new PIN replaces the old one and clears a PIN lock.</template>
        <template v-else>This also unlocks the account and logs the user out everywhere.</template>
      </p>
      <div class="field">
        <label for="reset-secret">{{ isPin ? 'New PIN (4 to 6 digits)' : 'New password' }}</label>
        <InputText
          id="reset-secret"
          :model-value="value"
          type="password"
          :inputmode="isPin ? 'numeric' : 'text'"
          :maxlength="isPin ? 6 : 72"
          autocomplete="new-password"
          :data-testid="isPin ? 'user-pin' : 'user-password'"
          @update:model-value="onInput"
        />
      </div>
      <p v-if="error" class="field-error" role="alert" data-testid="reset-error">{{ error }}</p>
      <div class="actions">
        <Button
          type="button"
          label="Cancel"
          text
          severity="secondary"
          :disabled="saver.busy.value"
          @click="emit('update:visible', false)"
        />
        <Button
          type="submit"
          :label="isPin ? 'Set PIN' : 'Set password'"
          :loading="saver.busy.value"
          :disabled="saver.busy.value"
          data-testid="user-save"
        />
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
.stack p {
  margin: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
