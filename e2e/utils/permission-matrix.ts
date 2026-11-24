/**
 * Permission-matrix test generator (PLAN M1.0 QA, P1-RBAC-03, ADR-005 §4).
 *
 * Reads the bundled OpenAPI spec, collects every operation's `x-permission` (plus
 * `x-approval`, `x-approval-permission`, `x-idempotent`, `x-requirements`) and produces one test
 * case per operation × seeded role, plus one unauthenticated case per protected operation,
 * using the grants table in `role-grants.ts`. It also reports contract problems (missing or
 * unknown permission codes, approval levels that contradict roles-permissions.md) so drift
 * between the spec and the permission doc fails loudly instead of silently generating nothing.
 *
 * Accepted `x-permission` forms:
 *   PUBLIC | NONE          no login needed (login, refresh)
 *   AUTHENTICATED          any logged-in user (me, logout)
 *   ORDER_CREATE           one permission code
 *   [KDS_OPERATE, KDS_VIEW_ALL]   any of these codes
 *   { anyOf: [...] } | { allOf: [...] }
 *
 * Authentication mode per operation:
 *   bearer              default (root `security`)
 *   none                `security: []`; must be PUBLIC (login, refresh)
 *   inline-credentials  `security: []` + `x-auth: INLINE_CREDENTIALS`: the caller's username/password
 *                       go in the body (registerTerminal); wrong credentials 401, no permission 403.
 *
 * PUBLIC operations get no role cases: a token is irrelevant to them and sending sample
 * credentials would count towards the lockout of a seeded user. auth.spec.ts covers them.
 */
import {
  HTTP_METHODS,
  type HttpMethod,
  type Json,
  type JsonObject,
  type OpenApiDoc,
  deref,
  isObject,
  loadOpenApi,
  sampleFromSchema,
} from './openapi';
import {
  type Grant,
  type GrantScope,
  type PermissionDef,
  type RoleKey,
  PERMISSIONS,
  SEEDED_ROLES,
  findPermission,
} from './role-grants';

export type PermissionExpr =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'anyOf'; codes: string[] }
  | { kind: 'allOf'; codes: string[] };

export type ApprovalLevel = 'MANAGER' | 'OWNER';

export interface ParameterInfo {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  sample: Json;
}

export type AuthMode = 'bearer' | 'none' | 'inline-credentials';

export interface OperationInfo {
  operationId: string;
  auth: AuthMode;
  /** Body property that carries {username, password} for inline-credentials operations ('' = the body itself). */
  credentialsField: string | null;
  /** A wrong password in the sample body counts as a failed login (currentPassword / credentials). */
  countsTowardLockout: boolean;
  method: HttpMethod;
  path: string;
  tags: string[];
  permission: PermissionExpr | null;
  rawPermission: Json | undefined;
  approval: ApprovalLevel | null;
  /** Permission the approver must hold; defaults to the operation's single permission code. */
  approvalPermission: string | null;
  idempotent: boolean;
  requirements: string[];
  parameters: ParameterInfo[];
  /** Sample JSON body built from the request schema, or undefined when there is no body. */
  sampleBody: Json | undefined;
  /** 'multipart' for file uploads (import): the matrix sends a tiny CSV file instead of JSON. */
  bodyKind: 'json' | 'multipart' | null;
  /** `x-terminal: REQUIRED` (ADR-008): a personal session gets 403 TERMINAL_REQUIRED. */
  terminalRequired: boolean;
}

export type ProblemCode =
  | 'MISSING_OPERATION_ID'
  | 'DUPLICATE_OPERATION_ID'
  | 'MISSING_X_PERMISSION'
  | 'INVALID_X_PERMISSION'
  | 'UNKNOWN_PERMISSION'
  | 'MISSING_X_REQUIREMENTS'
  | 'INVALID_X_APPROVAL'
  | 'APPROVAL_PERMISSION_UNKNOWN'
  | 'APPROVAL_WITHOUT_PIN_GRANT'
  | 'APPROVAL_LEVEL_MISMATCH'
  | 'INCONSISTENT_SECURITY'
  | 'INVALID_X_AUTH'
  | 'INVALID_X_TERMINAL';

