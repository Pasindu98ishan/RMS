import { api, data } from './client'
import type {
  ListTerminalsQuery,
  RegisterTerminalRequest,
  Terminal,
  TerminalRegistration,
  TerminalSetupOptions,
  TerminalSummary,
  UpdateTerminalRequest,
} from './types'

const id = (terminalId: string) => ({ params: { path: { terminalId } } })

export const terminalsApi = {
  list(query: ListTerminalsQuery = {}) {
    return data<TerminalSummary[]>(api.GET('/terminals', { params: { query } }))
  },
  /** No bearer token: owner credentials travel in the body (x-auth: INLINE_CREDENTIALS). */
  register(body: RegisterTerminalRequest) {
    return data<TerminalRegistration>(api.POST('/terminals', { body }))
  },
  /** Stations and ordering points for the setup screen: no token, owner credentials inline. */
  setupOptions(credentials: RegisterTerminalRequest['credentials']) {
    return data<TerminalSetupOptions>(api.POST('/terminals/setup-options', { body: credentials }))
  },
  get(terminalId: string) {
    return data<Terminal>(api.GET('/terminals/{terminalId}', id(terminalId)))
  },
  update(terminalId: string, body: UpdateTerminalRequest) {
    return data<Terminal>(api.PUT('/terminals/{terminalId}', { ...id(terminalId), body }))
  },
  deactivate(terminalId: string) {
    return data<Terminal>(api.POST('/terminals/{terminalId}/deactivate', id(terminalId)))
  },
}
