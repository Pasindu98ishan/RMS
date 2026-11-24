import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useIdleTimer } from '../useIdleTimer'

const MIN = 60_000

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useIdleTimer', () => {
  it('P1-AUTH-03 fires once after the timeout without input', () => {
    const scope = effectScope()
    const onIdle = vi.fn()
    scope.run(() => useIdleTimer(ref(10 * MIN), onIdle))
    vi.advanceTimersByTime(10 * MIN - 1000)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(onIdle).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30 * MIN)
    expect(onIdle).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('P1-AUTH-03 input resets the timer', () => {
    const scope = effectScope()
    const onIdle = vi.fn()
    scope.run(() => useIdleTimer(ref(10 * MIN), onIdle))
    vi.advanceTimersByTime(9 * MIN)
    window.dispatchEvent(new Event('keydown'))
    vi.advanceTimersByTime(9 * MIN)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1 * MIN + 1)
    expect(onIdle).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('P1-AUTH-03 a null timeout (KITCHEN / DISPLAY) never fires', async () => {
    const scope = effectScope()
    const onIdle = vi.fn()
    const timeout = ref<number | null>(10 * MIN)
    scope.run(() => useIdleTimer(timeout, onIdle))
    timeout.value = null
    await nextTick()
    vi.advanceTimersByTime(12 * 60 * MIN)
    expect(onIdle).not.toHaveBeenCalled()
    scope.stop()
  })
})