export interface ContractProblem {
  severity: 'error' | 'warning';
  code: ProblemCode;
  operation: string;
  message: string;
}

export type Expectation = 'allow' | 'allow-scoped' | 'deny' | 'unauthenticated' | 'public';

export interface PermissionCase {
  /** Starts with the requirement id, e.g. "P1-RBAC-03 [cashier] GET /users (listUsers) USER_MANAGE -> 403". */
  title: string;
  operationId: string;
  method: HttpMethod;
  path: string;
  role: RoleKey | 'anonymous';
  expectation: Expectation;
  /** How the role's identity is sent: bearer token, or username/password in the body. */
  auth: AuthMode;
  /** Run a successful login afterwards to reset the failed-attempt counter. */
  countsTowardLockout?: boolean;
  /** Statuses the response must have (deny / unauthenticated). */
  expectStatusIn?: number[];
  /** Statuses the response must NOT have (allow). */
  expectStatusNotIn?: number[];
  /** Restriction that applies when the role is allowed only for its own records / reads / dine-in. */
  scope?: Exclude<GrantScope, 'all'>;
  /** Grant is a removable default (footnote ¹). */
  defaultOnly?: boolean;
  permission: string;
  requirements: string[];
  /** Session the role calls from (ADR-008). Absent = terminal session (the classic matrix). */
  session?: 'terminal' | 'personal';
  /** Problem code the 403 must carry (personal session on an x-terminal: REQUIRED operation). */
  expectCode?: string;
}

export interface ApprovalCase {
  title: string;
  operationId: string;
  method: HttpMethod;
  path: string;
  approverRole: RoleKey;
  approvalLevel: ApprovalLevel;
  approvalPermission: string;
  /** 'approve' = the role's PIN must be accepted; 'reject' = 403 APPROVAL_INVALID. */
  expectation: 'approve' | 'reject';
}

export interface MatrixResult {
  operations: OperationInfo[];
  cases: PermissionCase[];
  /** Personal-session cases (ADR-008), one per bearer operation x role holding LOGIN_ANY_DEVICE. */
  sessionCases: PermissionCase[];
  approvalCases: ApprovalCase[];
  problems: ContractProblem[];
}

export interface GeneratorOptions {
  roles?: readonly RoleKey[];
  permissions?: readonly PermissionDef[];
  /** Requirement id prefixed to matrix case titles. */
  requirementId?: string;
  /** Include the unauthenticated (no token → 401) case per protected operation. Default true. */
  includeAnonymous?: boolean;
}

const PUBLIC_TOKENS = new Set(['PUBLIC', 'NONE']);
const AUTHENTICATED_TOKENS = new Set(['AUTHENTICATED']);
const CODE_RE = /^[A-Z][A-Z0-9_]*$/;
/** Headers the test client sets itself; never sampled. */
const CLIENT_HEADERS = new Set(['authorization', 'x-terminal-id', 'idempotency-key']);

export function parsePermission(raw: Json | undefined): PermissionExpr | null {
  if (raw === undefined || raw === null) return null;
  const codes = (list: Json): string[] | null =>
    Array.isArray(list) && list.length > 0 && list.every((c) => typeof c === 'string' && CODE_RE.test(c))
      ? (list as string[])
      : null;

  if (typeof raw === 'string') {
    const v = raw.trim();
    if (PUBLIC_TOKENS.has(v)) return { kind: 'public' };
    if (AUTHENTICATED_TOKENS.has(v)) return { kind: 'authenticated' };
    return CODE_RE.test(v) ? { kind: 'anyOf', codes: [v] } : null;
  }
  if (Array.isArray(raw)) {
    const c = codes(raw);
    return c ? { kind: 'anyOf', codes: c } : null;
  }
  if (isObject(raw)) {
    const keys = Object.keys(raw);
    if (keys.length === 1 && (keys[0] === 'anyOf' || keys[0] === 'allOf')) {
      const c = codes(raw[keys[0]]);
      return c ? { kind: keys[0] as 'anyOf' | 'allOf', codes: c } : null;
    }
  }
  return null;
}

