# ADR-006: Authentication, terminals and contract shape (M1.0)

**Status:** Accepted · 2026-11-21 · Contract `docs/api/openapi.yaml` v0.1.0

> **Amended by [ADR-008](ADR-008-personal-login-without-terminal.md)** (2026-11-24, client decision #9): decisions 1, 2 and 4 now apply to terminal sessions only. Users holding `LOGIN_ANY_DEVICE` may also start a personal session without a terminal; operations marked `x-terminal: REQUIRED` need a terminal session.

## Context
P1-AUTH-01..05 ask for personal logins, short-lived tokens, idle logout, registered devices and approval PINs. P1-AUTH-04 says an unregistered browser can only reach login and terminal setup. Annex A doesn't say how a device proves it is registered, how long a kitchen screen stays logged in, or how the API marks optional fields. These are the choices made when writing the M1.0 contract, approved by the lead.

## Decision
1. **Login needs a registered terminal.** `POST /auth/login` takes the `X-Terminal-Id` header and the terminal's `deviceToken` in the body. An unknown terminal, a wrong token or a missing header returns 403 `TERMINAL_NOT_REGISTERED`, and a deactivated terminal returns 403 `TERMINAL_INACTIVE`. The server stores only a SHA-256 hash of the device token.
2. **`X-Terminal-Id` is checked by a filter.** The spec declares the header only on login and refresh. On every other authenticated call, a request filter checks that the header matches the terminal claim in the access token (`tid`), and returns 403 `TERMINAL_MISMATCH` if it doesn't. This keeps the generated `*Api` methods free of a parameter they would all ignore.
3. **Terminal registration uses credentials in the body.** `POST /terminals` has `security: []` and `x-auth: INLINE_CREDENTIALS`. The body carries the username and password of a user who holds `TERMINAL_MANAGE`.
   - Wrong credentials return 401 but do **not** count towards the account lock, because anyone can reach this endpoint from an unregistered device and could otherwise lock the owner out. Instead, 5 failures from one client IP within 15 minutes return 429 `TOO_MANY_ATTEMPTS` (contract v0.1.1, lead decision on QA Q4).
   - An account that is already locked still gets 423.
   - Valid credentials without the permission return 403.
   - If the owner is locked out or forgets the password, someone with server access can reset it by setting `RMS_RECOVERY_OWNER_USERNAME` and `RMS_RECOVERY_OWNER_PASSWORD` at startup (backend/README.md).
   - A fresh install can therefore register its first device using the bootstrap owner.
   - There is no reactivation: a device that loses its token is deactivated and registered again.
4. **Tokens:**
   - The access token is a JWT that lasts 15 minutes and carries the user id, terminal id and permissions.
   - The refresh token is opaque, single-use and bound to one terminal.
   - Each refresh returns a new refresh token valid for 12 h from that moment (a sliding window), and re-reads the user's permissions, so role changes apply at the next refresh (P1-RBAC-02).
   - Presenting a revoked refresh token again revokes every refresh token of that user on that terminal.
   - Kitchen screens stay logged in because their idle logout is off. On POS and admin terminals, idle logout ends the session.
   - Login and refresh both return `AuthSession`, which includes `idleTimeoutMinutes` (absent for KITCHEN and DISPLAY).
5. **Logout** revokes the refresh token and records a `reason` (`USER` or `IDLE_TIMEOUT`) in the audit log.
6. **Changing your own password or PIN requires the current password.** A wrong current password returns 422 and counts as a failed login attempt: 5 in a row lock the account for 15 minutes (423).
7. **Roles:**
   - The 8 seeded roles cannot be renamed or deleted (409 `SYSTEM_ROLE_READ_ONLY`).
   - The Owner role always holds every permission and cannot be edited (409 `OWNER_ROLE_READ_ONLY`), so the system can't lock out its own administrator.
   - A role still assigned to any user can't be deleted (409 `ROLE_IN_USE`).
   - Nobody can remove the last active Owner, and nobody can deactivate their own account (409 `LAST_OWNER`, 409 `CANNOT_DEACTIVATE_SELF`).
8. **No `nullable` in the spec.**
   - An optional property is simply left out of the JSON when it has no value; Jackson uses `NON_NULL` inclusion.
   - Updates are full replacements (`PUT`), so leaving an optional field out of a request clears it.
   - This avoids the weak support for OpenAPI 3.1 nullable `$ref` in openapi-generator.
9. **`Problem.code` is a pattern-checked string, not an enum.** The known codes are listed in its description. Adding a code is therefore not a breaking change, and clients that don't recognise a code show `detail`.

10. **Login counters are atomic SQL, not entity writes** (QA BUG-1-001 / BUG-1-002). Wrong-password and wrong-PIN counters, the lock, and the last-login stamps are changed with single `UPDATE ... RETURNING` statements that don't touch the row's `version`. Reading a counter, adding one and saving it loses increments when guesses arrive in parallel (the lockout could be bypassed), and with optimistic locking it made valid logins fail with 409. A login is not an edit, so it must not bump the version an admin form is holding. Attempts while a lock is active neither count nor extend it.
11. **Sessions.** A session is one login and the chain of refresh tokens rotated from it; its id is the `sid` claim of the access token and a column on every refresh token (QA BUG-1-003). "Change own password" revokes every other session of the user, on any terminal and on the same terminal, and keeps the caller's. Replaying a refresh token that was already used (rotated away) is treated as theft and ends only that session. A token revoked by logout or a password change is just invalid and ends nothing else. Access tokens are not revoked and stay valid until they expire (at most 15 minutes).
12. **Strict request parsing** (QA BUG-1-005). Money and rates must arrive as a JSON string with exactly 2 decimals; integers must be integers; numbers and booleans must not arrive as text. Anything else is a 422 field error instead of being normalised (for example 7.5 minutes cut to 7). The contract schemas are what the server enforces.

## Consequences
- QA's permission-matrix generator treats `registerTerminal` specially: the role under test goes in the body credentials, not in a bearer token.
- Every request from the SPA must carry `X-Terminal-Id`, which the frontend client middleware does.
- Kitchen screens re-authenticate only if they are offline for longer than 12 h.
