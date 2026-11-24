<script setup lang="ts">
/**
 * Create / edit a menu item (P1-MENU-02): code, name, category, exactly one station, local price,
 * optional foreign price, active flag and the ordered modifier groups, all in one request.
 */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import FormField from '@/components/FormField.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import VersionConflictBanner from '@/components/VersionConflictBanner.vue'
import { menuApi } from '@/api/menu'
import type { Category, KitchenStation, MenuItem, ModifierGroup } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { buildItemBody, moveItem } from './itemForm'

const props = defineProps<{
  visible: boolean
  /** null = create */
  itemId: string | null
  categories: Category[]
  stations: KitchenStation[]
  groups: ModifierGroup[]
}>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [item: MenuItem] }>()

const isCreate = computed(() => props.itemId === null)
const item = ref<MenuItem | null>(null)
const code = ref('')
const name = ref('')
const categoryId = ref('')
const stationId = ref('')
const localPrice = ref<string | null>(null)
const localInvalid = ref(false)
const foreignPrice = ref<string | null>(null)
const foreignInvalid = ref(false)
const active = ref(true)
const groupIds = ref<string[]>([])
const addGroupId = ref('')
const touched = ref(false)

/** Set when the user types or picks anything; a load that finishes later must not overwrite it. */
let userEdited = false

const loader = useAction(async (id: string) => {
  const i = await menuApi.getItem(id)
  item.value = i // always: the save needs its id and version
  if (userEdited) return
  code.value = i.code
  name.value = i.name
  categoryId.value = i.categoryId
  stationId.value = i.stationId
  localPrice.value = i.localPrice
  foreignPrice.value = i.foreignPrice ?? null
  active.value = i.active
  groupIds.value = i.modifierGroups.map((g) => g.id)
})

/** True from opening an existing record until it has loaded: the form is disabled so nothing typed early is overwritten. */
const loading = computed(() => props.itemId !== null && !item.value && !loader.error.value)

const saver = useAction(async () => {
  const form = {
    code: code.value,
    name: name.value,
    categoryId: categoryId.value,
    stationId: stationId.value,
    localPrice: localPrice.value as string,
    foreignPrice: foreignPrice.value,
    active: active.value,
    modifierGroupIds: groupIds.value,
  }
  const body = buildItemBody(form)
  return item.value
    ? menuApi.updateItem(item.value.id, { ...body, version: item.value.version })
    : menuApi.createItem(body)
})

watch(
  () => props.visible,
  async (open) => {
    if (!open) return
    userEdited = false
    touched.value = false
    saver.reset()
    item.value = null
    code.value = name.value = categoryId.value = stationId.value = addGroupId.value = ''
    localPrice.value = foreignPrice.value = null
    localInvalid.value = foreignInvalid.value = false
    active.value = true
    groupIds.value = []
    if (props.itemId) await loader.run(props.itemId).catch(() => undefined)
  },
)

const groupName = (id: string) => props.groups.find((g) => g.id === id)?.name ?? id
const attachable = computed(() => props.groups.filter((g) => g.active && !groupIds.value.includes(g.id)))
// A deactivated station can't take new items, but keep the item's own station selectable.
const stationChoices = computed(() =>
  props.stations.filter((s) => s.active || s.id === item.value?.stationId),
)
const categoryChoices = computed(() =>
  props.categories.filter((c) => c.active || c.id === item.value?.categoryId),
)

function onCode(v: string | undefined) {
  code.value = (v ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 20)
}

function addGroup() {
  if (addGroupId.value && !groupIds.value.includes(addGroupId.value))
    groupIds.value = [...groupIds.value, addGroupId.value]
  addGroupId.value = ''
}

