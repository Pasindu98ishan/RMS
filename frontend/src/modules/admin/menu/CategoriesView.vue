<script setup lang="ts">
/** /admin/menu/categories - menu categories: order and active flag (P1-MENU-01). */
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import FormField from '@/components/FormField.vue'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { menuApi } from '@/api/menu'
import type { Category } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'

const notify = useNotify()
const categories = ref<Category[]>([])
const loader = useAction(async () => {
  categories.value = await menuApi.listCategories()
})
const load = () => loader.run().catch((e) => notify.error(e, 'Could not load categories'))
onMounted(load)

// ---------------------------------------------------------------- dialog
const open = ref(false)
const editing = ref<Category | null>(null)
const name = ref('')
const sortOrder = ref('')
const active = ref(true)
const touched = ref(false)

const saver = useAction(async () => {
  const order = sortOrder.value.trim() === '' ? undefined : Number(sortOrder.value)
  if (editing.value) {
    return menuApi.updateCategory(editing.value.id, {
      name: name.value.trim(),
      sortOrder: order ?? editing.value.sortOrder,
      active: active.value,
      version: editing.value.version,
    })
  }
  return menuApi.createCategory({
    name: name.value.trim(),
    active: active.value,
    ...(order !== undefined ? { sortOrder: order } : {}),
  })
})

function openDialog(c: Category | null) {
  editing.value = c
  name.value = c?.name ?? ''
  sortOrder.value = c ? String(c.sortOrder) : ''
  active.value = c?.active ?? true
  touched.value = false
  saver.reset()
  open.value = true
}

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (touched.value) {
    if (!name.value.trim()) e.name ??= 'Enter the category name.'
    if (sortOrder.value.trim() !== '' && !/^\d{1,5}$/.test(sortOrder.value.trim())) {
      e.sortOrder ??= 'Display order is a whole number, 0 or more.'
    }
  }
  return e
})
const conflict = computed(() => saver.error.value?.isVersionConflict ?? false)
const general = computed(() => {
  const err = saver.error.value
  return err && !err.fieldErrors.length && !err.isVersionConflict ? err.userMessage : null
})

async function save() {
  touched.value = true
  saver.reset()
  if (Object.keys(errors.value).length) return
  try {
    const saved = await saver.run()
    if (saved) {
      open.value = false
      notify.success(editing.value ? 'Category saved' : 'Category created', saved.name)
      await load()
    }
  } catch {
    /* inline */
  }
}

async function reloadAndClose() {
  open.value = false
  await load()
}

// ---------------------------------------------------------------- quick active toggle (full PUT)
const toggling = ref<string | null>(null)
async function toggleActive(c: Category) {
  toggling.value = c.id
  try {
    const saved = await menuApi.updateCategory(c.id, {
      name: c.name,
      sortOrder: c.sortOrder,
      active: !c.active,
      version: c.version,
    })
    notify.success(saved.active ? 'Category activated' : 'Category deactivated', saved.name)
    await load()
  } catch (e) {
    notify.error(e, 'Could not change the category')
    await load()
  } finally {
    toggling.value = null
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Categories</h1>
      <Button
        label="New category"
        icon="pi pi-plus"
        data-testid="category-create"
        @click="openDialog(null)"
      />
    </div>
    <p class="muted small">
      Categories are never deleted. Deactivating one hides its items from the POS; the items' own flags do not
      change.
    </p>

    <div class="table-wrap">
      <table class="rtable" data-testid="categories-table" :aria-busy="loader.busy.value">
        <thead>
          <tr>
            <th>Name</th>
            <th>Order</th>
            <th>Items</th>
            <th>Status</th>
            <th class="sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in categories"
            :key="c.id"
            :class="{ inactive: !c.active }"
            :data-testid="`category-row-${c.name}`"
          >
            <td data-label="Name">
              <strong>{{ c.name }}</strong>
            </td>
            <td data-label="Order">{{ c.sortOrder }}</td>
            <td data-label="Items">{{ c.itemCount }}</td>
            <td data-label="Status">
              <span class="chip" :class="c.active ? 'chip-ok' : 'chip-muted'">{{
                c.active ? 'Active' : 'Inactive'
              }}</span>
            </td>
            <td data-label="" class="no-label">
              <div class="actions">
                <Button
                  label="Edit"
                  icon="pi pi-pencil"
                  size="small"
                  outlined
                  :data-testid="`category-edit-${c.name}`"
                  @click="openDialog(c)"
                />
                <Button
                  :label="c.active ? 'Deactivate' : 'Activate'"
                  :icon="c.active ? 'pi pi-ban' : 'pi pi-check'"
                  size="small"
                  text
                  :severity="c.active ? 'danger' : undefined"
                  :loading="toggling === c.id"
                  :data-testid="`category-toggle-${c.name}`"
                  @click="toggleActive(c)"
                />
              </div>
            </td>
          </tr>
          <tr v-if="!categories.length && !loader.busy.value">
            <td colspan="5" class="no-label empty">No categories yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Dialog
      v-model:visible="open"
      modal
      :header="editing ? `Edit ${editing.name}` : 'New category'"
      :draggable="false"
      :closable="!saver.busy.value"
      :style="{ width: 'min(440px, calc(100vw - 24px))' }"
      data-testid="category-dialog"
    >
      <form class="stack" novalidate @submit.prevent="save">
        <VersionConflictBanner v-if="conflict" @reload="reloadAndClose" />
        <FormField label="Name" for="category-name" name="name" :error="errors.name">
          <InputText id="category-name" v-model="name" maxlength="50" data-testid="category-name" />
        </FormField>
        <FormField
          label="Display order"
          for="category-order"
          name="sortOrder"
          :error="errors.sortOrder"
          hint="Lowest first. Leave empty to add at the end."
        >
          <InputText
            id="category-order"
            v-model="sortOrder"
            inputmode="numeric"
            data-testid="category-order"
          />
        </FormField>
        <label class="switch">
          <ToggleSwitch v-model="active" input-id="category-active" data-testid="category-active" />
          <span>Active</span>
        </label>
        <p v-if="general" class="field-error" role="alert" data-testid="category-error">{{ general }}</p>
        <div class="dialog-actions">
          <Button
            type="button"
            label="Cancel"
            text
            severity="secondary"
            :disabled="saver.busy.value"
            @click="open = false"
          />
          <Button
            type="submit"
            :label="editing ? 'Save' : 'Create category'"
            :loading="saver.busy.value"
            :disabled="saver.busy.value || conflict"
            data-testid="category-save"
          />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.empty {
  text-align: center;
  color: var(--rms-muted);
  padding: 24px;
}
</style>
