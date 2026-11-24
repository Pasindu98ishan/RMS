<script setup lang="ts">
/** /admin/roles - roles and the permission editor (P1-RBAC-01/02). */
import { onMounted, ref } from 'vue'
import Button from 'primevue/button'
import RoleEditor from './RoleEditor.vue'
import { rolesApi } from '@/api/roles'
import type { Permission, Role, RoleSummary } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'

const notify = useNotify()
const roles = ref<RoleSummary[]>([])
const permissions = ref<Permission[]>([])
/** undefined = nothing open, null = creating */
const selectedId = ref<string | null | undefined>(undefined)

const loader = useAction(async () => {
  const [r, p] = await Promise.all([
    rolesApi.list(),
    permissions.value.length ? permissions.value : rolesApi.permissions(),
  ])
  roles.value = r
  permissions.value = p
})

async function load() {
  await loader.run().catch((e) => notify.error(e, 'Could not load roles'))
}

onMounted(async () => {
  await load()
  if (selectedId.value === undefined && window.matchMedia('(min-width: 901px)').matches) {
    selectedId.value = roles.value[0]?.id
  }
})

function onSaved(r: Role) {
  notify.success(selectedId.value === null ? 'Role created' : 'Role saved', r.name)
  selectedId.value = r.id
  void load()
}

function onDeleted() {
  notify.success('Role deleted')
  selectedId.value = undefined
  void load()
}
</script>

<template>
  <div class="page roles-page" :class="{ editing: selectedId !== undefined }">
    <div class="page-header">
      <h1>Roles & permissions</h1>
      <Button label="New role" icon="pi pi-plus" data-testid="role-create" @click="selectedId = null" />
    </div>

    <div class="layout">
      <nav class="list card" aria-label="Roles" data-testid="roles-list">
        <button
          v-for="r in roles"
          :key="r.id"
          type="button"
          class="role"
          :class="{ active: r.id === selectedId }"
          :data-testid="`role-row-${r.name}`"
          @click="selectedId = r.id"
        >
          <span class="role-name">
            {{ r.name }}
            <i v-if="r.system" class="pi pi-lock muted" title="System role" aria-label="System role" />
          </span>
          <span class="muted small"
            >{{ r.permissionCount }} permissions - {{ r.userCount }} user{{
              r.userCount === 1 ? '' : 's'
            }}</span
          >
        </button>
        <p v-if="!roles.length && loader.busy.value" class="muted">Loading...</p>
      </nav>

      <RoleEditor
        v-if="selectedId !== undefined && permissions.length"
        :role-id="selectedId"
        :permissions="permissions"
        @saved="onSaved"
        @deleted="onDeleted"
        @close="selectedId = undefined"
      />
      <div v-else class="card placeholder muted">Choose a role to see its permissions.</div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 16px;
  align-items: start;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  position: sticky;
  top: 76px;
}

.role {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 56px;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.role:hover {
  background: #f1f5f9;
}

.role.active {
  background: var(--rms-primary-soft);
}

.role-name {
  font-weight: 700;
  display: flex;
  gap: 6px;
  align-items: center;
}

.placeholder {
  padding: 40px;
  text-align: center;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .list {
    position: static;
  }

  .editing .list,
  .editing .page-header,
  .placeholder {
    display: none;
  }
}
</style>
