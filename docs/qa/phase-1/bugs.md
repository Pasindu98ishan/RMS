# Phase 1 bugs

Owner: qa-engineer. One entry per bug, newest at the bottom. Ids are never reused.

**Severity** (test-strategy §6): **Critical** = stops billing or kitchen orders, loses or miscomputes money, or is a security hole · **High** = a required (M) rule does not hold, or a report total is wrong · **Medium** = rule holds but is awkward or partial (e.g. wrong message) · **Low** = cosmetic, copy, missing test hook (`data-testid`).
Critical and High block the milestone exit gate.

**Status flow:** Open → Fixed (pending verify) → Verified, or Won't fix (reason, agreed with the lead). A bug found by client staff during UAT gets `Source: UAT`.

Failing tests that show a bug stay in the suite with `test.fail(true, 'BUG-1-nnn …')`: when the bug is fixed the test starts passing, Playwright reports it as "expected to fail but passed", and QA removes the annotation to verify the fix (done for BUG-1-001 to 006 on 2026-11-22).

## Format

```
### BUG-1-<nnn>: <short title>
Severity: Critical | High | Medium | Low      Owner: backend-dev | frontend-dev
Milestone: M1.x      Source: QA | UAT
Requirement: P1-XXX-nn / Annex A §x.y "<rule, paraphrased>"
Steps: 1. … 2. …
Expected: …
Actual: …
Evidence: failing test e2e/specs/<file>.spec.ts:<line> (test id P1-XXX-nn-Tnn), screenshot / trace / log path
Status: Open | Fixed (pending verify) | Verified | Won't fix (reason)
```

## Summary

| Id | Title | Severity | Owner | Milestone | Status |
|---|---|---|---|---|---|
| BUG-1-001 | Concurrent logins get 409 VERSION_CONFLICT (same user, or same terminal) | High | backend-dev | M1.0 | Verified |
| BUG-1-002 | Failed-login counter loses increments under concurrency: 30 parallel wrong passwords do not lock the account | High | backend-dev | M1.0 | Verified |
| BUG-1-003 | Changing own password does not revoke the user's other sessions | High | backend-dev | M1.0 | Verified |
| BUG-1-004 | Users list keeps showing "No PIN" after a PIN reset | Medium | frontend-dev | M1.0 | Verified |
| BUG-1-005 | Server accepts input the contract forbids: rate "5" / "1e2", idle timeout 7.5 (truncated to 7) | Low | backend-dev | M1.0 | Verified |
| BUG-1-006 | User menu button is 44 px high in the POS and kitchen headers (touch targets must be 48 px) | Low | frontend-dev | M1.0 | Verified |
| BUG-1-007 | Changing the order of an item's modifier groups fails with 409 | Medium | backend-dev | M1.1 | Verified |
| BUG-1-008 | Import validation is slow and grows faster than linearly (5000-row file ≈ 3 min) | Medium | backend-dev | M1.1 | Verified |
| BUG-1-009 | Login with the X-Terminal-Id header and an empty body: fieldErrors omit deviceToken | Low | backend-dev | ADR-008 | Open |

## Bugs

### BUG-1-001: Concurrent logins get 409 VERSION_CONFLICT (same user, or same terminal)
Severity: High      Owner: backend-dev
Milestone: M1.0      Source: QA
Requirement: P1-AUTH-01 "every user logs in with their own username and password" (valid credentials must log in); P1-AUTH-04 (terminals)
Steps:
1. Register a terminal; create a user (or use seeded users).
2. Send several `POST /api/v1/auth/login` with valid credentials at the same moment:
   (a) the same user, same terminal, 2 / 4 / 8 / 16 in parallel;
   (b) 8 different users on the same terminal;
   (c) the same user on 3 different terminals;
   (d) 3 different users on 3 different terminals (control).
