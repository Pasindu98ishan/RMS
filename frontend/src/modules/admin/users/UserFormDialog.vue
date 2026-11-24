<script setup lang="ts">
/** Create a user, or edit an existing user's details (username cannot change). */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { usersApi } from '@/api/users'
import type { RoleOption, User } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { formatDateTime } from '@/utils/time'

const props = defineProps<{
  visible: boolean
  /** null = create */
  userId: string | null
  roles: RoleOption[]
}>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [user: User] }>()

const isCreate = computed(() => props.userId === null)
const user = ref<User | null>(null)
const username = ref('')
const fullName = ref('')
const phone = ref('')
const password = ref('')
const pin = ref('')
const roleIds = ref<string[]>([])
const touched = ref(false)

const loader = useAction(async (id: string) => {
  const u = await usersApi.get(id)
  user.value = u
  fullName.value = u.fullName
  phone.value = u.phone ?? ''
})

/** True from opening an existing record until it has loaded: the form is disabled so nothing typed early is overwritten. */
const loading = computed(() => props.userId !== null && !user.value && !loader.error.value)

const saver = useAction(async () => {
  if (isCreate.value) {
    return usersApi.create({
      username: username.value.trim(),
      fullName: fullName.value.trim(),
      password: password.value,
      roleIds: roleIds.value,
      ...(phone.value.trim() ? { phone: phone.value.trim() } : {}),
      ...(pin.value ? { pin: pin.value } : {}),
    })
  }
  const u = user.value as User
  // PUT is a full replacement: optional fields without a value are omitted, never null.
  return usersApi.update(u.id, {
    fullName: fullName.value.trim(),
    version: u.version,
    ...(phone.value.trim() ? { phone: phone.value.trim() } : {}),
  })
})

watch(
  () => props.visible,
  async (open) => {
    if (!open) return
    touched.value = false
    saver.reset()
    user.value = null
    username.value = fullName.value = phone.value = password.value = pin.value = ''
    roleIds.value = []
    if (props.userId) await loader.run(props.userId).catch(() => undefined)
  },
)

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (!touched.value) return e
  if (isCreate.value) {
    if (!/^[a-z0-9._-]{3,32}$/.test(username.value.trim())) {
      e.username ??= 'Use 3 to 32 lower-case letters, digits, dot, dash or underscore.'
    }
    if (password.value.length < 8 || password.value.length > 72) e.password ??= 'Use 8 to 72 characters.'
    if (pin.value && !/^\d{4,6}$/.test(pin.value)) e.pin ??= 'PIN is 4 to 6 digits.'
    if (roleIds.value.length === 0) e.roleIds ??= 'Choose at least one role.'
  }
  if (!fullName.value.trim()) e.fullName ??= 'Enter the full name.'
  if (phone.value.trim() && !/^\+?[0-9][0-9 -]{6,18}$/.test(phone.value.trim())) {
    e.phone ??= 'Enter a valid phone number, e.g. +94 77 123 4567.'
  }
  return e
})

const conflict = computed(() => saver.error.value?.isVersionConflict ?? false)
const generalError = computed(() => {
  const err = saver.error.value ?? loader.error.value
  return err && !err.fieldErrors.length && !err.isVersionConflict ? err.userMessage : null
})

async function save() {
  touched.value = true
  saver.reset()
  if (Object.keys(errors.value).length) return
  try {
    const saved = await saver.run()
    if (saved) {
      emit('saved', saved)
      emit('update:visible', false)
    }
  } catch {
    /* shown inline */
  }
}

const unlocker = useAction(async () => {
  const u = await usersApi.unlock((user.value as User).id)
  user.value = u
  emit('saved', u)
})

async function unlock() {
  await unlocker.run().catch(() => undefined)
}

