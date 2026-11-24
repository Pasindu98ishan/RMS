import { api, data, done } from './client'
import type { CreateRoleRequest, Permission, Role, RoleOption, RoleSummary, UpdateRoleRequest } from './types'

const id = (roleId: string) => ({ params: { path: { roleId } } })

export const rolesApi = {
  list() {
    return data<RoleSummary[]>(api.GET('/roles'))
  },
  get(roleId: string) {
    return data<Role>(api.GET('/roles/{roleId}', id(roleId)))
  },
  create(body: CreateRoleRequest) {
    return data<Role>(api.POST('/roles', { body }))
  },
  update(roleId: string, body: UpdateRoleRequest) {
    return data<Role>(api.PUT('/roles/{roleId}', { ...id(roleId), body }))
  },
  remove(roleId: string) {
    return done(api.DELETE('/roles/{roleId}', id(roleId)))
  },
  /** Role choices for the user forms (needs USER_MANAGE only). */
  options() {
    return data<RoleOption[]>(api.GET('/roles/options'))
  },
  permissions() {
    return data<Permission[]>(api.GET('/permissions'))
  },
}
