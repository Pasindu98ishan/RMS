<script setup lang="ts">
/** /admin/users - users incl. unlock, password / PIN reset, roles (P1-RBAC-02, P1-AUTH-01, P1-AUTH-05). */
import { computed, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import UserFormDialog from './UserFormDialog.vue'
import AssignRolesDialog from './AssignRolesDialog.vue'
import ResetSecretDialog from './ResetSecretDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { usersApi } from '@/api/users'
import type { User, UserPage, UserSummary } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/time'
import { useRoleOptions } from '../useRoleOptions'

const PAGE_SIZE = 25

const auth = useAuthStore()
const notify = useNotify()
const roleOptions = useRoleOptions()

const search = ref('')
const active = ref<'all' | 'true' | 'false'>('true')
const roleId = ref('')
const page = ref(0)
const result = ref<UserPage | null>(null)

const loader = useAction(async () => {
  result.value = await usersApi.list({
    page: page.value,
    size: PAGE_SIZE,
    sort: 'username,asc',
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
    ...(active.value !== 'all' ? { active: active.value === 'true' } : {}),
    ...(roleId.value ? { roleId: roleId.value } : {}),
  })
})

async function load() {
  await loader.run().catch((e) => notify.error(e, 'Could not load users'))
}

onMounted(async () => {
  await Promise.all([load(), roleOptions.load().catch((e) => notify.error(e, 'Could not load roles'))])
})

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 0
    void load()
  }, 300)
})
watch([active, roleId], () => {
  page.value = 0
  void load()
})

const totalPages = computed(() =>
  result.value ? Math.max(1, Math.ceil(result.value.totalItems / PAGE_SIZE)) : 1,
)
function goPage(p: number) {
  page.value = p
  void load()
}

// ---------------------------------------------------------------- dialogs
const formOpen = ref(false)
const formUserId = ref<string | null>(null)
const rolesOpen = ref(false)
const rolesUserId = ref<string | null>(null)
const secretOpen = ref(false)
const secretKind = ref<'password' | 'pin'>('password')
const secretUser = ref<UserSummary | null>(null)
const confirmOpen = ref(false)
const confirmUser = ref<UserSummary | null>(null)

function openCreate() {
  formUserId.value = null
  formOpen.value = true
}
function openEdit(u: UserSummary) {
  formUserId.value = u.id
  formOpen.value = true
}
function openRoles(u: UserSummary) {
  rolesUserId.value = u.id
  rolesOpen.value = true
}
function openSecret(u: UserSummary, kind: 'password' | 'pin') {
  secretUser.value = u
  secretKind.value = kind
  secretOpen.value = true
}
function openToggleActive(u: UserSummary) {
  confirmUser.value = u
  toggler.reset()
  confirmOpen.value = true
}

function onSaved(u: User, what: string) {
  notify.success(what, u.fullName)
  void load()
}

/** A PIN / password reset changes the row (No PIN chip, PIN lock, account lock), so reload the list. */
function onSecretSaved() {
  notify.success(secretKind.value === 'pin' ? 'PIN reset' : 'Password reset', secretUser.value?.fullName)
  void load()
}

const toggler = useAction(async () => {
  const u = confirmUser.value as UserSummary
  return u.active ? usersApi.deactivate(u.id) : usersApi.activate(u.id)
})
async function toggleActive() {
  try {
    const u = await toggler.run()
    if (u) {
      confirmOpen.value = false
      notify.success(u.active ? 'User activated' : 'User deactivated', u.fullName)
      void load()
    }
  } catch {
    /* shown in the dialog (e.g. CANNOT_DEACTIVATE_SELF, LAST_OWNER) */
  }
}

const unlocking = ref<string | null>(null)
async function unlock(u: UserSummary) {
  unlocking.value = u.id
  try {
    await usersApi.unlock(u.id)
    notify.success(
      'Unlocked',
      u.locked ? `${u.fullName} can log in again.` : `${u.fullName} can use their PIN again.`,
    )
    await load()
  } catch (e) {
    notify.error(e, 'Could not unlock')
  } finally {
    unlocking.value = null
  }
}