export function describePermission(p: PermissionExpr | null): string {
  if (!p) return '(none)';
  switch (p.kind) {
    case 'public':
      return 'PUBLIC';
    case 'authenticated':
      return 'AUTHENTICATED';
    case 'anyOf':
      return p.codes.length === 1 ? p.codes[0] : `anyOf(${p.codes.join(',')})`;
    case 'allOf':
      return `allOf(${p.codes.join(',')})`;
  }
}

function collectParameters(doc: OpenApiDoc, pathItem: JsonObject, op: JsonObject): ParameterInfo[] {
  const byKey = new Map<string, ParameterInfo>();
  const add = (list: Json | undefined) => {
    if (!Array.isArray(list)) return;
    for (const p of list) {
      const param = deref(doc, p);
      if (!isObject(param) || typeof param.name !== 'string' || typeof param.in !== 'string') continue;
      const loc = param.in as ParameterInfo['in'];
      // Operation-level parameters override path-level ones with the same name + location.
      byKey.set(`${loc}:${param.name}`, {
        name: param.name,
        in: loc,
        required: loc === 'path' ? true : param.required === true,
        sample: 'example' in param ? param.example : sampleFromSchema(doc, param.schema),
      });
    }
  };
  add(pathItem.parameters);
  add(op.parameters);
  return [...byKey.values()];
}

function bodyKindOf(doc: OpenApiDoc, op: JsonObject): 'json' | 'multipart' | null {
  const body = deref(doc, op.requestBody);
  if (!isObject(body) || !isObject(body.content)) return null;
  if ('multipart/form-data' in body.content) return 'multipart';
  return 'json';
}

function jsonBodySchema(doc: OpenApiDoc, op: JsonObject): Json | undefined {
  const body = deref(doc, op.requestBody);
  if (!isObject(body) || !isObject(body.content)) return undefined;
  const media =
    body.content['application/json'] ??
    Object.entries(body.content).find(([type]) => type.endsWith('+json'))?.[1];
  return isObject(media) ? media.schema : undefined;
}

