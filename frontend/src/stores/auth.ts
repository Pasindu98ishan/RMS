import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { api } from '@/api/client'
import { authApi } from '@/api/auth'
import { isApiError } from '@/api/errors'
import type {
  AuthSession,
  AuthUser,
  LogoutReason,
  PermissionCode,
  SessionType,
  TerminalSummary,
} from '@/api/types'
import { readJson, removeKey, STORAGE_KEYS, writeJson } from '@/utils/storage'
import { useTerminalStore } from './terminal'

interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** Which kind of session the tokens belong to (decides the X-Terminal-Id header). Missing in pre-ADR-008 storage. */
  sessionType?: SessionType
}

export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated'
export type EndedReason = 'IDLE_TIMEOUT' | 'EXPIRED' | 'TERMINAL_REQUIRED_FOR_USER'

/** Errors at login that mean this device must be set up again. */
const TERMINAL_PROBLEMS = new Set(['TERMINAL_NOT_REGISTERED', 'TERMINAL_INACTIVE', 'TERMINAL_MISMATCH'])

/**
 * Two kinds of session (ADR-008): TERMINAL (logged in on a registered device; X-Terminal-Id on every
 * call) and PERSONAL (no terminal; the header is never sent).
 */
export const useAuthStore = defineStore('auth', () => {
  const terminalStore = useTerminalStore()

  const status = ref<AuthStatus>('unknown')
  const tokens = shallowRef<StoredTokens | null>(null)
  const user = ref<AuthUser | null>(null)
  const permissions = ref<ReadonlySet<PermissionCode>>(new Set())
  const sessionType = ref<SessionType | null>(null)
  /** Present in a TERMINAL session only. */
  const terminal = ref<TerminalSummary | null>(null)
  /** From the session: the terminal type's rule, the personal rule, or absent (KITCHEN / DISPLAY). */
  const idleTimeoutMinutes = ref<number | null>(null)
  /** Why the last session ended, for the login screen. */
  const endedReason = ref<EndedReason | null>(null)

  const isAuthenticated = computed(() => status.value === 'authenticated')
  const isPersonal = computed(() => sessionType.value === 'PERSONAL')
  const isTerminalSession = computed(() => sessionType.value === 'TERMINAL')
  const permissionList = computed(() => [...permissions.value])
  /** Riders land on the rider app in a personal session (matched on the stable role key). */
  const isRider = computed(() => Boolean(user.value?.roles.some((r) => r.key === 'RIDER')))

  function has(code: PermissionCode): boolean {
    return permissions.value.has(code)
  }
  function hasAny(codes: readonly PermissionCode[]): boolean {
    return codes.some((c) => permissions.value.has(c))
  }

  function setTokens(next: StoredTokens | null) {
    tokens.value = next
    if (next) writeJson(STORAGE_KEYS.session, next)
    else removeKey(STORAGE_KEYS.session)
  }

  /** The X-Terminal-Id this session must send: the device's id in a terminal session, none otherwise. */
  function sessionTerminalId(): string | null {
    const kind = tokens.value?.sessionType ?? sessionType.value
    return kind === 'TERMINAL' ? terminalStore.terminalId : null
  }

  function applyProfile(p: {
    user: AuthUser
    permissions: PermissionCode[]
    sessionType: SessionType
    terminal?: TerminalSummary
    idleTimeoutMinutes?: number
  }) {
    user.value = p.user
    permissions.value = new Set(p.permissions)
    sessionType.value = p.sessionType
    terminal.value = p.terminal ?? null
    idleTimeoutMinutes.value = p.idleTimeoutMinutes ?? null
    if (p.terminal) terminalStore.updateDetails(p.terminal)
    status.value = 'authenticated'
  }

  function applySession(s: AuthSession) {
    setTokens({ accessToken: s.accessToken, refreshToken: s.refreshToken, sessionType: s.sessionType })
    applyProfile(s)
  }

  function clear() {
    setTokens(null)
    user.value = null
    permissions.value = new Set()
    sessionType.value = null
    terminal.value = null
    idleTimeoutMinutes.value = null
    status.value = 'anonymous'
  }

  async function refresh(): Promise<boolean> {
    const refreshToken = tokens.value?.refreshToken
    if (!refreshToken) return false
    const terminalId = sessionTerminalId()
    if (tokens.value?.sessionType === 'TERMINAL' && !terminalId) return false
    try {
      // Refresh tokens are single-use: always keep the new pair.
      applySession(await authApi.refresh(terminalId, refreshToken))
      return true
    } catch (e) {
      // A personal session whose user lost LOGIN_ANY_DEVICE ends with this code (ADR-008 #5).
      if (isApiError(e) && e.code === 'TERMINAL_REQUIRED_FOR_USER')
        endedReason.value = 'TERMINAL_REQUIRED_FOR_USER'
      return false
    }
  }

  function sessionExpired() {
    if (status.value === 'authenticated' && endedReason.value !== 'TERMINAL_REQUIRED_FOR_USER') {
      endedReason.value = 'EXPIRED'
    }
    clear()
  }

  // Wire the API client to this store.
  api.setAuthHooks({
    getAccessToken: () => tokens.value?.accessToken,
    getTerminalId: sessionTerminalId,
    canRefresh: () => Boolean(tokens.value?.refreshToken),
    refresh,
    onSessionExpired: sessionExpired,
  })

  let initPromise: Promise<void> | null = null

  /** Restores a stored session after a reload (GET /auth/me; the client refreshes on 401). */
  function init(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        const stored = readJson<StoredTokens>(STORAGE_KEYS.session)
        if (!stored) {
          clear()
          return
        }
        // Sessions stored before ADR-008 were always terminal sessions.
        tokens.value = { ...stored, sessionType: stored.sessionType ?? 'TERMINAL' }
        try {
          applyProfile(await authApi.me())
        } catch {
          clear()
        }
      })()
    }
    return initPromise
  }

  /**
   * Registered device: terminal session (terminal id + device token). Unregistered device: personal
   * session (neither), allowed only for users holding LOGIN_ANY_DEVICE.
   */
  async function login(username: string, password: string): Promise<AuthSession> {
    const reg = terminalStore.registration
    try {
      const s = await authApi.login(
        reg ? { terminalId: reg.terminalId, deviceToken: reg.deviceToken } : null,
        { username, password },
      )
      endedReason.value = null
      applySession(s)
      return s
    } catch (e) {
      if (isApiError(e) && TERMINAL_PROBLEMS.has(e.code)) terminalStore.problem = e.userMessage
      throw e
    }
  }

  /** Revokes the refresh token on the server (best effort) and clears the session locally. */
  async function logout(reason: LogoutReason = 'USER'): Promise<void> {
    const refreshToken = tokens.value?.refreshToken
    if (reason === 'IDLE_TIMEOUT') endedReason.value = 'IDLE_TIMEOUT'
    try {
      if (refreshToken && status.value === 'authenticated') await authApi.logout(refreshToken, reason)
    } catch {
      /* the session is ended locally either way */
    } finally {
      clear()
    }
  }

  return {
    status,
    user,
    sessionType,
    isPersonal,
    isTerminalSession,
    isRider,
    terminal,
    idleTimeoutMinutes,
    endedReason,
    isAuthenticated,
    permissions,
    permissionList,
    has,
    hasAny,
    init,
    login,
    logout,
    refresh,
    sessionExpired,
  }
})