const isSelf = (u: UserSummary) => u.id === auth.user?.id
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Users</h1>
      <Button label="New user" icon="pi pi-plus" data-testid="user-create" @click="openCreate" />
    </div>

    <div class="card toolbar filters">
      <div class="field grow">
        <label for="users-search">Search</label>
        <InputText
          id="users-search"
          v-model="search"
          placeholder="Name or username"
          data-testid="users-search"
        />
      </div>
      <div class="field">
        <label for="users-filter-active">Status</label>
        <select
          id="users-filter-active"
          v-model="active"
          class="native-select"
          data-testid="users-filter-active"
        >
          <option value="true">Active</option>
          <option value="false">Deactivated</option>
          <option value="all">All</option>
        </select>
      </div>
      <div class="field">
        <label for="users-filter-role">Role</label>
        <select id="users-filter-role" v-model="roleId" class="native-select" data-testid="users-filter-role">
          <option value="">All roles</option>
          <option v-for="r in roleOptions.roles.value" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table class="rtable" data-testid="users-table" :aria-busy="loader.busy.value">
        <thead>
          <tr>
            <th>User</th>
            <th>Roles</th>
            <th>Status</th>
            <th>Last login</th>
            <th class="sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="u in result?.items ?? []"
            :key="u.id"
            :class="{ inactive: !u.active }"
            :data-testid="`user-row-${u.username}`"
          >
            <td data-label="User">
              <div class="who">
                <strong>{{ u.fullName }}</strong>
                <span class="muted mono">{{ u.username }}<template v-if="isSelf(u)"> (you)</template></span>
              </div>
            </td>
            <td data-label="Roles">
              <span class="roles">
                <span v-for="r in u.roles" :key="r.id" class="chip chip-info">{{ r.name }}</span>
              </span>
            </td>
            <td data-label="Status">
              <span class="roles">
                <span
                  class="chip"
                  :class="u.active ? 'chip-ok' : 'chip-muted'"
                  :data-testid="`user-status-${u.username}`"
                >
                  {{ u.active ? 'Active' : 'Deactivated' }}
                </span>
                <span v-if="u.locked" class="chip chip-danger" :data-testid="`user-locked-${u.username}`">
                  <i class="pi pi-lock" aria-hidden="true" />Locked
                </span>
                <span
                  v-if="u.pinLocked"
                  class="chip chip-danger"
                  :data-testid="`user-pin-locked-${u.username}`"
                >
                  <i class="pi pi-lock" aria-hidden="true" />PIN locked
                </span>
                <span v-else-if="!u.pinSet" class="chip chip-warn" :data-testid="`user-no-pin-${u.username}`">
                  No PIN
                </span>
              </span>
            </td>
            <td data-label="Last login">{{ u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never' }}</td>
            <td data-label="" class="no-label">
              <div class="actions">
                <Button
                  v-if="u.locked || u.pinLocked"
                  :label="u.locked ? 'Unlock' : 'Unlock PIN'"
                  icon="pi pi-unlock"
                  size="small"
                  severity="warn"
                  :loading="unlocking === u.id"
                  :data-testid="`user-unlock-${u.username}`"
                  @click="unlock(u)"
                />
                <Button
                  label="Edit"
                  icon="pi pi-pencil"
                  size="small"
                  outlined
                  :data-testid="`user-edit-${u.username}`"
                  @click="openEdit(u)"
                />
                <Button
                  label="Roles"
                  icon="pi pi-shield"
                  size="small"
                  outlined
                  :data-testid="`user-assign-roles-${u.username}`"
                  @click="openRoles(u)"
                />
                <Button
                  label="Password"
                  icon="pi pi-key"
                  size="small"
                  outlined
                  severity="secondary"
                  :data-testid="`user-reset-password-${u.username}`"
                  @click="openSecret(u, 'password')"
                />
                <Button
                  label="PIN"
                  icon="pi pi-lock"
                  size="small"
                  outlined
                  severity="secondary"
                  :data-testid="`user-reset-pin-${u.username}`"
                  @click="openSecret(u, 'pin')"
                />
                <Button
                  v-if="u.active && !isSelf(u)"
                  label="Deactivate"
                  icon="pi pi-ban"
                  size="small"
                  text
                  severity="danger"
                  :data-testid="`user-deactivate-${u.username}`"
                  @click="openToggleActive(u)"
                />
                <Button
                  v-if="!u.active"
                  label="Activate"
                  icon="pi pi-check"
                  size="small"
                  text
                  :data-testid="`user-activate-${u.username}`"
                  @click="openToggleActive(u)"
                />
              </div>
            </td>
          </tr>
          <tr v-if="result && result.items.length === 0">
            <td colspan="5" class="no-label empty" data-testid="users-empty">
              No users match these filters.
            </td>
          </tr>
          <tr v-if="!result && loader.busy.value">
            <td colspan="5" class="no-label empty">Loading...</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="result" class="pager">
      <span class="muted small" data-testid="users-total"
        >{{ result.totalItems }} user{{ result.totalItems === 1 ? '' : 's' }}</span
      >
      <div class="pager-buttons">
        <Button
          icon="pi pi-angle-left"
          text
          aria-label="Previous page"
          :disabled="page === 0 || loader.busy.value"
          data-testid="users-prev"
          @click="goPage(page - 1)"
        />
        <span class="small">Page {{ page + 1 }} of {{ totalPages }}</span>
        <Button
          icon="pi pi-angle-right"
          text
          aria-label="Next page"
          :disabled="page + 1 >= totalPages || loader.busy.value"
          data-testid="users-next"
          @click="goPage(page + 1)"
        />
      </div>
    </div>

    <UserFormDialog
      v-model:visible="formOpen"
      :user-id="formUserId"
      :roles="roleOptions.roles.value"
      @saved="(u) => onSaved(u, formUserId ? 'User saved' : 'User created')"
    />
    <AssignRolesDialog
      v-model:visible="rolesOpen"
      :user-id="rolesUserId"
      :roles="roleOptions.roles.value"
      @saved="(u) => onSaved(u, 'Roles saved')"
    />
    <ResetSecretDialog
      v-model:visible="secretOpen"
      :kind="secretKind"
      :user="secretUser"
      @saved="onSecretSaved"
    />
    <ConfirmDialog
      v-model:visible="confirmOpen"
      :title="
        confirmUser?.active ? `Deactivate ${confirmUser?.fullName}?` : `Activate ${confirmUser?.fullName}?`
      "
      :message="
        confirmUser?.active
          ? 'The user can no longer log in and is logged out everywhere. Their history stays.'
          : 'The user can log in again with their current password.'
      "
      :confirm-label="confirmUser?.active ? 'Deactivate' : 'Activate'"
      :danger="confirmUser?.active"
      :busy="toggler.busy.value"
      :error="toggler.error.value?.userMessage"
      @confirm="toggleActive"
    />
  </div>
</template>

<style scoped>
.filters .grow {
  flex: 1 1 240px;
}

.filters .field {
  min-width: 160px;
}

.who {
  display: flex;
  flex-direction: column;
}

.roles {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

@media (min-width: 721px) {
  .roles {
    justify-content: flex-start;
  }
}

.empty {
  text-align: center;
  color: var(--rms-muted);
  padding: 24px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.pager-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
