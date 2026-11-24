/**
 * Annex A §2 — generated API permission matrix (P1-RBAC-03, P1-RBAC-01, P1-AUTH-05 approvals,
 * P1-AUD-02 contract check). Cases come from build/openapi.bundled.yaml via utils/permission-matrix.ts.
 *
 * - Bundle missing → one fixme placeholder (the contract is not bundled yet).
 * - Contract problems (missing / unknown x-permission, inconsistent security / x-auth, approval level
 *   contradicting roles-permissions.md) → a failing contract test listing them.
 * - PUBLIC operations (login, refresh) get no role cases; auth.spec.ts covers them.
 * - registerTerminal (`x-auth: INLINE_CREDENTIALS`): the role's username/password go in the body,
 *   no bearer token; "anonymous" sends credentials of a user that does not exist.
 * - 'allow-scoped' cases (own / dine-in) are fixme until scoped fixtures exist; cross-record denial
 *   is tested in the module specs (P1-RBAC-04 in M1.3, own-shift reports in M1.5).
 * - Allowed cases really perform the call with a schema-valid sample body, so run the matrix on a
 *   disposable database (RMS_SEED=1). Bodies with `currentPassword` fail with 422 and count as a failed
 *   login; a successful login follows each such case so the 5-attempt lock is never reached.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/test';
import { UNKNOWN_USER, passwordFor, userFor } from '../fixtures/seed';
import type { ApiClient } from '../utils/api-client';
import { findAuditMutations } from '../utils/contract-checks';
import { env } from '../utils/env';
import { type Json, isObject } from '../utils/openapi';
import { type MatrixResult, buildRequest, generatePermissionMatrix } from '../utils/permission-matrix';
import type { RoleKey } from '../utils/role-grants';

const matrix: MatrixResult | null = existsSync(env.openapiBundle) ? generatePermissionMatrix(env.openapiBundle) : null;

test.describe('Annex A §2 permission matrix (generated)', { tag: '@api' }, () => {
  if (!matrix) {
    test.fixme(`P1-RBAC-03 matrix: bundled spec not found at ${env.openapiBundle} (run redocly bundle)`, async () => {});
    return;
  }

  test.describe('contract', () => {
    const errors = matrix.problems.filter((p) => p.severity === 'error');
    test('P1-RBAC-03-T03 every operation declares a known x-permission and consistent security / x-auth / x-approval', () => {
      expect(errors.map((p) => `${p.code}: ${p.message}`)).toEqual([]);
    });
    test('P1-AUD-02-T01 the contract has no update/delete endpoint for the audit log', () => {
      expect(findAuditMutations(matrix.operations).map((o) => `${o.method.toUpperCase()} ${o.path}`)).toEqual([]);
    });
    for (const w of matrix.problems.filter((p) => p.severity === 'warning')) {
      test(`traceability warning: ${w.operation} ${w.code}`, () => {
        test.info().annotations.push({ type: 'warning', description: w.message });
      });
    }
  });

  test.describe('role × operation', () => {
    // Cache tokens, not clients: a client's request context is disposed with its test.
    const sessions = new Map<RoleKey, { token: string; client: ApiClient }>();
    const bearerFor = async (role: RoleKey, apiAs: (r: RoleKey) => Promise<ApiClient>, api: ApiClient) => {
      if (!sessions.has(role)) {
        const c = await apiAs(role);
        sessions.set(role, { token: c.token ?? '', client: c });
      }
      const s = sessions.get(role)!;
      return api.withTerminal(s.client.terminal).withToken(s.token);
    };

    for (const c of matrix.cases) {
      const op = matrix.operations.find((o) => o.operationId === c.operationId)!;
      if (c.expectation === 'public') {
        test.skip(c.title, async () => {});
        continue;
      }
      const run = c.expectation === 'allow-scoped' ? test.fixme : test;
      run(c.title, async ({ api, apiAs }) => {
        test.info().annotations.push({ type: 'requirements', description: c.requirements.join(', ') });
        const plan = buildRequest(op);
        let body: Json | undefined = plan.body;
        let client: ApiClient;

        if (c.auth === 'inline-credentials') {
          const creds = c.role === 'anonymous' ? UNKNOWN_USER : { username: userFor(c.role).username, password: passwordFor(userFor(c.role)) };
          if (op.credentialsField === '') body = { ...(isObject(body) ? body : {}), ...creds };
          else if (isObject(body) && op.credentialsField) body = { ...body, [op.credentialsField]: { ...creds } };
          client = api.withToken(undefined).withTerminal(undefined);
        } else if (c.role === 'anonymous') {
          client = api.withToken(undefined);
        } else if (/logout/i.test(op.operationId)) {
          client = await apiAs(c.role); // logout revokes the session, so never the cached one
        } else {
          client = await bearerFor(c.role, apiAs, api);
        }

        const res = await client.call(plan.method, plan.url, {
          body: plan.bodyKind === 'multipart' ? undefined : (body ?? undefined),
          multipart: plan.bodyKind === 'multipart' ? { file: { name: 'matrix.csv', mimeType: 'text/csv', buffer: Buffer.from(['name,sort_order', 'QA matrix,1', ''].join('\n')) } } : undefined,
          query: plan.query,
          headers: plan.headers,
          idempotencyKey: plan.needsIdempotencyKey ? randomUUID() : undefined,
        });
        const status = res.status();
        expect(status, `${c.title}: server error ${await res.text()}`).toBeLessThan(500);
        const why = `${c.title}: got ${status} ${await res.text()}`;
        if (c.expectStatusIn) expect(c.expectStatusIn, why).toContain(status);
        if (c.expectStatusNotIn) expect(c.expectStatusNotIn, why).not.toContain(status);

        if (c.countsTowardLockout && c.role !== 'anonymous') await apiAs(c.role); // reset failed-attempt counter
      });
    }
  });

  // Session-type dimension (ADR-008): every bearer operation called from a PERSONAL session (no terminal) by each role
  // holding LOGIN_ANY_DEVICE. Operations marked `x-terminal: REQUIRED` (none before M1.2) expect 403 TERMINAL_REQUIRED.
  test.describe('personal session × role × operation (ADR-008)', () => {
    const tokens = new Map<RoleKey, string>();
    for (const c of matrix.sessionCases) {
      const op = matrix.operations.find((o) => o.operationId === c.operationId)!;
      const run = c.expectation === 'allow-scoped' ? test.fixme : test;
      run(c.title, async ({ api, apiAs, apiPersonal }) => {
        test.info().annotations.push({ type: 'requirements', description: ['P1-AUTH-04', ...c.requirements].join(', ') });
        const role = c.role as RoleKey;
        let client: ApiClient;
        if (/logout/i.test(op.operationId)) client = await apiPersonal(role);
        else {
          if (!tokens.has(role)) tokens.set(role, (await apiPersonal(role)).token ?? '');
          client = api.withTerminal(undefined).withToken(tokens.get(role));
        }
        const plan = buildRequest(op);
        const res = await client.call(plan.method, plan.url, {
          body: plan.bodyKind === 'multipart' ? undefined : (plan.body ?? undefined),
          multipart: plan.bodyKind === 'multipart' ? { file: { name: 'matrix.csv', mimeType: 'text/csv', buffer: Buffer.from(['name,sort_order', 'QA matrix,1', ''].join(String.fromCharCode(10))) } } : undefined,
          query: plan.query,
          headers: plan.headers,
          idempotencyKey: plan.needsIdempotencyKey ? randomUUID() : undefined,
        });
        const status = res.status();
        const text = await res.text();
        expect(status, `${c.title}: server error ${text}`).toBeLessThan(500);
        const why = `${c.title}: got ${status} ${text}`;
        if (c.expectStatusIn) expect(c.expectStatusIn, why).toContain(status);
        if (c.expectStatusNotIn) expect(c.expectStatusNotIn, why).not.toContain(status);
        if (c.expectCode) expect(text, why).toContain(`"${c.expectCode}"`);
        expect(text, `${why} (a personal session must not be refused for lack of a terminal unless x-terminal: REQUIRED)`).not.toContain(c.expectCode ? '"TERMINAL_MISMATCH"' : '"TERMINAL_REQUIRED"');
        if (c.countsTowardLockout) await apiAs(role); // reset failed-attempt counter
      });
    }
  });

  test.describe('approver PIN × approval operation', () => {
    // M1.0 has no x-approval operation (PINs are checked inline; first one in M1.2).
    for (const c of matrix.approvalCases) {
      test.fixme(c.title, async () => {});
    }
  });
});