const errors = computed(() => {
  const e: Record<string, string> = { ...saver.fieldErrors.value }
  if (touched.value) {
    if (!/^[A-Z0-9-]{1,20}$/.test(code.value))
      e.code ??= 'Code is 1 to 20 characters: capital letters, digits and dash.'
    if (!name.value.trim()) e.name ??= 'Enter the item name.'
    if (!categoryId.value) e.categoryId ??= 'Choose a category.'
    if (!stationId.value) e.stationId ??= 'Choose the kitchen station that prepares this item.'
    if (localPrice.value === null || localInvalid.value) e.localPrice ??= 'Enter the local price.'
    if (foreignInvalid.value) e.foreignPrice ??= 'Enter the foreign price like 1425.00, or leave it empty.'
  }
  return e
})
const conflict = computed(() => saver.error.value?.isVersionConflict ?? false)
const general = computed(() => {
  const err = saver.error.value ?? loader.error.value
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

async function reload() {
  if (!props.itemId) return
  userEdited = false // an explicit reload replaces the form with the saved version
  saver.reset()
  await loader.run(props.itemId).catch(() => undefined)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="isCreate ? 'New menu item' : `Edit ${item?.name ?? 'item'}`"
    :draggable="false"
    :closable="!saver.busy.value"
    :style="{ width: 'min(680px, calc(100vw - 24px))' }"
    data-testid="item-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <form
      class="stack"
      novalidate
      @submit.prevent="save"
      @input="userEdited = true"
      @change="userEdited = true"
    >
      <VersionConflictBanner v-if="conflict" :busy="loader.busy.value" @reload="reload" />
      <fieldset class="plain stack" :disabled="loading">
        <div class="form-grid">
          <FormField
            label="Code"
            for="item-code"
            name="code"
            :error="errors.code"
            hint="Used for POS search."
          >
            <InputText
              id="item-code"
              :model-value="code"
              autocapitalize="characters"
              autocomplete="off"
              maxlength="20"
              data-testid="item-code"
              @update:model-value="onCode"
            />
          </FormField>
          <FormField label="Name" for="item-name" name="name" :error="errors.name">
            <InputText id="item-name" v-model="name" maxlength="100" data-testid="item-name" />
          </FormField>
          <FormField label="Category" for="item-category" name="categoryId" :error="errors.categoryId">
            <select id="item-category" v-model="categoryId" class="native-select" data-testid="item-category">
              <option value="" disabled>Choose...</option>
              <option v-for="c in categoryChoices" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </FormField>
          <FormField
            label="Kitchen station"
            for="item-station"
            name="stationId"
            :error="errors.stationId"
            hint="Exactly one station prepares this item."
          >
            <select id="item-station" v-model="stationId" class="native-select" data-testid="item-station">
              <option value="" disabled>Choose...</option>
              <option v-for="s in stationChoices" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </FormField>
          <FormField label="Local price" for="item-local-price" name="localPrice">
            <MoneyInput
              id="item-local-price"
              v-model="localPrice"
              :error="errors.localPrice"
              data-testid="item-local-price"
              @invalid="localInvalid = $event"
            />
          </FormField>
          <FormField
            label="Foreign price (optional)"
            for="item-foreign-price"
            name="foreignPrice"
            hint="Without it the item cannot be sold on a foreign-price order."
          >
            <MoneyInput
              id="item-foreign-price"
              v-model="foreignPrice"
              :error="errors.foreignPrice"
              data-testid="item-foreign-price"
              @invalid="foreignInvalid = $event"
            />
          </FormField>
        </div>

        <label class="switch">
          <ToggleSwitch v-model="active" input-id="item-active" data-testid="item-active" />
          <span>Active (shown on the POS)</span>
        </label>

        <fieldset class="groups">
          <legend>Modifier groups</legend>
          <p v-if="groupIds.length === 0" class="muted small" data-testid="item-no-groups">
            No modifier groups attached.
          </p>
          <ol class="group-list">
            <li
              v-for="(id, i) in groupIds"
              :key="id"
              class="group-row"
              :data-testid="`item-group-${groupName(id)}`"
            >
              <span class="gname">{{ groupName(id) }}</span>
              <Button
                icon="pi pi-arrow-up"
                text
                rounded
                size="small"
                aria-label="Move up"
                :disabled="i === 0"
                :data-testid="`item-group-up-${groupName(id)}`"
                @click="groupIds = moveItem(groupIds, i, -1)"
              />
              <Button
                icon="pi pi-arrow-down"
                text
                rounded
                size="small"
                aria-label="Move down"
                :disabled="i === groupIds.length - 1"
                :data-testid="`item-group-down-${groupName(id)}`"
                @click="groupIds = moveItem(groupIds, i, 1)"
              />
              <Button
                icon="pi pi-times"
                text
                rounded
                size="small"
                severity="danger"
                aria-label="Remove group"
                :data-testid="`item-group-remove-${groupName(id)}`"
                @click="groupIds = groupIds.filter((g) => g !== id)"
              />
            </li>
          </ol>
          <div v-if="attachable.length" class="add-row">
            <select
              v-model="addGroupId"
              class="native-select"
              aria-label="Add a modifier group"
              data-testid="item-group-add"
            >
              <option value="">Add a group...</option>
              <option v-for="g in attachable" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
            <Button
              label="Add"
              size="small"
              outlined
              :disabled="!addGroupId"
              data-testid="item-group-add-button"
              @click="addGroup"
            />
          </div>
        </fieldset>

        <p v-if="general" class="field-error" role="alert" data-testid="item-error">{{ general }}</p>
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
          :label="isCreate ? 'Create item' : 'Save'"
          :loading="saver.busy.value"
          :disabled="saver.busy.value || loader.busy.value || conflict"
          data-testid="item-save"
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

.groups {
  border: 1px solid var(--rms-border);
  border-radius: 10px;
  padding: 8px 12px 12px;
  margin: 0;
}

.groups legend {
  font-weight: 700;
  padding: 0 6px;
}

.group-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}

.group-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  border-bottom: 1px solid #f0f2f4;
}

.gname {
  flex: 1;
  font-weight: 600;
}

.add-row {
  display: flex;
  gap: 8px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