/** Walks `paths` and returns every operation with its QA-relevant extensions. */
export function collectOperations(
  doc: OpenApiDoc,
  permissions: readonly PermissionDef[] = PERMISSIONS,
): { operations: OperationInfo[]; problems: ContractProblem[] } {
  const operations: OperationInfo[] = [];
  const problems: ContractProblem[] = [];
  const seenIds = new Map<string, string>();
  const paths = isObject(doc.paths) ? doc.paths : {};

  for (const path of Object.keys(paths).sort()) {
    const pathItem = deref(doc, paths[path]);
    if (!isObject(pathItem)) continue;

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!isObject(op)) continue;
      const label = `${method.toUpperCase()} ${path}`;
      const problem = (severity: ContractProblem['severity'], code: ProblemCode, message: string) =>
        problems.push({ severity, code, operation: label, message });

      let operationId = typeof op.operationId === 'string' ? op.operationId : '';
      if (!operationId) {
        problem('error', 'MISSING_OPERATION_ID', `${label} has no operationId`);
        operationId = `${method}_${path}`;
      } else if (seenIds.has(operationId)) {
        problem('error', 'DUPLICATE_OPERATION_ID', `operationId "${operationId}" also used by ${seenIds.get(operationId)}`);
      }
      seenIds.set(operationId, label);

      const rawPermission = op['x-permission'];
      const permission = parsePermission(rawPermission);
      if (rawPermission === undefined) {
        problem('error', 'MISSING_X_PERMISSION', `${operationId} has no x-permission (conventions.md: every operation has one)`);
      } else if (!permission) {
        problem('error', 'INVALID_X_PERMISSION', `${operationId} has malformed x-permission ${JSON.stringify(rawPermission)}`);
      } else if (permission.kind === 'anyOf' || permission.kind === 'allOf') {
        for (const code of permission.codes) {
          if (!findPermission(code, permissions)) {
            problem('error', 'UNKNOWN_PERMISSION', `${operationId} uses ${code}, which is not in roles-permissions.md`);
          }
        }
      }

      const requirements = Array.isArray(op['x-requirements'])
        ? op['x-requirements'].filter((r): r is string => typeof r === 'string')
        : [];
      if (requirements.length === 0) {
        problem('warning', 'MISSING_X_REQUIREMENTS', `${operationId} has no x-requirements`);
      }

      let approval: ApprovalLevel | null = null;
      let approvalPermission: string | null = null;
      if (op['x-approval'] !== undefined) {
        const level = op['x-approval'];
        if (level === 'MANAGER' || level === 'OWNER') {
          approval = level;
          const explicit = op['x-approval-permission'];
          if (typeof explicit === 'string') {
            approvalPermission = explicit;
          } else if (permission && permission.kind !== 'public' && permission.kind !== 'authenticated' && permission.codes.length === 1) {
            approvalPermission = permission.codes[0];
          }
          problems.push(...checkApproval(label, operationId, approval, approvalPermission, permissions));
        } else {
          problem('error', 'INVALID_X_APPROVAL', `${operationId} has x-approval ${JSON.stringify(level)}; expected MANAGER or OWNER`);
        }
      }

      const auth = authMode(op, rawPermission, permission, (code, msg) => problem('error', code, `${operationId}: ${msg}`));
      const xTerminal = op['x-terminal'];
      if (xTerminal !== undefined && xTerminal !== 'REQUIRED' && xTerminal !== 'OPTIONAL') {
        problem('error', 'INVALID_X_TERMINAL', `${operationId} has x-terminal ${JSON.stringify(xTerminal)}; expected REQUIRED (or OPTIONAL)`);
      }
      if (xTerminal === 'REQUIRED' && (permission?.kind === 'public' || auth !== 'bearer')) {
        problem('error', 'INVALID_X_TERMINAL', `${operationId}: x-terminal REQUIRED needs a bearer-token operation (a session to check)`);
      }
      const schema = jsonBodySchema(doc, op);
      const sampleBody = schema === undefined ? undefined : sampleFromSchema(doc, schema);
      const credentialsField = auth === 'inline-credentials' ? findCredentialsField(sampleBody) : null;
      if (auth === 'inline-credentials' && credentialsField === null) {
        problem('error', 'INVALID_X_AUTH', `${operationId}: x-auth INLINE_CREDENTIALS but the body has no {username, password} object`);
      }
      operations.push({
        operationId,
        auth,
        credentialsField,
        countsTowardLockout: credentialsField !== null || (isObject(sampleBody) && 'currentPassword' in sampleBody),
        method,
        path,
        tags: Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === 'string') : [],
        permission,
        rawPermission,
        approval,
        approvalPermission,
        idempotent: op['x-idempotent'] === true,
        requirements,
        parameters: collectParameters(doc, pathItem, op),
        sampleBody,
        bodyKind: bodyKindOf(doc, op),
        terminalRequired: xTerminal === 'REQUIRED',
      });
    }
  }
  return { operations, problems };
}

function authMode(
  op: JsonObject,
  raw: Json | undefined,
  permission: PermissionExpr | null,
  report: (code: ProblemCode, message: string) => void,
): AuthMode {
  const noSecurity = Array.isArray(op.security) && op.security.length === 0;
  const xAuth = op['x-auth'];
  if (xAuth !== undefined && xAuth !== 'INLINE_CREDENTIALS') {
    report('INVALID_X_AUTH', `unknown x-auth ${JSON.stringify(xAuth)}`);
    return noSecurity ? 'none' : 'bearer';
  }
  if (xAuth === 'INLINE_CREDENTIALS') {
    if (!noSecurity) report('INCONSISTENT_SECURITY', 'x-auth INLINE_CREDENTIALS requires security: []');
    if (!permission || permission.kind === 'public' || permission.kind === 'authenticated') {
      report('INCONSISTENT_SECURITY', 'x-auth INLINE_CREDENTIALS needs a permission code in x-permission');
    }
    return 'inline-credentials';
  }
  if (noSecurity) {
    if (raw !== undefined && permission?.kind !== 'public') {
      report('INCONSISTENT_SECURITY', `security: [] but x-permission is ${JSON.stringify(raw)} (expected PUBLIC or x-auth)`);
    }
    return 'none';
  }
  if (permission?.kind === 'public') {
    report('INCONSISTENT_SECURITY', 'x-permission PUBLIC but the operation still requires a bearer token (add security: [])');
  }
  return 'bearer';
}

