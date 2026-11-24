<script setup lang="ts">
/** /admin/menu/modifiers - modifier groups with options and price deltas (P1-MENU-03). */
import { onMounted, ref } from 'vue'
import Button from 'primevue/button'
import ModifierFormDialog from './ModifierFormDialog.vue'
import { menuApi } from '@/api/menu'
import type { ModifierGroup } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'
import { formatMoney } from '@/utils/money'

const notify = useNotify()
const groups = ref<ModifierGroup[]>([])
const loader = useAction(async () => {
  groups.value = await menuApi.listModifierGroups()
})
const load = () => loader.run().catch((e) => notify.error(e, 'Could not load modifier groups'))
onMounted(load)

const open = ref(false)
const editing = ref<ModifierGroup | null>(null)
function openDialog(g: ModifierGroup | null) {
  editing.value = g
  open.value = true
}

function rule(g: ModifierGroup) {
  const pick = g.minSelect === g.maxSelect ? `pick ${g.maxSelect}` : `pick ${g.minSelect} to ${g.maxSelect}`
  return `${g.required ? 'Required' : 'Optional'}, ${pick}`
}

const toggling = ref<string | null>(null)
async function toggleActive(g: ModifierGroup) {
  toggling.value = g.id
  try {
    await menuApi.updateModifierGroup(g.id, {
      name: g.name,
      required: g.required,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      active: !g.active,
      options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta })),
      version: g.version,
    })
  } catch (e) {
    notify.error(e, 'Could not change the group')
  } finally {
    toggling.value = null
    await load()
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Modifier groups</h1>
      <Button label="New group" icon="pi pi-plus" data-testid="modifier-create" @click="openDialog(null)" />
    </div>
    <p class="muted small">
      A group such as "Spice level" offers options that can add to the price. Attach groups to items in the
      item editor. An inactive group is hidden from the POS.
    </p>

    <div class="cards" :aria-busy="loader.busy.value" data-testid="modifiers-list">
      <section
        v-for="g in groups"
        :key="g.id"
        class="card group"
        :class="{ inactive: !g.active }"
        :data-testid="`modifier-row-${g.name}`"
      >
        <header class="head">
          <h2>{{ g.name }}</h2>
          <span class="chip" :class="g.active ? 'chip-ok' : 'chip-muted'">{{
            g.active ? 'Active' : 'Inactive'
          }}</span>
        </header>
        <p class="muted small">
          {{ rule(g) }} - used by {{ g.itemCount }} item{{ g.itemCount === 1 ? '' : 's' }}
        </p>
        <ul class="opts">
          <li v-for="o in g.options" :key="o.id">
            <span>{{ o.name }}</span>
            <span class="muted">{{
              o.priceDelta === '0.00' ? 'no extra' : `+ ${formatMoney(o.priceDelta)}`
            }}</span>
          </li>
        </ul>
        <div class="actions">
          <Button
            label="Edit"
            icon="pi pi-pencil"
            size="small"
            outlined
            :data-testid="`modifier-edit-${g.name}`"
            @click="openDialog(g)"
          />
          <Button
            :label="g.active ? 'Deactivate' : 'Activate'"
            size="small"
            text
            :severity="g.active ? 'danger' : undefined"
            :loading="toggling === g.id"
            :data-testid="`modifier-toggle-${g.name}`"
            @click="toggleActive(g)"
          />
        </div>
      </section>
      <p v-if="!groups.length && !loader.busy.value" class="muted">No modifier groups yet.</p>
    </div>

    <ModifierFormDialog
      v-model:visible="open"
      :group="editing"
      @saved="(g) => (notify.success(editing ? 'Group saved' : 'Group created', g.name), load())"
      @reload="load"
    />
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group.inactive {
  opacity: 0.75;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.head h2 {
  font-size: 1.05rem;
  margin: 0;
}

.group p {
  margin: 0;
}

.opts {
  list-style: none;
  margin: 0;
  padding: 0;
}

.opts li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid #f0f2f4;
}

.actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
}
</style>
