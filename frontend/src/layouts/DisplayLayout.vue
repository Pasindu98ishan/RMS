<script setup lang="ts">
/** Large display (Phase 2 inventory screen): full screen, auto-refresh, no interaction. */
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import { useClock } from '@/composables/useClock'
import { useAuthStore } from '@/stores/auth'
import { formatClock, formatDate } from '@/utils/time'

const auth = useAuthStore()
const now = useClock()
const clock = computed(() => formatClock(now.value))
const date = computed(() => formatDate(now.value.toISOString()))
</script>

<template>
  <div class="display">
    <header class="display-bar">
      <span class="name" data-testid="header-terminal">{{ auth.terminal?.name ?? 'Display' }}</span>
      <span class="spacer" />
      <span class="date">{{ date }}</span>
      <span class="clock">{{ clock }}</span>
    </header>
    <main class="display-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.display {
  position: fixed;
  inset: 0;
  background: #0f172a;
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  cursor: none;
  user-select: none;
}

.display-bar {
  display: flex;
  align-items: baseline;
  gap: 24px;
  padding: 20px 32px;
  font-size: 1.6rem;
}

.name {
  font-weight: 800;
}

.spacer {
  flex: 1;
}

.clock {
  font-size: 2.4rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.display-main {
  flex: 1;
  padding: 0 32px 32px;
}
</style>