/** Name of the body property holding {username, password}; '' when the body itself is the credentials object. */
function findCredentialsField(body: Json | undefined): string | null {
  if (!isObject(body)) return null;
  if ('username' in body && 'password' in body) return '';
  for (const [k, v] of Object.entries(body)) {
    if (isObject(v) && 'username' in v && 'password' in v) return k;
  }
  return null;
}

function checkApproval(
  label: string,
  operationId: string,
  level: ApprovalLevel,
  approvalPermission: string | null,
  permissions: readonly PermissionDef[],
): ContractProblem[] {
  const out: ContractProblem[] = [];
  const add = (code: ProblemCode, message: string) =>
    out.push({ severity: 'error', code, operation: label, message });

  if (!approvalPermission) {
    add('APPROVAL_PERMISSION_UNKNOWN', `${operationId} has x-approval but no single permission to approve against; add x-approval-permission`);
    return out;
  }
  const def = findPermission(approvalPermission, permissions);
  if (!def) {
    add('APPROVAL_PERMISSION_UNKNOWN', `${operationId}: approval permission ${approvalPermission} is not in roles-permissions.md`);
    return out;
  }
  const approvers = SEEDED_ROLES.filter((r) => def.grants[r].canApprove);
  if (approvers.length === 0) {
    add('APPROVAL_WITHOUT_PIN_GRANT', `${operationId}: no role has 🔑 for ${approvalPermission} in roles-permissions.md`);
  } else if (level === 'OWNER' && approvers.some((r) => r !== 'owner')) {
    add('APPROVAL_LEVEL_MISMATCH', `${operationId}: x-approval OWNER, but ${approvers.filter((r) => r !== 'owner').join(', ')} can approve ${approvalPermission} per roles-permissions.md`);
  } else if (level === 'MANAGER' && !approvers.includes('manager')) {
    add('APPROVAL_LEVEL_MISMATCH', `${operationId}: x-approval MANAGER, but manager has no 🔑 for ${approvalPermission} per roles-permissions.md`);
  }
  return out;
}

interface Decision {
  expectation: Expectation;
  scope?: Exclude<GrantScope, 'all'>;
  defaultOnly?: boolean;
}

const READ_METHODS = new Set<HttpMethod>(['get', 'head', 'options']);

/** Effective decision for one grant on one method: 'read' scope allows reads only. */
function decideGrant(grant: Grant | undefined, method: HttpMethod): Decision {
  if (!grant || !grant.granted) return { expectation: 'deny' };
  if (grant.scope === 'read') {
    return READ_METHODS.has(method) ? { expectation: 'allow', defaultOnly: grant.defaultOnly } : { expectation: 'deny' };
  }
  if (grant.scope === 'all') return { expectation: 'allow', defaultOnly: grant.defaultOnly };
  // 'dine-in' limits which order TYPES a role may create; reading lookups (menu, areas, floor) is not restricted by it.
  if (grant.scope === 'dine-in' && READ_METHODS.has(method)) return { expectation: 'allow', defaultOnly: grant.defaultOnly };
  return { expectation: 'allow-scoped', scope: grant.scope, defaultOnly: grant.defaultOnly };
}

const RANK: Record<Expectation, number> = { deny: 0, 'allow-scoped': 1, allow: 2, unauthenticated: -1, public: 3 };

export function decide(
  op: Pick<OperationInfo, 'permission' | 'method'>,
  role: RoleKey,
  permissions: readonly PermissionDef[] = PERMISSIONS,
): Decision {
  const p = op.permission;
  if (!p) return { expectation: 'deny' };
  if (p.kind === 'public' || p.kind === 'authenticated') return { expectation: 'allow' };

  const decisions = p.codes.map((code) => decideGrant(findPermission(code, permissions)?.grants[role], op.method));
  if (p.kind === 'anyOf') {
    // The least restrictive grant wins.
    return decisions.reduce((best, d) => (RANK[d.expectation] > RANK[best.expectation] ? d : best));
  }
  // allOf: every code must be granted; any scoped grant makes the whole call scoped.
  if (decisions.some((d) => d.expectation === 'deny')) return { expectation: 'deny' };
  const scoped = decisions.find((d) => d.expectation === 'allow-scoped');
  return scoped ?? { expectation: 'allow', defaultOnly: decisions.some((d) => d.defaultOnly) };
}

