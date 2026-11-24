<script setup lang="ts">
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
  <AuthCard title="No access" :subtitle="auth.user ? `Logged in as ${auth.user.fullName}` : undefined">
    <div data-testid="forbidden-page" class="stack">
      <p>
        You do not have permission to open
        <strong v-if="from">{{ from }}</strong><template v-else>this screen</template>. Ask the owner if you
        need it.
      </p>
      <div class="actions">
        <Button
          v-if="home !== '/forbidden'"
          label="Go to my screen"
          icon="pi pi-home"
          data-testid="forbidden-home"
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
