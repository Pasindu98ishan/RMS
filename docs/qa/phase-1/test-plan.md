# Phase 1 test plan: Core POS and kitchens

Owner: qa-engineer · Oracle: Annex A + proposal (proposal wins), `docs/requirements/phase-1-requirements.md`, `docs/client-decisions.md`, `docs/security/roles-permissions.md`, `docs/ui/screens.md`, contract `build/openapi.bundled.yaml` (bundled from `docs/api/`).

**Legend**
- **Level:** U = unit (QA tooling or BE/FE unit) · I = backend integration (Spring Boot Test + Testcontainers, written by backend-dev, verified by QA in CI) · C = contract check on the bundled spec · API = API acceptance (Playwright `request`) · E2E = browser (Playwright) · M = manual / on-site.
- **Auto:** A = automated · M = manual (reason given).
- **Status:** Not run · Pass · Fail (BUG id) · Blocked (reason). Every row starts as **Not run**.
- **Gate:** the milestone whose exit gate needs the row. Rows of an M1.0 requirement whose behaviour only exists later (orders, bills, KOTs) are listed here with a later gate, so the requirement's full trace sits in one place.
- **Test id** = `<requirement id>-T<nn>`; the Playwright title starts with it. `×N` means the row is generated N times (per role, per route, per bad value).

Spec files (one per Annex A area, all under `e2e/specs/`): `auth.spec.ts` (§2/§15 login, tokens) · `session-idle.spec.ts` (§15 idle logout) · `terminals.spec.ts` (§2 terminal on audit) · `pin-approval.spec.ts` (§2 PIN) · `roles.spec.ts` (§2 roles) · `permission-matrix.spec.ts` (§2, generated from the bundle) · `ui-permissions.spec.ts` (§2, generated routes) · `audit.spec.ts` (§2/§15 audit) · `settings.spec.ts` (§14 settings) · `nfr.spec.ts` (§15).

---

## M1.0 Foundation

### M1.0 harness (PLAN QA column)

| Item | Where | Status |
|---|---|---|
| Playwright + TS project; projects `unit`, `chromium-desktop` 1366×768, `kds-tablet` 1280×800 touch, `serial` (global-state tests, one worker, after the others), `edge-desktop` (opt-in smoke on installed Edge) | `e2e/playwright.config.ts` | Done |
| Generated API types (`npm run api:gen`, openapi-typescript 7.13.0 from the bundle; ADR-005) | `e2e/generated/` (git-ignored) | Done |
| Seed (test-strategy §5) through the real API: terminals, 8 system roles, users, settings; `POST /test/reset` first | `e2e/fixtures/seed.ts`, `global-setup.ts` | **Works** against the live stack (bootstrap owner from `RMS_BOOTSTRAP_OWNER_*`) |
| Permission-matrix generator reading `x-permission` / `security` / `x-auth` / `x-approval` from the bundle | `e2e/utils/permission-matrix.ts`, `role-grants.ts` | **Pass**: 44 unit tests; 41 operations, 0 contract errors |
| Test stack used for this run | own backend `:8082` (profiles `dev,test`, database `rms_e2e`), second backend `:8083` with export limit 30, own frontend `:3001` | Backend started with `RMS_CORS_ALLOWED_ORIGINS` including `http://localhost:3001` (the dev profile only allows 3000 and 5173; without it every browser login gets 403) |
| Testcontainers base class | `backend/` (backend-dev) | 93 integration tests green |

### Traceability: M1.0 requirements

#### P1-AUTH-01: own username + password; generic error; 5 failures → 15 min lock; owner unlocks

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-AUTH-01-T01 | Valid credentials on a registered terminal → 200 AuthSession (tokens, user, permissions, terminal) | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T02 | Wrong password → 401 INVALID_CREDENTIALS, no hint which part was wrong | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T03 | Unknown username → same status and body as wrong password (no user enumeration) | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T04 | Missing username / password / deviceToken → 422 VALIDATION_FAILED with fieldErrors | API | A | M1.0 | **Fail: BUG-1-009** (Low, since contract 0.3.0) |
| P1-AUTH-01-T05 | 5th wrong password in a row locks: correct password then → 423 ACCOUNT_LOCKED | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T06 | Successful login before the 5th failure resets the counter | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T07 | Lock lasts 15 min (locked at 14:59, open at 15:00) | I (+API if test clock, Q26) | A | M1.0 | **Pass** |
| P1-AUTH-01-T08 | Owner unlocks (unlockUser) → user logs in at once; ACCOUNT_UNLOCKED audited | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T09 | Roles other than owner cannot unlock (403) | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T10 | Login screen: generic error, password cleared, lock message after 5 | E2E | A | M1.0 | **Pass** |
| P1-AUTH-01-T11 | Successful login lands on the role home (owner /admin, cashier /pos, kitchen /kitchen) | E2E | A | M1.0 | **Pass** (3) |
| P1-AUTH-01-T12 | Lock applies to the user on every terminal | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T13 | Deactivated user → 401 INVALID_CREDENTIALS; their refresh tokens stop working | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T14 | Users screen shows locked badge; owner unlocks | E2E | A | M1.0 | **Pass** |
| P1-AUTH-01-T15 | Wrong current password in changeOwnPassword → 422 and counts towards the lock | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T16 | Changing own password revokes the user's other sessions, keeps the calling one | API | A | M1.0 | **Pass** |
| P1-AUTH-01-T17 | New password < 8 chars or equal to username → 422 | API | A | M1.0 | **Pass** |

#### P1-AUTH-02: access token ≤ 15 min, refresh ≤ 12 h, logout revokes refresh

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-AUTH-02-T01 | expiresIn ≤ 900 and JWT exp − iat ≤ 900 | API | A | M1.0 | **Pass** |
| P1-AUTH-02-T02 | refreshExpiresIn ≤ 43200 | API | A | M1.0 | **Pass** |
| P1-AUTH-02-T03 | Refresh → new access token and new refresh token (rotation) | API | A | M1.0 | **Pass** |
| P1-AUTH-02-T04 | Expired access token → 401 TOKEN_EXPIRED; refresh still works | I (+API if test clock) | A | M1.0 | **Pass** |
| P1-AUTH-02-T05 | Refresh token older than 12 h → 401 REFRESH_TOKEN_INVALID | I (+API if test clock) | A | M1.0 | **Pass** |
| P1-AUTH-02-T06 | Logout revokes the refresh token; second logout still 204 | API | A | M1.0 | **Pass** |
| P1-AUTH-02-T07 | Tampered / unsigned JWT → 401 | API | A | M1.0 | **Pass** |
| P1-AUTH-02-T08 | Refresh token not accepted as an access token | API | A | M1.0 | **Pass** |
| P1-AUTH-02-T09 | Already-used refresh token → 401 REFRESH_TOKEN_INVALID | API | A | M1.0 | **Pass** |
| P1-AUTH-02-T10 | UI refreshes silently when the access token expires mid-work (short TTL in test profile) | E2E | A | M1.0 | **Pass** |
| P1-AUTH-02-T11 | After logout, Back does not restore the session | E2E | A | M1.0 | **Pass** |
| P1-AUTH-02-T12 | Refresh token presented from another terminal → rejected | API | A | M1.0 | **Pass** |

#### P1-AUTH-03: idle logout per terminal type (POS 10, admin 30); KDS exempt

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-AUTH-03-T01 | Cashier POS locks after 10 idle min → login (page.clock) | E2E | A | M1.0 | **Pass** |
| P1-AUTH-03-T02 | Input at 9:59 resets the timer | E2E | A | M1.0 | **Pass** |
| P1-AUTH-03-T03 | Reception POS also 10 min | E2E | A | M1.0 | **Pass** |
| P1-AUTH-03-T04 | Admin terminal: kept at 29:59, locked at 30:00 | E2E | A | M1.0 | **Pass** |
| P1-AUTH-03-T05 | KDS stays logged in after 12 idle hours (@kds) | E2E | A | M1.1 (kitchen terminal needs a station) | **Pass** |
| P1-AUTH-03-T06 | Owner sets POS to 5 min → applies at next login / refresh | E2E + API | A | M1.0 | **Pass** |
| P1-AUTH-03-T07 ×4 | Idle timeout 0, 241, −1, 7.5 → 422 | API | A | M1.0 | **Pass** (4) |
| P1-AUTH-03-T07b | KITCHEN / DISPLAY rule, or missing / duplicate POS type → 422 | API | A | M1.0 | **Pass** |
| P1-AUTH-03-T08 | Idle logout calls logout(reason IDLE_TIMEOUT): refresh token revoked | E2E + API | A | M1.0 | **Pass** |
| P1-AUTH-03-T09 | LOGOUT audit row with reason IDLE_TIMEOUT | API | A | M1.0 | **Pass** |
| P1-AUTH-03-T10 | Defaults CASHIER_POS 10, RECEPTION_POS 10, ADMIN 30; KITCHEN / DISPLAY exempt | API | A | M1.0 | **Pass** |
| P1-AUTH-03-T11 | Session on a KITCHEN terminal has no idleTimeoutMinutes | API | A | M1.1 | **Pass** |

#### P1-AUTH-04: devices registered as terminals; unregistered browser reaches only login / setup; terminal id on records

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-AUTH-04-T01 ×4 | Unregistered browser on /pos, /admin, /admin/users, /kitchen → login / setup | E2E | A | M1.0 | **Pass** (4) |
| P1-AUTH-04-T02 | Login without X-Terminal-Id → rejected | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T03 | Owner registers the device as Cashier POS / Reception POS / Admin from /setup/terminal | E2E | A | M1.0 | **Pass** |
| P1-AUTH-04-T03b | registerTerminal (inline owner credentials) → 201, one-time deviceToken ≥ 32 chars | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T04 | Valid credentials without TERMINAL_MANAGE → 403 FORBIDDEN (also in matrix) | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T05 | Unknown terminal id → 403 TERMINAL_NOT_REGISTERED | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T05b | Registered terminal id + wrong device token → rejected | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T06 | Deactivated terminal: login → 403 TERMINAL_INACTIVE; its refresh tokens → 401 | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T06b | Device of a deactivated terminal returns to setup within one access-token lifetime | E2E | A | M1.0 | **Pass** |
| P1-AUTH-04-T07 | Audit rows carry the device's terminal | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T08 | KITCHEN without kitchenStationId → 422; with a station → registers | API | A | M1.1 | **Pass** |
| P1-AUTH-04-T09 | Terminals screen: list, rename (audited), deactivate | E2E | A | M1.0 | **Pass** |
| P1-AUTH-04-T10 | Orders and payments store the terminal id | API | A | M1.2 / M1.4 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-04-T11 | X-Terminal-Id ≠ token's terminal → 403 TERMINAL_MISMATCH | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T12 | Kitchen screen header shows its station (@kds) | E2E | A | M1.1 | **Pass** |
| P1-AUTH-04-T13 | registerTerminal wrong credentials → 401; owner never locked; 5 failures from one IP in 15 min → 429 TOO_MANY_ATTEMPTS + Retry-After; window expires after 15 min | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T16 | Setup screen shows the wait time when registration is rate limited | E2E | A | M1.0 | **Pass** |
| P1-AUTH-04-T14 | Duplicate terminal name (case-insensitive) → 409 TERMINAL_NAME_TAKEN | API | A | M1.0 | **Pass** |
| P1-AUTH-04-T15 | Deactivated terminal cannot be reactivated; shown with active=false | API | A | M1.0 | **Pass** |

#### P1-AUTH-05: 4–6 digit PIN, hashed; 3 wrong in a row → PIN locked 5 min

