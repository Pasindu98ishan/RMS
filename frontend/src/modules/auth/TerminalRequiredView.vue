<script setup lang="ts">
/** A POS / kitchen screen opened in a personal session (ADR-008 #10): those need a registered counter device. */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import AuthCard from './AuthCard.vue'
import { useAuthStore } from '@/stores/auth'
import { landingFor } from '@/router/access'
import { LOGIN_PATH } from '@/router/guard'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const home = computed(() =>
  landingFor(
    { sessionType: auth.sessionType, terminalType: auth.terminal?.type, isRider: auth.isRider },
    auth.has,
  ),
)
const from = computed(() => (typeof route.query.from === 'string' ? route.query.from : null))

async function logout() {
  await auth.logout('USER')
  await router.replace(LOGIN_PATH)
}
</script>

<template>
  <AuthCard
    title="Use a registered counter device"
    :subtitle="auth.user ? `Logged in as ${auth.user.fullName} on a personal device` : undefined"
  >
    <div class="stack" data-testid="terminal-required-page">
      <p>
        <strong v-if="from">{{ from }}</strong><template v-else>This screen</template> works only on a
        registered counter or kitchen device (the cash drawer, printer, shift and station belong to that
        device). Open it there.
      </p>
      <div class="actions">
        <Button
          v-if="home !== '/terminal-required'"
          label="Go to my screen"
          icon="pi pi-home"
          data-testid="terminal-required-home"
          @click="router.replace(home)"
        />
        <Button
          label="Log out"
          icon="pi pi-sign-out"
          severity="secondary"
          outlined
          data-testid="logout"
          @click="logout"
        />
      </div>
    </div>
  </AuthCard>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stack p {
  margin: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
