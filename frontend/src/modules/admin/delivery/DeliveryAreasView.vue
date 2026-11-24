<script setup lang="ts">
/** /admin/delivery-areas - delivery areas with a fee, never deleted (P1-SET-07). */
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import FormField from '@/components/FormField.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { settingsApi } from '@/api/settings'
import type { DeliveryArea } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'
import { formatMoney } from '@/utils/money'

const notify = useNotify()
const areas = ref<DeliveryArea[]>([])
const loader = useAction(async () => {
  areas.value = await settingsApi.listDeliveryAreas()
})
const load = () => loader.run().catch((e) => notify.error(e, 'Could not load delivery areas'))
onMounted(load)

const open = ref(false)
const editing = ref<DeliveryArea | null>(null)
const name = ref('')
const fee = ref<string | null>(null)
const feeInvalid = ref(false)
const active = ref(true)
const touched = ref(false)

const saver = useAction(async () => {
  const body = { name: name.value.trim(), fee: fee.value as string, active: active.value }
  return editing.value
    ? settingsApi.updateDeliveryArea(editing.value.id, { ...body, version: editing.value.version })
    : settingsApi.createDeliveryArea(body)
})

function openDialog(a: DeliveryArea | null) {
  editing.value = a
  name.value = a?.name ?? ''
  fee.value = a?.fee ?? null
  feeInvalid.value = false
  active.value = a?.active ?? true
  touched.value = false
  saver.reset()
  open.value = true
}

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (touched.value) {
    if (!name.value.trim()) e.name ??= 'Enter the area name.'
    if (fee.value === null || feeInvalid.value) e.fee ??= 'Enter the delivery fee (0.00 for free delivery).'
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
      notify.success(editing.value ? 'Area saved' : 'Area created', saved.name)
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
async function toggleActive(a: DeliveryArea) {
  toggling.value = a.id
  try {
    const saved = await settingsApi.updateDeliveryArea(a.id, {
      name: a.name,
      fee: a.fee,
      active: !a.active,
      version: a.version,
    })
    notify.success(saved.active ? 'Area activated' : 'Area deactivated', saved.name)
  } catch (e) {
    notify.error(e, 'Could not change the area')
  } finally {
    toggling.value = null
    await load()
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Delivery areas</h1>
      <Button label="New area" icon="pi pi-plus" data-testid="area-create" @click="openDialog(null)" />
    </div>
    <p class="muted small">
      The fee is added as a bill line on delivery orders. Areas are never deleted, only deactivated.
    </p>

    <div class="table-wrap">
      <table class="rtable" data-testid="areas-table" :aria-busy="loader.busy.value">
        <thead>
          <tr>
            <th>Area</th>
            <th>Fee</th>
            <th>Status</th>
            <th class="sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in areas"
            :key="a.id"
            :class="{ inactive: !a.active }"
            :data-testid="`area-row-${a.name}`"
          >
            <td data-label="Area">
              <strong>{{ a.name }}</strong>
            </td>
            <td data-label="Fee" class="money">{{ formatMoney(a.fee) }}</td>
            <td data-label="Status">
              <span class="chip" :class="a.active ? 'chip-ok' : 'chip-muted'">{{
                a.active ? 'Active' : 'Inactive'
              }}</span>
            </td>
            <td data-label="" class="no-label">
              <div class="actions">
                <Button
                  label="Edit"
                  icon="pi pi-pencil"
                  size="small"
                  outlined
                  :data-testid="`area-edit-${a.name}`"
                  @click="openDialog(a)"
                />
                <Button
                  :label="a.active ? 'Deactivate' : 'Activate'"
                  :icon="a.active ? 'pi pi-ban' : 'pi pi-check'"
                  size="small"
                  text
                  :severity="a.active ? 'danger' : undefined"
                  :loading="toggling === a.id"
                  :data-testid="`area-toggle-${a.name}`"
                  @click="toggleActive(a)"
                />
              </div>
            </td>
          </tr>
          <tr v-if="!areas.length && !loader.busy.value">
            <td colspan="4" class="no-label empty">No delivery areas yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Dialog
      v-model:visible="open"
      modal
      :header="editing ? `Edit ${editing.name}` : 'New delivery area'"
      :draggable="false"
      :closable="!saver.busy.value"
      :style="{ width: 'min(440px, calc(100vw - 24px))' }"
      data-testid="area-dialog"
    >
      <form class="stack" novalidate @submit.prevent="save">
        <VersionConflictBanner v-if="conflict" @reload="reloadAndClose" />
        <FormField label="Area name" for="area-name" name="name" :error="errors.name">
          <InputText id="area-name" v-model="name" maxlength="100" data-testid="area-name" />
        </FormField>
        <FormField label="Delivery fee" for="area-fee" name="fee">
          <MoneyInput
            id="area-fee"
            v-model="fee"
            :error="errors.fee"
            data-testid="area-fee"
            @invalid="feeInvalid = $event"
          />
        </FormField>
        <label class="switch">
          <ToggleSwitch v-model="active" input-id="area-active" data-testid="area-active" />
          <span>Active</span>
        </label>
        <p v-if="general" class="field-error" role="alert" data-testid="area-error">{{ general }}</p>
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
            :label="editing ? 'Save' : 'Create area'"
            :loading="saver.busy.value"
            :disabled="saver.busy.value || conflict"
            data-testid="area-save"
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

.money {
  font-variant-numeric: tabular-nums;
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
