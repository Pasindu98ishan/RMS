<script setup lang="ts">
/** Create / edit a modifier group and its options (P1-MENU-03). Options are replaced as a list keyed by id. */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import FormField from '@/components/FormField.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { menuApi } from '@/api/menu'
import type { ModifierGroup } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { moveItem } from './itemForm'

interface OptionRow {
  key: number
  id?: string
  name: string
  priceDelta: string | null
  invalid: boolean
}

const props = defineProps<{ visible: boolean; group: ModifierGroup | null }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [group: ModifierGroup]; reload: [] }>()

let keySeq = 0
const name = ref('')
const required = ref(false)
const minSelect = ref('0')
const maxSelect = ref('1')
const active = ref(true)
const options = ref<OptionRow[]>([])
const touched = ref(false)

const isCreate = computed(() => props.group === null)

const saver = useAction(async () => {
  const body = {
    name: name.value.trim(),
    required: required.value,
    minSelect: Number(minSelect.value),
    maxSelect: Number(maxSelect.value),
    active: active.value,
    options: options.value.map((o) => ({
      ...(o.id ? { id: o.id } : {}),
      name: o.name.trim(),
      priceDelta: o.priceDelta as string,
    })),
  }
  return props.group
    ? menuApi.updateModifierGroup(props.group.id, { ...body, version: props.group.version })
    : menuApi.createModifierGroup(body)
})

function newRow(o?: { id?: string; name: string; priceDelta: string }): OptionRow {
  return {
    key: ++keySeq,
    ...(o?.id ? { id: o.id } : {}),
    name: o?.name ?? '',
    priceDelta: o?.priceDelta ?? '0.00',
    invalid: false,
  }
}

watch(
  () => props.visible,
  (open) => {
    if (!open) return
    touched.value = false
    saver.reset()
    const g = props.group
    name.value = g?.name ?? ''
    required.value = g?.required ?? false
    minSelect.value = String(g?.minSelect ?? 0)
    maxSelect.value = String(g?.maxSelect ?? 1)
    active.value = g?.active ?? true
    options.value = g ? g.options.map(newRow) : [newRow(), newRow()]
  },
)