async function reload() {
  if (!props.userId) return
  saver.reset()
  await loader.run(props.userId).catch(() => undefined)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="isCreate ? 'New user' : `Edit ${user?.username ?? 'user'}`"
    :draggable="false"
    :closable="!saver.busy.value"
    :style="{ width: 'min(560px, calc(100vw - 24px))' }"
    data-testid="user-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <form class="stack" novalidate @submit.prevent="save">
      <VersionConflictBanner v-if="conflict" :busy="loader.busy.value" @reload="reload" />
      <fieldset class="plain stack" :disabled="loading">
        <div v-if="!isCreate && user" class="status-line">
          <span class="chip" :class="user.active ? 'chip-ok' : 'chip-muted'">{{
            user.active ? 'Active' : 'Deactivated'
          }}</span>
          <span v-if="user.locked" class="chip chip-danger"
            >Locked until {{ formatDateTime(user.lockedUntil) }}</span
          >
          <span v-if="user.pinLocked" class="chip chip-danger"
            >PIN locked until {{ formatDateTime(user.pinLockedUntil) }}</span
          >
          <span class="chip" :class="user.pinSet ? 'chip-info' : 'chip-warn'">{{
            user.pinSet ? 'PIN set' : 'No PIN'
          }}</span>
          <span class="muted small">Roles: {{ user.roles.map((r) => r.name).join(', ') }}</span>
          <Button
            v-if="user.locked || user.pinLocked"
            label="Unlock account and PIN"
            icon="pi pi-unlock"
            size="small"
            outlined
            :loading="unlocker.busy.value"
            data-testid="user-dialog-unlock"
            @click="unlock"
          />
        </div>

        <div class="form-grid">
          <div v-if="isCreate" class="field">
            <label for="user-username">Username</label>
            <InputText
              id="user-username"
              v-model="username"
              autocapitalize="none"
              autocomplete="off"
              spellcheck="false"
              maxlength="32"
              data-testid="user-username"
            />
            <span class="hint">Cannot be changed later.</span>
            <p v-if="errors.username" class="field-error" data-testid="field-error-username">
              {{ errors.username }}
            </p>
          </div>
          <div class="field">
            <label for="user-fullname">Full name</label>
            <InputText id="user-fullname" v-model="fullName" maxlength="100" data-testid="user-fullname" />
            <p v-if="errors.fullName" class="field-error" data-testid="field-error-fullName">
              {{ errors.fullName }}
            </p>
          </div>
          <div class="field">
            <label for="user-phone">Phone (optional)</label>
            <InputText
              id="user-phone"
              v-model="phone"
              type="tel"
              placeholder="+94 77 123 4567"
              data-testid="user-phone"
            />
            <p v-if="errors.phone" class="field-error" data-testid="field-error-phone">{{ errors.phone }}</p>
          </div>
          <template v-if="isCreate">
            <div class="field">
              <label for="user-password">Password</label>
              <InputText
                id="user-password"
                v-model="password"
                type="password"
                autocomplete="new-password"
                data-testid="user-password"
              />
              <span class="hint">8 to 72 characters, not the username.</span>
              <p v-if="errors.password" class="field-error" data-testid="field-error-password">
                {{ errors.password }}
              </p>
            </div>
            <div class="field">
              <label for="user-pin">Approval PIN (optional)</label>
              <InputText
                id="user-pin"
                :model-value="pin"
                type="password"
                inputmode="numeric"
                maxlength="6"
                autocomplete="off"
                data-testid="user-pin"
                @update:model-value="pin = ($event ?? '').replace(/\D/g, '').slice(0, 6)"
              />
              <span class="hint">4 to 6 digits. Needed only by users who approve.</span>
              <p v-if="errors.pin" class="field-error" data-testid="field-error-pin">{{ errors.pin }}</p>
            </div>
            <div class="field roles-field">
              <label for="user-roles-input">Roles</label>
              <MultiSelect
                v-model="roleIds"
                input-id="user-roles-input"
                :options="roles"
                option-label="name"
                option-value="id"
                display="chip"
                placeholder="Choose roles"
                :show-toggle-all="false"
                data-testid="user-roles"
              />
              <p v-if="errors.roleIds" class="field-error" data-testid="field-error-roleIds">
                {{ errors.roleIds }}
              </p>
            </div>
          </template>
        </div>

        <p v-if="generalError" class="field-error" role="alert" data-testid="user-error">
          {{ generalError }}
        </p>
      </fieldset>
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
          :label="isCreate ? 'Create user' : 'Save'"
          :loading="saver.busy.value"
          :disabled="saver.busy.value || loader.busy.value || conflict"
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
  gap: 14px;
}

.status-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.roles-field {
  grid-column: 1 / -1;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
