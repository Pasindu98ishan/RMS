import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { findAuditMutations } from '../contract-checks';
import { SAMPLE_UUID, loadOpenApi, parseOpenApiText, sampleFromSchema } from '../openapi';
import {
  type PermissionCase,
  buildRequest,
  collectOperations,
  buildSessionCases,
  generatePermissionMatrix,
  parsePermission,
} from '../permission-matrix';
import { PERSONAL_LOGIN_ROLES, SEEDED_ROLES } from '../role-grants';
import { buildRouteCases } from '../route-permissions';

const FIXTURES = path.resolve(__dirname, '..', '__fixtures__');
const MINI = path.join(FIXTURES, 'mini-openapi.yaml');
const BROKEN = path.join(FIXTURES, 'broken-openapi.yaml');

const mini = generatePermissionMatrix(MINI);
const caseFor = (operationId: string, role: PermissionCase['role']) => {
  const c = mini.cases.find((x) => x.operationId === operationId && x.role === role);
  if (!c) throw new Error(`no case ${operationId}/${role}`);
  return c;
};

test.describe('parsePermission', () => {
  test('accepts every documented form', () => {
    expect(parsePermission('PUBLIC')).toEqual({ kind: 'public' });
    expect(parsePermission('NONE')).toEqual({ kind: 'public' });
    expect(parsePermission('AUTHENTICATED')).toEqual({ kind: 'authenticated' });
    expect(parsePermission('ORDER_CREATE')).toEqual({ kind: 'anyOf', codes: ['ORDER_CREATE'] });
    expect(parsePermission(['A_B', 'C'])).toEqual({ kind: 'anyOf', codes: ['A_B', 'C'] });
    expect(parsePermission({ allOf: ['A', 'B'] })).toEqual({ kind: 'allOf', codes: ['A', 'B'] });
    expect(parsePermission({ anyOf: ['A'] })).toEqual({ kind: 'anyOf', codes: ['A'] });
  });

  test('rejects malformed values', () => {
    expect(parsePermission(undefined)).toBeNull();
    expect(parsePermission('order create')).toBeNull();
    expect(parsePermission([])).toBeNull();
    expect(parsePermission([1, 2])).toBeNull();
    expect(parsePermission({ oneOf: ['A'] })).toBeNull();
    expect(parsePermission({ anyOf: ['A'], allOf: ['B'] })).toBeNull();
  });
});

test.describe('collectOperations on the clean fixture', () => {
  test('finds all 18 operations, ignores non-method path keys, sorted by path', () => {
    expect(mini.operations).toHaveLength(18);
    expect(mini.operations.map((o) => o.operationId)).not.toContain(undefined);
    const paths = mini.operations.map((o) => o.path);
    expect(paths).toEqual([...paths].sort());
  });

  test('reports zero contract problems', () => {
    expect(mini.problems).toEqual([]);
  });

  test('merges path-level parameters and resolves $ref parameters', () => {
    const getUser = mini.operations.find((o) => o.operationId === 'getUser')!;
    expect(getUser.parameters).toEqual([{ name: 'userId', in: 'path', required: true, sample: SAMPLE_UUID }]);
    const list = mini.operations.find((o) => o.operationId === 'listUsers')!;
    expect(list.parameters).toEqual([{ name: 'page', in: 'query', required: false, sample: 0 }]);
  });

  test('reads x-approval, x-idempotent and x-requirements', () => {
    const voidBill = mini.operations.find((o) => o.operationId === 'voidBill')!;
    expect(voidBill).toMatchObject({ approval: 'MANAGER', approvalPermission: 'BILL_VOID', idempotent: true, requirements: ['P1-CAN-05'] });
    expect(mini.operations.find((o) => o.operationId === 'createUser')!.requirements).toEqual(['P1-RBAC-02', 'P1-AUTH-05']);
  });

  test('builds schema-valid sample bodies through $ref, requestBodies, allOf, oneOf, enums, +json media', () => {
    const body = (id: string) => mini.operations.find((o) => o.operationId === id)!.sampleBody;
    expect(body('createUser')).toEqual({
      username: 'newuser',
      fullName: 'x',
      password: 'Sample#Passw0rd',
      pin: '1234',
      roleIds: [SAMPLE_UUID],
    });
    expect(body('updateUser')).toEqual({ fullName: 'Updated Name', version: 1 });
    expect(body('updateKotStatus')).toEqual({ status: 'NEW' });
    expect(body('voidBill')).toEqual({ reason: 'Customer left', comment: 'x', approval: { approverUsername: 'manager1', pin: '1234' } });
    expect(body('createOrder')).toEqual({ orderType: 'DINE_IN', priceList: 'LOCAL' });
    expect(body('login')).toEqual({ username: 'xxx', password: 'Sample#Passw0rd' });
    expect(body('listUsers')).toBeUndefined();
    // minItems 3 of an enum-keyed rule: one rule per enum value, not three copies of the first.
    expect(body('updateServiceChargeSettings')).toEqual({
      rules: [
        { orderType: 'DINE_IN', rate: '10.00' },
        { orderType: 'TAKEAWAY', rate: '10.00' },
        { orderType: 'DELIVERY', rate: '10.00' },
      ],
      version: 1,
    });
  });
});