watch(required, (r) => {
  // Keep the pair consistent: required needs at least 1, optional is 0 (server rule).
  if (r && Number(minSelect.value) < 1) minSelect.value = '1'
  if (!r) minSelect.value = '0'
  if (Number(maxSelect.value) < Number(minSelect.value)) maxSelect.value = minSelect.value
})

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (!touched.value) return e
  const min = Number(minSelect.value)
  const max = Number(maxSelect.value)
  if (!name.value.trim()) e.name ??= 'Enter the group name.'
  if (options.value.length === 0) e.options ??= 'Add at least one option.'
  options.value.forEach((o, i) => {
    if (!o.name.trim()) e[`options[${i}].name`] ??= 'Enter the option name.'
    if (o.priceDelta === null || o.invalid)
      e[`options[${i}].priceDelta`] ??= 'Enter the extra price (0.00 for none).'
  })
  if (!/^\d{1,2}$/.test(minSelect.value)) e.minSelect ??= 'Whole number, 0 or more.'
  else if (required.value && min < 1) e.minSelect ??= 'A required group needs a minimum of at least 1.'
  if (!/^\d{1,2}$/.test(maxSelect.value) || max < 1) e.maxSelect ??= 'Maximum is at least 1.'
  else if (max < min) e.maxSelect ??= 'Maximum cannot be less than the minimum.'
  else if (options.value.length && max > options.value.length)
    e.maxSelect ??= 'Maximum cannot be more than the number of options.'
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
    :header="isCreate ? 'New modifier group' : `Edit ${group?.name}`"
    :draggable="false"
    :closable="!saver.busy.value"
    :style="{ width: 'min(640px, calc(100vw - 24px))' }"
    data-testid="modifier-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <form class="stack" novalidate @submit.prevent="save">
      <VersionConflictBanner v-if="conflict" @reload="(emit('reload'), emit('update:visible', false))" />
      <FormField label="Group name" for="mod-name" name="name" :error="errors.name">
        <InputText
          id="mod-name"
          v-model="name"
          maxlength="50"
          placeholder="Spice level"
          data-testid="mod-name"
        />
      </FormField>

      <div class="rules">
        <label class="switch">
          <ToggleSwitch v-model="required" input-id="mod-required" data-testid="mod-required" />
          <span>Required (the item cannot be ordered without choosing)</span>
        </label>
        <div class="minmax">
          <FormField label="Choose at least" for="mod-min" name="minSelect" :error="errors.minSelect">
            <InputText
              id="mod-min"
              v-model="minSelect"
              inputmode="numeric"
              :disabled="!required"
              data-testid="mod-min"
            />
          </FormField>
          <FormField label="Choose at most" for="mod-max" name="maxSelect" :error="errors.maxSelect">
            <InputText id="mod-max" v-model="maxSelect" inputmode="numeric" data-testid="mod-max" />
          </FormField>
        </div>
        <label class="switch">
          <ToggleSwitch v-model="active" input-id="mod-active" data-testid="mod-active" />
          <span>Active</span>
        </label>
      </div>

      <fieldset class="options">
        <legend>Options</legend>
        <p v-if="errors.options" class="field-error" data-testid="field-error-options">
          {{ errors.options }}
        </p>
        <div v-for="(o, i) in options" :key="o.key" class="option-row" :data-testid="`mod-option-${i}`">
          <div class="option-name">
            <InputText
              v-model="o.name"
              maxlength="50"
              placeholder="Option name"
              :aria-label="`Option ${i + 1} name`"
              :data-testid="`mod-option-name-${i}`"
            />
            <p
              v-if="errors[`options[${i}].name`]"
              class="field-error"
              :data-testid="`field-error-options[${i}].name`"
            >
              {{ errors[`options[${i}].name`] }}
            </p>
          </div>
          <div class="option-price">
            <MoneyInput
              v-model="o.priceDelta"
              :aria-label="`Option ${i + 1} extra price`"
              :error="errors[`options[${i}].priceDelta`]"
              :data-testid="`mod-option-price-${i}`"
              @invalid="o.invalid = $event"
            />
          </div>
          <div class="option-actions">
            <Button
              icon="pi pi-arrow-up"
              text
              rounded
              size="small"
              aria-label="Move up"
              :disabled="i === 0"
              :data-testid="`mod-option-up-${i}`"
              @click="options = moveItem(options, i, -1)"
            />
            <Button
              icon="pi pi-arrow-down"
              text
              rounded
              size="small"
              aria-label="Move down"
              :disabled="i === options.length - 1"
              :data-testid="`mod-option-down-${i}`"
              @click="options = moveItem(options, i, 1)"
            />
            <Button
              icon="pi pi-times"
              text
              rounded
              size="small"
              severity="danger"
              aria-label="Remove option"
              :data-testid="`mod-option-remove-${i}`"
              @click="options = options.filter((x) => x.key !== o.key)"
            />
          </div>
        </div>
        <Button
          label="Add option"
          icon="pi pi-plus"
          size="small"
          outlined
          data-testid="mod-option-add"
          @click="options = [...options, newRow()]"
        />
      </fieldset>

      <p v-if="general" class="field-error" role="alert" data-testid="mod-error">{{ general }}</p>
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
          :label="isCreate ? 'Create group' : 'Save'"
          :loading="saver.busy.value"
          :disabled="saver.busy.value || conflict"
          data-testid="mod-save"
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

.rules {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.minmax {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.options {
  border: 1px solid var(--rms-border);
  border-radius: 10px;
  padding: 8px 12px 12px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.options legend {
  font-weight: 700;
  padding: 0 6px;
}

.option-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.option-row p {
  margin: 2px 0 0;
}

.option-actions {
  display: flex;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 520px) {
  .option-row {
    grid-template-columns: 1fr 1fr;
  }

  .option-actions {
    grid-column: 1 / -1;
  }
}
</style>
