import type { components } from './generated/schema'

export type Problem = components['schemas']['Problem']
export type FieldError = components['schemas']['FieldError']

/**
 * Every non-2xx response (and network failure) becomes an ApiError. `detail` and
 * `fieldErrors[].message` are written by the server for the user and are shown as-is
 * (conventions.md "Errors").
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly title: string
  readonly detail: string | undefined
  readonly fieldErrors: readonly FieldError[]
  readonly traceId: string | undefined
  readonly problem: Problem | undefined
  /** Seconds from the Retry-After header (429 TooManyRequests), if sent. */
  readonly retryAfterSeconds: number | undefined

  constructor(init: {
    status: number
    code: string
    title: string
    detail?: string
    fieldErrors?: readonly FieldError[]
    traceId?: string
    problem?: Problem
    retryAfterSeconds?: number
  }) {
    super(init.detail ?? init.title)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.title = init.title
    this.detail = init.detail
    this.fieldErrors = init.fieldErrors ?? []
    this.traceId = init.traceId
    this.problem = init.problem
    this.retryAfterSeconds = init.retryAfterSeconds
  }

  /**
   * The text to show the user: the server's detail, else its title. A few codes have a fixed text the
   * UI always uses (ADR-008 session-kind errors).
   */
  get userMessage(): string {
    return CODE_TEXT[this.code] ?? this.detail ?? this.title
  }

  /** Field errors as a map (first message per field), for inline display. */
  get fieldErrorMap(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const fe of this.fieldErrors) if (!(fe.field in out)) out[fe.field] = fe.message
    return out
  }

  /**
   * "Try again in 3 minutes." from Retry-After, or null when the server sent none or its `detail`
   * already states the wait (so the UI never shows two wait lines).
   */
  get retryAfterText(): string | null {
    const s = this.retryAfterSeconds
    if (s === undefined) return null
    if (detailStatesWait(this.detail)) return null
    if (s < 60) return `Try again in ${s} second${s === 1 ? '' : 's'}.`
    const m = Math.ceil(s / 60)
    return `Try again in ${m} minute${m === 1 ? '' : 's'}.`
  }

  is(code: string): boolean {
    return this.code === code
  }

  get isVersionConflict(): boolean {
    return this.code === 'VERSION_CONFLICT'
  }
}

/** Codes whose message the UI fixes regardless of the server's detail (client decision #9). */
export const CODE_TEXT: Record<string, string> = {
  TERMINAL_REQUIRED_FOR_USER: 'This account can only sign in on a registered counter or kitchen device.',
  TERMINAL_REQUIRED: 'Use a registered counter device for this.',
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

/** True when text already says how long to wait ("in 15 minutes", "after 30 seconds", "wait 2 hours"). */
export function detailStatesWait(detail: string | undefined): boolean {
  return /\b\d+\s*(second|sec|minute|min|hour|hr)s?\b/i.test(detail ?? '')
}

function isProblem(v: unknown): v is Problem {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Problem).status === 'number' &&
    typeof (v as Problem).code === 'string'
  )
}

export const REJECTED_403_TEXT =
  "The server rejected this request (403). If you're developing, check the backend's allowed origins."

const FALLBACK_TEXT: Record<number, string> = {
  400: 'The request could not be read.',
  401: 'Your session has ended. Please log in again.',
  404: 'This record does not exist.',
  409: 'This could not be saved because of a conflict.',
  422: 'Some fields are missing or invalid.',
  423: 'This account is locked.',
  429: 'Too many attempts. Wait a few minutes and try again.',
  500: 'Something went wrong on the server. Please try again.',
  502: 'The server is not reachable right now. Please try again.',
  503: 'The server is not available right now. Please try again.',
}

/** Retry-After as seconds: delta-seconds or an HTTP date (RFC 9110). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^\d+$/.test(v)) return Number(v)
  const at = Date.parse(v)
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000))
}

/** Builds an ApiError from a failed Response; reads problem+json when present. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))
  let body: unknown
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('json')) {
    try {
      body = await response.clone().json()
    } catch {
      body = undefined
    }
  }
  if (isProblem(body)) {
    return new ApiError({
      status: body.status,
      code: body.code,
      title: body.title,
      detail: body.detail,
      fieldErrors: body.fieldErrors,
      traceId: body.traceId,
      problem: body,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    })
  }
  const status = response.status
  // A 403 that is not problem+json did not come from our permission checks (e.g. Spring's plain
  // "Invalid CORS request"), so it must not be reported as a missing permission.
  if (status === 403) {
    return new ApiError({
      status,
      code: 'HTTP_403',
      title: 'Request rejected',
      detail: REJECTED_403_TEXT,
    })
  }
  return new ApiError({
    status,
    code: `HTTP_${status}`,
    title: response.statusText || `HTTP ${status}`,
    detail:
      FALLBACK_TEXT[status] ?? (status >= 500 ? FALLBACK_TEXT[500] : `Request failed (HTTP ${status}).`),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  })
}

export function networkError(cause?: unknown): ApiError {
  const err = new ApiError({
    status: 0,
    code: 'NETWORK_ERROR',
    title: 'No connection',
    detail: 'Cannot reach the server. Check the network connection and try again.',
  })
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause
  return err
}

/** Message for any thrown value (ApiError or not). */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.userMessage
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

export const VERSION_CONFLICT_TEXT = 'Someone else changed this - reload to see the latest version.'