function expectationText(e: Expectation, scope?: string): string {
  switch (e) {
    case 'allow':
      return 'allowed';
    case 'allow-scoped':
      return `allowed (${scope})`;
    case 'deny':
      return '403';
    case 'unauthenticated':
      return '401';
    case 'public':
      return 'public';
  }
}

export function buildPermissionCases(operations: OperationInfo[], opts: GeneratorOptions = {}): PermissionCase[] {
  const roles = opts.roles ?? SEEDED_ROLES;
  const permissions = opts.permissions ?? PERMISSIONS;
  const reqId = opts.requirementId ?? 'P1-RBAC-03';
  const includeAnonymous = opts.includeAnonymous ?? true;
  const cases: PermissionCase[] = [];

  for (const op of operations) {
    // Operations with no usable x-permission are reported as contract problems, not tested.
    if (!op.permission) continue;
    const perm = describePermission(op.permission);
    const inline = op.auth === 'inline-credentials';
    const head = `${op.method.toUpperCase()} ${op.path} (${op.operationId}) ${perm}${inline ? ' [inline credentials]' : ''}`;

    if (op.permission.kind === 'public') {
      if (includeAnonymous) {
        cases.push({
          title: `${reqId} [anonymous] ${head} -> public (no token needed; behaviour in auth.spec.ts)`,
          operationId: op.operationId,
          method: op.method,
          path: op.path,
          role: 'anonymous',
          expectation: 'public',
          auth: op.auth,
          expectStatusNotIn: [403],
          permission: perm,
          requirements: op.requirements,
        });
      }
      continue;
    }

    for (const role of roles) {
      const d = decide(op, role, permissions);
      const c: PermissionCase = {
        title: `${reqId} [${role}] ${head} -> ${expectationText(d.expectation, d.scope)}`,
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        role,
        expectation: d.expectation,
        auth: op.auth,
        permission: perm,
        requirements: op.requirements,
      };
      if (op.countsTowardLockout) c.countsTowardLockout = true;
      if (d.expectation === 'deny') c.expectStatusIn = [403];
      else c.expectStatusNotIn = [401, 403];
      if (d.scope) c.scope = d.scope;
      if (d.defaultOnly) c.defaultOnly = true;
      cases.push(c);
    }

    if (includeAnonymous) {
      // Inline credentials: "anonymous" = credentials of a user that does not exist (no lockout side effect).
      cases.push({
        title: `${reqId} [anonymous] ${head} -> 401${inline ? ' (unknown user credentials)' : ''}`,
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        role: 'anonymous',
        expectation: 'unauthenticated',
        auth: op.auth,
        expectStatusIn: [401],
        permission: perm,
        requirements: op.requirements,
      });
    }
  }
  return cases;
}

/**
 * Session-type dimension (ADR-008). For every bearer operation and every role holding LOGIN_ANY_DEVICE, one case in a
 * PERSONAL session (no terminal): `x-terminal: REQUIRED` -> 403 TERMINAL_REQUIRED for a role that has the permission
 * (403 either way for one that has not); otherwise the same expectation as in the terminal-session matrix.
 * Roles without LOGIN_ANY_DEVICE cannot start a personal session (login is tested in auth-personal.spec.ts).
 */
