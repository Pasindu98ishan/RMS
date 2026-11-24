import { computed, ref, shallowRef, type Ref } from 'vue'
import { isApiError, type ApiError } from '@/api/errors'

/**
 * One settings resource (GET + PUT with version): a local form copy, dirty tracking, field errors
 * and version-conflict state.
 */
export function useSettingSection<T extends { version: number }, F extends object>(opts: {
  get: () => Promise<T>
  toForm: (data: T) => F
  /** Builds and sends the PUT from the form; client-side validation errors are returned instead. */
  put: (form: F, current: T) => Promise<T> | Record<string, string>
}) {
  const data = shallowRef<T | null>(null)
  const form = ref(null) as Ref<F | null>
  const loading = ref(false)
  const saving = ref(false)
  const error = shallowRef<ApiError | null>(null)
  const fieldErrors = ref<Record<string, string>>({})

  const dirty = computed(
    () =>
      data.value !== null &&
      form.value !== null &&
      JSON.stringify(form.value) !== JSON.stringify(opts.toForm(data.value)),
  )
  const conflict = computed(() => error.value?.isVersionConflict ?? false)

  async function load() {
    loading.value = true
    error.value = null
    fieldErrors.value = {}
    try {
      const d = await opts.get()
      data.value = d
      form.value = opts.toForm(d)
    } catch (e) {
      if (isApiError(e)) error.value = e
      throw e
    } finally {
      loading.value = false
    }
  }

  /** Resolves true when saved (or nothing to save), false on any error. */
  async function save(): Promise<boolean> {
    if (!dirty.value || !data.value || !form.value || saving.value) return true
    error.value = null
    fieldErrors.value = {}
    const result = opts.put(form.value, data.value)
    if (!(result instanceof Promise)) {
      fieldErrors.value = result
      if (Object.keys(result).length) return false
      return true
    }
    saving.value = true
    try {
      const d = await result
      data.value = d
      form.value = opts.toForm(d)
      return true
    } catch (e) {
      if (isApiError(e)) {
        error.value = e
        fieldErrors.value = e.fieldErrorMap
      }
      return false
    } finally {
      saving.value = false
    }
  }

  function revert() {
    if (data.value) form.value = opts.toForm(data.value)
    error.value = null
    fieldErrors.value = {}
  }

  return { data, form, loading, saving, error, fieldErrors, dirty, conflict, load, save, revert }
}
