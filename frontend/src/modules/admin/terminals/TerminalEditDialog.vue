<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { floorApi } from '@/api/floor'
import { menuApi } from '@/api/menu'
import { terminalsApi } from '@/api/terminals'
import {
  TERMINAL_TYPE_LABEL,
  TERMINAL_TYPES,
  type KitchenStationOption,
  type OrderingPoint,
  type Terminal,
  type TerminalType,
} from '@/api/types'
import { useAction } from '@/composables/useAction'
import { formatDateTime } from '@/utils/time'

const props = defineProps<{ visible: boolean; terminalId: string | null }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [t: Terminal] }>()

const terminal = ref<Terminal | null>(null)
const name = ref('')
const type = ref<TerminalType>('CASHIER_POS')
const stationId = ref<string | null>(null)
const orderingPointId = ref<string | null>(null)
const stations = ref<KitchenStationOption[]>([])
const orderingPoints = ref<OrderingPoint[]>([])
const touched = ref(false)
const typeOptions = TERMINAL_TYPES.map((t) => ({ value: t, label: TERMINAL_TYPE_LABEL[t] }))

// Station options need TERMINAL_MANAGE (GET /kitchen-stations/options), as does this screen.
onMounted(async () => {
  try {
    ;[stations.value, orderingPoints.value] = await Promise.all([
      menuApi.stationOptions(),
      floorApi.orderingPoints(),
    ])
  } catch {
    /* the selects stay empty; saving still works for terminals that keep their current ones */
  }
})

const loader = useAction(async (id: string) => {
  const t = await terminalsApi.get(id)
  terminal.value = t
  name.value = t.name
  type.value = t.type
  stationId.value = t.kitchenStationId ?? null
  orderingPointId.value = t.orderingPointId ?? null
})

/** True from opening an existing record until it has loaded: the form is disabled so nothing typed early is overwritten. */
const loading = computed(() => props.terminalId !== null && !terminal.value && !loader.error.value)

const saver = useAction(() => {
  const t = terminal.value as Terminal
  const isPos = type.value === 'CASHIER_POS' || type.value === 'RECEPTION_POS'
  return terminalsApi.update(t.id, {
    name: name.value.trim(),
    type: type.value,
    version: t.version,
    ...(type.value === 'KITCHEN' && stationId.value ? { kitchenStationId: stationId.value } : {}),
    ...(isPos && orderingPointId.value ? { orderingPointId: orderingPointId.value } : {}),
  })
})

watch(
  () => props.visible,
  async (open) => {
    if (!open || !props.terminalId) return
    touched.value = false
    saver.reset()
    terminal.value = null
    await loader.run(props.terminalId).catch(() => undefined)
  },
)

/** Active stations, plus the terminal's own (it may have been deactivated since). */
const stationOptions = computed(() => {
  const list = [...stations.value]
  const t = terminal.value
  if (t?.kitchenStationId && !list.some((s) => s.id === t.kitchenStationId)) {
    list.push({ id: t.kitchenStationId, number: 0, name: t.kitchenStationName ?? 'Current station' })
  }
  return list
})
const isPosType = computed(() => type.value === 'CASHIER_POS' || type.value === 'RECEPTION_POS')

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (touched.value) {
    if (!name.value.trim()) e.name ??= 'Enter a name.'
    if (type.value === 'KITCHEN' && !stationId.value) e.kitchenStationId ??= 'Choose the kitchen station.'
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
    const t = await saver.run()
    if (t) {
      emit('saved', t)
      emit('update:visible', false)
    }
  } catch {
    /* inline */
  }
}

async function reload() {
  if (!props.terminalId) return
  saver.reset()
  await loader.run(props.terminalId).catch(() => undefined)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="`Edit ${terminal?.name ?? 'terminal'}`"
    :draggable="false"
    :closable="!saver.busy.value"
    :style="{ width: 'min(480px, calc(100vw - 24px))' }"
    data-testid="terminal-edit-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <form class="stack" novalidate @submit.prevent="save">
      <VersionConflictBanner v-if="conflict" :busy="loader.busy.value" @reload="reload" />
      <fieldset class="plain stack" :disabled="loading">
        <div class="field">
          <label for="terminal-edit-name">Name</label>
          <InputText id="terminal-edit-name" v-model="name" maxlength="50" data-testid="terminal-edit-name" />
          <p v-if="errors.name" class="field-error" data-testid="field-error-name">{{ errors.name }}</p>
        </div>
        <div class="field">
          <label for="terminal-edit-type">Type</label>
          <Select
            v-model="type"
            input-id="terminal-edit-type"
            :options="typeOptions"
            option-label="label"
            option-value="value"
            data-testid="terminal-edit-type"
          />
        </div>
        <div v-if="type === 'KITCHEN'" class="field">
          <label for="terminal-edit-station">Kitchen station</label>
          <Select
            v-model="stationId"
            input-id="terminal-edit-station"
            :options="stationOptions"
            option-label="name"
            option-value="id"
            placeholder="Choose..."
            data-testid="terminal-edit-station"
          />
          <p v-if="errors.kitchenStationId" class="field-error" data-testid="field-error-kitchenStationId">
            {{ errors.kitchenStationId }}
          </p>
        </div>
        <div v-if="isPosType" class="field">
          <label for="terminal-edit-ordering-point">Ordering point (optional)</label>
          <Select
            v-model="orderingPointId"
            input-id="terminal-edit-ordering-point"
            :options="orderingPoints"
            option-label="name"
            option-value="id"
            placeholder="None"
            show-clear
            data-testid="terminal-edit-ordering-point"
          />
          <p v-if="errors.orderingPointId" class="field-error" data-testid="field-error-orderingPointId">
            {{ errors.orderingPointId }}
          </p>
        </div>
        <p v-if="terminal" class="muted small">
          Registered {{ formatDateTime(terminal.createdAt) }}. The device keeps its token after edits.
        </p>
        <p v-if="generalError" class="field-error" role="alert" data-testid="terminal-edit-error">
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
          label="Save"
          :loading="saver.busy.value"
          :disabled="saver.busy.value || loader.busy.value || conflict"
          data-testid="terminal-edit-save"
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
.stack p {
  margin: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
