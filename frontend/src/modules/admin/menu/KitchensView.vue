<script setup lang="ts">
/** /admin/kitchens - the 3 kitchen stations: names and target preparation time (P1-MENU-07, P1-SET-05). */
import { computed, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import ToggleSwitch from 'primevue/toggleswitch'
import FormField from '@/components/FormField.vue'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { menuApi } from '@/api/menu'
import { isApiError } from '@/api/errors'
import type { KitchenStation } from '@/api/types'
import { useNotify } from '@/composables/useNotify'

interface Draft {
  name: string
  target: string
  active: boolean
}

const notify = useNotify()
const stations = ref<KitchenStation[]>([])
const drafts = ref<Record<string, Draft>>({})
const errors = ref<Record<string, Record<string, string>>>({})
const general = ref<Record<string, string>>({})
const conflict = ref<Record<string, boolean>>({})
const saving = ref<string | null>(null)
const loading = ref(false)

function toDraft(s: KitchenStation): Draft {
  return { name: s.name, target: String(s.targetPrepMinutes), active: s.active }
}

async function load() {
  loading.value = true
  try {
    stations.value = await menuApi.listStations()
    drafts.value = Object.fromEntries(stations.value.map((s) => [s.id, toDraft(s)]))
    errors.value = {}
    general.value = {}
    conflict.value = {}
  } catch (e) {
    notify.error(e, 'Could not load kitchen stations')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const dirty = (s: KitchenStation) => JSON.stringify(drafts.value[s.id]) !== JSON.stringify(toDraft(s))
const anyDirty = computed(() => stations.value.some(dirty))

async function save(s: KitchenStation) {
  const d = drafts.value[s.id]
  if (!d || saving.value) return
  const e: Record<string, string> = {}
  if (!d.name.trim()) e.name = 'Enter the station name.'
  const minutes = /^\d{1,3}$/.test(d.target.trim()) ? Number(d.target) : NaN
  if (!(minutes >= 1 && minutes <= 240)) e.targetPrepMinutes = 'Enter whole minutes from 1 to 240.'
  errors.value = { ...errors.value, [s.id]: e }
  general.value = { ...general.value, [s.id]: '' }
  if (Object.keys(e).length) return
  saving.value = s.id
  try {
    const saved = await menuApi.updateStation(s.id, {
      name: d.name.trim(),
      targetPrepMinutes: minutes,
      active: d.active,
      version: s.version,
    })
    stations.value = stations.value.map((x) => (x.id === s.id ? saved : x))
    drafts.value = { ...drafts.value, [s.id]: toDraft(saved) }
    notify.success('Station saved', saved.name)
  } catch (err) {
    if (isApiError(err)) {
      errors.value = { ...errors.value, [s.id]: err.fieldErrorMap }
      conflict.value = { ...conflict.value, [s.id]: err.isVersionConflict }
      if (!err.fieldErrors.length && !err.isVersionConflict)
        general.value = { ...general.value, [s.id]: err.userMessage }
    }
  } finally {
    saving.value = null
  }
}

function revert(s: KitchenStation) {
  drafts.value = { ...drafts.value, [s.id]: toDraft(s) }
  errors.value = { ...errors.value, [s.id]: {} }
}
</script>

<template>
  <div class="page" :aria-busy="loading">
    <div class="page-header">
      <h1>Kitchen stations</h1>
      <span class="muted small"
        >Names and target preparation time. The kitchen screen turns a ticket red past the target.</span
      >
    </div>

    <section v-for="s in stations" :key="s.id" class="card station" :data-testid="`station-${s.number}`">
      <VersionConflictBanner v-if="conflict[s.id]" @reload="load" />
      <div class="head">
        <h2>Kitchen {{ s.number }}</h2>
        <span class="chip" :class="s.active ? 'chip-ok' : 'chip-muted'">{{
          s.active ? 'Active' : 'Inactive'
        }}</span>
        <span class="muted small"
          >{{ s.activeItemCount }} active item{{ s.activeItemCount === 1 ? '' : 's' }}</span
        >
      </div>
      <div v-if="drafts[s.id]" class="form-grid">
        <FormField label="Name" :for="`station-name-${s.number}`" name="name" :error="errors[s.id]?.name">
          <input
            :id="`station-name-${s.number}`"
            v-model="drafts[s.id]!.name"
            class="native-input"
            maxlength="50"
            :data-testid="`station-name-${s.number}`"
          />
        </FormField>
        <FormField
          label="Target preparation time (minutes)"
          :for="`station-target-${s.number}`"
          name="targetPrepMinutes"
          :error="errors[s.id]?.targetPrepMinutes"
        >
          <input
            :id="`station-target-${s.number}`"
            v-model="drafts[s.id]!.target"
            class="native-input"
            inputmode="numeric"
            :data-testid="`set-station-target-${s.number}`"
          />
        </FormField>
        <div class="field">
          <span class="label">Active</span>
          <label class="switch">
            <ToggleSwitch
              v-model="drafts[s.id]!.active"
              :input-id="`station-active-${s.number}`"
              :data-testid="`station-active-${s.number}`"
            />
            <span>{{ drafts[s.id]!.active ? 'On' : 'Off' }}</span>
          </label>
          <span class="hint">A station with active menu items cannot be switched off.</span>
        </div>
      </div>
      <p v-if="general[s.id]" class="field-error" role="alert" :data-testid="`station-error-${s.number}`">
        {{ general[s.id] }}
      </p>
      <div class="actions">
        <Button
          label="Discard"
          text
          severity="secondary"
          :disabled="!dirty(s) || saving === s.id"
          @click="revert(s)"
        />
        <Button
          label="Save"
          icon="pi pi-check"
          :loading="saving === s.id"
          :disabled="!dirty(s) || saving === s.id"
          :data-testid="`station-save-${s.number}`"
          @click="save(s)"
        />
      </div>
    </section>
    <p v-if="!stations.length && !loading" class="muted">No stations.</p>
    <p v-if="anyDirty" class="muted small" data-testid="stations-dirty">
      Unsaved changes: press Save on the station you changed.
    </p>
  </div>
</template>

<style scoped>
.station {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 900px;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.head h2 {
  font-size: 1.1rem;
}

.switch {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
