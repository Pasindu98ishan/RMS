import { onScopeDispose, ref } from 'vue'

/** A Date ref that ticks every `intervalMs` (for header clocks and timers). */
export function useClock(intervalMs = 1000) {
  const now = ref(new Date())
  const id = setInterval(() => (now.value = new Date()), intervalMs)
  onScopeDispose(() => clearInterval(id))
  return now
}
