<script setup lang="ts">
/** Rider PWA shell (Phase 4). Stub: mobile-first header only. */
import { RouterView } from 'vue-router'
import UserMenu from '@/components/UserMenu.vue'
</script>

<template>
  <div class="rider">
    <header class="rider-bar">
      <span class="title">Deliveries</span>
      <UserMenu compact />
    </header>
    <main class="rider-main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.rider {
  min-height: 100vh;
  max-width: 600px;
  margin: 0 auto;
  background: #fff;
}

.rider-bar {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  min-height: 56px;
  border-bottom: 1px solid var(--rms-border);
  background: #fff;
}

.title {
  font-weight: 700;
  font-size: 1.1rem;
}

.rider-main {
  padding: 16px;
}
</style>
