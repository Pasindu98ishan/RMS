<script setup lang="ts">
/** Replace a user's roles (PUT /users/{id}/roles, full replacement with version). */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import MultiSelect from 'primevue/multiselect'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { usersApi } from '@/api/users'
import type { RoleOption, User } from '@/api/types'
import { useAction } from '@/composables/useAction'

const props = defineProps<{
  visible: boolean
  userId: string | null
  roles: RoleOption[]
}>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [user: User] }>()

const user = ref<User | null>(null)
const roleIds = ref<string[]>([])
const touched = ref(false)

const loader = useAction(async (id: string) => {
  user.value = await usersApi.get(id)
  roleIds.value = user.value.roles.map((r) => r.id)
})
/** True from opening an existing record until it has loaded: the form is disabled so nothing typed early is overwritten. */
const loading = computed(() => props.userId !== null && !user.value && !loader.error.value)

const saver = useAction(() => {
  const u = user.value as User
  return usersApi.assignRoles(u.id, roleIds.value, u.version)
})

watch(
  () => props.visible,
  async (open) => {
    if (!open || !props.userId) return
    touched.value = false
    saver.reset()
    user.value = null
    roleIds.value = []
    await loader.run(props.userId).catch(() => undefined)
  },
)

/** Options: all roles, plus any the user holds that the list doesn't have (defensive). */
const options = computed(() => {
  const map = new Map(props.roles.map((r) => [r.id, r]))
  user.value?.roles.forEach((r) => map.set(r.id, r))
  return [...map.values()]
})

const conflict = computed(() => saver.error.value?.isVersionConflict ?? false)
const error = computed(() => {
  if (touched.value && roleIds.value.length === 0) return 'Choose at least one role.'
  const err = saver.error.value ?? loader.error.value
  return err && !err.isVersionConflict ? err.userMessage : null
})

async function save() {
  touched.value = true
  saver.reset()
  if (roleIds.value.length === 0) return
  try {
    const u = await saver.run()
    if (u) {
      emit('saved', u)
      emit('update:visible', false)
    }
  } catch {
    /* inline */
  }
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
    :header="`Roles for ${user?.fullName ?? '...'}`"
    :draggable="false"
    :closable="!saver.busy.value"
    :style="{ width: 'min(480px, calc(100vw - 24px))' }"
    data-testid="assign-roles-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <form class="stack" novalidate @submit.prevent="save">
      <VersionConflictBanner v-if="conflict" :busy="loader.busy.value" @reload="reload" />
      <fieldset class="plain stack" :disabled="loading">
        <div class="field">
          <label for="assign-roles-input">Roles</label>
          <MultiSelect
            v-model="roleIds"
            input-id="assign-roles-input"
            :options="options"
            option-label="name"
            option-value="id"
            display="chip"
            :show-toggle-all="false"
            placeholder="Choose roles"
            :loading="loader.busy.value"
            data-testid="user-roles"
          />
          <span class="hint">Changes take effect at the user's next token refresh (within 15 minutes).</span>
        </div>
        <p v-if="error" class="field-error" role="alert" data-testid="assign-roles-error">{{ error }}</p>
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
          label="Save roles"
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
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
