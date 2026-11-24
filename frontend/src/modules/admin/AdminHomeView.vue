<script setup lang="ts">
/** Phase 1 admin home (placeholder). Today's sales, open orders, kitchen status arrive with M1.2-M1.5. */
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { canAccess } from '@/router/access'
import { formatDate } from '@/utils/time'

const auth = useAuthStore()
const router = useRouter()

const shortcuts = computed(() => {
  const admin = router.options.routes.find((r) => r.path === '/admin')
  return (admin?.children ?? [])
    .filter((c) => c.path && c.meta?.nav && canAccess(c.meta, auth.has))
    .map((c) => ({ path: `/admin/${c.path}`, label: c.meta!.nav!.label, icon: c.meta!.nav!.icon }))
})

const tiles = [
  { label: "Today's sales", note: 'Available when billing is built (M1.4).', icon: 'pi pi-wallet' },
  { label: 'Open orders', note: 'Available when orders are built (M1.2).', icon: 'pi pi-receipt' },
  {
    label: 'Kitchen status',
    note: 'Available when kitchen screens are built (M1.3).',
    icon: 'pi pi-th-large',
  },
  { label: 'Alerts', note: 'Notifications arrive in Phase 3.', icon: 'pi pi-bell' },
]

const today = formatDate(new Date().toISOString())
</script>

<template>
  <div class="page" data-testid="admin-home">
    <div class="page-header">
      <div>
        <h1>Good day, {{ auth.user?.fullName?.split(' ')[0] }}</h1>
        <p class="muted" style="margin: 4px 0 0">{{ today }} - Santhula Hotel, Netolpitiya</p>
      </div>
    </div>

    <div class="tiles">
      <div v-for="t in tiles" :key="t.label" class="card tile">
        <i :class="t.icon" class="tile-icon" aria-hidden="true" />
        <div>
          <div class="tile-label">{{ t.label }}</div>
          <div class="muted small">{{ t.note }}</div>
        </div>
      </div>
    </div>

    <section v-if="shortcuts.length" class="card">
      <h2>Manage</h2>
      <div class="shortcuts">
        <RouterLink
          v-for="s in shortcuts"
          :key="s.path"
          :to="s.path"
          class="shortcut"
          :data-testid="`home-link-${s.path.split('/').pop()}`"
        >
          <i :class="s.icon" aria-hidden="true" />
          <span>{{ s.label }}</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}

.tile {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.tile-icon {
  font-size: 1.4rem;
  color: var(--rms-primary);
  background: var(--rms-primary-soft);
  border-radius: 10px;
  padding: 10px;
}

.tile-label {
  font-weight: 700;
  margin-bottom: 2px;
}

.shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 0 14px;
  border: 1px solid var(--rms-border);
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  font-weight: 600;
}

.shortcut:hover {
  border-color: var(--rms-primary);
  color: var(--rms-primary);
}
</style>