test.describe('buildPermissionCases', () => {
  test('one case per protected operation × seeded role + one anonymous case; PUBLIC ops get only the anonymous case', () => {
    const publicOps = mini.operations.filter((o) => o.permission?.kind === 'public').length;
    expect(publicOps).toBe(2);
    expect(mini.cases).toHaveLength((18 - publicOps) * (SEEDED_ROLES.length + 1) + publicOps);
  });

  test('titles start with the requirement id and are unique', () => {
    for (const c of mini.cases) expect(c.title.startsWith('P1-RBAC-03 [')).toBe(true);
    expect(new Set(mini.cases.map((c) => c.title)).size).toBe(mini.cases.length);
  });

  test('owner-only permission: owner allowed, every other role 403, anonymous 401', () => {
    expect(caseFor('listUsers', 'owner')).toMatchObject({ expectation: 'allow', expectStatusNotIn: [401, 403] });
    for (const r of SEEDED_ROLES.filter((x) => x !== 'owner')) {
      expect(caseFor('listUsers', r)).toMatchObject({ expectation: 'deny', expectStatusIn: [403] });
    }
    expect(caseFor('listUsers', 'anonymous')).toMatchObject({ expectation: 'unauthenticated', expectStatusIn: [401] });
    expect(caseFor('listUsers', 'cashier').title).toBe('P1-RBAC-03 [cashier] GET /users (listUsers) USER_MANAGE -> 403');
  });

  test('PUBLIC: no role cases (sample credentials would lock seeded users); one anonymous "public" case', () => {
    for (const id of ['login', 'refreshToken']) {
      const cases = mini.cases.filter((c) => c.operationId === id);
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({ role: 'anonymous', expectation: 'public', auth: 'none', expectStatusNotIn: [403] });
    }
  });

  test('inline credentials (registerTerminal): role identity goes in the body; unknown user -> 401', () => {
    const op = mini.operations.find((o) => o.operationId === 'registerTerminal')!;
    expect(op).toMatchObject({ auth: 'inline-credentials', credentialsField: 'credentials', countsTowardLockout: true });
    expect(caseFor('registerTerminal', 'owner')).toMatchObject({ expectation: 'allow', auth: 'inline-credentials', countsTowardLockout: true });
    expect(caseFor('registerTerminal', 'manager')).toMatchObject({ expectation: 'deny', expectStatusIn: [403] });
    expect(caseFor('registerTerminal', 'anonymous')).toMatchObject({ expectation: 'unauthenticated', expectStatusIn: [401] });
    expect(caseFor('registerTerminal', 'anonymous').title).toContain('(unknown user credentials)');
  });

  test('inline credentials at the body root (getTerminalSetupOptions): credentialsField is empty string', () => {
    const op = mini.operations.find((o) => o.operationId === 'getTerminalSetupOptions')!;
    expect(op).toMatchObject({ auth: 'inline-credentials', credentialsField: '' });
    expect(caseFor('getTerminalSetupOptions', 'owner')).toMatchObject({ expectation: 'allow', auth: 'inline-credentials' });
    expect(caseFor('getTerminalSetupOptions', 'cashier')).toMatchObject({ expectation: 'deny' });
  });

  test('bearer is the default auth mode; currentPassword bodies are flagged as counting toward lockout', () => {
    expect(mini.operations.find((o) => o.operationId === 'listUsers')!).toMatchObject({ auth: 'bearer', countsTowardLockout: false });
    expect(mini.operations.find((o) => o.operationId === 'setOwnPin')!).toMatchObject({ auth: 'bearer', countsTowardLockout: true });
    for (const r of SEEDED_ROLES) expect(caseFor('setOwnPin', r)).toMatchObject({ expectation: 'allow', countsTowardLockout: true });
  });

  test('AUTHENTICATED: every role allowed, anonymous 401', () => {
    for (const r of SEEDED_ROLES) expect(caseFor('getCurrentUser', r).expectation).toBe('allow');
    expect(caseFor('getCurrentUser', 'anonymous').expectation).toBe('unauthenticated');
  });

  test('anyOf with scopes: least restrictive grant wins; read scope allows GET only', () => {
    expect(caseFor('listStationKots', 'owner').expectation).toBe('allow');
    expect(caseFor('listStationKots', 'cashier').expectation).toBe('allow'); // KDS_VIEW_ALL (read) on GET
    expect(caseFor('listStationKots', 'kitchen')).toMatchObject({ expectation: 'allow-scoped', scope: 'own' });
    expect(caseFor('listStationKots', 'receptionist').expectation).toBe('deny');
    expect(caseFor('updateKotStatus', 'cashier').expectation).toBe('deny'); // read scope never writes
    expect(caseFor('updateKotStatus', 'kitchen')).toMatchObject({ expectation: 'allow-scoped', scope: 'own' });
  });

  test('allOf: every code required', () => {
    expect(caseFor('exportPosReports', 'owner').expectation).toBe('allow');
    expect(caseFor('exportPosReports', 'manager').expectation).toBe('allow');
    expect(caseFor('exportPosReports', 'cashier').expectation).toBe('deny');
  });

  test('footnote ¹ grants are allowed but flagged defaultOnly; dine-in scope is scoped', () => {
    expect(caseFor('createOrder', 'receptionist')).toMatchObject({ expectation: 'allow-scoped', scope: 'dine-in', defaultOnly: true });
    expect(caseFor('createOrder', 'cashier').expectation).toBe('allow');
    expect(caseFor('createOrder', 'kitchen').expectation).toBe('deny');
  });

  test('approval-gated operation: caller permission decides the matrix (cashier cannot void)', () => {
    expect(caseFor('voidBill', 'manager').expectation).toBe('allow');
    expect(caseFor('voidBill', 'cashier').expectation).toBe('deny');
  });

  test('options: subset of roles, custom requirement id, no anonymous', () => {
    const r = generatePermissionMatrix(MINI, { roles: ['cashier'], requirementId: 'P1-RBAC-01', includeAnonymous: false });
    expect(r.cases).toHaveLength(16); // 18 ops minus 2 PUBLIC
    expect(r.cases.every((c) => c.title.startsWith('P1-RBAC-01 [cashier]'))).toBe(true);
  });

  test('deterministic: same input, same output', () => {
    expect(generatePermissionMatrix(MINI)).toEqual(mini);
  });
});

