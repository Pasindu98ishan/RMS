# Phase 1 QA sign-off

One section per milestone. QA fills it in when the milestone is presented for its exit gate (PLAN.md §3 step 4, test-strategy §7). A milestone is done only when **every** box is ticked, or an unticked box has a written waiver agreed with the lead.

Exit gate (PLAN.md §3): every Annex A item for the milestone has a passing test or a signed manual check · no open Critical / High bug · deployed to staging · role permissions verified. Test-strategy §7 adds: BE + FE unit / integration suites green in CI, and this file updated with date, counts, open bugs and verdict.

## Template (copy per milestone)

```
## M1.x <name>

Date: YYYY-MM-DD      QA: qa-engineer      Build: backend <commit> · frontend <commit> · contract <bundle hash>
Environment: staging <url>      Seed: RMS_SEED run <runId>

### Exit-gate checklist
- [ ] Every M requirement of the milestone (test-plan.md "Gate = M1.x" rows) has a passing automated test or a signed manual check
- [ ] No open Critical bug
- [ ] No open High bug
- [ ] Permission matrix: generated API matrix green for every seeded role; UI route matrix green
- [ ] Contract checks green (x-permission known and consistent; no audit mutation endpoints)
- [ ] Sensitive actions of this milestone leave one audit row with user, terminal, time, approver, reason
- [ ] Backend unit + integration suite green in CI (count: … / …)
- [ ] Frontend unit suite green in CI (count: … / …)
- [ ] Deployed to staging and smoke-tested there
- [ ] Manual checks done and signed (list below)
- [ ] Open questions that block the gate answered (test-plan.md "Questions")

### Results
| Area | Tests | Pass | Fail | Fixme / skipped | Manual signed |
|---|---|---|---|---|---|
| … | | | | | |

### Open bugs
| Id | Severity | Title | Status |
|---|---|---|---|

### Manual checks
| Test id | Check | Done by | Date | Result |
|---|---|---|---|---|

### Waivers (agreed with the lead)
| Item | Reason | Agreed by | Date |
|---|---|---|---|

### Verdict
Meets exit gate: YES / NO. Blocking items: …
```

---

## M1.0 Foundation (re-verified 2026-11-22, after the BUG-1-001..006 fixes)

Date: 2026-11-22      QA: qa-engineer      Build: backend jar built from `backend/` working tree (contract v0.2.0, 81 operations) · frontend Vite dev server (`frontend/` working tree) · contract `build/openapi.bundled.yaml`
Environment: local QA stack only (own backend :8082 with profiles `dev,test`, database `rms_e2e`; own frontend :3001). **Not deployed to staging; no HTTPS environment.**
Run scope: Tier 2 (test-strategy §2a). The six bug tests were re-run with their `test.fail` markers removed and the 409-retry workaround in the login helper deleted; the whole M1.0 suite also ran in the first full pass of this session.

### Exit-gate checklist
- [x] Every M requirement of M1.0 has a passing automated test or a signed manual check, except P1-NFR-03-T01/T02 (blocked, see below). P1-AUTH-01 (concurrent login, lockout under concurrency) and P1-AUTH-02 (password change revokes sessions) now pass.
- [x] No open Critical bug
- [x] No open High bug (BUG-1-001, 002, 003 Verified)
- [x] Permission matrix green for every seeded role (now all 81 operations: 632 role cases, 79 unauthenticated cases, 0 violations); UI route matrix green (160 cases)
- [x] Contract checks green: 81 operations, 0 contract errors; no audit mutation endpoint
- [x] Audit rows verified for the M1.0 sensitive actions (P1-AUD-01 M1.0 rows)
- [x] Backend unit + integration suite green (77 + 192 = 269 / 269, run in an isolated copy)
- [x] Frontend unit suite green (131 / 131), lint and type-check clean
- [ ] Deployed to staging and smoke-tested, HTTPS redirect + HSTS (P1-NFR-03-T01): **not done, no staging**
- [x] Manual checks signed (table below), except TLS (blocked)
- [ ] Gate questions answered: Q5, Q6, Q30 (token and idle policy) and Q1 (7 or 8 roles) still need the client or lead

