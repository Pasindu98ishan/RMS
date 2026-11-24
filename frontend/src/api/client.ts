/**
 * The one typed API client (ADR-005): openapi-fetch over the generated `paths`, with middleware for
 *  - Authorization: Bearer <accessToken> (skipped for operations with `security: []`)
 *  - X-Terminal-Id on every call from a registered device
 *  - Idempotency-Key on `x-idempotent` operations (kept if the caller already set one, so a retry of
 *    the same user action reuses its key)
 *  - refresh-on-401 with a single in-flight refresh, then one retry of the original request
 *  - problem+json -> thrown ApiError (network failures -> ApiError NETWORK_ERROR)
 *
 * Because errors are thrown, `data` is always present on a resolved call (except 204 responses).
 */
import createClient, { type Client, type Middleware } from 'openapi-fetch'
import type { paths } from './generated/schema'
import { OPERATIONS, type OperationMeta } from './generated/operations'
import { ApiError, apiErrorFromResponse, networkError } from './errors'

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export interface AuthHooks {
  /** Current access token, if logged in. */
  getAccessToken(): string | null | undefined
  /** Id of the registered terminal this device is, if any. */
  getTerminalId(): string | null | undefined
  /** Whether a refresh token exists (otherwise a 401 is final). */
  canRefresh(): boolean
  /** Performs POST /auth/refresh and stores the new tokens. Resolves false if the session is gone. */
  refresh(): Promise<boolean>
  /** Called once a 401 cannot be recovered by refreshing. */
  onSessionExpired(error: ApiError): void
}

const NO_HOOKS: AuthHooks = {
  getAccessToken: () => null,
  getTerminalId: () => null,
  canRefresh: () => false,
  refresh: async () => false,
  onSessionExpired: () => undefined,
}

const META_BY_KEY = new Map<string, OperationMeta>(OPERATIONS.map((op) => [`${op.method} ${op.path}`, op]))

export function operationMeta(method: string, schemaPath: string): OperationMeta | undefined {
  return META_BY_KEY.get(`${method.toUpperCase()} ${schemaPath}`)
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

export interface ApiClientOptions {
  baseUrl?: string
  hooks?: AuthHooks
  /** Defaults to a late-bound globalThis.fetch (so test interceptors installed later still apply). */
  fetch?: (request: Request) => Promise<Response>
}

export type ApiClient = Client<paths> & {
  /** Replaces the auth hooks (the auth store installs them at start-up). */
  setAuthHooks(hooks: AuthHooks): void
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  let hooks = options.hooks ?? NO_HOOKS
  const doFetch = options.fetch ?? ((request: Request) => globalThis.fetch(request))
  /** Untouched copies of requests that may need a retry after a refresh, keyed by openapi-fetch's id. */
  const retryCopies = new Map<string, Request>()
  let refreshInFlight: Promise<boolean> | null = null

  function refreshOnce(): Promise<boolean> {
    if (!refreshInFlight) {
      refreshInFlight = hooks
        .refresh()
        .catch(() => false)
        .finally(() => {
          refreshInFlight = null
        })
    }
    return refreshInFlight
  }

  const middleware: Middleware = {
    onRequest({ request, schemaPath, id }) {
      const meta = operationMeta(request.method, schemaPath)
      const noBearer = meta?.noBearer ?? false
      const token = hooks.getAccessToken()
      if (!noBearer && token) request.headers.set('Authorization', `Bearer ${token}`)
      const terminalId = hooks.getTerminalId()
      if (terminalId && !request.headers.has('X-Terminal-Id'))
        request.headers.set('X-Terminal-Id', terminalId)
      if (meta?.idempotent && !request.headers.has('Idempotency-Key')) {
        request.headers.set('Idempotency-Key', newIdempotencyKey())
      }
      if (!noBearer) retryCopies.set(id, request.clone())
      return request
    },

    async onResponse({ request, response, schemaPath, id }) {
      const meta = operationMeta(request.method, schemaPath)
      const copy = retryCopies.get(id)
      retryCopies.delete(id)
      let res = response

      if (res.status === 401 && !(meta?.noBearer ?? false) && copy) {
        const firstError = await apiErrorFromResponse(res)
        if (!hooks.canRefresh()) {
          hooks.onSessionExpired(firstError)
          throw firstError
        }
        const refreshed = await refreshOnce()
        if (!refreshed) {
          hooks.onSessionExpired(firstError)
          throw firstError
        }
        const retry = copy.clone()
        const token = hooks.getAccessToken()
        if (token) retry.headers.set('Authorization', `Bearer ${token}`)
        try {
          res = await doFetch(retry)
        } catch (e) {
          throw networkError(e)
        }
        if (res.status === 401) {
          const err = await apiErrorFromResponse(res)
          hooks.onSessionExpired(err)
          throw err
        }
      }

      if (!res.ok) throw await apiErrorFromResponse(res)
      return res === response ? undefined : res
    },

    onError({ error, id }) {
      retryCopies.delete(id)
      if (error instanceof ApiError) return error
      return networkError(error)
    },
  }

  const client = createClient<paths>({ baseUrl: options.baseUrl ?? API_BASE, fetch: doFetch })
  client.use(middleware)
  return Object.assign(client, {
    setAuthHooks(next: AuthHooks) {
      hooks = next
    },
  })
}

/** App-wide client. The auth store installs its hooks on start-up. */
export const api = createApiClient()

/**
 * Narrows an openapi-fetch result to its data. The middleware throws on every non-2xx response,
 * so a missing body here means the server broke the contract.
 */
export async function data<T>(call: Promise<{ data?: T; response: Response }>): Promise<T> {
  const { data: body, response } = await call
  if (body === undefined) {
    throw new ApiError({
      status: response.status,
      code: 'EMPTY_RESPONSE',
      title: 'Empty response',
      detail: 'The server sent an empty response.',
    })
  }
  return body
}

/** For 204 operations: awaits the call and discards the (empty) body. */
export async function done(call: Promise<unknown>): Promise<void> {
  await call
}
