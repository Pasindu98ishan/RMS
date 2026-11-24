<script setup lang="ts">
/** KDS board (placeholder until M1.3: KOT cards, waiting timers, one-tap status). */
</script>

<template>
  <div class="board" data-testid="kds-board">
    <div class="empty">
      <i class="pi pi-inbox" aria-hidden="true" />
      <p>No tickets</p>
      <p class="sub">Kitchen tickets appear here when orders are sent (milestone M1.3).</p>
    </div>
  </div>
</template>

<style scoped>
.board {
  min-height: calc(100vh - 120px);
  display: grid;
  place-items: center;
}

.empty {
  text-align: center;
  color: #9ca3af;
}

.empty i {
  font-size: 4rem;
}

.empty p {
  margin: 8px 0 0;
  font-size: 1.8rem;
  font-weight: 700;
}

.empty .sub {
  font-size: 1.1rem;
  font-weight: 400;
}
</style>