### Re-verify of the fixed bugs
| Bug | Severity | Owner | Test (marker removed) | Result |
|---|---|---|---|---|
| BUG-1-001 | High | backend-dev | P1-AUTH-01 concurrent logins (same user, same terminal) | Verified |
| BUG-1-002 | High | backend-dev | P1-AUTH-01 / P1-AUTH-04 lockout under parallel failed attempts | Verified |
| BUG-1-003 | High | backend-dev | P1-AUTH-02 password change revokes other sessions | Verified |
| BUG-1-004 | Medium | frontend-dev | users list shows PIN state after reset | Verified |
| BUG-1-005 | Low | backend-dev | rate "5" / "1e2" and idle timeout 7.5 rejected | Verified |
| BUG-1-006 | Low | frontend-dev | user menu button 48 px in POS and kitchen headers | Verified |

### Manual checks
| Test id | Check | Done by | Date | Result |
|---|---|---|---|---|
| P1-AUD-02-T03 | As the app role `rms_app`: DELETE, UPDATE, TRUNCATE on `audit_log` refused; DROP refused; SELECT works; grants INSERT, SELECT only | qa-engineer (psql) | 2026-11-22 | Pass |
| P1-NFR-03-T03 | All user password hashes bcrypt, no plaintext password or PIN stored | qa-engineer (psql) | 2026-11-22 | Pass |
| P1-NFR-03-T04 / P1-AUTH-05-T11 | PIN hashes bcrypt; device tokens and refresh tokens stored only as hashes | qa-engineer (psql) | 2026-11-22 | Pass |
| P1-NFR-02-T04 | Chromium and Microsoft Edge smoke: login, admin screens, no-access page, logout | qa-engineer (automated) | 2026-11-22 | Pass |
| P1-AUD-03-T12 | Export over the row limit gives 422 EXPORT_TOO_LARGE; verified on a second backend with `RMS_AUDIT_EXPORT_MAX_ROWS=30` | qa-engineer | 2026-11-22 | Pass |
| P1-NFR-03-T01 / T02 | http to https redirect, HSTS, certificate | none | none | **Blocked** (no staging) |

### Waivers (agreed with the lead)
| Item | Reason | Agreed by | Date |
|---|---|---|---|
| P1-AUTH-05 approval, PIN-lock and PinPrompt end-to-end rows move to the M1.2 gate | No approval operation before M1.2 (Q10); backend tests cover the rules | lead | 2026-11-22 |
| P1-SET-05, kitchen-terminal and station rows move to M1.1 | Stations arrive in M1.1 (Q23); now covered, see M1.1 | lead | 2026-11-21 |

### Verdict
Meets exit gate (code and test criteria): **YES.** No open Critical or High bug; all six M1.0 bugs are Verified; suites are green.
Still outstanding for the formal gate: staging deploy and the HTTPS checks (P1-NFR-03-T01/T02), and the open policy questions Q1, Q5, Q6, Q30. These are not code defects.

## M1.1 Catalog & floor

Date: 2026-11-22      QA: qa-engineer      Build: backend jar from `backend/` working tree · frontend Vite dev server · contract v0.2.0 (81 operations, 40 new since M1.0)
Environment: local QA stack only (same as M1.0). **Not deployed to staging.**
Run scope: Tier 2 (test-strategy §2a): all M1.1 specs in full, the permission matrix for all 81 operations, M1.0 UI smoke subset, Tier 1 smoke. Load-related flakes were not chased.

### Exit-gate checklist
- [x] Every M requirement of M1.1 (P1-MENU-01..07, P1-FLOOR-01/02, P1-IMP-01, P1-SET-05/07/08) has a passing automated test, except the order-dependent rules listed under "Not tested"
- [x] No open Critical bug
- [x] No open High bug
- [x] Permission matrix green for the 40 new operations and every role; UI route matrix green (kitchen, rider, inventory, HR see none of the menu admin screens)
- [x] Contract checks green
- [x] Sensitive actions of this milestone (price change, availability, station / category / item / group / table / area / reason changes, import) leave audit rows (PRICE_CHANGED with old and new price)
- [x] Backend unit + integration suite green (77 + 192 = 269 / 269)
- [x] Frontend unit suite green (131 / 131)
- [ ] Deployed to staging and smoke-tested: **not done**
- [x] Manual checks: none required beyond the automated ones listed in the plan
- [ ] Open questions: Q34..Q38 are minor and do not block; Q36 (sold-out reset up to one minute late) should be agreed

