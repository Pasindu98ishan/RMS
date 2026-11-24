<script setup lang="ts">
/**
 * /home - personal-session home (ADR-008) for users with no admin or rider screens yet: their name,
 * change password / PIN, log out.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import AuthCard from './AuthCard.vue'
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'
import SetPinDialog from '@/components/SetPinDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { LOGIN_PATH } from '@/router/guard'

const auth = useAuthStore()
const router = useRouter()
const showPassword = ref(false)
const showPin = ref(false)
const roles = computed(() => auth.user?.roles.map((r) => r.name).join(', ') ?? '')

async function logout() {
  await auth.logout('USER')
  await router.replace(LOGIN_PATH)
}
</script>

<template>
  <AuthCard :title="auth.user?.fullName ?? 'Home'" :subtitle="roles">
    <div class="stack" data-testid="home-page">
      <p class="device" data-testid="header-terminal">
        <i class="pi pi-mobile" aria-hidden="true" />
        {{ auth.terminal?.name ?? 'Personal device' }}
      </p>
      <p class="muted">
        There is nothing for your role to do on a personal device yet. Counter and kitchen work happens on the
        registered devices in the restaurant.
      </p>
      <div class="actions">
        <Button
          label="Change password"
          icon="pi pi-key"
          outlined
          data-testid="home-change-password"
          @click="showPassword = true"
        />
        <Button
          label="Set my PIN"
          icon="pi pi-lock"
          outlined
          data-testid="home-set-pin"
          @click="showPin = true"
        />
        <Button
          label="Log out"
          icon="pi pi-sign-out"
          severity="secondary"
          data-testid="logout"
          @click="logout"
        />
      </div>
    </div>
    <ChangePasswordDialog v-model:visible="showPassword" />
    <SetPinDialog v-model:visible="showPin" />
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

.device {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.actions :deep(.p-button) {
  min-height: 48px;
}
</style>
