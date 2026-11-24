<script setup lang="ts">
/** Large display (Phase 2 inventory). Placeholder; auto-refreshes once data exists. */
</script>

<template>
  <div class="display-empty" data-testid="display-home">
    <p>Santhula Hotel</p>
    <p class="sub">The inventory display arrives in Phase 2.</p>
  </div>
</template>

<style scoped>
.display-empty {
  height: 100%;
  display: grid;
  place-content: center;
  text-align: center;
}

.display-empty p {
  margin: 0;
  font-size: 3rem;
  font-weight: 800;
}

.display-empty .sub {
  font-size: 1.4rem;
  font-weight: 400;
  color: #94a3b8;
}
</style>