The contract has no PIN-check endpoint, and M1.0 has no `x-approval` operation, so the approval and lock rows can only run from M1.2 on (see Q10).

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-AUTH-05-T08 ×6 | PIN "123", "1234567", "12a4", "" → 422; 4 and 6 digits accepted (setOwnPin / createUser / resetUserPin) | API | A | M1.0 | **Pass** (5) |
| P1-AUTH-05-T11 | PIN stored as bcrypt/argon2 hash | I + M (DB check on staging) | A+M | M1.0 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T12 | No API response contains a PIN or a PIN hash | API | A | M1.0 | **Pass** |
| P1-AUTH-05-T14 | Owner resets a PIN: pinSet true, PIN lock cleared, PIN_RESET without values | API | A | M1.0 | **Pass** |
| P1-AUTH-05-T17 | setOwnPin with wrong password → 422, counts towards the account lock | API | A | M1.0 | **Pass** |
| P1-AUTH-05-T18 | setOwnPin clears the PIN failure counter; PIN_CHANGED audited | API | A | M1.0 | **Pass** |
| P1-AUTH-05-T19 | User without a PIN has pinSet false (login, users list) | API | A | M1.0 | **Pass** |
| P1-AUTH-05-T20 | unlockUser clears the PIN lock and counter | API | A | M1.2 (lock can only be produced by an approval) | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T01 | Correct manager PIN approves an action the manager can approve | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T02 | Wrong PIN → 403 APPROVAL_INVALID | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T03 | 3 wrong PINs in a row → correct PIN gets 423 PIN_LOCKED | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T04 | 2 wrong then correct → counter reset | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T05 | PIN lock lasts 5 min | I (+API if test clock) | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T06 | PIN lock does not block password login | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T07 | PIN lock is per user: owner can still approve | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T09 | Cashier's correct PIN never approves | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T10 | Manager PIN rejected for owner-only approval (DISCOUNT_OWNER) | API | A | M1.4 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T13 | PinPrompt masks a numeric PIN, shows the locked message on 423 | E2E | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T15 | Approver stored on the record and in the audit log | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T16 | Unknown approver username → same APPROVAL_INVALID | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-T21 | Missing approval object → 403 APPROVAL_REQUIRED | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUTH-05-GEN | Generated approver × x-approval operation cases (`buildApprovalCases`; 0 in M1.0) | API | A | M1.2+ | Not run |

#### P1-RBAC-01: permission-based access; 8 seeded roles with the roles-permissions.md matrix

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-RBAC-01-T01 | Exactly 8 system roles with the documented names | API | A | M1.0 | **Pass** |
| P1-RBAC-01-T02 ×8 | Each system role's permissionCodes = `role-grants.ts` defaults | API | A | M1.0 | **Pass** (8) |
| P1-RBAC-01-T03 ×8 | Login permissions[] = the role's defaults | API | A | M1.0 | **Pass** (8) |
| P1-RBAC-01-T04 | listPermissions = the 37 Phase 1 codes, grouped by module | API | A | M1.0 | **Pass** |
| P1-RBAC-01-T05 | System role delete / rename → 409 SYSTEM_ROLE_READ_ONLY | API | A | M1.0 | **Pass** |
| P1-RBAC-01-T06 | System role permissions (not Owner) editable and restorable | API | A | M1.0 | **Pass** |
| P1-RBAC-01-T07 ×3 | Rider / Inventory / HR login shows a "nothing yet" home, not an error | E2E | A | M1.0 | **Pass** (3) |
| P1-RBAC-01-T08 | Owner role permissions cannot change → 409 OWNER_ROLE_READ_ONLY | API | A | M1.0 | **Pass** |
| P1-RBAC-01-U | `role-grants.ts` encodes roles-permissions.md (parser, 37 codes, spot checks, later-phase column order) | U | A | M1.0 | **Pass** (12 tests) |

#### P1-RBAC-02: owner creates custom roles and assigns roles; effect on next refresh; audited

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-RBAC-02-T01 | Create custom role from the permission list | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T02 | Assign the custom role to a user | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T03 | **Remove** a permission: old token keeps it until refresh; after refresh the permission is gone and its endpoint → 403 | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T04 | **Add** a permission: allowed after refresh | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T05 | Change a user's roles: takes effect after refresh | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T06 | Role CREATE / UPDATE / DELETE audited with before / after codes | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T07 | ROLES_ASSIGNED audited with before / after role names | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T08 | Duplicate role name (case-insensitive) → 409 ROLE_NAME_TAKEN | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T09 | Unknown permission code → 422 | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T10 | Delete a custom role still assigned → 409 ROLE_IN_USE | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T11 | Remove Owner role from the last active owner → 409 LAST_OWNER | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T11b | Deactivate the last active owner → 409 LAST_OWNER | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T12 | Stale version on updateRole / updateUser / assignUserRoles → 409 VERSION_CONFLICT | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T13 | Role editor groups by module; persists after reload | E2E | A | M1.0 | **Pass** |
| P1-RBAC-02-T14 | Create user (username, password, PIN, role); duplicate → 409 USERNAME_TAKEN | API + E2E | A | M1.0 | **Pass** |
| P1-RBAC-02-T15 | Owner deactivating self → 409 CANNOT_DEACTIVATE_SELF | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T16 | Deactivated user keeps history; activateUser restores login | API | A | M1.0 | **Pass** |
| P1-RBAC-02-T17 | Username immutable, `^[a-z0-9._-]{3,32}$` | API | A | M1.0 | **Pass** |

#### P1-RBAC-03: every endpoint enforces permissions server-side (403); UI hiding not enough

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-RBAC-03-T01 ×632 | **Generated** role × operation: 79 protected operations × 8 roles; 403 when not granted, not 401/403 when granted. `registerTerminal` sends the role's credentials in the body (`x-auth: INLINE_CREDENTIALS`) | API | A | M1.0 | **Pass** (632) |
| P1-RBAC-03-T02 ×79 | **Generated**: each protected operation without a token → 401 (registerTerminal: unknown-user credentials → 401) | API | A | M1.0 | **Pass** (79) |
| P1-RBAC-03-T02p ×2 | login, refresh are PUBLIC: no role cases (skipped in the matrix, covered by P1-AUTH-01/02) | API | A | M1.0 | Deferred (test skeleton, `fixme`) |
| P1-RBAC-03-T03 | Contract: every operation has a known x-permission; security / x-auth / x-approval consistent with roles-permissions.md | C | A | M1.0 | **Pass** |
| P1-RBAC-03-T04 ×160 | **Generated** UI route matrix: 10 M1.0 routes × 8 roles → reachable / blocked | E2E | A | M1.0 | **Fail** (0 of 160, 1 flaky) |
| P1-RBAC-03-T05 | Navigation shows only permitted entries per role | E2E | A | M1.0 | **Pass** |
| P1-RBAC-03-T06 | 403 body is problem+json with plain-English detail, no stack trace (asserted inside T01) | API | A | M1.0 | **Pass** |
| P1-RBAC-03-T07 | `x-permission` ↔ `@PreAuthorize` check test exists and is green in backend CI | I | A | M1.0 | **Pass** (backend `PermissionContractTest`: every operation of the contract has a controller method whose `@PreAuthorize` matches its `x-permission`) |
| P1-RBAC-03-U | Generator unit tests on fixture specs (forms of x-permission, scopes, auth modes, contract problems, samples) | U | A | M1.0 | **Pass** (32 tests) |

#### P1-RBAC-04: kitchen users see only their own station

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-RBAC-04-T01 | KITCHEN terminal bound to exactly one station | API | A | M1.1 | **Pass** |
| P1-RBAC-04-T02 | Kitchen 1 cannot list Kitchen 2 KOTs (403/404) | API | A | M1.3 | Deferred (test skeleton, `fixme`) |
| P1-RBAC-04-T03 | Kitchen 1 screen cannot open station 2 by URL (@kds) | E2E | A | M1.3 | Deferred (test skeleton, `fixme`) |
| P1-RBAC-04-T04 | Kitchen 1 cannot subscribe to the Kitchen 2 STOMP topic | API (WS) | A | M1.3 | Deferred (test skeleton, `fixme`) |
| P1-RBAC-04-T05 | Kitchen 1 cannot change a Kitchen 2 KOT's status | API | A | M1.3 | Deferred (test skeleton, `fixme`) |

#### P1-AUD-01: audit records with time, user, terminal, action, entity, before/after, approver, reason

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-AUD-01-T01 | LOGIN: time (UTC), user, terminal | API | A | M1.0 | **Pass** |
| P1-AUD-01-T02 | LOGOUT with reason USER / IDLE_TIMEOUT | API | A | M1.0 | **Pass** |
| P1-AUD-01-T03 | LOGIN_FAILED with typed username, no password | API | A | M1.0 | **Pass** |
| P1-AUD-01-T04 | ACCOUNT_LOCKED, ACCOUNT_UNLOCKED | API | A | M1.0 | **Pass** |
| P1-AUD-01-T05 | User CREATE / UPDATE / ACTIVATE / DEACTIVATE before/after, no password or PIN | API | A | M1.0 | **Pass** |
| P1-AUD-01-T06 | Role CREATE / UPDATE / DELETE before/after codes | API | A | M1.0 | **Pass** |
| P1-AUD-01-T07 | TERMINAL_REGISTERED, terminal UPDATE, DEACTIVATE | API | A | M1.0 | **Pass** |
| P1-AUD-01-T08 | SETTINGS_CHANGED per settings area with before/after | API | A | M1.0 | **Pass** |
| P1-AUD-01-T09 | Approver stored; PIN_FAILED / PIN_LOCKED recorded | API | A | M1.2 | Deferred (test skeleton, `fixme`) |
| P1-AUD-01-T10 | Reason and comment stored when present | API | A | M1.2 (first action with a reason) | Deferred (test skeleton, `fixme`) |
| P1-AUD-01-T11 | Exactly one audit row per action | API | A | M1.0 | **Pass** |
| P1-AUD-01-T12 | Later actions: price changes (M1.1), discounts / cancellations / voids / refunds (M1.4), shift open/close, day-end (M1.5) | API | A | M1.1–M1.5 | Deferred (test skeleton, `fixme`) |
| P1-AUD-01-T13 | PASSWORD_CHANGED / PASSWORD_RESET / PIN_CHANGED / PIN_RESET carry no secrets | API | A | M1.0 | **Pass** |
| P1-AUD-01-T14 | AUDIT_EXPORTED with the filters used | API | A | M1.0 | **Pass** |

#### P1-AUD-02: audit log cannot be edited or deleted

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-AUD-02-T01 | Contract: no PUT / PATCH / DELETE (or non-export POST) on audit paths | C | A | M1.0 | **Pass** |
| P1-AUD-02-T02 ×4 | PUT / PATCH / DELETE / POST on `audit-log` and `audit-log/{id}` as owner → 404/405 | API | A | M1.0 | **Pass** (4) |
| P1-AUD-02-T03 | App DB role has no DELETE (Q18: also UPDATE, TRUNCATE) on `audit_log` (`has_table_privilege`) | I + M (psql on staging) | A+M | M1.0 | **Pass** (manual psql 2026-11-22: app role has INSERT, SELECT only; DELETE / UPDATE / TRUNCATE / DROP denied; backend `AuditLogImmutabilityIT` 3/3) |
| P1-AUD-02-T04 | Audit viewer has no edit / delete controls | E2E | A | M1.0 | **Pass** |

