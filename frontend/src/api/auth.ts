import { api, data, done } from './client'
import type { AuthSession, CurrentUserProfile, LogoutReason } from './types'

export const authApi = {
  /**
   * Terminal session: pass this device's terminal id + device token (both).
   * Personal session (ADR-008): pass null and neither is sent.
   */
  login(
    device: { terminalId: string; deviceToken: string } | null,
    credentials: { username: string; password: string },
  ) {
    return data<AuthSession>(
      api.POST('/auth/login', {
        params: device ? { header: { 'X-Terminal-Id': device.terminalId } } : {},
        body: device ? { ...credentials, deviceToken: device.deviceToken } : credentials,
      }),
    )
  },
  /** The header must match the session kind: the terminal id for a terminal session, none for a personal one. */
  refresh(terminalId: string | null, refreshToken: string) {
    return data<AuthSession>(
      api.POST('/auth/refresh', {
        params: terminalId ? { header: { 'X-Terminal-Id': terminalId } } : {},
        body: { refreshToken },
      }),
    )
  },
  logout(refreshToken: string, reason: LogoutReason) {
    return done(api.POST('/auth/logout', { body: { refreshToken, reason } }))
  },
  me() {
    return data<CurrentUserProfile>(api.GET('/auth/me'))
  },
  changeOwnPassword(currentPassword: string, newPassword: string) {
    return done(api.POST('/auth/me/password', { body: { currentPassword, newPassword } }))
  },
  setOwnPin(currentPassword: string, newPin: string) {
    return done(api.POST('/auth/me/pin', { body: { currentPassword, newPin } }))
  },
}
