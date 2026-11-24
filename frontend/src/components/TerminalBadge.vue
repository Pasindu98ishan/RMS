<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useTerminalStore } from '@/stores/terminal'
import { TERMINAL_TYPE_LABEL } from '@/api/types'

withDefaults(defineProps<{ dark?: boolean }>(), { dark: false })

const auth = useAuthStore()
const terminalStore = useTerminalStore()
/** A personal session shows 'Personal device', never the registration of the browser it runs in (ADR-008). */
const terminal = computed(() => (auth.isPersonal ? null : (auth.terminal ?? terminalStore.terminal)))
</script>

<template>
  <span
    v-if="auth.isPersonal"
    class="terminal-badge personal"
    :class="{ dark }"
    title="Signed in without a registered terminal"
    data-testid="header-terminal"
  >
    <i class="pi pi-mobile" aria-hidden="true" />
    <span class="tname">Personal device</span>
  </span>
  <span
    v-else-if="terminal"
    class="terminal-badge"
    :class="{ dark }"
    :title="TERMINAL_TYPE_LABEL[terminal.type]"
    data-testid="header-terminal"
  >
    <i class="pi pi-desktop" aria-hidden="true" />
    <span class="tname">{{ terminal.name }}</span>
  </span>
</template>

<style scoped>
.terminal-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--rms-primary-soft);
  color: var(--rms-primary);
  font-size: 0.85rem;
  font-weight: 600;
  max-width: 220px;
}

.terminal-badge.personal {
  background: #eef1f4;
  color: var(--rms-muted);
}

.terminal-badge.dark {
  background: rgba(255, 255, 255, 0.12);
  color: #e6fffb;
}

.tname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
