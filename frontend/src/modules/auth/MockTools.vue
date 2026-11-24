<script setup lang="ts">
/**
 * Dev-only panel (VITE_USE_MOCKS): adopt a seeded terminal instead of registering, or reset the
 * mock data. Loaded only behind the compile-time mock flag, so it never ships in a real build.
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { seededTerminals } from '@/mocks/browser'
import { db, resetDb } from '@/mocks/db'
import { useAuthStore } from '@/stores/auth'
import { useTerminalStore } from '@/stores/terminal'
import { useNotify } from '@/composables/useNotify'
import { TERMINAL_TYPE_LABEL, type TerminalType } from '@/api/types'
import { LOGIN_PATH } from '@/router/guard'

const emit = defineEmits<{ reset: [] }>()

const auth = useAuthStore()
const terminalStore = useTerminalStore()
const router = useRouter()
const notify = useNotify()
const terminals = ref<Array<{ id: string; name: string; type: TerminalType }>>([])

function load() {
  terminals.value = seededTerminals().map((t) => ({ id: t.id, name: t.name, type: t.type }))
}
onMounted(load)

async function adopt(id: string) {
  const live = db.terminals.find((x) => x.id === id)
  if (!live) return
  if (auth.isAuthenticated) await auth.logout('USER')
  terminalStore.adopt({
    terminalId: live.id,
    deviceToken: live.deviceToken,
    terminal: { id: live.id, name: live.name, type: live.type, active: live.active },
    registeredAt: new Date().toISOString(),
  })
  await router.replace(LOGIN_PATH)
}

async function reset() {
  resetDb()
  if (auth.isAuthenticated) await auth.logout('USER')
  terminalStore.forget()
  load()
  emit('reset')
  notify.info('Mock data reset', 'Seed data restored; this device is unregistered.')
}
</script>

<template>
  <section class="mock-tools" data-testid="mock-tools">
    <h2>Mock tools <span class="chip chip-warn">VITE_USE_MOCKS</span></h2>
    <p class="small">
      Use a seeded terminal instead of registering (seed users and password: src/mocks/seed.ts).
    </p>
    <div class="mock-list">
      <Button
        v-for="t in terminals"
        :key="t.id"
        :label="`${t.name} (${TERMINAL_TYPE_LABEL[t.type]})`"
        size="small"
        severity="secondary"
        outlined
        :data-testid="`mock-adopt-${t.name.replace(/\s+/g, '-')}`"
        @click="adopt(t.id)"
      />
    </div>
    <Button
      label="Reset mock data"
      size="small"
      severity="danger"
      text
      data-testid="mock-reset"
      @click="reset"
    />
  </section>
</template>

<style scoped>
.mock-tools {
  width: 100%;
  max-width: 560px;
  background: #fffbeb;
  border: 1px dashed #d97706;
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mock-tools h2 {
  font-size: 1rem;
  display: flex;
  gap: 8px;
  align-items: center;
}

.mock-tools p {
  margin: 0;
}

.mock-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
