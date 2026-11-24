import { ref } from 'vue'
import { rolesApi } from '@/api/roles'
import type { RoleOption } from '@/api/types'

/** Role choices for the user forms: GET /roles/options (USER_MANAGE; no ROLE_MANAGE needed). */
export function useRoleOptions() {
  const roles = ref<RoleOption[]>([])

  async function load() {
    roles.value = await rolesApi.options()
  }

  return { roles, load }
}
