<script setup lang="ts">
/** /admin/menu/items - menu items with local + foreign price and kitchen station (P1-MENU-02/04/05/06). */
import { computed, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ItemFormDialog from './ItemFormDialog.vue'
import { menuApi } from '@/api/menu'
import type { Category, KitchenStation, MenuItem, MenuItemPage, ModifierGroup } from '@/api/types'
import { useAction } from '@/composables/useAction'
import { useNotify } from '@/composables/useNotify'
import { useAuthStore } from '@/stores/auth'
import { formatMoney } from '@/utils/money'

const PAGE_SIZE = 25

const auth = useAuthStore()
const notify = useNotify()

const search = ref('')
const categoryId = ref('')
const stationId = ref('')
const active = ref<'all' | 'true' | 'false'>('true')
const availability = ref<'all' | 'true' | 'false'>('all')
const page = ref(0)
const result = ref<MenuItemPage | null>(null)
const categories = ref<Category[]>([])
const stations = ref<KitchenStation[]>([])
const groups = ref<ModifierGroup[]>([])

const loader = useAction(async () => {
  result.value = await menuApi.listItems({
    page: page.value,
    size: PAGE_SIZE,
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
    ...(categoryId.value ? { categoryId: categoryId.value } : {}),
    ...(stationId.value ? { stationId: stationId.value } : {}),
    ...(active.value !== 'all' ? { active: active.value === 'true' } : {}),
    ...(availability.value !== 'all' ? { available: availability.value === 'true' } : {}),
  })
})
const load = () => loader.run().catch((e) => notify.error(e, 'Could not load menu items'))

onMounted(async () => {
  const lookups = Promise.all([
    menuApi.listCategories(),
    menuApi.listStations(),
    menuApi.listModifierGroups(),
  ]).then(([c, s, g]) => {
    categories.value = c
    stations.value = s
    groups.value = g
  })
  await Promise.all([load(), lookups.catch((e) => notify.error(e, 'Could not load categories and stations'))])
})

let timer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    page.value = 0
    void load()
  }, 300)
})
watch([categoryId, stationId, active, availability], () => {
  page.value = 0
  void load()
})

const totalPages = computed(() =>
  result.value ? Math.max(1, Math.ceil(result.value.totalItems / PAGE_SIZE)) : 1,
)
function goPage(p: number) {
  page.value = p
  void load()
}

const formOpen = ref(false)
const formId = ref<string | null>(null)
function openForm(id: string | null) {
  formId.value = id
  formOpen.value = true
}
function onSaved(item: MenuItem) {
  notify.success(formId.value ? 'Item saved' : 'Item created', `${item.code} ${item.name}`)
  void load()
}

