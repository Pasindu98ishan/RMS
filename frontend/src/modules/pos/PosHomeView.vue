<script setup lang="ts">
/** POS home / floor (placeholder until M1.2 orders). */
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const actions = [
  { label: 'New takeaway', icon: 'pi pi-shopping-bag', id: 'new-takeaway' },
  { label: 'New delivery', icon: 'pi pi-car', id: 'new-delivery' },
  { label: 'New credit', icon: 'pi pi-id-card', id: 'new-credit' },
  { label: 'Held orders', icon: 'pi pi-pause', id: 'held-orders' },
]
</script>

<template>
  <div class="pos-home" data-testid="pos-home">
    <section class="floor">
      <h2>Floor</h2>
      <p class="muted">The table plan with live status colours arrives with orders (milestone M1.2).</p>
      <div class="tables" aria-hidden="true">
        <div v-for="n in 12" :key="n" class="table">
          <span>T{{ n }}</span>
          <span class="chip chip-muted">Free</span>
        </div>
      </div>
    </section>
    <aside class="side">
      <p class="hello">
        Logged in as <strong>{{ auth.user?.fullName }}</strong>
      </p>
      <button
        v-for="a in actions"
        :key="a.id"
        type="button"
        class="big"
        disabled
        :data-testid="`pos-${a.id}`"
      >
        <i :class="a.icon" aria-hidden="true" />{{ a.label }}
      </button>
      <RouterLink
        v-if="auth.has('MENU_AVAILABILITY')"
        to="/pos/availability"
        class="big link"
        data-testid="pos-availability"
      >
        <i class="pi pi-ban" aria-hidden="true" />Sold-out board
      </RouterLink>
      <p class="muted small">Order buttons are enabled in M1.2.</p>
    </aside>
  </div>
</template>

<style scoped>
.pos-home {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 16px;
  height: 100%;
}

.floor,
.side {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--rms-border);
}

.floor h2 {
  font-size: 1.2rem;
  margin-bottom: 4px;
}

.tables {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.table {
  min-height: 96px;
  border-radius: 12px;
  border: 2px solid #d1d5db;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 1.3rem;
  font-weight: 700;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hello {
  margin: 0 0 4px;
}

.big {
  min-height: 64px;
  border-radius: 12px;
  border: 1px solid var(--rms-border);
  background: #f3f6f8;
  font: inherit;
  font-size: 1.1rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  color: inherit;
}

.big.link {
  text-decoration: none;
  background: #fff;
}

.big:disabled {
  opacity: 0.6;
}
</style>
