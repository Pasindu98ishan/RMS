<script setup lang="ts">
/** /admin/reasons - editable reason lists for the cancel, void, refund, petty cash and discount dialogs (P1-SET-08). */
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import FormField from '@/components/FormField.vue'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { settingsApi } from '@/api/settings'
import { REASON_CATEGORIES, REASON_CATEGORY_LABEL, type Reason, type ReasonCategory } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'

const notify = useNotify()
const category = ref<ReasonCategory>('CANCEL')
const all = ref<Reason[]>([])
const loader = useAction(async () => {
  all.value = await settingsApi.listReasons()
})
const load = () => loader.run().catch((e) => notify.error(e, 'Could not load reasons'))
onMounted(load)

const reasons = computed(() => all.value.filter((r) => r.category === category.value))
const counts = computed(() =>
  Object.fromEntries(
    REASON_CATEGORIES.map((c) => [c, all.value.filter((r) => r.category === c && r.active).length]),
  ),
)

const open = ref(false)
const editing = ref<Reason | null>(null)
const text = ref('')
const active = ref(true)
const touched = ref(false)

const saver = useAction(async () => {
  const t = text.value.trim()
  return editing.value
    ? settingsApi.updateReason(editing.value.id, {
        text: t,
        active: active.value,
        version: editing.value.version,
      })
    : settingsApi.createReason({ category: category.value, text: t, active: active.value })
})

function openDialog(r: Reason | null) {
  editing.value = r
  text.value = r?.text ?? ''
  active.value = r?.active ?? true
  touched.value = false
  saver.reset()
  open.value = true
}

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (touched.value && !text.value.trim()) e.text ??= 'Enter the reason.'
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
      notify.success(editing.value ? 'Reason saved' : 'Reason added', saved.text)
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

const toggling = ref<string | null>(null)
async function toggleActive(r: Reason) {
  toggling.value = r.id
  try {
    await settingsApi.updateReason(r.id, { text: r.text, active: !r.active, version: r.version })
  } catch (e) {
    notify.error(e, 'Could not change the reason')
  } finally {
    toggling.value = null
    await load()
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Reason lists</h1>
      <Button label="Add reason" icon="pi pi-plus" data-testid="reason-create" @click="openDialog(null)" />
    </div>
    <p class="muted small">
      Staff pick one of these reasons (plus a comment) in the cancel, void, refund, petty cash and discount
      dialogs. Reasons are never deleted, only switched off.
    </p>

    <div class="tabs" role="tablist" aria-label="Reason lists">
      <button
        v-for="c in REASON_CATEGORIES"
        :key="c"
        type="button"
        role="tab"
        class="tab"
        :class="{ active: c === category }"
        :aria-selected="c === category"
        :data-testid="`reason-tab-${c}`"
        @click="category = c"
      >
        {{ REASON_CATEGORY_LABEL[c] }} <span class="count">{{ counts[c] }}</span>
      </button>
    </div>

    <div class="table-wrap">
      <table class="rtable" data-testid="reasons-table" :aria-busy="loader.busy.value">
        <thead>
          <tr>
            <th>Reason</th>
            <th>Status</th>
            <th class="sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in reasons"
            :key="r.id"
            :class="{ inactive: !r.active }"
            :data-testid="`reason-row-${r.text}`"
          >
            <td data-label="Reason">{{ r.text }}</td>
            <td data-label="Status">
              <span class="chip" :class="r.active ? 'chip-ok' : 'chip-muted'">{{
                r.active ? 'Active' : 'Inactive'
              }}</span>
            </td>
            <td data-label="" class="no-label">
              <div class="actions">
                <Button
                  label="Edit"
                  icon="pi pi-pencil"
                  size="small"
                  outlined
                  :data-testid="`reason-edit-${r.text}`"
                  @click="openDialog(r)"
                />
                <Button
                  :label="r.active ? 'Switch off' : 'Switch on'"
                  size="small"
                  text
                  :severity="r.active ? 'danger' : undefined"
                  :loading="toggling === r.id"
                  :data-testid="`reason-toggle-${r.text}`"
                  @click="toggleActive(r)"
                />
              </div>
            </td>
          </tr>
          <tr v-if="!reasons.length && !loader.busy.value">
            <td colspan="3" class="no-label empty">No reasons in this list yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Dialog
      v-model:visible="open"
      modal
      :header="editing ? 'Edit reason' : `Add reason - ${REASON_CATEGORY_LABEL[category]}`"
      :draggable="false"
      :closable="!saver.busy.value"
      :style="{ width: 'min(480px, calc(100vw - 24px))' }"
      data-testid="reason-dialog"
    >
      <form class="stack" novalidate @submit.prevent="save">
        <VersionConflictBanner v-if="conflict" @reload="reloadAndClose" />
        <FormField label="Reason" for="reason-text" name="text" :error="errors.text">
          <InputText id="reason-text" v-model="text" maxlength="200" data-testid="reason-text" />
        </FormField>
        <label class="switch">
          <ToggleSwitch v-model="active" input-id="reason-active" data-testid="reason-active" />
          <span>Active</span>
        </label>
        <p v-if="general" class="field-error" role="alert" data-testid="reason-error">{{ general }}</p>
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
            :label="editing ? 'Save' : 'Add reason'"
            :loading="saver.busy.value"
            :disabled="saver.busy.value || conflict"
            data-testid="reason-save"
          />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tab {
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--rms-border);
  border-radius: 8px;
  background: #fff;
  font: inherit;
  cursor: pointer;
  color: inherit;
}

.tab.active {
  background: var(--rms-primary-soft);
  border-color: var(--rms-primary);
  color: var(--rms-primary);
  font-weight: 700;
}

.count {
  display: inline-block;
  min-width: 20px;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 999px;
  background: #eef1f4;
  font-size: 0.78rem;
  text-align: center;
}

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
