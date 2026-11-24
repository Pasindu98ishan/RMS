<script setup lang="ts">
/** /admin/terminals - registered devices (P1-AUTH-04). */
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import Button from 'primevue/button'
import TerminalEditDialog from './TerminalEditDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { terminalsApi } from '@/api/terminals'
import { TERMINAL_TYPE_LABEL, TERMINAL_TYPES, type TerminalSummary, type TerminalType } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'
import { useTerminalStore } from '@/stores/terminal'

const notify = useNotify()
const terminalStore = useTerminalStore()

const active = ref<'all' | 'true' | 'false'>('all')
const type = ref<TerminalType | ''>('')
const terminals = ref<TerminalSummary[]>([])

const loader = useAction(async () => {
  terminals.value = await terminalsApi.list({
    ...(active.value !== 'all' ? { active: active.value === 'true' } : {}),
    ...(type.value ? { type: type.value } : {}),
  })
})
const load = () => loader.run().catch((e) => notify.error(e, 'Could not load terminals'))
onMounted(load)
watch([active, type], load)

const editOpen = ref(false)
const editId = ref<string | null>(null)
function openEdit(t: TerminalSummary) {
  editId.value = t.id
  editOpen.value = true
}

const confirmOpen = ref(false)
const target = ref<TerminalSummary | null>(null)
const deactivator = useAction(() => terminalsApi.deactivate((target.value as TerminalSummary).id))
function openDeactivate(t: TerminalSummary) {
  target.value = t
  deactivator.reset()
  confirmOpen.value = true
}
async function deactivate() {
  try {
    const t = await deactivator.run()
    if (t) {
      confirmOpen.value = false
      notify.success('Terminal deactivated', t.name)
      await load()
    }
  } catch {
    /* in dialog */
  }
}

const isThisDevice = (t: TerminalSummary) => t.id === terminalStore.terminalId
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Terminals</h1>
      <span class="muted small">
        New devices are registered on the device itself at
        <RouterLink to="/setup/terminal">Terminal setup</RouterLink>.
      </span>
    </div>

    <div class="card toolbar">
      <div class="field">
        <label for="terminals-filter-active">Status</label>
        <select
          id="terminals-filter-active"
          v-model="active"
          class="native-select"
          data-testid="terminals-filter-active"
        >
          <option value="all">All</option>
          <option value="true">Active</option>
          <option value="false">Deactivated</option>
        </select>
      </div>
      <div class="field">
        <label for="terminals-filter-type">Type</label>
        <select
          id="terminals-filter-type"
          v-model="type"
          class="native-select"
          data-testid="terminals-filter-type"
        >
          <option value="">All types</option>
          <option v-for="t in TERMINAL_TYPES" :key="t" :value="t">{{ TERMINAL_TYPE_LABEL[t] }}</option>
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table class="rtable" data-testid="terminals-table" :aria-busy="loader.busy.value">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th class="sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in terminals"
            :key="t.id"
            :class="{ inactive: !t.active }"
            :data-testid="`terminal-row-${t.name}`"
          >
            <td data-label="Name">
              <strong>{{ t.name }}</strong>
              <span v-if="isThisDevice(t)" class="chip chip-info this">This device</span>
            </td>
            <td data-label="Type">
              {{ TERMINAL_TYPE_LABEL[t.type] }}
              <span v-if="t.kitchenStationName" class="muted small"> - {{ t.kitchenStationName }}</span>
              <span v-if="t.orderingPointName" class="muted small"> - {{ t.orderingPointName }}</span>
            </td>
            <td data-label="Status">
              <span
                class="chip"
                :class="t.active ? 'chip-ok' : 'chip-muted'"
                :data-testid="`terminal-status-${t.name}`"
              >
                {{ t.active ? 'Active' : 'Deactivated' }}
              </span>
            </td>
            <td data-label="" class="no-label">
              <div class="actions">
                <Button
                  v-if="t.active"
                  label="Edit"
                  icon="pi pi-pencil"
                  size="small"
                  outlined
                  :data-testid="`terminal-edit-${t.name}`"
                  @click="openEdit(t)"
                />
                <Button
                  v-if="t.active"
                  label="Deactivate"
                  icon="pi pi-ban"
                  size="small"
                  text
                  severity="danger"
                  :data-testid="`terminal-deactivate-${t.name}`"
                  @click="openDeactivate(t)"
                />
              </div>
            </td>
          </tr>
          <tr v-if="!terminals.length && !loader.busy.value">
            <td colspan="4" class="no-label empty">No terminals match these filters.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <TerminalEditDialog
      v-model:visible="editOpen"
      :terminal-id="editId"
      @saved="(t) => (notify.success('Terminal saved', t.name), load())"
    />
    <ConfirmDialog
      v-model:visible="confirmOpen"
      :title="`Deactivate ${target?.name}?`"
      confirm-label="Deactivate"
      danger
      :busy="deactivator.busy.value"
      :error="deactivator.error.value?.userMessage"
      @confirm="deactivate"
    >
      <p>
        The device's token stops working and everyone on it is logged out within 15 minutes. There is no
        reactivation: the device must be registered again.
      </p>
      <p v-if="target && isThisDevice(target)" class="banner banner-warn">
        This is the device you are using now. You will be logged out and must register it again.
      </p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.this {
  margin-left: 6px;
}

.empty {
  text-align: center;
  color: var(--rms-muted);
  padding: 24px;
}
</style>
