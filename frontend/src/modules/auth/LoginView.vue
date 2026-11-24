<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import AuthCard from './AuthCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useTerminalStore } from '@/stores/terminal'
import { useAction } from '@/composables/useAction'
import { landingFor, safeRedirect } from '@/router/access'
import { SETUP_PATH } from '@/router/guard'
import { TERMINAL_TYPE_LABEL } from '@/api/types'

const auth = useAuthStore()
const terminalStore = useTerminalStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const missing = ref(false)

const login = useAction(() => auth.login(username.value.trim(), password.value))

const notice = computed(() => {
  if (auth.endedReason === 'IDLE_TIMEOUT') return 'You were logged out because the terminal was idle.'
  if (auth.endedReason === 'EXPIRED') return 'Your session ended. Please log in again.'
  if (auth.endedReason === 'TERMINAL_REQUIRED_FOR_USER') {
    return 'This account can only sign in on a registered counter or kitchen device.'
  }
  return null
})

onMounted(() => document.getElementById('login-username')?.focus())

async function onSubmit() {
  missing.value = !username.value.trim() || !password.value
  if (missing.value) {
    login.reset()
    return
  }
  try {
    const session = await login.run()
    if (!session) return
    const target =
      safeRedirect(route.query.redirect) ??
      landingFor(
        { sessionType: session.sessionType, terminalType: session.terminal?.type, isRider: auth.isRider },
        (c) => session.permissions.includes(c),
      )
    await router.replace(target)
  } catch {
    password.value = ''
  }
}
</script>

<template>
  <AuthCard title="Log in" subtitle="Santhula Hotel - Restaurant Management">
    <div v-if="terminalStore.terminal" class="terminal-line">
      <i class="pi pi-desktop" aria-hidden="true" />
      <span data-testid="login-device">{{ terminalStore.terminal.name }}</span>
      <span class="chip chip-muted">{{ TERMINAL_TYPE_LABEL[terminalStore.terminal.type] }}</span>
    </div>
    <div v-else class="terminal-line personal">
      <i class="pi pi-mobile" aria-hidden="true" />
      <span data-testid="login-device">Personal device</span>
      <span class="muted small">Counter and kitchen staff sign in on the registered devices.</span>
    </div>

    <div
      v-if="terminalStore.problem"
      class="banner banner-danger"
      role="alert"
      data-testid="terminal-problem"
    >
      <i class="pi pi-exclamation-triangle" aria-hidden="true" />
      <div>
        <p style="margin: 0 0 8px">{{ terminalStore.problem }}</p>
        <Button
          label="Set up this device"
          size="small"
          severity="danger"
          outlined
          data-testid="goto-setup"
          @click="router.push(SETUP_PATH)"
        />
      </div>
    </div>
    <div v-else-if="notice" class="banner banner-info" data-testid="login-notice">
      <i class="pi pi-info-circle" aria-hidden="true" />
      <span>{{ notice }}</span>
    </div>

    <form class="stack" novalidate @submit.prevent="onSubmit">
      <div class="field">
        <label for="login-username">Username</label>
        <InputText
          id="login-username"
          v-model="username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          size="large"
          :disabled="login.busy.value"
          data-testid="login-username"
        />
      </div>
      <div class="field">
        <label for="login-password">Password</label>
        <InputText
          id="login-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          size="large"
          :disabled="login.busy.value"
          data-testid="login-password"
        />
      </div>
      <p v-if="login.error.value" class="field-error" role="alert" data-testid="login-error">
        {{ login.error.value.userMessage }}
      </p>
      <p v-else-if="missing" class="field-error" role="alert" data-testid="login-error">
        Enter your username and password.
      </p>
      <Button
        type="submit"
        label="Log in"
        icon="pi pi-sign-in"
        size="large"
        :loading="login.busy.value"
        :disabled="login.busy.value"
        class="submit"
        data-testid="login-submit"
      />
    </form>

    <template #after>
      <RouterLink to="/setup/terminal" class="setup-link" data-testid="link-terminal-setup"
        >Set up this device</RouterLink
      >
    </template>
  </AuthCard>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.submit {
  min-height: 52px;
}

.terminal-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f3f6f8;
  font-weight: 600;
  flex-wrap: wrap;
}

.terminal-line.personal {
  font-weight: 500;
}

.setup-link {
  color: var(--rms-muted);
  font-size: 0.9rem;
}
</style>
