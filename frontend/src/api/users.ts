import { api, data, done } from './client'
import type {
  CreateUserRequest,
  ListUsersQuery,
  UpdateUserRequest,
  User,
  UserOption,
  UserPage,
} from './types'

const id = (userId: string) => ({ params: { path: { userId } } })

export const usersApi = {
  list(query: ListUsersQuery) {
    return data<UserPage>(api.GET('/users', { params: { query } }))
  },
  /** Users for the audit-log filter (needs AUDIT_VIEW only; includes deactivated users). */
  options() {
    return data<UserOption[]>(api.GET('/users/options'))
  },
  get(userId: string) {
    return data<User>(api.GET('/users/{userId}', id(userId)))
  },
  create(body: CreateUserRequest) {
    return data<User>(api.POST('/users', { body }))
  },
  update(userId: string, body: UpdateUserRequest) {
    return data<User>(api.PUT('/users/{userId}', { ...id(userId), body }))
  },
  deactivate(userId: string) {
    return data<User>(api.POST('/users/{userId}/deactivate', id(userId)))
  },
  activate(userId: string) {
    return data<User>(api.POST('/users/{userId}/activate', id(userId)))
  },
  unlock(userId: string) {
    return data<User>(api.POST('/users/{userId}/unlock', id(userId)))
  },
  resetPassword(userId: string, newPassword: string) {
    return done(api.POST('/users/{userId}/reset-password', { ...id(userId), body: { newPassword } }))
  },
  resetPin(userId: string, newPin: string) {
    return done(api.POST('/users/{userId}/reset-pin', { ...id(userId), body: { newPin } }))
  },
  assignRoles(userId: string, roleIds: string[], version: number) {
    return data<User>(api.PUT('/users/{userId}/roles', { ...id(userId), body: { roleIds, version } }))
  },
}