const toggling = ref<string | null>(null)
async function toggleAvailability(id: string, current: boolean) {
  toggling.value = id
  try {
    const saved = await menuApi.setAvailability(id, !current)
    notify.success(saved.available ? 'Back on the menu' : 'Marked sold out', `${saved.code} ${saved.name}`)
    await load()
  } catch (e) {
    notify.error(e, 'Could not change availability')
  } finally {
    toggling.value = null
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>Menu items</h1>
      <Button label="New item" icon="pi pi-plus" data-testid="item-create" @click="openForm(null)" />
    </div>

    <div class="card toolbar filters">
      <div class="field grow">
        <label for="items-search">Search</label>
        <InputText id="items-search" v-model="search" placeholder="Code or name" data-testid="items-search" />
      </div>
      <div class="field">
        <label for="items-filter-category">Category</label>
        <select
          id="items-filter-category"
          v-model="categoryId"
          class="native-select"
          data-testid="items-filter-category"
        >
          <option value="">All</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="items-filter-station">Station</label>
        <select
          id="items-filter-station"
          v-model="stationId"
          class="native-select"
          data-testid="items-filter-station"
        >
          <option value="">All</option>
          <option v-for="s in stations" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="items-filter-active">Status</label>
        <select
          id="items-filter-active"
          v-model="active"
          class="native-select"
          data-testid="items-filter-active"
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>
      <div class="field">
        <label for="items-filter-available">Today</label>
        <select
          id="items-filter-available"
          v-model="availability"
          class="native-select"
          data-testid="items-filter-available"
        >
          <option value="all">All</option>
          <option value="true">Available</option>
          <option value="false">Sold out</option>
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table class="rtable" data-testid="items-table" :aria-busy="loader.busy.value">
        <thead>
          <tr>
            <th>Code</th>
            <th>Item</th>
            <th>Category</th>
            <th>Station</th>
            <th class="num">Local</th>
            <th class="num">Foreign</th>
            <th>Status</th>
            <th class="sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="i in result?.items ?? []"
            :key="i.id"
            :class="{ inactive: !i.active }"
            :data-testid="`item-row-${i.code}`"
          >
            <td data-label="Code" class="mono">{{ i.code }}</td>
            <td data-label="Item">
              <strong>{{ i.name }}</strong>
              <span v-if="i.modifierGroupCount" class="muted small">
                - {{ i.modifierGroupCount }} modifier group{{ i.modifierGroupCount === 1 ? '' : 's' }}</span
              >
            </td>
            <td data-label="Category">{{ i.categoryName }}</td>
            <td data-label="Station">{{ i.stationName }}</td>
            <td data-label="Local" class="num">{{ formatMoney(i.localPrice) }}</td>
            <td data-label="Foreign" class="num">{{ i.foreignPrice ? formatMoney(i.foreignPrice) : '-' }}</td>
            <td data-label="Status">
              <span class="status">
                <span class="chip" :class="i.active ? 'chip-ok' : 'chip-muted'">{{
                  i.active ? 'Active' : 'Inactive'
                }}</span>
                <span v-if="!i.available" class="chip chip-danger" :data-testid="`item-soldout-${i.code}`"
                  >Sold out</span
                >
              </span>
            </td>
            <td data-label="" class="no-label">
              <div class="actions">
                <Button
                  label="Edit"
                  icon="pi pi-pencil"
                  size="small"
                  outlined
                  :data-testid="`item-edit-${i.code}`"
                  @click="openForm(i.id)"
                />
                <Button
                  v-if="auth.has('MENU_AVAILABILITY') && i.active"
                  :label="i.available ? 'Sold out' : 'Available'"
                  :icon="i.available ? 'pi pi-ban' : 'pi pi-check'"
                  size="small"
                  text
                  :severity="i.available ? 'danger' : undefined"
                  :loading="toggling === i.id"
                  :data-testid="`item-availability-${i.code}`"
                  @click="toggleAvailability(i.id, i.available)"
                />
              </div>
            </td>
          </tr>
          <tr v-if="result && result.items.length === 0">
            <td colspan="8" class="no-label empty" data-testid="items-empty">
              No items match these filters.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="result" class="pager">
      <span class="muted small" data-testid="items-total"
        >{{ result.totalItems }} item{{ result.totalItems === 1 ? '' : 's' }}</span
      >
      <div class="pager-buttons">
        <Button
          icon="pi pi-angle-left"
          text
          aria-label="Previous page"
          :disabled="page === 0 || loader.busy.value"
          data-testid="items-prev"
          @click="goPage(page - 1)"
        />
        <span class="small">Page {{ page + 1 }} of {{ totalPages }}</span>
        <Button
          icon="pi pi-angle-right"
          text
          aria-label="Next page"
          :disabled="page + 1 >= totalPages || loader.busy.value"
          data-testid="items-next"
          @click="goPage(page + 1)"
        />
      </div>
    </div>

    <ItemFormDialog
      v-model:visible="formOpen"
      :item-id="formId"
      :categories="categories"
      :stations="stations"
      :groups="groups"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.filters .grow {
  flex: 1 1 200px;
}

.filters .field {
  min-width: 140px;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.status {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.empty {
  text-align: center;
  color: var(--rms-muted);
  padding: 24px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.pager-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (max-width: 720px) {
  .num {
    text-align: right;
  }
}
</style>
