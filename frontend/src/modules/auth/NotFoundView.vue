<script setup lang="ts">
import AuthCard from './AuthCard.vue'
</script>

<template>
  <AuthCard title="Page not found">
    <p data-testid="not-found-page">
      This page does not exist. <RouterLink to="/">Go to the start screen</RouterLink>.
    </p>
  </AuthCard>
</template>