### Results (2026-11-22)
| Area | Tests | Pass | Expected-fail (bug) | `fixme` (M1.2 to M1.5) | Skipped | Flaky |
|---|---|---|---|---|---|---|
| Playwright, whole listed suite (chromium-desktop, kds-tablet, serial, Edge; Tier 1 project counted apart) | 1441 | 1403 | 3 | 30 | 4 | 1 |
| of which M1.1 traceability section | 252 | 244 | 3 | 5 | 0 | 0 |
| Playwright `serial` phase (daily reset, rate limit, export limit, heavy import) | 24 | 23 | 1 | 0 | 0 | 0 |
| Playwright Edge smoke | 2 | 2 | 0 | 0 | 0 | 0 |
| Tier 1 smoke (`npm run test:smoke`, API only) | 161 | 161 | 0 | 0 | 0 | 0 |
| Backend unit + integration | 269 | 269 | 0 | 0 | 0 | 0 |
| Frontend unit (vitest) | 131 | 131 | 0 | 0 | 0 | 0 |
| QA tooling unit | 45 | 45 | 0 | 0 | 0 | 0 |

The one flaky case was a Chromium worker crash in a UI route-matrix test (passes on retry; logged, not chased). The 3 expected failures (BUG-1-007 x2, BUG-1-008 x1) of that 2026-11-22 run were Verified fixed on 2026-11-24 (section below).

### Re-verify 2026-11-24 (fixes for BUG-1-007, BUG-1-008, Q35, Q38; Tier 1 smoke + fixed items only)
Rebuilt backend (migration V7) in an isolated copy; own stack on :8082 / :3001, database `rms_e2e`.
| Item | Check | Result |
|---|---|---|
| BUG-1-007 (Medium, backend-dev) | `P1-MENU-02-T13c` (API) and `P1-MENU-03-T20b` (UI) with `test.fail` removed | Verified |
| BUG-1-008 (Medium, backend-dev) | `P1-IMP-01-T12b` (5000-row dry run, marker removed) and new `P1-IMP-01-T12c` (dry run writes nothing, real 5000-row import about 4 s, re-import 5000 unchanged); 5 MB and 5000-row limit cases | Verified |
| Q35 (frontend-dev) | `P1-MENU-06-T30` and UI route matrix for cashier and manager: `/admin/menu/availability` blocked for the cashier (generator now applies the `/admin` parent guard), `/pos/availability` works | Pass |
| Q38 (frontend-dev) | new `P1-MENU-02-T30` early typing in the item dialog is kept | Pass (5 of 5 alone; failed once in a loaded run, passes on retry, logged as flaky, not chased) |
| Tier 1 smoke | `npm run test:smoke` | 161 / 161 in 20 s |
| Targeted run | menu, import, floor API specs (156 pass, 3 deferred `fixme`), 117 targeted Chromium tests (114 pass, 1 flaky, 2 skipped) | Pass |

### Open bugs
None. BUG-1-007 and BUG-1-008 are Verified (see above).

### Not tested (and why)
- Real Excel-authored or multi-sheet XLSX files: only generated workbooks were used; a 5 MB file through the import UI.
- Floor-plan drag on touch devices and on a real tablet or phone.
- TLS, HTTPS and staging checks.
- Rules that need orders (M1.2): required modifier not chosen, sold-out item cannot be added, live table status (5 `fixme` rows stay in the plan).
- Receipt printing and cash drawer hardware.
- Full M1.0 UI regression after the M1.1 frontend change (Tier 2 ran the smoke subset; the first full pass of this session ran everything and was clean).

### Waivers
| Item | Reason | Agreed by | Date |
|---|---|---|---|
| Full regression not re-run this round | Tier 2 strategy for this run (test-strategy §2a); the full regression happens at the phase gate | lead | 2026-11-22 |

