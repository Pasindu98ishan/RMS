import { useToast } from 'primevue/usetoast'
import { errorMessage, isApiError, VERSION_CONFLICT_TEXT } from '@/api/errors'

/** Toasts. Server error text (`detail`) is shown as-is (screens.md design rules). */
export function useNotify() {
  const toast = useToast()
  return {
    success(summary: string, detail?: string) {
      toast.add({ severity: 'success', summary, detail, life: 3000 })
    },
    info(summary: string, detail?: string) {
      toast.add({ severity: 'info', summary, detail, life: 4000 })
    },
    error(e: unknown, summary = 'Could not complete') {
      const detail = isApiError(e) && e.isVersionConflict ? VERSION_CONFLICT_TEXT : errorMessage(e)
      toast.add({ severity: 'error', summary, detail, life: 6000 })
    },
  }
}
