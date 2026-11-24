import { ref } from 'vue'
import { ApiError, isApiError } from '@/api/errors'

/**
 * Wraps an async user action: one run at a time (no double submit), `busy` for spinners, the last
 * ApiError and its field errors for inline display.
 */
export function useAction<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  const busy = ref(false)
  const error = ref<ApiError | null>(null)
  const fieldErrors = ref<Record<string, string>>({})

  async function run(...args: Args): Promise<R | undefined> {
    if (busy.value) return undefined
    busy.value = true
    error.value = null
    fieldErrors.value = {}
    try {
      return await fn(...args)
    } catch (e) {
      if (isApiError(e)) {
        error.value = e
        fieldErrors.value = e.fieldErrorMap
      }
      throw e
    } finally {
      busy.value = false
    }
  }

  function reset() {
    error.value = null
    fieldErrors.value = {}
  }

  return { run, busy, error, fieldErrors, reset }
}
