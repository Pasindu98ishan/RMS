<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; wide?: boolean }>()
</script>

<template>
  <div class="auth-page">
    <section class="auth-card" :class="{ wide }">
      <header class="auth-head">
        <span class="logo" aria-hidden="true">RMS</span>
        <div>
          <h1>{{ title }}</h1>
          <p v-if="subtitle" class="muted">{{ subtitle }}</p>
        </div>
      </header>
      <slot />
    </section>
    <slot name="after" />
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px 16px;
  background: linear-gradient(160deg, #0b3b38 0%, #0f766e 55%, #e6f4f2 55.1%);
}

.auth-card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 16px;
  padding: 28px 24px;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.auth-card.wide {
  max-width: 560px;
}

.auth-head {
  display: flex;
  gap: 12px;
  align-items: center;
}

.auth-head h1 {
  font-size: 1.35rem;
}

.auth-head p {
  margin: 2px 0 0;
  font-size: 0.9rem;
}

.logo {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--rms-primary);
  color: #fff;
  font-weight: 800;
  font-size: 0.85rem;
}
</style>