Expected: every request with valid credentials returns 200 (or the server serialises them); no error for a correct password.
Actual:
- (a) 1 of N returns 200, the other N-1 return `409 VERSION_CONFLICT` ("This record was changed by someone else. Reload and try again."): 2 → 1 OK, 4 → 1 OK, 8 → 1 OK, 16 → 2 OK.
- (b) 1 of 8 succeeds, 7 get 409.
- (c) 1 of 3 succeeds, 2 get 409.
- (d) all 3 succeed.
So login updates a row of both the user and the terminal (last login) under optimistic locking and does not retry. Refresh and logout are not affected (8 parallel refreshes of one user: all 200).
Impact: a valid user gets a hard error with a message that makes no sense at login. Real cases: shift change on a shared POS, a shared kitchen account on two tablets, the owner logging in on a laptop and a phone together, a double submit. A retry works. It also made the parallel QA suite flaky until the fixtures retried on 409.
Evidence: failing test `e2e/specs/auth.spec.ts` "P1-AUTH-01-T18 concurrent logins of one valid user all succeed" (marked `test.fail`, BUG-1-001); reproduction in the PowerShell/Node snippets in the QA scratchpad (`conc.mjs`, `conc2.mjs`); matrix failures on the first run (`login as manager1 … VERSION_CONFLICT`).
Status: **Verified**. Verified 2026-11-22 (contract v0.2.0 backend). `P1-AUTH-01-T18` now runs 10 bursts of 8 parallel logins with no retry and the `test.fail` marker removed: all 200. The whole 1,095-test run logged in thousands of times in parallel with the login retry workaround also removed: no 409.

### BUG-1-002: Failed-login counter loses increments under concurrency: 30 parallel wrong passwords do not lock the account
Severity: High      Owner: backend-dev      (same root cause as BUG-1-001; arguably Critical as a security weakness: lead to decide)
Milestone: M1.0      Source: QA
Requirement: P1-AUTH-01 "5 failed attempts lock the account for 15 minutes"
Steps:
1. Create a user. 2. Send 30 `POST /auth/login` with a wrong password at once (same user, same terminal). 3. Log in with the correct password.
Expected: the account is locked after the 5th failure (423 ACCOUNT_LOCKED) and the correct password is refused until the lock ends.
Actual: the 30 requests return 4 × `401 INVALID_CREDENTIALS` and 26 × `409 VERSION_CONFLICT`. Only the 4 counted; the account is not locked and the correct password logs in (200). With 6 parallel attempts: 1 × 401, 5 × 409. Control: 6 sequential wrong attempts lock correctly (401, 401, 401, 401, 423, 423).
Impact: lockout can be sidestepped by sending guesses in parallel: each burst evaluates many passwords but counts only a few, so the attacker gets tens of guesses per lock instead of 5 (two bursts of 30 lock the account after ~60 guesses). Passwords are bcrypt-hashed, which limits the rate, but the P1-AUTH-01 rule does not hold.
Evidence: failing test `e2e/specs/auth.spec.ts` "P1-AUTH-01-T19 5 failed attempts lock the account even when the attempts arrive in parallel" (`test.fail`, BUG-1-002); QA script `conc3.mjs`.
Status: **Verified**. Verified 2026-11-22. `P1-AUTH-01-T19` (10 bursts of 60 parallel wrong passwords): no 409, the correct password then gets 423 ACCOUNT_LOCKED every time; marker removed.

### BUG-1-003: Changing own password does not revoke the user's other sessions
Severity: High      Owner: backend-dev
Milestone: M1.0      Source: QA
Requirement: P1-AUTH-02 "logout revokes the refresh token" / contract `changeOwnPassword`: "Other sessions of this user are revoked; the calling session stays logged in"
Steps:
1. Log in as user U twice (sessions S1 and S2). 2. With S2 call `POST /auth/me/password` (correct current password, valid new password) → 204. 3. `POST /auth/refresh` with S1's refresh token. 4. `GET /auth/me` with S1's access token.
Expected: step 3 returns 401 REFRESH_TOKEN_INVALID (S1 revoked); S2 keeps working.
Actual: S1's refresh token returns 200 (a new session), and S1's access token still works. By contrast, the admin `POST /users/{id}/reset-password` does revoke (401 REFRESH_TOKEN_INVALID).
Impact: a user who changes their password because it leaked, or because a device was lost, leaves the other session (e.g. on a stolen device) alive for up to 12 h, sliding.
Evidence: failing test `e2e/specs/auth.spec.ts` "P1-AUTH-01-T16 changing own password revokes the user's other sessions" (`test.fail`, BUG-1-003); QA script `pw.mjs` output "refresh with FIRST session token after password change -> 200".
Status: **Verified**. Verified 2026-11-22. `P1-AUTH-01-T16`: the other session's refresh token is rejected (401 REFRESH_TOKEN_INVALID), the calling session's refresh works; marker removed. Per the fix note the other session's current access token stays valid for up to 15 minutes (see Q5).