#### P1-AUD-03: owner searches audit log by date, user, action, entity; paginated; Excel export

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-AUD-03-T01 | from / to = calendar dates in Asia/Colombo, inclusive | API | A | M1.0 | **Pass** |
| P1-AUD-03-T02 | Filter by userId | API | A | M1.0 | **Pass** |
| P1-AUD-03-T03 | Filter by action | API | A | M1.0 | **Pass** |
| P1-AUD-03-T04 | Filter by entityType and entityId | API | A | M1.0 | **Pass** |
| P1-AUD-03-T05 | Combined filters ANDed | API | A | M1.0 | **Pass** |
| P1-AUD-03-T06 | page / size ≤ 200 / totalItems; newest first; sort on `at` only | API | A | M1.0 | **Pass** |
| P1-AUD-03-T07 | Export: one .xlsx sheet, exactly the filtered rows, Colombo times | API | A | M1.0 | **Pass** |
| P1-AUD-03-T08 | Only AUDIT_VIEW (owner) can search / export (matrix) | API | A | M1.0 | **Pass** (generated matrix: only the owner holds AUDIT_VIEW; custom AUDIT_VIEW role works, P1-AUD-03-T13) |
| P1-AUD-03-T09 | Viewer: filter, paginate, export downloads .xlsx | E2E | A | M1.0 | **Pass** |
| P1-AUD-03-T10 | 23:59:59 Colombo on to-date included; 00:00 next day excluded | API | A | M1.0 | **Pass** |
| P1-AUD-03-T11 | to before from → 422 | API | A | M1.0 | **Pass** |
| P1-AUD-03-T12 | > 50,000 rows → 422 EXPORT_TOO_LARGE | I (volume) | A | M1.0 | **Pass** |

#### P1-SET-01: service charge rate per order type; copied to the order

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-SET-01-T01 | One rule each for DINE_IN, TAKEAWAY, DELIVERY; none for CREDIT | API | A | M1.0 | **Pass** |
| P1-SET-01-T02 | Owner updates rates; persisted; SETTINGS_CHANGED before/after | API | A | M1.0 | **Pass** |
| P1-SET-01-T03 ×4 | Rate "-1.00", "100.01", "10.555", "ten" → 422 | API | A | M1.0 | **Pass** (7) |
| P1-SET-01-T03b | Missing / duplicate order type → 422 | API | A | M1.0 | **Pass** (2) |
| P1-SET-01-T04 | Non-owner → 403 (matrix) | API | A | M1.0 | **Pass** |
| P1-SET-01-T05 | Settings screen edits rates per order type | E2E | A | M1.0 | **Pass** |
| P1-SET-01-T06 | Rate copied onto the order at creation; later change leaves open orders alone | API | A | M1.2 | Not run |
| P1-SET-01-T07 | Credit order uses its service mode's rate | API | A | M1.4 | Not run |
| P1-SET-01-T08 | Stale version → 409 VERSION_CONFLICT | API | A | M1.0 | **Pass** |

#### P1-SET-02: tax setting exists, off, rate 0

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-SET-02-T01 | Fresh install: enabled false, rate 0.00 | API | A | M1.0 | **Pass** |
| P1-SET-02-T02 | Settings screen shows tax off, no switch-on | E2E | A | M1.0 | **Pass** |
| P1-SET-02-T03 | enabled=true → 409 TAX_NOT_SUPPORTED; rate/label alone stored and audited | API | A | M1.0 | **Pass** |
| P1-SET-02-T04 | Bills show tax 0.00 or hide the line; service charge & tax summary shows 0.00 | API + E2E | A | M1.4 / M1.5 | Not run |

#### P1-SET-03: restaurant details on receipts

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-SET-03-T01 | Save name, address, phone, footer; persisted, audited | API | A | M1.0 | **Pass** |
| P1-SET-03-T02 | name 1–60, address 1–200, phone 1–40 required; footer ≤ 300 | API | A | M1.0 | **Pass** |
| P1-SET-03-T03 | Settings screen edits the details | E2E | A | M1.0 | **Pass** |
| P1-SET-03-T04 | Printed on every receipt incl. reprints (80 mm printer) | M (hardware) | M | M1.3 / M1.4 | Deferred (test skeleton, `fixme`) |

#### P1-SET-04: business day start time

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-SET-04-T01 | Set dayStartTime HH:mm; persisted, audited; timeZone Asia/Colombo | API | A | M1.0 | **Pass** |
| P1-SET-04-T02 ×5 | "25:00", "6:00", "06:60", "abc", "" → 422 | API | A | M1.0 | **Pass** (7) |
| P1-SET-04-T03 | Settings screen edits the start time | E2E | A | M1.0 | **Pass** |
| P1-SET-04-T04 | Order after midnight but before day-end belongs to the open business day | API (clock) | A | M1.5 | Deferred (test skeleton, `fixme`) |
| P1-SET-04-T05 | Change applies from the next business day; open day unchanged | API | A | M1.5 | Deferred (test skeleton, `fixme`) |

#### P1-SET-05: kitchen target preparation time per station

No endpoint in the M1.0 contract: stations arrive in M1.1 (Q23).

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-SET-05-T01 | Set target minutes per station; persisted, audited | API | A | M1.1 | **Pass** |
| P1-SET-05-T02 ×3 | "0", "-5", "7.5" → rejected | API | A | M1.1 | **Pass** (5) |
| P1-SET-05-T03 | /admin/kitchens edits targets | E2E | A | M1.1 | **Pass** |
| P1-SET-05-T04 | KDS highlights KOTs past the target (P1-KDS-05) | E2E | A | M1.3 | Not run |

#### P1-NFR: non-functional (rows that apply from M1.0)

| Test id | Test | Level | Auto | Gate | Status |
|---|---|---|---|---|---|
| P1-NFR-01-T01 | Login round trip recorded as a baseline (KOT ≤ 3 s measured in M1.3) | API | A | M1.0 (info) / M1.3 | **Pass** |
| P1-NFR-02-T01 | Login, POS layout, admin screens at 1366×768: no horizontal scroll, touch targets ≥ 48 px | E2E | A | M1.0 | **Pass** |
| P1-NFR-02-T02 | Kitchen layout at 1280×800 landscape (@kds) | E2E | A | M1.0 (layout) / M1.3 | **Pass** |
| P1-NFR-02-T03 | Admin screens usable at 360 px wide | E2E | A | M1.0 | **Pass** |
| P1-NFR-02-T04 | Current Edge smoke: login, admin, POS shell | Edge smoke (E2E) | A | M1.0 | **Pass** (2) |
| P1-NFR-02-T05 | Android tablet smoke (KDS) | M (device) | M | M1.6 | Not run |
| P1-NFR-03-T01 | Staging: http → https redirect, HSTS header | API (staging) | A | M1.0 | Deferred (test skeleton, `fixme`) |
| P1-NFR-03-T02 | Valid TLS certificate, no mixed content | M + E2E console check | A+M | M1.0 | **Blocked**: needs the staging deploy |
| P1-NFR-03-T03 | Passwords hashed bcrypt/argon2 | I + M (DB check) | A+M | M1.0 | **Pass** (manual: all 103 password hashes are bcrypt `$2a$`, 60 chars; no plaintext) |
| P1-NFR-03-T04 | PINs hashed (= P1-AUTH-05-T11) | I + M | A+M | M1.0 | **Pass** (manual: all PIN hashes are bcrypt `$2a$`; device and refresh tokens stored as SHA-256 hashes) |
| P1-NFR-03-T05 | No password, PIN or hash in any API response or audit payload | API | A | M1.0 | **Pass** |
| P1-NFR-04-T01 | Daily backup, off-site copy, restore drill documented in deploy/ | M | M | M1.6 | Not run |
| P1-NFR-05-T01 | Uptime monitoring in place (99.5 %/month target) | M | M | M1.6 | Not run |
| P1-NFR-06-T01 | M1.0 screens in English, no untranslated keys | E2E | A | M1.0 | **Pass** |
| P1-NFR-06-T02 | Money in LKR, 2 decimals | E2E | A | M1.4 | Not run |
| P1-NFR-07-T01 | API timestamps ISO-8601 UTC (`Z`) | API | A | M1.0 | **Pass** |
| P1-NFR-07-T02 | Audit viewer shows Asia/Colombo time with the browser in Europe/London | E2E | A | M1.0 | **Pass** |
| P1-NFR-07-T03 | Kitchen header clock in Asia/Colombo (@kds) | E2E | A | M1.1 | **Pass** |

### Execution results (2026-11-22, M1.0 re-verify + M1.1 Tier 2)

Stack under test: backend jar built 2026-11-22 16:05 (contract v0.2.0, 81 operations; profiles `dev,test`, port 8082, database `rms_e2e`, plus a second instance on 8083 with an audit export limit of 30), frontend Vite dev server on 3001, seeded through the real API after `POST /test/reset`. Strategy of 2026-11-22 (test-strategy §2a): this run is Tier 2 plus Tier 1; the first full pass was run before the strategy changed and its results are kept.

| Suite | Result |
|---|---|
| Backend `./mvnw verify` (isolated copy) | **77 unit + 192 integration = 269 / 269 pass** |
| Frontend `npm run lint`, `type-check`, vitest | lint clean · type-check clean · **131 / 131 pass** (18 files) |
| QA tooling unit tests | **45 / 45 pass** |
| **Tier 1 smoke** (`npm run test:smoke`, API only) | **161 / 161 pass in 16 s** |
| Playwright parallel phase (`chromium-desktop`, `kds-tablet`), after reruns of changed specs | **1,333 pass** (plus the 45 QA unit tests below) · 2 expected failures (open bug BUG-1-007) · 30 `fixme` (rows gated M1.2–M1.5) · 4 skipped · 1 flaky (a Chromium worker crash in a route-matrix case, passes on retry) · **0 unexpected failures** |
| Playwright `serial` (test clock, global settings, owners, rate limits, export limit, import size) | **23 pass** · 1 expected failure (BUG-1-008) |
| Playwright `edge-desktop` smoke (installed Microsoft Edge) | **2 / 2 pass** |
| Manual DB checks (psql, M1.0) | hashes bcrypt, tokens SHA-256, audit log immutable: all pass |

M1.0 re-verify: the six M1.0 bugs are fixed and verified (BUG-1-001 to BUG-1-006; their `test.fail` markers and the login-retry workaround were removed and all those tests pass; see bugs.md). The M1.0 UI specs were all re-run in the first full pass; a handful of UI tests (users list, terminals rename, items list) failed once under a 25-minute 3-worker load and passed alone: logged as flaky, not bugs.

Generated permission matrix: 81 operations (2 PUBLIC) → **632 role × operation cases + 79 unauthenticated cases + 2 public (skipped by design) + 2 contract tests**, plus 160 UI route cases (20 routes × 8 roles): all pass, **0 permission violations found**. The generator now also handles multipart uploads (import), inline credentials at the body root (`getTerminalSetupOptions`) and the receptionist's dine-in scope on read operations; it fails any case that answers 5xx.

Tests by spec file (Playwright, after expansion; `fixme` = gated at a later milestone):

| Spec | Tests | Pass | Expected fail (bug) | `fixme` | Skipped |
|---|---|---|---|---|---|
| auth, session-idle, terminals, pin-approval, roles, audit, settings, nfr, smoke (M1.0 areas) | 246 | 219 | 0 | 25 | 2 |
| permission-matrix (API) | 715 | 713 | 0 | 0 | 2 |
| ui-permissions (route matrix) | 165 | 164 | 0 | 0 | 0 (+1 flaky) |
| stations | 32 | 32 | 0 | 0 | 0 |
| menu | 71 | 68 | 1 (BUG-1-007) | 2 | 0 |
| menu-ui | 25 | 24 | 1 (BUG-1-007) | 0 | 0 |
| floor | 37 | 36 | 0 | 1 | 0 |
| delivery-reasons | 30 | 28 | 0 | 2 | 0 |
| import | 51 | 51 | 0 | 0 | 0 |
| serial | 24 | 23 | 1 (BUG-1-008) | 0 | 0 |
| QA tooling unit tests | 45 | 45 | 0 | 0 | 0 |
| **Total** | **1,441** | **1,403** | **3** | **30** | **4** (+1 flaky) |

### Additional tests written during execution (not in the original plan, M1.0 areas)

