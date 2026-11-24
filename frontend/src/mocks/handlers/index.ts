import { auditHandlers } from './audit'
import { authHandlers } from './auth'
import { catalogSettingsHandlers } from './catalogSettings'
import { floorHandlers } from './floor'
import { importHandlers } from './importer'
import { menuHandlers } from './menu'
import { gatekeeper } from './gatekeeper'
import { roleHandlers } from './roles'
import { settingsHandlers } from './settings'
import { terminalHandlers } from './terminals'
import { userHandlers } from './users'

/** All 81 operations (M1.0 + M1.1). The gatekeeper runs first (token, terminal, x-permission). */
export const handlers = [
  gatekeeper,
  ...authHandlers,
  ...userHandlers,
  ...roleHandlers,
  ...terminalHandlers,
  ...auditHandlers,
  ...settingsHandlers,
  ...menuHandlers,
  ...floorHandlers,
  ...catalogSettingsHandlers,
  ...importHandlers,
]