test.describe('buildApprovalCases', () => {
  test('MANAGER approval on BILL_VOID: owner and manager PINs accepted, everyone else rejected', () => {
    const cases = mini.approvalCases.filter((c) => c.operationId === 'voidBill');
    expect(cases).toHaveLength(SEEDED_ROLES.length);
    const accepted = cases.filter((c) => c.expectation === 'approve').map((c) => c.approverRole);
    expect(accepted.sort()).toEqual(['manager', 'owner']);
    expect(cases.every((c) => c.title.startsWith('P1-AUTH-05 ['))).toBe(true);
  });

  test('x-approval-permission decides the approver permission', () => {
    const broken = generatePermissionMatrix(BROKEN);
    const explicit = broken.approvalCases.filter((c) => c.operationId === 'approvalExplicit');
    expect(explicit.every((c) => c.approvalPermission === 'LINE_CANCEL_AFTER_KOT')).toBe(true);
    expect(explicit.filter((c) => c.expectation === 'approve').map((c) => c.approverRole).sort()).toEqual(['manager', 'owner']);
  });
});

test.describe('contract problems on the broken fixture', () => {
  const broken = generatePermissionMatrix(BROKEN);
  const found = broken.problems.map((p) => `${p.operation} ${p.code}`).sort();

  test('each defect is reported exactly once', () => {
    expect(found).toEqual(
      [
        'GET /no-permission MISSING_X_PERMISSION',
        'GET /unknown-permission UNKNOWN_PERMISSION',
        'GET /malformed-permission INVALID_X_PERMISSION',
        'GET /duplicate-b DUPLICATE_OPERATION_ID',
        'GET /no-operation-id MISSING_OPERATION_ID',
        'GET /no-requirements MISSING_X_REQUIREMENTS',
        'POST /owner-discount-manager-approval APPROVAL_LEVEL_MISMATCH',
        'POST /void-owner-approval APPROVAL_LEVEL_MISMATCH',
        'POST /approval-no-pin-grant APPROVAL_WITHOUT_PIN_GRANT',
        'POST /approval-ambiguous APPROVAL_PERMISSION_UNKNOWN',
        'POST /approval-bad-level INVALID_X_APPROVAL',
        'POST /public-with-token INCONSISTENT_SECURITY',
        'GET /no-security-with-code INCONSISTENT_SECURITY',
        'POST /bad-x-auth INVALID_X_AUTH',
        'POST /inline-without-credentials INVALID_X_AUTH',
      ].sort(),
    );
  });

  test('missing x-requirements is a warning, everything else an error', () => {
    for (const p of broken.problems) {
      expect(p.severity, p.code).toBe(p.code === 'MISSING_X_REQUIREMENTS' ? 'warning' : 'error');
    }
  });

  test('operations with no usable x-permission get no matrix cases', () => {
    const ids = new Set(broken.cases.map((c) => c.operationId));
    expect(ids.has('noPermission')).toBe(false);
    expect(ids.has('malformedPermission')).toBe(false);
    // Unknown code: still tested, and every role is denied.
    const unknown = broken.cases.filter((c) => c.operationId === 'unknownPermission' && c.role !== 'anonymous');
    expect(unknown.every((c) => c.expectation === 'deny')).toBe(true);
  });
});

