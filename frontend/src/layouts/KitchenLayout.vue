<script setup lang="ts">
/**
 * Kitchen display shell (10-15" tablets, 1280x800 landscape): full screen, station name, clock,
 * connection indicator and an offline banner. No idle logout (the session has no idle timeout).
 * The STOMP connection and auto-reconnect arrive in M1.3; until then this shows network state.
 */
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import UserMenu from '@/components/UserMenu.vue'
import { useClock } from '@/composables/useClock'
import { useOnline } from '@/composables/useOnline'
import { useAuthStore } from '@/stores/auth'
import { formatClock } from '@/utils/time'

const auth = useAuthStore()
const now = useClock()
const online = useOnline()
const clock = computed(() => formatClock(now.value))
const stationName = computed(() => auth.terminal?.name ?? 'Kitchen')
</script>

<template>
  <div class="kds">
    <header class="kds-bar">
      <h1 class="station" data-testid="header-terminal">{{ stationName }}</h1>
      <div class="spacer" />
      <span class="conn" :class="online ? 'ok' : 'down'" data-testid="connection-status">
        <span class="dot" aria-hidden="true" />{{ online ? 'Online' : 'Offline' }}
      </span>
      <span class="clock" aria-label="Time in Colombo">{{ clock }}</span>
      <UserMenu dark compact />
    </header>
    <div v-if="!online" class="offline" role="alert" data-testid="offline-banner">
      <i class="pi pi-wifi" aria-hidden="true" /> Offline - reconnecting. New tickets will appear when the
      connection is back.
    </div>
    <main class="kds-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.kds {
  min-height: 100vh;
  background: #111827;
  color: #f9fafb;
  display: flex;
  flex-direction: column;
}

.kds-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #0b1220;
  border-bottom: 1px solid #1f2937;
}

.station {
  font-size: 1.6rem;
  font-weight: 800;
}

.spacer {
  flex: 1;
}

.conn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 1.05rem;
}

.conn .dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}

.conn.ok .dot {
  background: #22c55e;
}

.conn.down .dot {
  background: #ef4444;
}

.clock {
  font-size: 1.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.offline {
  background: #b91c1c;
  color: #fff;
  padding: 10px 16px;
  font-size: 1.15rem;
  font-weight: 700;
}

.kds-main {
  flex: 1;
  padding: 16px;
}
</style>
