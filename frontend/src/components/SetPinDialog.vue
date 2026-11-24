<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { authApi } from '@/api/auth'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [] }>()

const notify = useNotify()
const password = ref('')
const pin = ref('')
const confirm = ref('')
const touched = ref(false)
const action = useAction(() => authApi.setOwnPin(password.value, pin.value))

watch(
  () => props.visible,
  (open) => {
    if (open) {
      password.value = pin.value = confirm.value = ''
      touched.value = false
      action.reset()
    }
  },
)

const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 6)

const errors = computed(() => {
  const e: Record<string, string> = { ...action.fieldErrors.value }
  if (touched.value) {
    if (!password.value) e.currentPassword ??= 'Enter your password to confirm it is you.'
    if (!/^\d{4,6}$/.test(pin.value)) e.newPin ??= 'PIN is 4 to 6 digits.'
    if (confirm.value !== pin.value) e.confirm = 'The two PINs do not match.'
  }
  return e
})

async function save() {
  touched.value = true
  action.reset()
  if (Object.keys(errors.value).length) return
  try {
    await action.run()
    notify.success('PIN set', 'Use it to approve actions at the terminal.')
    emit('saved')
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
    header="Set my approval PIN"
    :draggable="false"
    :closable="!action.busy.value"
    :style="{ width: 'min(420px, calc(100vw - 32px))' }"
    data-testid="set-pin-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <form class="stack" novalidate @submit.prevent="save">
      <div class="field">
        <label for="pin-set-password">Your password</label>
        <InputText
          id="pin-set-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          data-testid="pin-set-password"
        />
        <p v-if="errors.currentPassword" class="field-error" data-testid="field-error-currentPassword">
          {{ errors.currentPassword }}
        </p>
      </div>
      <div class="field">
        <label for="pin-set-new">New PIN (4 to 6 digits)</label>
        <InputText
          id="pin-set-new"
          :model-value="pin"
          type="password"
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          data-testid="pin-set-new"
          @update:model-value="pin = digitsOnly($event ?? '')"
        />
        <p v-if="errors.newPin" class="field-error" data-testid="field-error-newPin">{{ errors.newPin }}</p>
      </div>
      <div class="field">
        <label for="pin-set-confirm">Repeat PIN</label>
        <InputText
          id="pin-set-confirm"
          :model-value="confirm"
          type="password"
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          data-testid="pin-set-confirm"
          @update:model-value="confirm = digitsOnly($event ?? '')"
        />
        <p v-if="errors.confirm" class="field-error">{{ errors.confirm }}</p>
      </div>
      <p
        v-if="action.error.value && !action.error.value.fieldErrors.length"
        class="field-error"
        role="alert"
        data-testid="pin-set-error"
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
        <Button type="submit" label="Set PIN" :loading="action.busy.value" data-testid="pin-set-save" />
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