test.describe('buildRequest', () => {
  test('substitutes path params, keeps required query/header params, flags idempotency', () => {
    const op = (id: string) => mini.operations.find((o) => o.operationId === id)!;
    expect(buildRequest(op('getUser'))).toMatchObject({ method: 'get', url: `users/${SAMPLE_UUID}`, query: {}, needsIdempotencyKey: false });
    expect(buildRequest(op('searchAuditLogs'))).toMatchObject({ url: 'audit-logs', query: { from: '2026-11-21' } });
    expect(buildRequest(op('exportPosReports'))).toMatchObject({ query: { format: 'pdf' }, headers: { 'X-Report-Locale': 'en-LK' } });
    const create = buildRequest(op('createOrder'));
    expect(create.needsIdempotencyKey).toBe(true);
    expect(create.headers).toEqual({}); // Idempotency-Key is set by the client, never sampled
    expect(buildRequest(op('voidBill')).needsIdempotencyKey).toBe(true);
  });
});

test.describe('openapi helpers', () => {
  test('rejects documents that are not OpenAPI', () => {
    expect(() => parseOpenApiText('foo: bar')).toThrow(/not an OpenAPI document/);
  });

  test('rejects external refs (generator must read the bundle)', () => {
    const doc = parseOpenApiText('openapi: 3.1.0\npaths: {}\n');
    expect(() => sampleFromSchema(doc, { $ref: './components/common.yaml#/Money' })).toThrow(/bundled spec/);
  });

  test('loadOpenApi reads a file', () => {
    expect(loadOpenApi(MINI).openapi).toBe('3.1.0');
  });
});

test.describe('contract-checks: P1-AUD-02', () => {
  test('flags DELETE on audit logs but allows the export POST', () => {
    const { operations } = collectOperations(loadOpenApi(BROKEN));
    expect(findAuditMutations(operations).map((o) => o.operationId)).toEqual(['deleteAuditLog']);
  });

  test('clean fixture has no audit mutations', () => {
    expect(findAuditMutations(mini.operations)).toEqual([]);
  });
});

