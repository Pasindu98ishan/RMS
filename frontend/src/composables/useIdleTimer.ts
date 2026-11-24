import { onScopeDispose, watch, type Ref } from 'vue'

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

/**
 * Calls `onIdle` once after `timeoutMs` without user input (P1-AUTH-03). Null timeout = disabled
 * (KITCHEN / DISPLAY terminals). Uses wall-clock time, so a sleeping tab locks as soon as it wakes.
 */
export function useIdleTimer(timeoutMs: Ref<number | null>, onIdle: () => void) {
  let lastActivity = Date.now()
  let timer: ReturnType<typeof setTimeout> | null = null
  let fired = false

  const markActive = () => {
    lastActivity = Date.now()
  }

  function clear() {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function check() {
    const limit = timeoutMs.value
    if (limit === null || fired) return
    const remaining = lastActivity + limit - Date.now()
    if (remaining <= 0) {
      fired = true
      clear()
      onIdle()
      return
    }
    clear()
    timer = setTimeout(check, remaining)
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') check()
  }

  function start() {
    stop()
    fired = false
    markActive()
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true, capture: true }))
    document.addEventListener('visibilitychange', onVisibility)
    check()
  }

  function stop() {
    clear()
    ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive, { capture: true }))
    document.removeEventListener('visibilitychange', onVisibility)
  }

  watch(
    timeoutMs,
    (ms) => {
      if (ms === null) stop()
      else start()
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  return { reset: markActive, stop }
}