| Test id | Result | Test |
|---|---|---|
| P1-AUD-03-T07b | Pass | the export honours the same date filter and shows times in Asia/Colombo |
| P1-AUD-03-T09b | Pass | the viewer pages through results and shows before / after details |
| P1-AUD-03-T13 | Pass | only the owner holds AUDIT_VIEW: a user with a custom AUDIT_VIEW role can search and export |
| P1-AUD-03-T14 | Pass | a range with to before from is flagged in the form before searching |
| P1-AUTH-01-T07b | Pass | after the lock expires the failure counter starts again from zero |
| P1-AUTH-01-T11b | Pass | the owner logs in on an admin device and lands on /admin |
| P1-AUTH-01-T18 | Pass | concurrent logins of one valid user all succeed (no 409 VERSION_CONFLICT) |
| P1-AUTH-01-T19 | Pass | 5 failed attempts lock the account even when the attempts arrive in parallel |
| P1-AUTH-02-T05b | Pass | logout revokes the refresh token immediately even inside its 12 hours |
| P1-AUTH-02-T13 | Pass | the session response and /auth/me agree on user, permissions and terminal |
| P1-AUTH-02-T14 | Pass | when the refresh token has expired too, the browser returns to login with a "session ended" notice |
| P1-AUTH-03-T02b | Pass (3) | a key press counts as activity |
| P1-AUTH-03-T06b | Pass | a changed timeout reaches a logged-in terminal at its next token refresh |
| P1-AUTH-03-T12 | Pass | the settings screen shows POS and admin timeouts and "Never" for kitchen and display |
| P1-AUTH-03-T13 | Pass | after idle logout the next user logs in on the same terminal and gets a fresh timer |
| P1-AUTH-03-T14 | Pass | the session carries the idle timeout of its terminal type (POS 10, reception 10, admin 30) |
| P1-AUTH-04-T01b | Pass | unregistered browser opening /login is sent to terminal setup |
| P1-AUTH-04-T03c | Pass (2) | registering the device as "Cashier POS" and logging in lands on the POS |
| P1-AUTH-04-T04b | Pass | a user without TERMINAL_MANAGE is refused on the setup screen with a clear message |
| P1-AUTH-04-T05c | Pass | malformed X-Terminal-Id is a 400 |
| P1-AUTH-04-T09b | Pass | owner deactivates a terminal from the terminals screen |
| P1-AUTH-04-T17 | Pass | KITCHEN without kitchenStationId and a non-KITCHEN type with a station are rejected with 422 |
| P1-AUTH-04-T18 | Pass | terminal name is required and at most 50 characters |
| P1-AUTH-04-T19 | Pass | listTerminals never exposes a device token or its hash |
| P1-AUTH-04-T20 | Pass | terminal setup options (no token) return active stations and ordering points for the owner |
| P1-AUTH-04-T21 | Pass | terminal setup options: valid credentials without TERMINAL_MANAGE get 403; no body is 422 |
| P1-AUTH-04-T22 | Pass | the owner registers a KITCHEN screen on the setup page by choosing its station; the kitchen user then logs in  |
| P1-AUTH-04-T23 | Pass | the setup page refuses a KITCHEN screen without a station |
| P1-AUTH-04-T24 | Pass | the setup page offers ordering points for a POS device and registers it with the chosen point |
| P1-AUTH-04-T26 | Pass | wrong credentials on the token-less setup-options call count towards the same per-IP limit (5 in 15 min, then  |
| P1-AUTH-05-T08b | Pass (3) | a PIN of 4 digits is accepted (setOwnPin, resetUserPin) |
| P1-AUTH-05-T22 | Pass | only the owner (USER_MANAGE) can reset another user's PIN |
| P1-NFR-02-T01b | Pass | admin screens fit 1366x768 without horizontal scroll |
| P1-NFR-02-T01c | Pass | the POS shell fits 1366x768 without horizontal scroll and its header touch targets are at least 48 px |
| P1-NFR-02-T02b | Pass | kitchen header controls are at least 48 px (touch-first) |
| P1-NFR-02-T04b | Pass (2) | the owner can use users, roles, settings and audit screens |
| P1-NFR-02-T06 | Pass | the admin shell works at phone size 390x844 with the navigation drawer (owner on a phone, Annex A §14) |
| P1-RBAC-01-T06b | Pass | a system role keeps its name and key after its permissions were edited |
| P1-RBAC-01-T09 | Pass | listRoleOptions and listUserOptions give narrow lookups without needing ROLE_MANAGE / USER_MANAGE |
| P1-RBAC-02-T09b | Pass | a role name is required (1..50 characters) |
| P1-RBAC-02-T13b | Pass | the Owner role is read-only in the editor; system roles have a fixed name |
| P1-RBAC-02-T14b | Pass | createUser validates: no role, unknown role id, short password |
| P1-RBAC-02-T14c | Pass | owner creates a user on the users screen; the new user can log in |
| P1-RBAC-02-T16b | Pass | owner deactivates and reactivates a user on the users screen |
| P1-RBAC-02-T18 | Pass | listUsers: search, role filter, active filter, paging and sorting |
| P1-RBAC-02-T19 | Pass | owner resets a PIN and a password from the users screen |
| P1-RBAC-02-T19b | Pass | the users list drops the "No PIN" badge right after a PIN reset (no reload needed) |
| P1-RBAC-02-T20 | Pass | a user whose role lacks ROLE_MANAGE is refused the role endpoints by the server |
| P1-RBAC-03-T05b | Pass | a manager sees the admin home but none of the owner-only entries |
| P1-RBAC-03-T05c | Pass | a user with only AUDIT_VIEW sees only the audit entry |
| P1-RBAC-03-T08 | Pass | a logged-in user is sent back to their landing page when opening /login |
| P1-RBAC-03-T09 | Pass | the matrix covers every seeded role for every route |
| P1-SET-01-T03c | Pass | a missing or duplicated order type in the rules is rejected with 422 |
| P1-SET-01-T05b | Pass | an invalid rate shows a field error on the settings screen and saves nothing |
| P1-SET-02-T03b | Pass | a tax rate outside 0.00-100.00 is rejected with 422 |
| P1-SET-03-T03b | Pass | the settings screen shows a field error for an empty name and saves nothing |
| P1-SET-04-T02b | Pass (2) | the boundary time 00:00 is accepted |

### Rows not automated, and why
- P1-AUTH-05 approval, PIN-lock and PinPrompt rows: gated at M1.2 (agreed): no approval operation exists before then.
- P1-AUTH-04-T10, P1-AUD-01-T09/T10/T12, P1-SET-01-T06/T07, P1-SET-02-T04, P1-SET-04-T04/T05, P1-RBAC-04-T02..T05: need orders, KOTs, bills, shifts (M1.2–M1.5).
- P1-NFR-03-T01/T02: need an HTTPS environment (staging).
- P1-NFR-02-T05 (Android tablet), P1-NFR-04 (backup restore), P1-NFR-05 (monitoring), P1-SET-03-T04 (receipt printer): manual, M1.3 / M1.6.

### Risks for running the suite
- Run it on a disposable database: the global setup calls `POST /test/reset` (wipes everything) and the matrix executes every allowed call with sample bodies.
- `npm run test:all` runs the parallel phase, then the `serial` project; the `serial` tests move the server clock and must never run beside other tests.
- The default CORS list of the backend `dev` profile allows ports 3000 and 5173 only: a second stack on another port needs `RMS_CORS_ALLOWED_ORIGINS`.

### Seed data (test-strategy §5) and deviations
- `e2e/fixtures/seed.ts`: 1 branch, 3 stations, 40 menu items (local + foreign price, mapped to stations, modifiers), 12 tables, 8 roles with one user each and known PINs, 3 discount rules, 2 delivery areas, 2 riders, 3 customers (one credit, one blocked), M1.0 settings.
- API seeding implemented for M1.0 (terminals via inline owner credentials, system roles, users, settings). Menu, floor, discounts, riders and customers are TODO for M1.1 / M1.2 / M1.4.
- **Deviation:** extra users kitchen2, kitchen3 (one kitchen identity per station for P1-RBAC-04) and cashier2 (own-records scoping). Owner = the bootstrap owner from `RMS_BOOTSTRAP_OWNER_*`.
- **Deviation:** no reset endpoint exists, so the seed is re-runnable rather than reset-based: terminals get a per-run name suffix (they cannot be deleted), existing users are reactivated and reset.

### Questions

**Answered by the contract, the backend or the lead (closed; kept so they are not asked again):**
refresh tokens rotate and are single-use · deactivating a user or terminal revokes its refresh tokens · LAST_OWNER, CANNOT_DEACTIVATE_SELF, OWNER_ROLE_READ_ONLY, ROLE_IN_USE guards · audit `from` / `to` are Colombo calendar dates, newest first, export limit 50,000 rows (configurable) · enabling tax → 409 TAX_NOT_SUPPORTED · idle timeouts 1–240 min, KITCHEN / DISPLAY exempt · restaurant field lengths · business-day changes apply from the next day · wrong current password counts towards the lock · terminals are bound by a one-time device token and `X-Terminal-Id` must match the token (TERMINAL_MISMATCH) · password 8–72 chars, not the username.

| # | Question | Answer / status (2026-11-22) |
|---|---|---|
| Q3 | Does the 5th failure answer 401 or 423? Does an attempt during the lock extend it? | **Closed.** The 5th wrong password answers 423 ACCOUNT_LOCKED, the 4 before it 401 (tested P1-AUTH-01-T05). Attempts during the lock do not extend it (T07: still locked at 14 min, open at 15). 423 only exists for real accounts, so the lock reveals that a username exists: accepted risk, to be confirmed by the owner. |
| Q4 | registerTerminal wrong credentials could lock the only owner (DoS); no recovery | **Closed.** No account lock any more: wrong credentials 401, then per-IP limit 5 failures / 15 min → 429 TOO_MANY_ATTEMPTS + Retry-After (tested P1-AUTH-04-T13, passes; owner login still works). The owner-recovery procedure is in `backend/README.md`. Remaining: anyone on the restaurant's own network can block registration for 15 min by spamming failures (acceptable). |
| Q10 | No PIN-check endpoint / no approval operation in M1.0 | **Agreed (lead): the P1-AUTH-05 approval and PIN-lock end-to-end rows stay at M1.2.** Backend covers lock and approval rules in unit / integration tests (PinApprovalServiceTest, PinApprovalServiceIT). M1.0 covers PIN storage, format, reset, change and flags. |
| Q12 | Which station does a kitchen user see: the terminal's or the user's? | **Open for M1.1/M1.3.** In M1.0 a kitchen user can log in on any terminal type (tested on the cashier POS) and the station belongs to the KITCHEN terminal. |
| Q14 | UI route → permission mapping not in screens.md | **Closed.** The frontend uses the same mapping (`router/access.ts`); `/setup/terminal` is open to anyone (the API enforces the owner credentials). `route-permissions.ts` updated. |
| Q17 | 403 vs 422 order | **Closed.** 403 comes before body validation (backend IT PermissionBeforeValidationIT; the matrix sends schema-valid bodies and still sees 403). |
| Q18 | Audit DB privileges | **Closed.** Verified in `rms_e2e` with psql: the app role has INSERT and SELECT only; UPDATE, DELETE, TRUNCATE and DROP are denied (manual check signed in signoff.md). |
| Q23 | P1-SET-05 gated at M1.0 or M1.1 | **Agreed (lead): M1.1** (stations arrive then). |
| Q25 | Testcontainers base class | **Closed.** It lives in `backend/` (backend-dev); 93 integration tests run on it. |
| Q26 | Test clock and reset hooks | **Closed.** `/test/clock/advance`, `/test/clock/reset`, `/test/reset` exist under profile `test` and are used by `serial.spec.ts` and the global setup. |
| Q28 | `data-testid` names | **Closed.** `pages/testids.ts` now matches the frontend; no missing hook found. |

**Open:**

| # | Topic | Question | Affects |
|---|---|---|---|
| Q1 | Roles | Proposal §1 lists **seven** roles ("HR / manager" as one); Annex A §2 and our docs seed **eight** (Manager and HR separate). The proposal wins on conflicts: confirm with the client that 8 is intended. | P1-RBAC-01-T01 |
| Q2 | Grants | Annex A §2 says Manager approves "discounts within limit"; roles-permissions.md gives Manager 🔑 on DISCOUNT_OTHER_ABOVE_LIMIT. Is there a manager-level ceiling above which only the owner may approve? | role-grants.ts, M1.4 |
| Q5 | Tokens | After logout, user deactivation, role change or terminal deactivation, an access token stays valid for up to 15 min. Acceptable for P1-AUTH-02 / P1-RBAC-02, e.g. for a dismissed employee? | P1-AUTH-02-T06, P1-RBAC-02-T03 |
| Q6 | Idle | Idle logout is client-side (the UI calls logout with IDLE_TIMEOUT). A tab that never fires it keeps its refresh chain alive. Is a client-only timer enough for "terminals log out automatically"? What happens to an unsaved order at idle logout? | P1-AUTH-03 |
| Q7 | Terminals | Annex A §14: the owner opens the admin panel from a laptop or phone. Every such device must be registered as an ADMIN terminal, and clearing browser storage loses the device token (no reactivation, register again). Acceptable to the client? | P1-AUTH-04 |
| Q8 | Audit | Which terminal is recorded for TERMINAL_REGISTERED (the device being registered has no terminal yet)? Observed: the new terminal is the entity; the actor is the owner. | P1-AUD-01-T07 |
| Q9 | Terminals | Should a KITCHEN terminal refuse non-kitchen users (a cashier on a kitchen screen), and should a kitchen user be refused on a POS terminal? Observed: both allowed. | P1-AUTH-04, matrix |
| Q11 | PIN | Is the PIN lock per approver across all terminals? Does a wrong *approver username* count against anyone? Brute-force limit when cycling approver names? | P1-AUTH-05 (M1.2) |
| Q13 | Custom roles | A role with zero permissions is allowed (the Rider system role has none). Can a user hold several roles (assignUserRoles takes a list; effective permissions = union)? | P1-RBAC-02 |
| Q15 | Roles | Rider, Inventory and HR hold no Phase 1 permission; after login they see the "No access" page with a Log out button. Is that the intended Phase 1 experience? | P1-RBAC-01-T07 |
| Q16 | Approvals | For x-approval operations, which permission does the **caller** need and which the **approver**? The generator supports `x-approval-permission`. Agree the convention before M1.2. | M1.2+, generator |
| Q19 | Audit | Are reads of sensitive data audited (viewing the user list)? Only AUDIT_EXPORTED is defined. | P1-AUD-01 |
| Q20 | Settings | Service charge range 0.00–100.00 with 2 decimals is enforced (and BUG-1-005 shows "5" / "1e2" are also accepted). Confirm the upper bound. | P1-SET-01-T03 |
| Q21 | Receipts | Restaurant name may be 60 chars; an 80 mm receipt fits about 48. Wrap or truncate? | P1-SET-03-T04 (M1.3) |
| Q22 | Business day | If day-end has not been run when the next day's start time passes, which business day do new orders belong to? | P1-SET-04-T04 (M1.5) |
| Q24 | Browsers | Edge is covered by an automated smoke run on the installed Edge (`edge-desktop`); real Android tablet / phone browsers remain manual (M1.6). | P1-NFR-02 |
| Q27 | Data | Some tests need a second owner (LAST_OWNER) and throwaway users. Done through the API in the test database only. | RBAC-02-T11 |
| Q29 | Password | The contract sets a password policy (8–72 chars, not the username). Annex A says nothing. Does the client want more (complexity, expiry, forced change at first login)? | P1-AUTH-01-T17 |
| Q30 | Tokens | Refresh tokens slide: each use issues a new one valid 12 h, so a session used at least every 12 h never ends except by idle logout (tested, P1-AUTH-02-T05; ADR-006). P1-AUTH-02 says "refresh token ≤ 12 h". Confirm sliding is the intent. | P1-AUTH-02 |
| Q31 | Audit | The 50,000-row export limit (`rms.audit.export-max-rows`) has no backend test; QA verified it with a second backend instance configured with a limit of 30. Ask backend-dev to add an integration test. | P1-AUD-03-T12 |
| Q32 | Concurrency | What should login do for two simultaneous valid logins (BUG-1-001): both succeed? Does a failed attempt that conflicts still count (BUG-1-002)? | P1-AUTH-01 |
| Q33 | UI | The admin home has two `<h1>` elements (page title "Home" and "Good day, Owner"). Cosmetic / accessibility; not filed as a bug. | P1-NFR-02 |
| Q34 | API order | `POST /import/{type}` answers 415 (not 403) to a caller without DATA_IMPORT who sends a non-multipart body: Spring rejects the media type before the permission check. With a proper multipart upload the answer is 403. Harmless, but the README says permission is checked before the body is read. Accept? | P1-RBAC-03 |
| Q35 | UI | A cashier (MENU_AVAILABILITY, no admin permission) can open `/admin/menu/availability` and sees the admin shell there, because the child route's guard replaces the parent's. They have the POS link `/pos/availability` for the same screen. Intended? Fixed 2026-11-24: the /admin guard applies, cashier gets /forbidden (P1-MENU-06-T30). | P1-MENU-06 |
| Q36 | Reset timing | The daily sold-out reset runs from a once-a-minute scheduler, so items come back up to one minute after the business-day start (tested: P1-MENU-06-T10/T13). Acceptable? | P1-MENU-06 |
| Q37 | Import | A binary file with a `.bin` name is read as CSV and answers 200 with `ok: false` and odd "unknown column" errors; `IMPORT_FILE_INVALID` (422) is only used for empty, oversized and over-long files. Should non-text content be refused with 422? | P1-IMP-01 |
| Q38 | UI | Item / category dialogs fill their fields after a short load: typing in the first fraction of a second is overwritten by the loaded values (seen once as a test race). Cosmetic. Fixed 2026-11-24: dialogs disabled until loaded, early typing kept (P1-MENU-02-T30). | P1-MENU-02 |
| Q39 | ADR-008 | Does a refused personal login with the right password (403 TERMINAL_REQUIRED_FOR_USER) reset the failed-attempt counter, as a successful login does? Not asserted (P1-AUTH-01-T40 only checks it never locks). Answered (lead 2026-11-24): yes, it resets the counter and never counts; asserted in P1-AUTH-01-T43. | P1-AUTH-01 |
| Q40 | ADR-008 | After a personal refresh is refused because LOGIN_ANY_DEVICE was removed, the current access token stays valid until it expires (up to 15 min)? Not asserted. Answered (lead 2026-11-24): yes, access token valid until expiry, refresh token revoked; asserted in P1-AUTH-04-T53. | P1-AUTH-04 |
| Q41 | ADR-008 | Does a refresh refused for a wrong X-Terminal-Id header revoke that refresh token? Tests use a new session per case, so either answer passes. Answered (lead 2026-11-24): no, the token is not revoked; asserted in P1-AUTH-04-T51/T52. | P1-AUTH-02 |
| Q42 | ADR-008 | A personal-session user without the POS permission (e.g. rider) opening /pos: "Use a registered counter device" or /forbidden? Not asserted. Answered (lead 2026-11-24): permission first, then session type; rider gets /forbidden, owner/manager the terminal page; asserted in P1-AUTH-04-T67b/T67c. | P1-AUTH-04 |
| Q43 | ADR-008 risk | The owner account becomes internet-facing with password + lockout only (ADR-008 consequences). Recommend the SMS one-time code for owner / manager personal logins when decision #6 lands. Client item (lead 2026-11-24): SMS one-time code after decision #6. Not a test item now. | P1-AUTH-01 |

---

## M1.1 Catalog & floor

Oracle: `docs/requirements/phase-1-requirements.md` §2–§3, `docs/requirements/m1.1-scope.md` (8 decisions + import format), contract v0.2.0 (81 operations, bundled), Annex A §3 (menu, price lists), §5 (three stations), §14 (menu, categories, modifiers, item-to-kitchen mapping, local / foreign price lists, tables and floor plan, delivery areas and fees). Specs (all under `e2e/specs/`): `stations.spec.ts` (stations, ordering points, terminal setup with a station, KDS exemption) · `menu.spec.ts` (categories, items, price lists, modifier groups, sold-out) · `menu-ui.spec.ts` (menu admin screens, sold-out screens, role checks) · `floor.spec.ts` (tables, positions, floor editor) · `delivery-reasons.spec.ts` (areas, reasons) · `import.spec.ts` (CSV / XLSX import, templates, import screen) · `serial.spec.ts` (daily sold-out reset on the test clock, setup-options rate limit, import size and speed) · `permission-matrix.spec.ts` / `ui-permissions.spec.ts` (now 81 operations and 20 routes).

Decisions of m1.1-scope.md and where they are tested: (1) never deleted: every "never deleted" test · (2) code 1–20 `A-Z 0-9 -` unique: P1-MENU-02-T03/T04 · (3) foreign price optional: P1-MENU-02-T02, P1-MENU-04-T01 · (4) station required: P1-MENU-02-T05 · (5) daily sold-out reset: P1-MENU-06-T10..T13 (serial) · (6) inactive category hides items: P1-MENU-01-T06 · (7) 1000×700 grid, x/y = centre: P1-FLOOR-01-T03/T04/T20..T22 · (8) import all-or-nothing, re-import updates: P1-IMP-01-T05, T21.

M1.1 rows that were gated here in the M1.0 plan and are now implemented: P1-SET-05-T01..T03 (stations), P1-AUTH-04-T08/T12 (KITCHEN terminal needs a real station), P1-AUTH-03-T05/T11 (kitchen terminal has no idle timeout), P1-RBAC-04-T01 (one station per kitchen terminal), P1-NFR-07-T03 (kitchen clock).

Not tested in M1.1 (and why): XLSX through the browser's native file chooser on the import screen is covered with a generated .xlsx in the UI test and at API level only (no Excel-authored file, no multi-sheet workbook); dragging the floor plan on a touch screen (the `kds-tablet` project has touch but the floor editor is an admin screen used with a mouse in the tests); a 5 MB file on the import screen; real printers and the POS floor view with live status (M1.2); "required modifier not chosen" and "sold-out item cannot be added" need orders (M1.2).

#### P1-MENU-01: Categories with display order and active flag.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-MENU-01-T01 | owner creates a category; defaults: active, placed at the end of the list, no items | API | A | **Pass** |
| P1-MENU-01-T02 | the list is ordered by sortOrder, then name | API | A | **Pass** |
| P1-MENU-01-T03 | a name is required (1-50 characters) and unique case-insensitively: 409 CATEGORY_NAME_TAKEN | API | A | **Pass** |
| P1-MENU-01-T04 | owner renames, reorders and deactivates a category; audited with before and after; stale version 409 | API | A | **Pass** |
| P1-MENU-01-T05 | categories are never deleted (no DELETE endpoint); deactivate instead | API | A | **Pass** |
| P1-MENU-01-T06 | an inactive category hides its items from the POS menu without changing the items | API | A | **Pass** |
| P1-MENU-01-T07 | itemCount counts all items of the category, active or not | API | A | **Pass** |
| P1-MENU-01-T08 | the POS menu lists active categories in sortOrder | API | A | **Pass** |
| P1-MENU-01-T20 | owner creates, renames, reorders and deactivates a category on the categories screen | E2E | A | **Pass** |
| P1-MENU-01-T21 | a duplicate category name shows an error in the dialog and saves nothing | E2E | A | **Pass** |

#### P1-MENU-02: Menu items: name, category, code, local price, foreign price, kitchen station, active flag, available flag.

Acceptance: Item cannot be saved without exactly one kitchen station.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-MENU-02-T01 | owner creates an item with code, name, category, one station, local and foreign price | API | A | **Pass** |
| P1-MENU-02-T02 | the foreign price is optional: an item without one has no foreignPrice | API | A | **Pass** |
| P1-MENU-02-T03 | the code is unique (case: upper only): a second item with the same code gets 409 ITEM_CODE_TAKEN | API | A | **Pass** |
| P1-MENU-02-T04 ×6 | item code "" is rejected with 422 | API | A | **Pass** (6) |
| P1-MENU-02-T04b ×3 | an item code a single character is accepted | API | A | **Pass** (3) |
| P1-MENU-02-T05 | an item cannot be saved without exactly one station: missing, unknown or empty stationId gets 422 on stationId | API | A | **Pass** |
| P1-MENU-02-T06 | category and name are required; an unknown category is 422; name is at most 100 characters | API | A | **Pass** |
| P1-MENU-02-T07 ×9 | local price "abc" is rejected with 422 (money = 2-decimal string, not negative) | API | A | **Pass** (9) |
| P1-MENU-02-T07b | prices sent as JSON numbers, or a negative / malformed foreign price, are rejected | API | A | **Pass** |
| P1-MENU-02-T07c | a zero price and the largest price (10 digits) are accepted | API | A | **Pass** |
| P1-MENU-02-T08 | update is a full replacement: an omitted foreignPrice removes it, omitted groups detach all | API | A | **Pass** |
| P1-MENU-02-T09 | changing the code to an existing one is 409 ITEM_CODE_TAKEN; a stale version is 409 VERSION_CONFLICT | API | A | **Pass** |
| P1-MENU-02-T10 | items are never deleted: no DELETE endpoint, deactivate instead; an inactive item leaves the POS menu | API | A | **Pass** |
| P1-MENU-02-T11 | the list filters by search, category, station, active and available, and pages and sorts | API | A | **Pass** |
| P1-MENU-02-T12 | an item is created with modifier groups in a chosen display order; an unknown group id is 422 | API | A | **Pass** |
| P1-MENU-02-T13 | saving an item that keeps its modifier groups works (a price edit), and a group can be added at the end | API | A | **Pass** |
| P1-MENU-02-T13b | groups can be detached or replaced by different groups on update | API | A | **Pass** |
| P1-MENU-02-T30 | typing into the item dialog right after opening it is kept (Q38 fixed) | E2E | A | **Pass** (new 2026-11-24; passed alone 5 of 5, flaky once under load) |
| P1-MENU-02-T13c | the display order of the modifier groups of an item can be changed (move up / down) | API | A | **Pass** (BUG-1-007 verified 2026-11-24) |
| P1-MENU-02-T20 | owner creates an item with category, station and both prices on the items screen; it is stored with exactly that station | E2E | A | **Pass** |
| P1-MENU-02-T21 | an item cannot be saved without a station or with a duplicate code; the dialog shows the errors | E2E | A | **Pass** |
| P1-MENU-02-T22 | the items screen filters by category, station, active and sold-out and pages through results | E2E | A | **Pass** |

#### P1-MENU-03: Modifier groups (e.g. "Spice level") with options that may add a price; required / optional; min / max selections.

Acceptance: Required modifier not chosen → item cannot be added to the order.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-MENU-03-T01 | owner creates a required group (pick 1) and an optional group (up to 3) with option prices | API | A | **Pass** |
| P1-MENU-03-T02 ×12 | a required group with minSelect 0 is rejected with 422 | API | A | **Pass** (12) |
| P1-MENU-03-T03 | a group name is unique (case-insensitive): 409 MODIFIER_GROUP_NAME_TAKEN | API | A | **Pass** |
| P1-MENU-03-T04 | update replaces the group and its options: options keep their id, unlisted options are removed; audited; stale version 409 | API | A | **Pass** |
| P1-MENU-03-T05 | groups are never deleted; an inactive group leaves the POS menu and keeps its attachments | API | A | **Pass** |
| P1-MENU-03-T06 | the POS menu lists each item with the ids of its groups, in order, and the groups with their options | API | A | **Pass** |
| P1-MENU-03-T07 | a required modifier not chosen: the item cannot be added to the order (enforced in M1.2) | API | A | Deferred (later milestone) |
| P1-MENU-03-T20 | an item with a modifier group can be opened and saved again from the items screen (group kept) | E2E | A | **Pass** |
| P1-MENU-03-T20b | the move up / move down arrows in the item dialog reorder the groups and save | E2E | A | **Pass** (BUG-1-007 verified 2026-11-24) |
| P1-MENU-03-T21 | owner attaches a modifier group to an item in the item dialog and removes it again | E2E | A | **Pass** |
| P1-MENU-03-T22 | owner creates a required group with options and prices on the modifiers screen, then deactivates it | E2E | A | **Pass** |
| P1-MENU-03-T23 | the group dialog shows field errors: two options with the same name, and a maximum above the number of options | E2E | A | **Pass** |
| P1-MENU-03-T24 | options can be reordered with the arrows and removed | E2E | A | **Pass** |

#### P1-MENU-04: Two price lists: **Local** and **Foreign**. Each order uses one, chosen by the cashier; default Local.

Acceptance: Price list name printed on the bill. Changing the price list on an open order reprices all un-sent lines only; sent lines need manager PIN.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-MENU-04-T01 | the POS menu carries the LOCAL and the FOREIGN price of every item; an item without a foreign price has none | API | A | **Pass** |

#### P1-MENU-05: Price changes are audit-logged and do not change existing orders.

Acceptance: Order lines keep the price at the time they were added.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-MENU-05-T01 | a price change writes PRICE_CHANGED (before and after) besides UPDATE, for local and for foreign price | API | A | **Pass** |
| P1-MENU-05-T02 | a change that is not a price writes UPDATE only, and removing the foreign price counts as a price change | API | A | **Pass** |
| P1-MENU-05-T03 | the POS menu shows a new price at once (existing orders keep theirs: checked with orders in M1.2) | API | A | **Pass** |
| P1-MENU-05-T20 | owner changes an item price on the items screen: stored with 2 decimals, PRICE_CHANGED audited, POS menu shows it | E2E | A | **Pass** |

#### P1-MENU-06: Owner can mark an item unavailable (sold out) for today.

Acceptance: Unavailable items are greyed out on POS and cannot be added.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-MENU-06-T01 | cashier and manager can toggle availability; the item itself stays untouched; the POS menu shows available=false | API | A | **Pass** |
| P1-MENU-06-T02 | a cashier can toggle availability but cannot edit, create or deactivate items (403 FORBIDDEN) | API | A | **Pass** |
| P1-MENU-06-T03 | roles without MENU_AVAILABILITY (receptionist, kitchen, rider, inventory, HR) get 403 on the toggle and the board | API | A | **Pass** |
| P1-MENU-06-T04 | the toggle is idempotent and audited as UPDATE (MENU_ITEM) with before and after available | API | A | **Pass** |
| P1-MENU-06-T05 | the availability board lists active items of active categories only, with their flag | API | A | **Pass** |
| P1-MENU-06-T06 | an unknown item is 404; a body without `available` is 422 | API | A | **Pass** |
| P1-MENU-06-T07 | menu settings: the daily reset is on by default and can be switched off (audited) | API | A | **Pass** |
| P1-MENU-06-T08 | sold-out items are greyed out on the POS and cannot be added to an order (M1.2) | API | A | Deferred (later milestone) |
| P1-MENU-06-T10 | sold-out items become available again at the start of the next business day (daily reset on by default) | API | A | **Pass** |
| P1-MENU-06-T11 | with the daily reset switched off a sold-out item stays sold out across the business-day start | API | A | **Pass** |
| P1-MENU-06-T12 | an item sold out after the business-day start stays sold out for the rest of that day | API | A | **Pass** |
| P1-MENU-06-T13 | changing the business-day start time moves the reset: a sold-out item is available after the new start, not before | API | A | **Pass** |
| P1-MENU-06-T20 | owner toggles Sold out / Available from the items screen | E2E | A | **Pass** |
| P1-MENU-06-T30 | a cashier opening /admin/menu/availability is sent to /forbidden; /pos/availability still works (Q35 fixed) | E2E | A | **Pass** (new 2026-11-24) |
| P1-MENU-06-T21 | the cashier marks an item sold out on the POS sold-out screen (/pos/availability) and available again | E2E | A | **Pass** |
| P1-MENU-06-T22 | the sold-out screen lists items grouped by category and hides inactive items | E2E | A | **Pass** |
| P1-MENU-06-T23 | the manager can use the sold-out screen in admin; the receptionist has no sold-out link in the POS | E2E | A | **Pass** |
| P1-MENU-06-T24 | the receptionist (no MENU_AVAILABILITY) does not see the sold-out link and is refused /pos/availability | E2E | A | **Pass** |

#### P1-MENU-07: Three kitchen stations, names editable (e.g. Kitchen 1 Rice & Curry, Kitchen 2 Grill, Kitchen 3 Juice & Dessert).

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-MENU-07-T01 | exactly three stations (numbers 1-3) are seeded with a name, a target time and an item count | API | A | **Pass** |
| P1-MENU-07-T02 | the owner renames a station and sets its target time; persisted and audited with before and after | API | A | **Pass** |
| P1-MENU-07-T03 | a station name must be unique among stations (case-insensitive): 409 STATION_NAME_TAKEN | API | A | **Pass** |
| P1-MENU-07-T04 | a stale version gets 409 VERSION_CONFLICT | API | A | **Pass** |
| P1-MENU-07-T05 | stations cannot be created or deleted through the API (seeded only) | API | A | **Pass** |
| P1-MENU-07-T06 | a station with active items cannot be deactivated: 409 STATION_IN_USE | API | A | **Pass** |
| P1-MENU-07-T07 | only an owner (MENU_MANAGE) can list or edit stations; the options lookup needs TERMINAL_MANAGE | API | A | **Pass** |
| P1-MENU-07-T08 | the station options lookup lists active stations by number | API | A | **Pass** |
| P1-MENU-07-T09 | the active item count per station follows item creation and deactivation | API | A | **Pass** |

#### P1-FLOOR-01: Tables with number, area/section, seats; a floor plan the owner can arrange.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-FLOOR-01-T01 | owner creates a table with number, section and seats; it is active and placed on the grid | API | A | **Pass** |
| P1-FLOOR-01-T02 | without x / y a new table goes to the next free spot: two new tables never share a position | API | A | **Pass** |
| P1-FLOOR-01-T03 | a table can be created at a given position; x / y are the centre within 0-1000 / 0-700 (edges accepted) | API | A | **Pass** |
| P1-FLOOR-01-T04 ×4 | x below 0 is rejected with 422 | API | A | **Pass** (4) |
| P1-FLOOR-01-T05 | the table number is unique (case-insensitive): 409 TABLE_NUMBER_TAKEN | API | A | **Pass** |
| P1-FLOOR-01-T06 ×5 | table number "" is rejected with 422 | API | A | **Pass** (5) |
| P1-FLOOR-01-T07 ×5 | seats 0 is rejected | API | A | **Pass** (5) |
| P1-FLOOR-01-T08 | the edge values seats 1 and 50 and a 30-character section are accepted | API | A | **Pass** |
| P1-FLOOR-01-T09 | owner or manager edits number, section, seats and active; audited with before and after; stale version 409 | API | A | **Pass** |
| P1-FLOOR-01-T10 | changing a number to an existing one is 409 TABLE_NUMBER_TAKEN | API | A | **Pass** |
| P1-FLOOR-01-T11 | tables are never deleted (no DELETE); the list filters by active and section; unknown id is 404 | API | A | **Pass** |
| P1-FLOOR-01-T12 | the POS floor layout lists active tables only on a 1000 x 700 grid; cashier and reception may read it, kitchen / rider / HR may not | API | A | **Pass** |
| P1-FLOOR-01-T13 | table admin needs FLOOR_MANAGE: the cashier and receptionist get 403 on list, create and update | API | A | **Pass** |
| P1-FLOOR-01-T20 | saving positions moves the tables, returns the updated tables with new versions, and audits one UPDATE per moved table | API | A | **Pass** |
| P1-FLOOR-01-T21 | saving positions is all-or-nothing: an unknown table id or an out-of-grid position changes nothing (422) | API | A | **Pass** |
| P1-FLOOR-01-T22 | a stale table version anywhere in the request gives 409 VERSION_CONFLICT and moves nothing | API | A | **Pass** |
| P1-FLOOR-01-T23 | an empty list, more than 200 positions, or a missing version is rejected | API | A | **Pass** |
| P1-FLOOR-01-T24 | moving a table updates the POS floor layout at once | API | A | **Pass** |
| P1-FLOOR-01-T30 | owner drags a table on the floor canvas and saves: the new centre is stored (scaled to the 1000 x 700 grid) | E2E | A | **Pass** |
| P1-FLOOR-01-T31 | dragging then "Discard" puts the table back and saves nothing | E2E | A | **Pass** |
| P1-FLOOR-01-T32 | a table cannot be dragged outside the canvas: the saved centre stays inside 0-1000 / 0-700 | E2E | A | **Pass** |
| P1-FLOOR-01-T33 | a position saved from a stale screen shows the reload banner (409 VERSION_CONFLICT), nothing is overwritten | E2E | A | **Pass** |
| P1-FLOOR-01-T34 | the tables list: create, edit and deactivate a table from the tables screen | E2E | A | **Pass** |
| P1-FLOOR-01-T35 | the table dialog shows field errors for a duplicate number and for seats outside 1-50 | E2E | A | **Pass** |
| P1-FLOOR-01-T36 | the cashier does not see the floor editor (403 page); the manager does | API | A | **Pass** |
| P1-FLOOR-01-T37 | the POS home shows the floor tables with their live status colours (M1.2) | API | A | Deferred (later milestone) |

#### P1-FLOOR-02: Two ordering points: Cashier counter and Reception.

Acceptance: Ordering point stored on every order and shown on KOTs.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-FLOOR-02-T01 | two ordering points are seeded: Cashier and Reception | API | A | **Pass** |
| P1-FLOOR-02-T02 | a POS terminal registered with an ordering point carries it in its session (orders will store it, M1.2) | API | A | **Pass** |
| P1-FLOOR-02-T03 | an unknown ordering point, or one on a KITCHEN / ADMIN terminal, is rejected with 422 | API | A | **Pass** |

#### P1-IMP-01: Import menu items, categories, tables from a spreadsheet (CSV / XLSX template).

Acceptance: Import validates all rows first; any invalid row → nothing imported, error report lists row and reason.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-IMP-01-T01 | a categories file creates the categories and reports created / updated / unchanged | API | A | **Pass** |
| P1-IMP-01-T02 | importing the same file again changes nothing; changing a value updates it; no duplicates are created | API | A | **Pass** |
| P1-IMP-01-T03 | a dry run returns the counts but saves nothing and writes no DATA_IMPORTED audit row | API | A | **Pass** |
| P1-IMP-01-T04 | a real import writes DATA_IMPORTED to the audit log with the counts and the file name | API | A | **Pass** |
| P1-IMP-01-T05 | an invalid row stops the whole import: nothing is saved, every error has row, column and reason | API | A | **Pass** |
| P1-IMP-01-T06 | wrong or missing column headers are reported per column; extra columns are rejected | E2E | A | **Pass** |
| P1-IMP-01-T07 | header matching ignores case and spaces; BOM, CRLF and quoted commas are handled | E2E | A | **Pass** |
| P1-IMP-01-T08 | an empty file is 422 IMPORT_FILE_INVALID; a header-only file imports nothing (ok, 0 rows) | E2E | A | **Pass** |
| P1-IMP-01-T09 | a file with garbage (not CSV, not XLSX) imports nothing | API | A | **Pass** |
| P1-IMP-01-T10 | the import type must be one of CATEGORIES, MENU_ITEMS, MODIFIER_GROUPS, TABLES (else 400) | API | A | **Pass** |
| P1-IMP-01-T11 | a request without a file is rejected (400 / 422), not a server error | API | A | **Pass** |
| P1-IMP-01-T12 | a file with 5001 rows is refused at once with 422 IMPORT_FILE_INVALID | API | A | **Pass** |
| P1-IMP-01-T12c | a dry run of 5000 rows writes nothing; the real import of 5000 rows completes within 60 s; re-import changes nothing | API | A | **Pass** (new 2026-11-24) |
| P1-IMP-01-T12b | a file with exactly 5000 rows (the documented limit) is accepted and validated within 60 seconds (dry run) | API | A | **Pass** (BUG-1-008 verified 2026-11-24) |
| P1-IMP-01-T13 | a file over 5 MB is refused with 422 IMPORT_FILE_INVALID | API | A | **Pass** |
| P1-IMP-01-T14 | a file just under 5 MB is read (dry run) | API | A | **Pass** |
| P1-IMP-01-T20 | a menu-items file creates items with category, station number, prices, groups (in the listed order) and the active flag | API | A | **Pass** |
| P1-IMP-01-T21 | re-importing an existing code updates that item (never a duplicate); a price change writes PRICE_CHANGED | API | A | **Pass** |
| P1-IMP-01-T22 | a blank optional cell on re-import clears the value (foreign price, modifier groups); a blank active means Y | API | A | **Pass** |
| P1-IMP-01-T23 | every kind of bad cell is reported with its row and column; nothing is imported (all-or-nothing) | API | A | **Pass** |
| P1-IMP-01-T24 | the error message has the documented shape, e.g. "menu_items row 14, local_price: 'abc' is not a number" fields | API | A | **Pass** |
| P1-IMP-01-T25 | price cells accept "10", "10.5" and surrounding spaces and are stored with 2 decimals | API | A | **Pass** |
| P1-IMP-01-T26 | import order matters: items that name a category or group that does not exist yet are refused | API | A | **Pass** |
| P1-IMP-01-T27 | a dry run of a menu-items file reports created / updated counts without saving | API | A | **Pass** |
| P1-IMP-01-T28 | a lower-case code and a lower-case y/n are normalised, not rejected | API | A | **Pass** |
| P1-IMP-01-T30 | rows with the same group name build one group with its options in file order | API | A | **Pass** |
| P1-IMP-01-T31 | re-importing a group updates it by name: options matched by name keep their identity, no duplicate group | API | A | **Pass** |
| P1-IMP-01-T32 ×6 | modifier group file with max below min is refused with a max_select error | API | A | **Pass** (6) |
| P1-IMP-01-T33 | a tables file creates tables; re-import updates section and seats by number without duplicates | API | A | **Pass** |
| P1-IMP-01-T34 | table file errors: seats outside 1-50, not a number, missing number, number with spaces or longer than 10 | API | A | **Pass** |
| P1-IMP-01-T40 | an .xlsx file imports like a CSV (tables: create, then update by number) | API | A | **Pass** |
| P1-IMP-01-T41 | an .xlsx menu-items file with numeric price cells (125.5) imports as 125.50 | API | A | **Pass** |
| P1-IMP-01-T42 | errors in an .xlsx file carry the spreadsheet row number (header = row 1) and the column header | E2E | A | **Pass** |
| P1-IMP-01-T43 | a corrupt .xlsx (zip with no sheet) is refused with 422 or an empty report, never a server error | API | A | **Pass** |
| P1-IMP-01-T50 ×4 | the CATEGORIES CSV template has the documented header row and one example row | E2E | A | **Pass** (4) |
| P1-IMP-01-T51 ×4 | the CATEGORIES XLSX template is a workbook with the same header | E2E | A | **Pass** (4) |
| P1-IMP-01-T52 | an unknown template type is 400; the CSV template of a type imports back without errors after its example row is made valid | API | A | **Pass** |
| P1-IMP-01-T60 | the import screen: choose a type, pick a file, check (dry run) shows counts, import saves, errors show row and column | E2E | A | **Pass** |
| P1-IMP-01-T61 | the import screen offers the CSV and XLSX template of the chosen type as downloads | E2E | A | **Pass** |
| P1-IMP-01-T62 | the import screen shows the order hint (categories and groups before items) and refuses non-CSV / non-XLSX files | E2E | A | **Pass** |
| P1-IMP-01-T63 | only the owner (DATA_IMPORT) sees the import screen; the manager is sent to the no-access page | E2E | A | **Pass** |
| P1-IMP-01-T64 | an .xlsx file chosen on the import screen is checked and imported (tables) | E2E | A | **Pass** |

#### P1-SET-05: Kitchen target preparation time per station (minutes).

Acceptance: Used by P1-KDS-05.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-SET-05-T01 | owner sets target minutes per station; persisted and audited | API | A | **Pass** |
| P1-SET-05-T02 ×5 | target time 0 minutes is rejected | API | A | **Pass** (5) |
| P1-SET-05-T02b ×2 | the boundary target time 1 minutes is accepted | API | A | **Pass** (2) |
| P1-SET-05-T03 | /admin/kitchens edits the name and target time of a station and saves | API | A | **Pass** |
| P1-SET-05-T03b | the kitchens screen refuses an invalid target time with a field error | E2E | A | **Pass** |

#### P1-SET-07: Delivery areas with a delivery fee per area.

Acceptance: Fee added as a bill line on delivery orders.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-SET-07-T01 | owner creates a delivery area with a fee; active by default; audited | API | A | **Pass** |
| P1-SET-07-T02 | the list includes inactive areas and is ordered by name | API | A | **Pass** |
| P1-SET-07-T03 | the name is unique (case-insensitive): 409 DELIVERY_AREA_NAME_TAKEN; empty or over 100 characters is 422 | API | A | **Pass** |
| P1-SET-07-T04 ×7 | fee "abc" is rejected with 422 (2-decimal string, not negative) | API | A | **Pass** (7) |
| P1-SET-07-T05 | a zero fee is allowed; a fee sent as a JSON number is rejected | API | A | **Pass** |
| P1-SET-07-T06 | update renames, changes the fee and deactivates; audited with before and after; stale version 409; never deleted | API | A | **Pass** |
| P1-SET-07-T07 | changing the name to an existing one is 409 DELIVERY_AREA_NAME_TAKEN | API | A | **Pass** |
| P1-SET-07-T08 | the order-screen lookup lists active areas with their fee for ORDER_CREATE roles; inactive areas are hidden | E2E | A | **Pass** |
| P1-SET-07-T09 | managing areas needs SETTINGS_MANAGE (owner only): manager and cashier get 403 | API | A | **Pass** |
| P1-SET-07-T10 | the delivery fee is added as a bill line on delivery orders | API | A | Deferred (later milestone) |
| P1-SET-07-T20 | owner adds, edits and deactivates an area on the delivery areas screen | E2E | A | **Pass** |
| P1-SET-07-T21 | the area dialog shows a field error for a duplicate name and an invalid fee | E2E | A | **Pass** |

#### P1-SET-08: Cancellation reasons list (editable) plus free-text comment.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-SET-08-T01 | every reason list (CANCEL, VOID, REFUND, PETTY_CASH, DISCOUNT_OTHER) is seeded with defaults | API | A | **Pass** |
| P1-SET-08-T02 | the list can be filtered by category and is ordered by category then text | API | A | **Pass** |
| P1-SET-08-T03 | owner adds a reason to a list; active by default; audited | API | A | **Pass** |
| P1-SET-08-T04 | the text is unique inside its list (case-insensitive): 409 REASON_TEXT_TAKEN; the same text is allowed in another list | API | A | **Pass** |
| P1-SET-08-T05 | text is required (1-200 characters) and the category must be valid | API | A | **Pass** |
| P1-SET-08-T06 | update changes the text or deactivates; the list cannot be changed; audited; stale version 409; never deleted | API | A | **Pass** |
| P1-SET-08-T07 | changing a text to an existing one in the same list is 409 REASON_TEXT_TAKEN | API | A | **Pass** |
| P1-SET-08-T08 | the dialog lookup returns the active reasons of one category by text, for ORDER_VIEW roles; inactive ones are hidden | E2E | A | **Pass** |
| P1-SET-08-T09 | managing reasons needs SETTINGS_MANAGE (owner only): manager and cashier get 403 | API | A | **Pass** |
| P1-SET-08-T10 | cancellation, void, refund and discount dialogs offer these reasons plus a free-text comment | E2E | A | Deferred (later milestone) |
| P1-SET-08-T20 | owner adds, edits and deactivates a reason on the reasons screen; tabs switch the list | E2E | A | **Pass** |
| P1-SET-08-T21 | a duplicate reason text in the same list shows an error in the dialog | E2E | A | **Pass** |

#### P1-AUTH-04: Each device is registered as a terminal (Cashier POS, Reception POS, Kitchen 1–3, Admin).

Acceptance: Every order, payment and audit record stores the terminal id. Unregistered browser can only reach login / terminal setup.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-AUTH-04-T08 | a KITCHEN terminal needs a real active station: missing, unknown or on another type gets 422 | API | A | **Pass** |
| P1-AUTH-04-T12 | the kitchen screen of a KITCHEN terminal shows which kitchen it is (terminal name in the header) and lands on /kitchen | E2E | A | **Pass** |
| P1-AUTH-04-T20 | terminal setup options (no token) return active stations and ordering points for the owner | API | A | **Pass** |
| P1-AUTH-04-T21 | terminal setup options: valid credentials without TERMINAL_MANAGE get 403; no body is 422 | API | A | **Pass** |
| P1-AUTH-04-T22 | the owner registers a KITCHEN screen on the setup page by choosing its station; the kitchen user then logs in to /kitchen | E2E | A | **Pass** |
| P1-AUTH-04-T23 | the setup page refuses a KITCHEN screen without a station | E2E | A | **Pass** |
| P1-AUTH-04-T24 | the setup page offers ordering points for a POS device and registers it with the chosen point | E2E | A | **Pass** |
| P1-AUTH-04-T26 | wrong credentials on the token-less setup-options call count towards the same per-IP limit (5 in 15 min, then 429) but never lock the owner | API | A | **Pass** |

#### P1-AUTH-03: Terminals log out automatically when idle.

Acceptance: Idle timeout configurable per terminal type (POS default 10 min, admin 30 min). KDS screens are exempt (they stay logged in as the station).

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-AUTH-03-T05 | a kitchen screen stays logged in after 12 idle hours | E2E | A | **Pass** |
| P1-AUTH-03-T11 | a session on a KITCHEN terminal has no idle timeout (the screen stays logged in) | E2E | A | **Pass** |

#### P1-RBAC-04: Kitchen users see only their own station.

Acceptance: A Kitchen 1 user cannot load Kitchen 2 tickets via UI or API.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-RBAC-04-T01 | a KITCHEN terminal is bound to exactly one station; it can be moved to another station but never left without one | API | A | **Pass** |

#### M1.1 role checks (kitchen / rider / inventory / HR / receptionist / cashier / manager)

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| M1.1-ROLE-T01 ×6 | [kitchen] sees none of the menu administration screens (every route goes to the no-access page) | E2E | A | **Pass** (6) |
| M1.1-ROLE-T02 | the manager sees the sold-out screen and the floor plan but not items, categories, modifiers, kitchens, import, areas, reasons | E2E | A | **Pass** |
| M1.1-ROLE-T03 | the owner sees every M1.1 entry in the admin navigation | E2E | A | **Pass** |

Totals in this section: 244 pass, 3 known-bug, 5 fixme.

## ADR-008 Personal login without a terminal (client decision #9, contract 0.3.0)

Written 2026-11-24 from the contract; **run 2026-11-24 (Tier 2)** against backend v0.3.0 (V8/V9) and the frontend, own stack :8082 / :3001. Amends P1-AUTH-03 / P1-AUTH-04 (see `docs/requirements/phase-1-requirements.md`), `LOGIN_ANY_DEVICE` in `docs/security/roles-permissions.md`.

| Test id | Test | Level | Auto | Status |
|---|---|---|---|---|
| P1-AUTH-04-T40 ×8 | every seeded role logs in on its registered terminal: sessionType TERMINAL with the terminal | API | A | **Pass** |
| P1-AUTH-04-T41 ×8 | login without a terminal: owner, manager, rider, inventory, HR get a PERSONAL session (no terminal); cashier, reception, kitchen get 403 TERMINAL_REQUIRED_FOR_USER | API | A | **Pass** |
| P1-AUTH-04-T42 | a custom role with LOGIN_ANY_DEVICE may log in without a terminal; without it may not | API | A | **Pass** |
| P1-AUTH-04-T43 / T44 | only one of X-Terminal-Id and deviceToken is 422 (field deviceToken) | API | A | **Pass** |
| P1-AUTH-04-T02 (changed) | deviceToken without the header: 422 (was 403 TERMINAL_NOT_REGISTERED before 0.3.0) | API | A | **Pass** |
| P1-AUTH-04-T45 | unknown user / wrong password without a terminal: 401 INVALID_CREDENTIALS (not 403) | API | A | **Pass** |
| P1-AUTH-01-T40 | 7 refused personal logins with the right password (403 TERMINAL_REQUIRED_FOR_USER) do not lock; terminal login then works | API | A | **Pass** |
| P1-AUTH-01-T41 | 5 wrong passwords without a terminal lock the account (423), also for a terminal login | API | A | **Pass** |
| P1-AUTH-01-T42 | wrong passwords on a terminal and without one add up to the lock | API | A | **Pass** |
| P1-AUTH-01-T43 | a refused personal login with the right password resets the failed-attempt counter (Q39) | API | A | **Pass** |
| P1-AUTH-04-T46 | /auth/me: sessionType PERSONAL and no terminal; TERMINAL with the terminal | API | A | **Pass** |
| P1-AUTH-04-T47 | personal session + any X-Terminal-Id header: 403 TERMINAL_MISMATCH | API | A | **Pass** |
| P1-AUTH-04-T48 | terminal session: header absent or another terminal: 403 TERMINAL_MISMATCH | API | A | **Pass** |
| P1-AUTH-04-T49 | personal-session token works on admin, menu and settings reads | API | A | **Pass** |
| P1-AUTH-04-T50 | personal refresh without header stays PERSONAL, rotates the token | API | A | **Pass** |
| P1-AUTH-04-T51 | personal refresh with a header: 401 REFRESH_TOKEN_INVALID; the token is not revoked, a refresh without the header then works (Q41) | API | A | **Pass** |
| P1-AUTH-04-T52 | terminal refresh without header / with another terminal: 401 REFRESH_TOKEN_INVALID; the token is not revoked (Q41) | API | A | **Pass** |
| P1-AUTH-04-T53 | LOGIN_ANY_DEVICE removed from the role: personal refresh 403 TERMINAL_REQUIRED_FOR_USER, refresh token revoked (401 after), access token still valid until expiry (Q40); terminal session still refreshes; personal login refused | API | A | **Pass** |
| P1-AUTH-04-T54 | personal LOGIN audit row: no terminal, clientInfo with the User-Agent (≤300 chars); terminal LOGIN row has terminal and clientInfo | API | A | **Pass** |
| P1-AUTH-04-T55 | refused personal login: LOGIN_FAILED with reason TERMINAL_REQUIRED_FOR_USER, no terminal, clientInfo, no password | API | A | **Pass** |
| P1-AUTH-04-T56 | an admin change in a personal session is audited with the user, no terminal, clientInfo | API | A | **Pass** |
| P1-AUTH-03-T20 | default idleTimeoutPersonalMinutes 30; a personal session reports idleTimeoutMinutes 30 | API | A | **Pass** |
| P1-AUTH-03-T21 ×4 | idleTimeoutPersonalMinutes 0, 241, -1, 7.5: 422 | API | A | **Pass** (4) |
| P1-AUTH-03-T22 | 1 and 240 accepted; new personal session gets the new value, terminal session keeps its type rule; omitting the field keeps it | API | A | **Pass** |
| P1-AUTH-03-T23 | the change is a SETTINGS_CHANGED audit row with terminal and clientInfo | API | A | **Pass** |
| P1-AUTH-04 [personal:role] ×385 | generated: every bearer operation × each LOGIN_ANY_DEVICE role in a personal session; same expectation as the terminal matrix; `x-terminal: REQUIRED` operations expect 403 TERMINAL_REQUIRED (none before M1.2; generated automatically from M1.2) | API | A | **Pass** |
| P1-AUTH-04-T01 ×4 / T01b (changed) | unregistered browser opening a protected route or /login: the login page with "Personal device" and the setup link (was: sent to setup) | E2E | A | **Pass** |
| P1-AUTH-04-T60 | unregistered device opens at /login; "Set up this device" link goes to /setup/terminal | E2E | A | **Pass** |
| P1-AUTH-04-T61 / T62 | owner / manager log in on an unregistered device without setup and land on /admin | E2E | A | **Pass** |
| P1-AUTH-04-T63 | rider lands on /rider | E2E | A | **Pass** |
| P1-AUTH-04-T64 ×2 | inventory, HR land on /home | E2E | A | **Pass** |
| P1-AUTH-04-T65 ×3 | cashier, reception, kitchen see "only ... on a registered counter or kitchen device" and stay on /login | E2E | A | **Pass** |
| P1-AUTH-04-T66 | registered device shows its terminal name; cashier logs in to /pos | E2E | A | **Pass** |
| P1-AUTH-04-T67 ×3 | personal session on /pos, /pos/availability, /kitchen: "Use a registered counter device" | E2E | A | **Pass** |
| P1-AUTH-04-T67b / T67c | personal session on /pos: manager sees "Use a registered counter device"; rider (no POS permission) gets /forbidden (Q42: permission first, then session type) | E2E | A | **Pass** |
| P1-AUTH-04-T68 / T69 | personal session: admin screens work for the owner; a rider still gets /forbidden on /admin/users | E2E | A | **Pass** |
| SMOKE-AUTH-PERSONAL, SMOKE-SESSION | Tier 1: personal login / me / refresh, cashier refused; x-terminal REQUIRED sample (none yet) | API | A | **Pass** |

Results: auth-personal API 35/35, auth-personal UI 17/17, personal-session matrix 385/385, terminal-session role matrix 711 pass (2 public skipped), settings 50 pass + 3 deferred, Tier 1 smoke 162/162. Changed M1.0 tests (P1-AUTH-04-T01 ×4, T01b, T02, T03) pass. P1-AUTH-01-T04 fails on BUG-1-009 (Low, `test.fail`). P1-MENU-02-T22 (items screen filters) failed in the loaded UI run and passed alone: logged flaky, not chased.

QA tooling: `role-grants.ts` gained the `LOGIN_ANY_DEVICE` row (38 Phase 1 codes); the generator reads `x-terminal` (REQUIRED / OPTIONAL; anything else is a contract error) and builds `sessionCases`; 6 new generator unit tests (51 total, pass).

## M1.2 Orders
_Placeholder: P1-ORD-01..10, P1-DIN-*, P1-TKW-*, P1-DEL-*, P1-CRD-*, plus the P1-AUTH-05 approval and PIN-lock rows (first x-approval operation)._

## M1.3 Kitchen & printing
_Placeholder: P1-KOT-01..03, P1-KDS-01..08, P1-RBAC-04-T02..T05, print agent, P1-NFR-01._

## M1.4 Billing, discounts, cancellations
_Placeholder: P1-BILL-01..07, P1-DISC-01..08, P1-CAN-01..06, P1-SET-02-T04._

## M1.5 Shifts, day-end, POS reports
_Placeholder: P1-SHIFT-01..07, P1-RPT-01..14, seeded-day reconciliation, P1-SET-04-T04/T05._

## M1.6 UAT & go-live
_Placeholder: full Phase 1 regression, on-site hardware checklist, backup restore drill (P1-NFR-04), availability monitoring (P1-NFR-05), Android tablet smoke (P1-NFR-02-T05)._
