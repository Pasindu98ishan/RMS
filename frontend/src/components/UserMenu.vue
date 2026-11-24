<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Menu from 'primevue/menu'
import type { MenuItem } from 'primevue/menuitem'
import ChangePasswordDialog from './ChangePasswordDialog.vue'
import SetPinDialog from './SetPinDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { LOGIN_PATH } from '@/router/guard'

withDefaults(defineProps<{ compact?: boolean; dark?: boolean }>(), { compact: false, dark: false })

const auth = useAuthStore()
const router = useRouter()
const menu = ref<InstanceType<typeof Menu> | null>(null)
const showPassword = ref(false)
const showPin = ref(false)
const pinJustSet = ref(false)

const needsPin = computed(() => auth.user && !auth.user.pinSet && !pinJustSet.value)

const items = computed<MenuItem[]>(() => [
  { label: auth.user?.fullName ?? '', disabled: true, class: 'menu-who' },
  {
    label: auth.isPersonal ? 'Personal device' : (auth.terminal?.name ?? ''),
    icon: auth.isPersonal ? 'pi pi-mobile' : 'pi pi-desktop',
    disabled: true,
    testid: 'menu-device',
  },
  { separator: true },
  {
    label: 'Change password',
    icon: 'pi pi-key',
    testid: 'menu-change-password',
    command: () => (showPassword.value = true),
  },
  {
    label: needsPin.value ? 'Set my PIN (not set)' : 'Change my PIN',
    icon: 'pi pi-lock',
    testid: 'menu-set-pin',
    command: () => (showPin.value = true),
  },
  { separator: true },
  { label: 'Log out', icon: 'pi pi-sign-out', testid: 'logout', command: logout },
])

async function logout() {
  await auth.logout('USER')
  await router.replace(LOGIN_PATH)
}

function toggle(e: Event) {
  menu.value?.toggle(e)
}
</script>

<template>
  <button
    type="button"
    class="user-btn"
    :class="{ dark }"
    aria-haspopup="true"
    aria-controls="user-menu-popup"
    data-testid="user-menu"
    @click="toggle"
  >
    <i class="pi pi-user" aria-hidden="true" />
    <span v-if="!compact" class="name">{{ auth.user?.fullName }}</span>
    <span v-if="needsPin" class="dot" title="Approval PIN not set" />
    <i class="pi pi-angle-down" aria-hidden="true" />
  </button>
  <Menu id="user-menu-popup" ref="menu" :model="items" popup>
    <template #item="{ item, props: p }">
      <a v-bind="p.action" :data-testid="item.testid" :class="item.class">
        <span v-if="item.icon" :class="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </a>
    </template>
  </Menu>
  <ChangePasswordDialog v-model:visible="showPassword" />
  <SetPinDialog v-model:visible="showPin" @saved="pinJustSet = true" />
</template>

<style scoped>
.user-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  /* Touch target: at least 48 x 48 px on POS and kitchen screens (screens.md design rules). */
  min-height: 48px;
  min-width: 48px;
  justify-content: center;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--rms-border);
  background: #fff;
  color: inherit;
  font: inherit;
  cursor: pointer;
  position: relative;
  max-width: 260px;
}

.user-btn.dark {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.25);
  color: #fff;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--rms-warn);
}

@media (max-width: 600px) {
  .name {
    display: none;
  }
}

:deep(.menu-who) {
  font-weight: 600;
  opacity: 1 !important;
}
</style>