export function buildSessionCases(operations: OperationInfo[], opts: GeneratorOptions & { personalRoles?: readonly RoleKey[] } = {}): PermissionCase[] {
  const permissions = opts.permissions ?? PERMISSIONS;
  const roles = opts.personalRoles ?? (opts.roles ?? SEEDED_ROLES).filter((r) => findPermission('LOGIN_ANY_DEVICE', permissions)?.grants[r]?.granted === true);
  const reqId = opts.requirementId ?? 'P1-AUTH-04';
  const cases: PermissionCase[] = [];
  for (const op of operations) {
    if (!op.permission || op.permission.kind === 'public' || op.auth !== 'bearer') continue;
    const perm = describePermission(op.permission);
    const head = `${op.method.toUpperCase()} ${op.path} (${op.operationId}) ${perm}${op.terminalRequired ? ' x-terminal REQUIRED' : ''}`;
    for (const role of roles) {
      const d = decide(op, role, permissions);
      const c: PermissionCase = {
        title: `${reqId} [personal:${role}] ${head} -> `,
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        role,
        expectation: d.expectation,
        auth: op.auth,
        permission: perm,
        requirements: op.requirements,
        session: 'personal',
      };
      if (op.countsTowardLockout) c.countsTowardLockout = true;
      if (op.terminalRequired) {
        c.expectation = 'deny';
        c.expectStatusIn = [403];
        if (d.expectation !== 'deny') c.expectCode = 'TERMINAL_REQUIRED';
        c.title += d.expectation === 'deny' ? '403' : '403 TERMINAL_REQUIRED';
      } else {
        if (d.expectation === 'deny') c.expectStatusIn = [403];
        else c.expectStatusNotIn = [401, 403];
        if (d.scope) c.scope = d.scope;
        c.title += expectationText(d.expectation, d.scope);
      }
      cases.push(c);
    }
  }
  return cases;
}

/** For each x-approval operation: whose PIN must be accepted (🔑 in the grants table) and whose rejected. */
export function buildApprovalCases(operations: OperationInfo[], opts: GeneratorOptions = {}): ApprovalCase[] {
  const roles = opts.roles ?? SEEDED_ROLES;
  const permissions = opts.permissions ?? PERMISSIONS;
  const cases: ApprovalCase[] = [];
  for (const op of operations) {
    if (!op.approval || !op.approvalPermission) continue;
    const def = findPermission(op.approvalPermission, permissions);
    if (!def) continue;
    for (const role of roles) {
      const ok = def.grants[role].canApprove && (op.approval === 'MANAGER' || role === 'owner');
      cases.push({
        title: `P1-AUTH-05 [${role} PIN] ${op.method.toUpperCase()} ${op.path} (${op.operationId}) approval ${op.approval}/${op.approvalPermission} -> ${ok ? 'accepted' : '403 APPROVAL_INVALID'}`,
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        approverRole: role,
        approvalLevel: op.approval,
        approvalPermission: op.approvalPermission,
        expectation: ok ? 'approve' : 'reject',
      });
    }
  }
  return cases;
}

export function generatePermissionMatrix(spec: string | OpenApiDoc, opts: GeneratorOptions = {}): MatrixResult {
  const doc = typeof spec === 'string' ? loadOpenApi(spec) : spec;
  const { operations, problems } = collectOperations(doc, opts.permissions ?? PERMISSIONS);
  return {
    operations,
    cases: buildPermissionCases(operations, opts),
    sessionCases: buildSessionCases(operations, opts),
    approvalCases: buildApprovalCases(operations, opts),
    problems,
  };
}

export interface RequestPlan {
  method: HttpMethod;
  /** Path with every `{param}` replaced by its sample value; relative (no leading slash). */
  url: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: Json | undefined;
  bodyKind: 'json' | 'multipart' | null;
  needsIdempotencyKey: boolean;
}

/** Turns an operation into a concrete request with sample path / query / header values and body. */
export function buildRequest(op: OperationInfo): RequestPlan {
  let url = op.path;
  const query: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const p of op.parameters) {
    const value = p.sample === null || p.sample === undefined ? '' : String(p.sample);
    if (p.in === 'path') {
      url = url.split(`{${p.name}}`).join(encodeURIComponent(value || 'x'));
    } else if (p.in === 'query' && p.required) {
      query[p.name] = value;
    } else if (p.in === 'header' && p.required && !CLIENT_HEADERS.has(p.name.toLowerCase())) {
      headers[p.name] = value;
    }
  }
  const needsIdempotencyKey =
    op.idempotent || op.parameters.some((p) => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key');
  return { method: op.method, url: url.replace(/^\/+/, ''), query, headers, body: op.sampleBody, bodyKind: op.bodyKind, needsIdempotencyKey };
}
