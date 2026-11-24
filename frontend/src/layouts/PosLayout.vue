<script setup lang="ts">
/**
 * POS shell (cashier / reception touch PCs, 1366x768). Header: terminal, user, shift status,
 * kitchen status dots, alerts bell (screens.md). Shift and kitchen status are wired in M1.3 / M1.5.
 */
import { computed } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import UserMenu from '@/components/UserMenu.vue'
import TerminalBadge from '@/components/TerminalBadge.vue'
import { useClock } from '@/composables/useClock'
import { useAuthStore } from '@/stores/auth'
import { ADMIN_AREA, canAccess } from '@/router/access'
import { formatClock } from '@/utils/time'

const auth = useAuthStore()
const now = useClock(15_000)
const clock = computed(() => formatClock(now.value))
const canAdmin = computed(() => canAccess({ anyOf: ADMIN_AREA }, auth.has))

/** Placeholder until the KDS heartbeat (M1.3) reports station status. */
const stations = [
  { key: 'k1', label: 'K1' },
  { key: 'k2', label: 'K2' },
  { key: 'k3', label: 'K3' },
]
</script>

<template>
  <div class="pos touch">
    <header class="pos-bar">
      <RouterLink to="/pos" class="logo" aria-label="POS home" data-testid="nav-pos">RMS</RouterLink>
      <TerminalBadge dark />
      <span class="chip chip-muted shift" data-testid="shift-status" title="Shifts arrive in M1.5">
        <i class="pi pi-clock" aria-hidden="true" /> No shift open
      </span>
      <div class="kitchens" aria-label="Kitchen status" data-testid="kitchen-status">
        <span
          v-for="s in stations"
          :key="s.key"
          class="kdot"
          :data-testid="`kitchen-status-${s.key}`"
          title="Kitchen status arrives in M1.3"
        >
          <span class="dot" aria-hidden="true" />{{ s.label }}
          <span class="sr-only">status unknown</span>
        </span>
      </div>
      <div class="spacer" />
      <span class="clock" aria-label="Time in Colombo">{{ clock }}</span>
      <button type="button" class="bell" aria-label="Alerts" data-testid="alerts-bell" disabled>
        <i class="pi pi-bell" aria-hidden="true" />
      </button>
      <RouterLink v-if="canAdmin" to="/admin" class="admin-link" data-testid="nav-admin">
        <i class="pi pi-cog" aria-hidden="true" /><span>Admin</span>
      </RouterLink>
      <UserMenu dark />
    </header>
    <main class="pos-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.pos {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #eef2f5;
}

.pos-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  min-height: 60px;
  background: #0b3b38;
  color: #fff;
}

.logo {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: var(--rms-primary);
  color: #fff;
  font-weight: 800;
  font-size: 0.8rem;
  text-decoration: none;
}

.shift {
  min-height: 32px;
}

.kitchens {
  display: flex;
  gap: 6px;
}

.kdot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 0.8rem;
  font-weight: 600;
}

.kdot .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #9ca3af;
}

.spacer {
  flex: 1;
}

.clock {
  font-variant-numeric: tabular-nums;
  font-size: 1.1rem;
  font-weight: 600;
}

.bell,
.admin-link {
  min-width: 48px;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: transparent;
  color: #fff;
  font: inherit;
  text-decoration: none;
  padding: 0 10px;
}

.bell:disabled {
  opacity: 0.55;
}

.pos-main {
  flex: 1;
  padding: 16px;
  min-height: 0;
}
</style>
