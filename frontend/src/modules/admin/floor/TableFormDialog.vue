<script setup lang="ts">
/** Create / edit a table's details (position is arranged on the canvas). Tables are never deleted. */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import FormField from '@/components/FormField.vue'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { floorApi } from '@/api/floor'
import type { DiningTable } from '@/api/types'
import { useAction } from '@/composables/useAction'

const props = defineProps<{ visible: boolean; table: DiningTable | null; sections: string[] }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [t: DiningTable]; reload: [] }>()

const number = ref('')
const section = ref('')
const seats = ref('4')
const active = ref(true)
const touched = ref(false)
const isCreate = computed(() => props.table === null)

const saver = useAction(async () => {
  const body = {
    number: number.value.trim(),
    section: section.value.trim(),
    seats: Number(seats.value),
    active: active.value,
  }
  return props.table
    ? floorApi.updateTable(props.table.id, { ...body, version: props.table.version })
    : floorApi.createTable(body)
})

watch(
  () => props.visible,
  (open) => {
    if (!open) return
    touched.value = false
    saver.reset()
    number.value = props.table?.number ?? ''
    section.value = props.table?.section ?? props.sections[0] ?? ''
    seats.value = String(props.table?.seats ?? 4)
    active.value = props.table?.active ?? true
  },
)

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (touched.value) {
    if (!/^[A-Za-z0-9-]{1,10}$/.test(number.value.trim()))
      e.number ??= 'Table number is 1 to 10 letters, digits or dashes.'
    if (!section.value.trim()) e.section ??= 'Enter the section, e.g. Indoor.'
    if (!/^\d{1,2}$/.test(seats.value) || Number(seats.value) < 1 || Number(seats.value) > 50)
      e.seats ??= 'Seats is a whole number from 1 to 50.'
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
      emit('saved', saved)
      emit('update:visible', false)
    }
  } catch {
    /* inline */
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="isCreate ? 'New table' : `Edit table ${table?.number}`"
    :draggable="false"
    :closable="!saver.busy.value"
    :style="{ width: 'min(440px, calc(100vw - 24px))' }"
    data-testid="table-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <form class="stack" novalidate @submit.prevent="save">
      <VersionConflictBanner v-if="conflict" @reload="(emit('reload'), emit('update:visible', false))" />
      <FormField label="Table number" for="table-number" name="number" :error="errors.number">
        <InputText id="table-number" v-model="number" maxlength="10" data-testid="table-number" />
      </FormField>
      <FormField label="Section" for="table-section" name="section" :error="errors.section">
        <input
          id="table-section"
          v-model="section"
          list="table-sections"
          maxlength="30"
          class="native-input"
          data-testid="table-section"
        />
        <datalist id="table-sections">
          <option v-for="s in sections" :key="s" :value="s" />
        </datalist>
      </FormField>
      <FormField label="Seats" for="table-seats" name="seats" :error="errors.seats">
        <InputText id="table-seats" v-model="seats" inputmode="numeric" data-testid="table-seats" />
      </FormField>
      <label class="switch">
        <ToggleSwitch v-model="active" input-id="table-active" data-testid="table-active" />
        <span>Active (shown on the floor plan)</span>
      </label>
      <p v-if="general" class="field-error" role="alert" data-testid="table-error">{{ general }}</p>
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
          :label="isCreate ? 'Create table' : 'Save'"
          :loading="saver.busy.value"
          :disabled="saver.busy.value || conflict"
          data-testid="table-save"
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

.switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
