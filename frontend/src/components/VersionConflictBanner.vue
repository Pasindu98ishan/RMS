<script setup lang="ts">
import Button from 'primevue/button'
import { VERSION_CONFLICT_TEXT } from '@/api/errors'

defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ reload: [] }>()
</script>

<template>
  <div class="banner banner-warn" role="alert" data-testid="version-conflict">
    <i class="pi pi-exclamation-triangle" aria-hidden="true" />
    <div class="body">
      <span>{{ VERSION_CONFLICT_TEXT }}</span>
      <Button
        label="Reload"
        icon="pi pi-refresh"
        size="small"
        outlined
        :loading="busy"
        data-testid="version-reload"
        @click="emit('reload')"
      />
    </div>
  </div>
</template>

<style scoped>
.body {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
</style>