### BUG-1-004: Users list keeps showing "No PIN" after a PIN reset
Severity: Medium      Owner: frontend-dev
Milestone: M1.0      Source: QA
Requirement: P1-AUTH-05 / screens.md `/admin/users` "PIN reset"
Steps: 1. As owner open /admin/users and search a user with no PIN (chip "No PIN"). 2. Click "PIN", enter 6 digits, "Set PIN". 3. Look at the row.
Expected: the dialog closes and the row shows the user has a PIN (chip gone); same refresh for a PIN lock that the reset clears.
Actual: the dialog closes and a success toast shows, but the "No PIN" chip stays until the page is reloaded (the API has `pinSet: true`). `UsersView` reloads the list after unlock and edit but not after `ResetSecretDialog` `saved`.
Evidence: failing test `e2e/specs/roles.spec.ts` "P1-RBAC-02-T19b the users list drops the No PIN badge right after a PIN reset" (`test.fail`, BUG-1-004). The functional test P1-RBAC-02-T19 (state correct after reload) passes.
Status: **Verified**. Verified 2026-11-22. `P1-RBAC-02-T19b` passes: the "No PIN" chip disappears right after the PIN reset without a reload; marker removed.

### BUG-1-005: Server accepts input the contract forbids (rate "5" / "1e2", idle timeout 7.5)
Severity: Low      Owner: backend-dev
Milestone: M1.0      Source: QA
Requirement: P1-SET-01 (rates are strings with 2 decimals, contract `Rate` pattern `^(100\.00|\d{1,2}\.\d{2})$`); P1-AUTH-03 (idle timeout, integer minutes)
Steps: 1. `PUT /settings/service-charges` with `rate: "5"` or `"1e2"`. 2. `PUT /settings/idle-timeouts` with `idleTimeoutMinutes: 7.5` for CASHIER_POS.
Expected: 422 VALIDATION_FAILED (value does not match the contract).
Actual: 200. "5" is stored as "5.00", "1e2" as "100.00", and 7.5 minutes is silently truncated to 7. ("ten", "-1.00", "100.01", "10.555", "" and 0 / 241 / -1 are rejected correctly.)
Impact: low: values are normalised and the UI sends valid ones; but a client can set a value other than the one it sent (7.5 → 7) and the generated contract validation is not what the server enforces.
Evidence: failing tests `e2e/specs/settings.spec.ts` "P1-SET-01-T03 service charge rate "1e2" / "5" is rejected" and "P1-AUTH-03-T07 idle timeout of 7.5 minutes is rejected" (`test.fail`, BUG-1-005).
Status: **Verified**. Verified 2026-11-22. Rates "5" and "1e2" and an idle timeout of 7.5 are rejected (422); markers removed.

### BUG-1-006: User menu button is 44 px high in the POS and kitchen headers
Severity: Low      Owner: frontend-dev
Milestone: M1.0      Source: QA
Requirement: P1-NFR-02 / screens.md design rules "POS & KDS are touch-first: targets ≥ 48 px"
Steps: 1. Log in as a cashier (POS, 1366x768) or kitchen user (KDS, 1280x800). 2. Measure `[data-testid=user-menu]`.
Expected: width and height ≥ 48 px.
Actual: 147 x 44 px (POS header); the kitchen header button is also under 48 px. (The login button is 52 px; the POS logo link passes.)
Evidence: failing tests `e2e/specs/nfr.spec.ts` "P1-NFR-02-T01c" and "P1-NFR-02-T02b" (`test.fail`, BUG-1-006).
Status: **Verified**. Verified 2026-11-22. `P1-NFR-02-T01c` and `P1-NFR-02-T02b` pass (user menu is at least 48 px in the POS and kitchen headers); markers removed.

