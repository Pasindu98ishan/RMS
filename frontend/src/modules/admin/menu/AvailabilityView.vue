<script setup lang="ts">
/**
 * Sold-out board (P1-MENU-06): one tap marks an item sold out for today or available again.
 * Used in the admin area and on the POS (cashiers hold MENU_AVAILABILITY, not MENU_MANAGE).
 * Big touch targets; each change is its own request and is shown right away.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { menuApi } from '@/api/menu'
import type { AvailabilityItem } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'

const notify = useNotify()
const route = useRoute()
const items = ref<AvailabilityItem[]>([])
const search = ref('')
const onlySoldOut = ref(false)
const busyId = ref<string | null>(null)

const loader = useAction(async () => {
  items.value = await menuApi.availabilityBoard()
})
const load = () => loader.run().catch((e) => notify.error(e, 'Could not load the menu'))
onMounted(load)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return items.value.filter(
    (i) =>
      (!onlySoldOut.value || !i.available) &&
      (!q || i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)),
  )
})

const groups = computed(() => {
  const map = new Map<string, AvailabilityItem[]>()
  for (const i of filtered.value) map.set(i.categoryName, [...(map.get(i.categoryName) ?? []), i])
  return [...map.entries()].map(([category, list]) => ({ category, list }))
})
const soldOutCount = computed(() => items.value.filter((i) => !i.available).length)

async function toggle(item: AvailabilityItem) {
  if (busyId.value) return
  busyId.value = item.id
  const next = !item.available
  item.available = next // optimistic
  try {
    const saved = await menuApi.setAvailability(item.id, next)
    item.available = saved.available
  } catch (e) {
    item.available = !next
    notify.error(e, `Could not update ${item.name}`)
  } finally {
    busyId.value = null
  }
}

const inPos = computed(() => route.path.startsWith('/pos'))
</script>

<template>
  <div class="page" :class="{ pos: inPos }" :aria-busy="loader.busy.value">
    <div class="page-header">
      <div>
        <h1>Sold out today</h1>
        <p class="muted small head-note">
          Tap an item to mark it sold out. It is greyed out on the POS until it is available again (and resets
          at the start of the business day when that setting is on).
        </p>
      </div>
      <RouterLink v-if="inPos" to="/pos" class="back" data-testid="availability-back">
        <i class="pi pi-arrow-left" aria-hidden="true" /> Back to POS
      </RouterLink>
    </div>

    <div class="card toolbar">
      <div class="field grow">
        <label for="avail-search">Search</label>
        <InputText
          id="avail-search"
          v-model="search"
          placeholder="Code or name"
          data-testid="availability-search"
        />
      </div>
      <label class="only">
        <input v-model="onlySoldOut" type="checkbox" data-testid="availability-only-soldout" />
        <span>Only sold out ({{ soldOutCount }})</span>
      </label>
      <Button
        icon="pi pi-refresh"
        label="Refresh"
        outlined
        :loading="loader.busy.value"
        data-testid="availability-refresh"
        @click="load"
      />
    </div>

    <section
      v-for="g in groups"
      :key="g.category"
      class="card"
      :data-testid="`availability-group-${g.category}`"
    >
      <h2>{{ g.category }}</h2>
      <div class="tiles">
        <button
          v-for="i in g.list"
          :key="i.id"
          type="button"
          class="tile"
          :class="{ out: !i.available }"
          :aria-pressed="!i.available"
          :disabled="busyId === i.id"
          :data-testid="`availability-item-${i.code}`"
          @click="toggle(i)"
        >
          <span class="tname">{{ i.name }}</span>
          <span class="tcode mono">{{ i.code }}</span>
          <span class="tstate" :data-testid="`availability-state-${i.code}`">
            <i :class="i.available ? 'pi pi-check-circle' : 'pi pi-ban'" aria-hidden="true" />
            {{ i.available ? 'Available' : 'Sold out' }}
          </span>
        </button>
      </div>
    </section>
    <p v-if="!groups.length && !loader.busy.value" class="muted" data-testid="availability-empty">
      No items match.
    </p>
  </div>
</template>

<style scoped>
.page.pos {
  max-width: none;
}

.head-note {
  margin: 4px 0 0;
  max-width: 640px;
}

.back {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid var(--rms-border);
  border-radius: 10px;
  text-decoration: none;
  background: #fff;
  font-weight: 600;
}

.toolbar .grow {
  flex: 1 1 220px;
}

.only {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
}

.only input {
  width: 22px;
  height: 22px;
  accent-color: var(--rms-primary);
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.tile {
  min-height: 84px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 2px solid #b7e2c5;
  background: var(--rms-ok-soft);
  color: inherit;
  font: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
}

.tile.out {
  border-color: #f3b8b2;
  background: var(--rms-danger-soft);
}

.tile:disabled {
  opacity: 0.6;
}

.tname {
  font-weight: 700;
}

.tcode {
  color: var(--rms-muted);
}

.tstate {
  margin-top: auto;
  font-weight: 700;
  color: var(--rms-ok);
}

.tile.out .tstate {
  color: var(--rms-danger);
}

.card h2 {
  font-size: 1.05rem;
  margin-bottom: 10px;
}
</style>