test.describe('route-permissions (UI matrix)', () => {
  test('one case per route × role; owner reaches all admin screens, cashier none of the owner-only ones', () => {
    const cases = buildRouteCases();
    const ownerOnly = ['/admin/users', '/admin/roles', '/admin/terminals', '/admin/settings', '/admin/audit'];
    for (const route of ownerOnly) {
      expect(cases.find((c) => c.route === route && c.role === 'owner')!.expectation).toBe('reachable');
      expect(cases.find((c) => c.route === route && c.role === 'cashier')!.expectation).toBe('blocked');
    }
    expect(cases.find((c) => c.route === '/kitchen' && c.role === 'kitchen')!.expectation).toBe('reachable');
    expect(cases.find((c) => c.route === '/login' && c.role === 'rider')!.expectation).toBe('reachable');
  });
});

test.describe('session-type dimension (ADR-008, x-terminal)', () => {
  const spec = (xTerminal: string | null) =>
    parseOpenApiText(
      [
        'openapi: 3.1.0',
        'info: {title: t, version: "1"}',
        'paths:',
        '  /orders:',
        '    post:',
        '      operationId: createOrder',
        '      x-permission: ORDER_CREATE',
        '      x-requirements: [P1-ORD-01]',
        ...(xTerminal ? [`      x-terminal: ${xTerminal}`] : []),
        '      responses: {"201": {description: ok}}',
        '  /users:',
        '    get:',
        '      operationId: listUsers',
        '      x-permission: USER_MANAGE',
        '      x-requirements: [P1-RBAC-02]',
        '      responses: {"200": {description: ok}}',
        '',
      ].join(String.fromCharCode(10)),
    );

  test('reads x-terminal REQUIRED; personal cases only for roles holding LOGIN_ANY_DEVICE', () => {
    const m = generatePermissionMatrix(spec('REQUIRED'));
    expect(m.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(m.operations.find((o) => o.operationId === 'createOrder')?.terminalRequired).toBe(true);
    expect(m.operations.find((o) => o.operationId === 'listUsers')?.terminalRequired).toBe(false);
    expect(new Set(m.sessionCases.map((c) => c.role))).toEqual(new Set(PERSONAL_LOGIN_ROLES));
    expect(m.sessionCases.every((c) => c.session === 'personal')).toBe(true);
  });

  test('x-terminal REQUIRED: a permitted role gets 403 TERMINAL_REQUIRED in a personal session, a role without the permission plain 403', () => {
    const m = generatePermissionMatrix(spec('REQUIRED'));
    const owner = m.sessionCases.find((c) => c.operationId === 'createOrder' && c.role === 'owner')!;
    expect(owner).toMatchObject({ expectation: 'deny', expectStatusIn: [403], expectCode: 'TERMINAL_REQUIRED' });
    const rider = m.sessionCases.find((c) => c.operationId === 'createOrder' && c.role === 'rider')!;
    expect(rider).toMatchObject({ expectation: 'deny', expectStatusIn: [403] });
    expect(rider.expectCode).toBeUndefined();
  });

  test('no x-terminal: the personal-session expectation equals the terminal-session one', () => {
    const m = generatePermissionMatrix(spec(null));
    for (const c of m.sessionCases) {
      const t = m.cases.find((x) => x.operationId === c.operationId && x.role === c.role)!;
      expect(c.expectation, c.title).toBe(t.expectation);
      expect(c.expectCode).toBeUndefined();
    }
  });

  test('an unknown x-terminal value is a contract error', () => {
    const m = generatePermissionMatrix(spec('MAYBE'));
    expect(m.problems.map((p) => p.code)).toContain('INVALID_X_TERMINAL');
  });

  test('buildSessionCases skips public operations', () => {
    expect(buildSessionCases(mini.operations).some((c) => mini.operations.find((o) => o.operationId === c.operationId)?.permission?.kind === 'public')).toBe(false);
  });
});

test.describe('real bundled contract (skipped until build/openapi.bundled.yaml exists)', () => {
  const bundle = path.resolve(__dirname, '..', '..', '..', 'build', 'openapi.bundled.yaml');
  test('P1-RBAC-03 generator reads the real spec with zero contract errors and a case for every operation', () => {
    test.skip(!existsSync(bundle), 'bundle not built');
    const real = generatePermissionMatrix(bundle);
    expect(real.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(real.operations.length).toBeGreaterThan(0);
    const covered = new Set(real.cases.map((c) => c.operationId));
    for (const op of real.operations) expect(covered.has(op.operationId), op.operationId).toBe(true);
    test.info().annotations.push({ type: 'matrix', description: `${real.operations.length} operations, ${real.cases.length} cases` });
  });
});