### BUG-1-007: Changing the order of an item's modifier groups fails with 409
Severity: Medium      Owner: backend-dev
Milestone: M1.1      Source: QA
Requirement: P1-MENU-03 "attach modifier groups to items" (display order of the groups, UI arrows "move up / move down"), P1-MENU-02
Steps:
1. Create modifier groups G1, G2 and an item attached to [G1, G2] (or [G2, G1]).
2. `PUT /api/v1/menu-items/{id}` (full replacement, correct version) with `modifierGroupIds` in the other order, e.g. [G2, G1].
3. Control cases on fresh items: same list (price edit), add a group at the end, remove one, replace by a different group, empty list.
Expected: all save (200); the new order is stored.
Actual: step 2 returns `409 {"title":"Conflicting data","detail":"This conflicts with an existing record. Reload and try again."}` (not VERSION_CONFLICT). The controls all return 200: only a change of order among groups that stay attached fails, which looks like re-inserting link rows before the old ones are removed (unique key on item + group).
Impact: the "move up / move down" arrows in the item dialog cannot be saved; the owner cannot control the order in which modifier groups appear on the POS. Everything else about editing items with modifiers works. (My first probe wrongly suggested every save with attached groups failed: that was a stale-order artefact of the probe; corrected 2026-11-22.)
Evidence: failing tests `e2e/specs/menu.spec.ts` "P1-MENU-02-T13c the display order of an item's modifier groups can be changed" and `e2e/specs/menu-ui.spec.ts` "P1-MENU-03-T20b the move up / move down arrows ... reorder the groups and save" (both `test.fail`, BUG-1-007). Passing controls: P1-MENU-02-T13, T13b, P1-MENU-03-T20.
Status: **Verified**. Verified 2026-11-24 (backend migration V7, deferrable unique constraint). `P1-MENU-02-T13c` (API) and `P1-MENU-03-T20b` (item dialog move up / down) pass with the `test.fail` markers removed.

### BUG-1-008: Import validation is slow and grows faster than linearly
Severity: Medium      Owner: backend-dev
Milestone: M1.1      Source: QA
Requirement: P1-IMP-01 "import from a spreadsheet" with the documented limits of 5 MB and 5000 rows
Steps: `POST /api/v1/import/CATEGORIES?dryRun=true` (owner) with 100, 500, 1000, 2000 and 5000 rows (`name,sort_order`); also 500 TABLES rows.
Expected: a file within the documented limits is processed in seconds, time roughly proportional to the rows (a restaurant menu is 100 to 500 rows).
Actual (quiet backend): 100 rows 0.8 s, 500 rows 7 s, 5000 rows about 190 s (dry run; a real import takes as long). Under load the same files took 3.3 s, 15.7 s, 1000 rows 28 s, 2000 rows 65 s, 500 tables 13 s. Time per row grows with the number of rows (about 8 ms per row at 100 rows, 14 ms at 500, 38 ms at 5000): suspected per-row lookups against the rows already read or one query per row. While a 5000-row request runs the backend is busy for minutes: other requests queue behind it (my parallel UI tests timed out, and `/test/reset` returned 500 after 9 s) and the work continues after the client gives up.
Impact: a 5000-row import cannot finish behind a 60 s reverse-proxy timeout (nginx default), so the documented limit is not usable; files under about 400 rows are fine (a few seconds), so the milestone is usable for the client's real menu.
Evidence: failing test `e2e/specs/serial.spec.ts` "P1-IMP-01-T12b a file with exactly 5000 rows is accepted and validated within 60 seconds" (`test.fail`, BUG-1-008): the file is accepted, the time assertion fails (190 s).
Status: **Verified**. Verified 2026-11-24. `P1-IMP-01-T12b` (5000-row dry run) passes in under 1 s (marker removed). New `P1-IMP-01-T12c`: two dry runs of 5000 rows both report 5000 created (the dry run writes nothing), the real import of 5000 rows takes about 4 s (limit used: 60 s), and a re-import reports 0 created, 0 updated, 5000 unchanged. The 5 MB and 5000-row limit cases pass.

### BUG-1-009: Login with the X-Terminal-Id header and an empty body: fieldErrors omit deviceToken
Severity: Low      Owner: backend-dev
Milestone: ADR-008 (contract 0.3.0)      Source: QA
Requirement: P1-AUTH-01 / P1-AUTH-04 (amended, ADR-008) "sending only one of the header and deviceToken returns 422 (field `deviceToken`)"; conventions.md 422 lists the field errors.
Steps:
1. `POST /api/v1/auth/login` with a valid `X-Terminal-Id` header and body `{}`.
Expected: 422 VALIDATION_FAILED with fieldErrors for `username`, `password` and `deviceToken` (all problems reported in one response, as before 0.3.0).
Actual: 422 with fieldErrors for `username` and `password` only. The header-without-deviceToken rule seems to run only after the bean validation passes: with a username and password the 422 does name `deviceToken` (P1-AUTH-04-T43 passes).
Impact: low; the user corrects the visible fields and then gets the deviceToken error on the next try. The login screen always sends the device token on a registered device, so staff do not see it.
Evidence: `e2e/specs/auth.spec.ts` "P1-AUTH-01-T04 missing username, password or deviceToken returns 422 VALIDATION_FAILED with field errors" (`test.fail`, BUG-1-009).
Status: Open

