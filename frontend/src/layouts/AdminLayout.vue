<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import UserMenu from '@/components/UserMenu.vue'
import TerminalBadge from '@/components/TerminalBadge.vue'
import { useAuthStore } from '@/stores/auth'
import { canAccess, KITCHEN_AREA, POS_AREA } from '@/router/access'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const drawerOpen = ref(false)

/** Side menu entries: admin child routes with `meta.nav`, filtered by permission. */
const navItems = computed(() => {
  const admin = router.options.routes.find((r) => r.path === '/admin')
  return (admin?.children ?? [])
    .filter((c) => c.meta?.nav && canAccess(c.meta, auth.has))
    .map((c) => {
      const path = c.path ? `/admin/${c.path}` : '/admin'
      return {
        path,
        label: c.meta!.nav!.label,
        icon: c.meta!.nav!.icon,
        group: c.meta!.nav!.group ?? '',
        testid: `nav-${path.replace(/^\//, '').replace(/\//g, '-')}`,
      }
    })
})

/** Entries in menu order, grouped under headings (the first, ungrouped entry is Home). */
const navGroups = computed(() => {
  const groups: Array<{ name: string; items: typeof navItems.value }> = []
  for (const item of navItems.value) {
    const last = groups[groups.length - 1]
    if (last && last.name === item.group) last.items.push(item)
    else groups.push({ name: item.group, items: [item] })
  }
  return groups
})

// POS and kitchen need a terminal session (ADR-008): not offered in a personal session.
const otherAreas = computed(() =>
  (auth.isPersonal
    ? []
    : [
        {
          path: '/pos',
          label: 'POS',
          icon: 'pi pi-shopping-cart',
          ok: canAccess({ anyOf: POS_AREA }, auth.has),
        },
        {
          path: '/kitchen',
          label: 'Kitchen',
          icon: 'pi pi-th-large',
          ok: canAccess({ anyOf: KITCHEN_AREA }, auth.has),
        },
      ]
  ).filter((a) => a.ok),
)

const title = computed(() => route.meta.title ?? 'Admin')

watch(
  () => route.fullPath,
  () => (drawerOpen.value = false),
)
</script>

<template>
  <div class="admin" :class="{ 'drawer-open': drawerOpen }">
    <header class="topbar">
      <Button
        class="menu-toggle"
        icon="pi pi-bars"
        text
        rounded
        aria-label="Open menu"
        data-testid="nav-toggle"
        @click="drawerOpen = !drawerOpen"
      />
      <RouterLink to="/admin" class="brand">
        <span class="logo" aria-hidden="true">RMS</span>
        <span class="brand-name">Santhula Hotel</span>
      </RouterLink>
      <h1 class="page-title">{{ title }}</h1>
      <div class="spacer" />
      <TerminalBadge class="badge" />
      <UserMenu />
    </header>

    <nav class="side" aria-label="Admin" data-testid="app-nav">
      <template v-for="g in navGroups" :key="g.name">
        <div v-if="g.name" class="nav-sep">{{ g.name }}</div>
        <RouterLink
          v-for="item in g.items"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{
            active: item.path === '/admin' ? route.path === '/admin' : route.path.startsWith(item.path),
          }"
          :data-testid="item.testid"
        >
          <i :class="item.icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </template>
      <template v-if="otherAreas.length">
        <div class="nav-sep">Other screens</div>
        <RouterLink
          v-for="a in otherAreas"
          :key="a.path"
          :to="a.path"
          class="nav-item"
          :data-testid="`nav-${a.path.slice(1)}`"
        >
          <i :class="a.icon" aria-hidden="true" />
          <span>{{ a.label }}</span>
        </RouterLink>
      </template>
    </nav>
    <div class="scrim" aria-hidden="true" @click="drawerOpen = false" />

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.admin {
  --side-w: 232px;
  --top-h: 60px;
  min-height: 100vh;
  display: grid;
  grid-template-columns: var(--side-w) minmax(0, 1fr);
  grid-template-rows: var(--top-h) 1fr;
  grid-template-areas:
    'top top'
    'side main';
}

.topbar {
  grid-area: top;
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid var(--rms-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: inherit;
  width: calc(var(--side-w) - 32px);
}

.logo {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--rms-primary);
  color: #fff;
  font-weight: 800;
  font-size: 0.75rem;
}

.brand-name {
  font-weight: 700;
}

.page-title {
  min-width: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--rms-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spacer {
  flex: 1;
}

.menu-toggle {
  display: none;
}

.side {
  grid-area: side;
  position: sticky;
  top: var(--top-h);
  height: calc(100vh - var(--top-h));
  overflow-y: auto;
  background: #fff;
  border-right: 1px solid var(--rms-border);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 0 12px;
  border-radius: 8px;
  color: var(--rms-text);
  text-decoration: none;
  font-weight: 500;
}

.nav-item:hover {
  background: #f1f5f9;
}

.nav-item.active {
  background: var(--rms-primary-soft);
  color: var(--rms-primary);
  font-weight: 700;
}

.nav-sep {
  margin: 12px 12px 2px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--rms-muted);
}

.content {
  grid-area: main;
  padding: 20px 24px 40px;
  min-width: 0;
}

.scrim {
  display: none;
}

@media (max-width: 900px) {
  .admin {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'top'
      'main';
  }

  .menu-toggle {
    display: inline-flex;
  }

  .brand {
    width: auto;
  }

  .brand-name {
    display: none;
  }

  .badge {
    max-width: 120px;
  }

  .topbar {
    padding: 0 8px;
    gap: 6px;
  }

  .side {
    position: fixed;
    top: var(--top-h);
    left: 0;
    bottom: 0;
    height: auto;
    width: min(280px, 84vw);
    z-index: 30;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: 4px 0 18px rgba(0, 0, 0, 0.12);
  }

  .drawer-open .side {
    transform: none;
  }

  .drawer-open .scrim {
    display: block;
    position: fixed;
    inset: var(--top-h) 0 0 0;
    background: rgba(15, 23, 42, 0.35);
    z-index: 25;
  }

  .content {
    padding: 16px;
  }
}
</style>
