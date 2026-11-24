<script setup lang="ts">
/**
 * Role editor: name, description and the permission checklist grouped by module.
 * Owner role: fully read-only (always every permission). System roles: name fixed, cannot be
 * deleted; permissions editable (roles-permissions.md).
 */
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { rolesApi } from '@/api/roles'
import {
  MODULE_LABEL,
  PERMISSION_MODULES,
  type Permission,
  type PermissionCode,
  type Role,
} from '@/api/types'
import { useAction } from '@/composables/useAction'
import { formatDateTime } from '@/utils/time'

const props = defineProps<{
  /** null = new custom role */
  roleId: string | null
  permissions: Permission[]
}>()
const emit = defineEmits<{ saved: [role: Role]; deleted: []; close: [] }>()

const role = ref<Role | null>(null)
const name = ref('')
const description = ref('')
const selected = ref<Set<PermissionCode>>(new Set())
const touched = ref(false)
const confirmDelete = ref(false)

const isCreate = computed(() => props.roleId === null)
/** Matched on the stable RoleKey, never on the (renameable) name. */
const isOwner = computed(() => role.value?.key === 'OWNER')
const isSystem = computed(() => Boolean(role.value?.system))
const readOnly = computed(() => isOwner.value)

const loader = useAction(async (id: string) => {
  const r = await rolesApi.get(id)
  role.value = r
  name.value = r.name
  description.value = r.description ?? ''
  selected.value = new Set(r.permissionCodes)
})

const saver = useAction(async () => {
  const permissionCodes = props.permissions.map((p) => p.code).filter((c) => selected.value.has(c))
  const desc = description.value.trim()
  if (isCreate.value) {
    return rolesApi.create({
      name: name.value.trim(),
      permissionCodes,
      ...(desc ? { description: desc } : {}),
    })
  }
  const r = role.value as Role
  return rolesApi.update(r.id, {
    name: name.value.trim(),
    permissionCodes,
    version: r.version,
    ...(desc ? { description: desc } : {}),
  })
})

const deleter = useAction(() => rolesApi.remove((role.value as Role).id))

watch(
  () => props.roleId,
  async (id) => {
    touched.value = false
    saver.reset()
    deleter.reset()
    role.value = null
    name.value = ''
    description.value = ''
    selected.value = new Set()
    if (id) await loader.run(id).catch(() => undefined)
  },
  { immediate: true },
)

const groups = computed(() =>
  PERMISSION_MODULES.map((m) => ({
    module: m,
    label: MODULE_LABEL[m],
    items: props.permissions.filter((p) => p.module === m),
  })).filter((g) => g.items.length > 0),
)

function toggle(code: PermissionCode, on: boolean) {
  const next = new Set(selected.value)
  if (on) next.add(code)
  else next.delete(code)
  selected.value = next
}

function moduleState(items: Permission[]): 'all' | 'some' | 'none' {
  const n = items.filter((p) => selected.value.has(p.code)).length
  return n === 0 ? 'none' : n === items.length ? 'all' : 'some'
}

function toggleModule(items: Permission[]) {
  const on = moduleState(items) !== 'all'
  const next = new Set(selected.value)
  items.forEach((p) => (on ? next.add(p.code) : next.delete(p.code)))
  selected.value = next
}

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (touched.value && !name.value.trim()) e.name ??= 'Enter a role name.'
  return e
})
const conflict = computed(() => saver.error.value?.isVersionConflict ?? false)
const generalError = computed(() => {
  const err = saver.error.value ?? loader.error.value ?? deleter.error.value
  return err && !err.fieldErrors.length && !err.isVersionConflict ? err.userMessage : null
})

async function save() {
  touched.value = true
  saver.reset()
  if (readOnly.value || Object.keys(errors.value).length) return
  try {
    const r = await saver.run()
    if (r) {
      role.value = r
      selected.value = new Set(r.permissionCodes)
      emit('saved', r)
    }
  } catch {
    /* inline */
  }
}

async function remove() {
  try {
    await deleter.run()
    confirmDelete.value = false
    emit('deleted')
  } catch {
    confirmDelete.value = false
  }
}

async function reload() {
  if (!props.roleId) return
  saver.reset()
  await loader.run(props.roleId).catch(() => undefined)
}
</script>

