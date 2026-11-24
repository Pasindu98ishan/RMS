/**
 * M1.0 endpoint paths relative to RMS_API_URL, taken from build/openapi.bundled.yaml (operationId in
 * the comment). There is NO PIN-check endpoint: PINs are verified inline by x-approval operations
 * (PLAN M1.0), the first of which arrives in M1.2.
 */
export const EP = {
  login: 'auth/login', // login (PUBLIC)
  refresh: 'auth/refresh', // refreshToken (PUBLIC)
  logout: 'auth/logout', // logout
  me: 'auth/me', // getCurrentUser
  myPassword: 'auth/me/password', // changeOwnPassword
  myPin: 'auth/me/pin', // setOwnPin
  users: 'users', // listUsers, createUser
  user: (id: string) => `users/${id}`, // getUser, updateUser
  activateUser: (id: string) => `users/${id}/activate`,
  deactivateUser: (id: string) => `users/${id}/deactivate`,
  resetPassword: (id: string) => `users/${id}/reset-password`,
  resetPin: (id: string) => `users/${id}/reset-pin`,
  userRoles: (id: string) => `users/${id}/roles`, // assignUserRoles
  unlockUser: (id: string) => `users/${id}/unlock`,
  roles: 'roles', // listRoles, createRole
  role: (id: string) => `roles/${id}`, // getRole, updateRole, deleteRole
  permissions: 'permissions', // listPermissions
  terminals: 'terminals', // listTerminals, registerTerminal (inline credentials)
  terminal: (id: string) => `terminals/${id}`,
  deactivateTerminal: (id: string) => `terminals/${id}/deactivate`,
  auditLog: 'audit-log', // searchAuditLog
  auditExport: 'audit-log/export', // exportAuditLog
  settings: {
    serviceCharges: 'settings/service-charges',
    tax: 'settings/tax',
    restaurant: 'settings/restaurant',
    businessDay: 'settings/business-day',
    idleTimeouts: 'settings/idle-timeouts',
  },
} as const;
