/**
 * Thin wrapper over Playwright's APIRequestContext for the RMS REST API (docs/api/conventions.md).
 * Paths are relative to RMS_API_URL, e.g. `api.get('users')`.
 *
 * Types come from the contract: `npm run api:gen` generates generated/schema.d.ts from
 * build/openapi.bundled.yaml (ADR-005: never hand-write API types).
 *
 * Terminal identity (P1-AUTH-04): a terminal login sends X-Terminal-Id + the deviceToken the terminal got
 * at registration; every later call sends the same X-Terminal-Id (else 403 TERMINAL_MISMATCH).
 * Personal session (ADR-008, contract 0.3.0): a client without a terminal sends neither; later calls send no header.
 */
import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type APIResponse, expect, request as pwRequest } from '@playwright/test';
import type { components } from '../generated/schema';
import { env } from './env';

export type Schemas = components['schemas'];
export type Problem = Schemas['Problem'];
export type AuthSession = Schemas['AuthSession'];
export type TerminalRegistration = Schemas['TerminalRegistration'];
export type TerminalType = Schemas['TerminalType'];

/** What a registered device keeps: its terminal id and the one-time device token. */
export interface TerminalIdentity {
  terminalId: string;
  deviceToken: string;
}

export interface CallOptions {
  body?: unknown;
  /** multipart/form-data fields (files as {name, mimeType, buffer}). */
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  /** true → generate a fresh key; string → use this key (duplicate-submit tests). */
  idempotencyKey?: boolean | string;
}

export class ApiClient {
  constructor(
    readonly ctx: APIRequestContext,
    private accessToken?: string,
    private identity?: TerminalIdentity,
  ) {}

  /** Creates a context rooted at RMS_API_URL. Dispose `ctx` in teardown. */
  static async create(identity?: TerminalIdentity): Promise<ApiClient> {
    const ctx = await pwRequest.newContext({ baseURL: `${env.apiUrl}/` });
    return new ApiClient(ctx, undefined, identity);
  }

  withToken(token: string | undefined): ApiClient {
    return new ApiClient(this.ctx, token, this.identity);
  }

  /** Pass undefined to act as an unregistered device (no X-Terminal-Id). */
  withTerminal(identity: TerminalIdentity | undefined): ApiClient {
    return new ApiClient(this.ctx, this.accessToken, identity);
  }

  /** The session this client was created from by loginAs (tokens for browser injection, refresh tests). */
  session?: AuthSession;

  get token(): string | undefined {
    return this.accessToken;
  }

  get terminal(): TerminalIdentity | undefined {
    return this.identity;
  }

  async call(method: string, path: string, opts: CallOptions = {}): Promise<APIResponse> {
    const headers: Record<string, string> = { Accept: 'application/json, application/problem+json', ...opts.headers };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (this.identity && !('X-Terminal-Id' in headers)) headers['X-Terminal-Id'] = this.identity.terminalId;
    if (opts.idempotencyKey) {
      headers['Idempotency-Key'] = typeof opts.idempotencyKey === 'string' ? opts.idempotencyKey : randomUUID();
    }
    return this.ctx.fetch(path.replace(/^\/+/, ''), {
      method: method.toUpperCase(),
      headers,
      params: opts.query,
      data: opts.multipart ? undefined : opts.body,
      multipart: opts.multipart,
      failOnStatusCode: false,
    });
  }

  get = (path: string, opts?: CallOptions) => this.call('GET', path, opts);
  post = (path: string, opts?: CallOptions) => this.call('POST', path, opts);
  put = (path: string, opts?: CallOptions) => this.call('PUT', path, opts);
  patch = (path: string, opts?: CallOptions) => this.call('PATCH', path, opts);
  delete = (path: string, opts?: CallOptions) => this.call('DELETE', path, opts);

  /**
   * POST /auth/login. On a client with a terminal: header + its deviceToken (terminal session). On a client without
   * one: no header and no deviceToken (personal session, ADR-008). Pass `deviceToken` to override (null = omit).
   * No retry: BUG-1-001 is fixed, a 409 here is a regression.
   */
  loginRaw(username: string, password: string, deviceToken?: string | null): Promise<APIResponse> {
    const token = deviceToken === undefined ? this.identity?.deviceToken : (deviceToken ?? undefined);
    return this.withToken(undefined).post('auth/login', { body: token === undefined ? { username, password } : { username, password, deviceToken: token } });
  }

  login(username: string, password: string, deviceToken?: string | null): Promise<APIResponse> {
    return this.loginRaw(username, password, deviceToken);
  }

  /** A personal-session login (no terminal header, no deviceToken). */
  loginPersonal(username: string, password: string): Promise<APIResponse> {
    return this.withTerminal(undefined).loginRaw(username, password, null);
  }

  /** Logs in and returns a client carrying the access token. Fails the test on non-200. */
  async loginAs(username: string, password: string): Promise<{ client: ApiClient; session: AuthSession }> {
    const res = await this.login(username, password);
    expect(res.status(), `login as ${username}: ${await res.text()}`).toBe(200);
    const session = (await res.json()) as AuthSession;
    const client = this.withToken(session.accessToken);
    client.session = session;
    return { client, session };
  }

  /**
   * POST /terminals (registerTerminal) — `security: []`, `x-auth: INLINE_CREDENTIALS`: the credentials of a
   * user holding TERMINAL_MANAGE go in the body; sent without token or X-Terminal-Id (unregistered device).
   */
  registerTerminal(
    credentials: { username: string; password: string },
    terminal: { name: string; type: TerminalType; kitchenStationId?: string; orderingPointId?: string },
  ): Promise<APIResponse> {
    return this.withToken(undefined).withTerminal(undefined).post('terminals', { body: { credentials, ...terminal } });
  }
}

/** Asserts an RFC 7807 problem response with the given status (and code, if given). */
export async function expectProblem(res: APIResponse, status: number, code?: string): Promise<Problem> {
  expect(res.status(), await res.text()).toBe(status);
  expect(res.headers()['content-type'] ?? '').toContain('json');
  const problem = (await res.json()) as Problem;
  if (code) expect(problem.code).toBe(code);
  return problem;
}
