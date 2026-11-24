import { onScopeDispose, ref } from 'vue'

/** Browser network state. The KDS adds its WebSocket state on top of this in M1.3. */
export function useOnline() {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const up = () => (online.value = true)
  const down = () => (online.value = false)
  window.addEventListener('online', up)
  window.addEventListener('offline', down)
  onScopeDispose(() => {
    window.removeEventListener('online', up)
    window.removeEventListener('offline', down)
  })
  return online
}