<template>
  <section class="editor card" data-testid="role-editor" :aria-busy="loader.busy.value">
    <header class="editor-head">
      <Button
        icon="pi pi-arrow-left"
        text
        rounded
        aria-label="Back to roles"
        class="back"
        data-testid="role-back"
        @click="emit('close')"
      />
      <h2>{{ isCreate ? 'New role' : (role?.name ?? 'Loading...') }}</h2>
      <span v-if="isSystem" class="chip chip-info">System role</span>
    </header>

    <div v-if="isOwner" class="banner banner-info" data-testid="role-owner-readonly">
      <i class="pi pi-lock" aria-hidden="true" />
      <span>The Owner role always holds every permission. It cannot be changed or deleted.</span>
    </div>
    <div v-else-if="isSystem" class="banner banner-info" data-testid="role-system-note">
      <i class="pi pi-info-circle" aria-hidden="true" />
      <span>System role: its name is fixed and it cannot be deleted. Its permissions can be changed.</span>
    </div>
    <VersionConflictBanner v-if="conflict" :busy="loader.busy.value" @reload="reload" />

    <form class="stack" novalidate @submit.prevent="save">
      <div class="form-grid">
        <div class="field">
          <label for="role-name">Role name</label>
          <InputText
            id="role-name"
            v-model="name"
            maxlength="50"
            :disabled="isSystem || readOnly"
            data-testid="role-name"
          />
          <p v-if="errors.name" class="field-error" data-testid="field-error-name">{{ errors.name }}</p>
        </div>
        <div class="field">
          <label for="role-description">Description</label>
          <Textarea
            id="role-description"
            v-model="description"
            rows="1"
            auto-resize
            maxlength="200"
            :disabled="readOnly"
            data-testid="role-description"
          />
        </div>
      </div>

      <div class="perm-head">
        <h3>Permissions</h3>
        <span class="muted small" data-testid="role-perm-count"
          >{{ selected.size }} of {{ permissions.length }} selected</span
        >
      </div>
      <div class="groups">
        <fieldset v-for="g in groups" :key="g.module" class="group" :data-testid="`perm-group-${g.module}`">
          <legend>
            <label class="module-toggle">
              <input
                type="checkbox"
                :checked="moduleState(g.items) === 'all'"
                :indeterminate.prop="moduleState(g.items) === 'some'"
                :disabled="readOnly"
                :data-testid="`perm-module-${g.module}`"
                @change="toggleModule(g.items)"
              />
              <span>{{ g.label }}</span>
            </label>
          </legend>
          <label v-for="p in g.items" :key="p.code" class="perm">
            <input
              type="checkbox"
              :checked="selected.has(p.code)"
              :disabled="readOnly"
              :data-testid="`perm-${p.code}`"
              @change="toggle(p.code, ($event.target as HTMLInputElement).checked)"
            />
            <span class="perm-text">
              <span>{{ p.description }}</span>
              <span class="mono muted">{{ p.code }}</span>
            </span>
          </label>
        </fieldset>
      </div>

      <p v-if="generalError" class="field-error" role="alert" data-testid="role-error">{{ generalError }}</p>
      <p v-if="role" class="muted small">
        Used by {{ role.userCount }} active user{{ role.userCount === 1 ? '' : 's' }} - last changed
        {{ formatDateTime(role.updatedAt) }}. Changes reach users at their next token refresh.
      </p>

      <div v-if="!readOnly" class="actions">
        <Button
          v-if="!isCreate && !isSystem"
          type="button"
          label="Delete role"
          icon="pi pi-trash"
          severity="danger"
          text
          :disabled="saver.busy.value"
          data-testid="role-delete"
          @click="confirmDelete = true"
        />
        <span class="spacer" />
        <Button
          type="submit"
          :label="isCreate ? 'Create role' : 'Save'"
          icon="pi pi-check"
          :loading="saver.busy.value"
          :disabled="saver.busy.value || loader.busy.value || conflict"
          data-testid="role-save"
        />
      </div>
    </form>

    <ConfirmDialog
      v-model:visible="confirmDelete"
      :title="`Delete role ${role?.name}?`"
      message="The role is removed. A role still assigned to any user cannot be deleted."
      confirm-label="Delete"
      danger
      :busy="deleter.busy.value"
      @confirm="remove"
    />
  </section>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.editor-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.editor-head h2 {
  font-size: 1.2rem;
}

.back {
  display: none;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.perm-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.perm-head h3 {
  font-size: 1rem;
}

.groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.group {
  border: 1px solid var(--rms-border);
  border-radius: 10px;
  padding: 8px 12px 12px;
  margin: 0;
  min-width: 0;
}

.module-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  padding: 0 4px;
}

.perm {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 2px;
  min-height: 44px;
  border-bottom: 1px solid #f0f2f4;
  cursor: pointer;
}

.perm:last-child {
  border-bottom: 0;
}

.perm input,
.module-toggle input {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  accent-color: var(--rms-primary);
  flex-shrink: 0;
}

.perm-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  position: sticky;
  bottom: 0;
  background: #fff;
  padding-top: 8px;
}

.spacer {
  flex: 1;
}

@media (max-width: 900px) {
  .back {
    display: inline-flex;
  }

  .groups {
    grid-template-columns: 1fr;
  }
}
</style>
