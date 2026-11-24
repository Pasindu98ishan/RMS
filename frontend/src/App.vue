<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Toast from 'primevue/toast'
import IdleLockOverlay from '@/components/IdleLockOverlay.vue'
import { useIdleTimer } from '@/composables/useIdleTimer'
import { useAuthStore } from '@/stores/auth'
import { LOGIN_PATH } from '@/router/guard'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const idleLocked = ref(false)
const idleMinutes = ref<number | null>(null)

const idleMs = computed(() =>
  auth.isAuthenticated && auth.idleTimeoutMinutes ? auth.idleTimeoutMinutes * 60_000 : null,
)

useIdleTimer(idleMs, async () => {
  idleMinutes.value = auth.idleTimeoutMinutes
  idleLocked.value = true
  await auth.logout('IDLE_TIMEOUT')
  await router.replace(LOGIN_PATH)
})

// Session ended elsewhere (refresh failed, terminal deactivated): back to login.
watch(
  () => auth.status,
  async (now, before) => {
    if (before === 'authenticated' && now === 'anonymous' && !route.meta.public) {
      await router.replace({ path: LOGIN_PATH, query: { redirect: route.fullPath } })
    }
  },
)

function unlock() {
  idleLocked.value = false
}
</script>

<template>
  <RouterView />
  <Toast position="top-right" :pt="{ message: { 'data-testid': 'toast' } }" />
  <IdleLockOverlay v-if="idleLocked" :minutes="idleMinutes" @unlock="unlock" />
</template>