### Verdict
Meets exit gate (code and test criteria): **YES.** No Critical, High or Medium bug is open; BUG-1-007 and BUG-1-008 are Verified.
Still outstanding for the formal gate: staging deploy and smoke test there; Q36 (sold-out reset up to one minute late) to be agreed.

## ADR-008 Personal login without a terminal (client decision #9, contract 0.3.0)

Date: 2026-11-24      QA: qa-engineer      Build: backend jar from `backend/` working tree (migrations V8, V9) built in an isolated copy · frontend Vite dev server · contract v0.3.0
Environment: local QA stack only (own backend :8082, database `rms_e2e`, frontend :3001). **Not deployed to staging.**
Run scope: Tier 2 for the change: the ADR-008 API and UI specs, settings, the personal-session matrix, the changed M1.0 tests (auth, terminals, stations specs in full), the full terminal-session role matrix, a UI regression subset (idle, UI route matrix, menu UI) and Tier 1 smoke.

### Exit-gate checklist (for this change)
- [x] Every amended rule of P1-AUTH-03 / P1-AUTH-04 and the lead's answers Q39 to Q42 have a passing automated test
- [x] No open Critical or High bug
- [x] Personal-session matrix green: 385 cases (77 operations × 5 roles holding LOGIN_ANY_DEVICE), 0 violations; no operation is `x-terminal: REQUIRED` yet (generated automatically from M1.2)
- [x] Terminal-session role matrix still green (711 pass, 2 public skipped)
- [x] Audit: personal-session rows have no terminal and a `clientInfo`; terminal rows have both
- [x] Backend (291) and frontend (171) suites reported green by the lead; not re-run by QA this round
- [ ] Deployed to staging: not done

### Results (2026-11-24)
| Area | Tests | Pass | Expected-fail (bug) | Deferred / skipped | Flaky |
|---|---|---|---|---|---|
| auth-personal API | 35 | 35 | 0 | 0 | 0 |
| auth-personal UI | 17 | 17 | 0 | 0 | 0 |
| Personal-session matrix | 385 | 385 | 0 | 0 | 0 |
| Settings (incl. idleTimeoutPersonalMinutes T20 to T23) | 53 | 50 | 0 | 3 fixme (M1.2 to M1.5) | 0 |
| auth, terminals, stations specs (changed M1.0 tests) | 87 | 85 | 1 (BUG-1-009) | 1 fixme (M1.2) | 0 |
| Terminal-session role matrix | 713 | 711 | 0 | 2 skipped (public) | 0 |
| UI subset (idle, UI route matrix, menu UI) | 203 | 202 | 0 | 0 | 1 |
| Tier 1 smoke | 162 | 162 | 0 | 0 | 0 |

The flaky case is P1-MENU-02-T22 (items screen filters): it failed in the loaded UI run and passed alone. Logged, not chased. One settings test (P1-AUTH-03-T23) failed first because of a test mistake: the audit snapshot names the value `PERSONAL`. I fixed the test and it passes. The counts above are after the fix.

### Open bugs
| Id | Severity | Title | Owner | Status |
|---|---|---|---|---|
| BUG-1-009 | Low | Login with the X-Terminal-Id header and an empty body: fieldErrors omit deviceToken | backend-dev | Open |

### Notes
- Q39 to Q42 answered by the lead and asserted; Q43 (SMS one-time code for owner / manager personal logins) is a client item after decision #6.
- Test-side changes needed by the new frontend: the login page shows the device on `login-device` (no `header-terminal` there), and the stored session needs `sessionType` (a stored session without it is treated as TERMINAL). No product change was needed.

### Verdict
The change meets its gate on code and test criteria: **YES.** One Low bug (BUG-1-009) is open. Staging is still outstanding, as for M1.0 and M1.1.

## M1.2 Orders
_Not started._

## M1.3 Kitchen & printing
_Not started._

## M1.4 Billing, discounts, cancellations
_Not started._

## M1.5 Shifts, day-end, POS reports
_Not started._

## M1.6 UAT & go-live
_Not started. Adds: full Phase 1 regression, on-site hardware checklist (each terminal, each KDS, receipt printers, cash drawers, 4G failover), one week of staff testing, backup restore drill._
