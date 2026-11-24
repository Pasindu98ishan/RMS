# QA test strategy

Owner: **qa-engineer** agent. Applies to every phase.

## 1. Goal
Show, for each milestone, that every requirement ID holds — or exactly where it doesn't — before the client tests it. The requirement documents are the oracle, not the current code.

## 2. Test levels

| Level | Tool | Written by | What it covers |
|---|---|---|---|
| Unit | JUnit 5 / Vitest | backend-dev / frontend-dev | Calculations (bill, discount, expected cash, OT, salary), state machines, stores, components |
| Integration | Spring Boot Test + Testcontainers (Postgres) | backend-dev | Each endpoint: happy path, validation, 403 for a forbidden role, DB constraints |
| API acceptance | JUnit / REST Assured, or Playwright `request` | qa-engineer | Requirement-level rules across modules (e.g. cancel after cooking → wastage + void report) |
| End-to-end | Playwright (TS) | qa-engineer | Real browser flows; multi-context tests for POS + 3 KDS |
| Manual / on-site | Checklist | qa-engineer + client staff | Receipt printer, cash drawer, tablets, real network, UAT |

## 2a. Test tiers (speed strategy, adopted 2026-11-22)
Full regression after every milestone was too slow (the M1.0 QA cycle took about 80 minutes, most of it writing tests and chasing load-related flakes). QA now works in three tiers:

| Tier | When | What runs | Target time |
|---|---|---|---|
| **1 Smoke** | After every backend or frontend change | Login, one happy path per module, permission-matrix sample (1 role per operation group), API only | under 3 min |
| **2 Milestone** | Once per milestone, when BE and FE report green | New milestone specs in full + **only the operations added or changed** in the permission matrix (diff the bundled contract against the last full run) + Tier 1 | under 15 min |
| **3 Full regression** | Only at the phase exit gate and before UAT or release; run in the background while the next milestone is being built | Everything, all roles × all operations, all UI specs | whatever it takes, never blocks the next milestone |

Rules that keep it fast:
1. **Tests are written from the contract before the code lands.** When backend-dev publishes a milestone contract, QA starts the spec skeletons and matrix at once, in parallel with the BE and FE builds, so only the run is left when they finish.
2. **Shift left.** Backend and frontend run QA's Tier 1 suite themselves before reporting a milestone done. A failure there is fixed before QA is involved.
3. **API before UI.** API acceptance tests run first; browser tests run only for flows the API tests can't cover (drag floor plan, multi-context KDS, real-time).
4. **No flake chasing inside a milestone.** A UI test that fails once and passes alone is logged as flaky (backlog); only a repeated failure is a bug.
5. **Two QA runs in parallel when needed:** one agent for API and matrix, one for UI, on separate ports and databases.
6. Gate wording: a milestone is signed off on Tier 2; the phase on Tier 3.

## 3. Traceability
- Each phase has `docs/qa/phase-N/test-plan.md`: requirement ID → test id(s) → level → automated/manual → status.
- Test names start with the requirement ID: `P1-BILL-02 concurrent bills get consecutive numbers`.
- Every **M** requirement needs at least one automated test unless marked manual with a reason (hardware).

## 4. What is always tested
1. **Permission matrix** — every permission × every seeded role, API and UI ([roles-permissions.md](../security/roles-permissions.md)).
2. **State machines** — every legal transition, and a sample of illegal ones per state → 409.
3. **Money** — ADR-002 worked example, rounding, split bills sum to the total, multi-tender, refunds.
4. **Reconciliation on a seeded day** — a fixed script creates ~60 orders across all types, discounts, cancellations, refunds and two shifts; every report total must match the computed expectation exactly.
5. **Concurrency** — 50 parallel payments → gap-free bill numbers; double-submit with the same idempotency key → one record.
6. **Real-time** — POS + KDS 1/2/3 in separate browser contexts: routing, Ready only after all stations, cancelled lines, KDS offline banner within 30 s, reload after reconnect.
7. **Audit** — each sensitive action leaves one audit row with user, terminal, approver, reason.
8. **Day boundaries** — orders after midnight belong to the open business day; no edits after day-end.

## 5. Test data
- `e2e/fixtures/seed.ts` creates via the API: 1 branch, 3 stations, ~40 menu items across stations with modifiers, local + foreign prices, 12 tables, all 8 roles with one user each (known PINs), 3 discount rules, 2 delivery areas, 2 riders, 3 customers.
- Each spec seeds what it needs or resets via a test-only endpoint enabled only with the `test` profile.

## 6. Severity
| Severity | Meaning | Gate |
|---|---|---|
| Critical | Stops billing or kitchen orders; loses or miscalculates money; security hole | Blocks milestone |
| High | A required (M) rule doesn't hold; wrong report total | Blocks milestone |
| Medium | Rule holds but awkward / partial (e.g. wrong message) | Fix before phase go-live, or agreed with client |
| Low | Cosmetic, test hooks, copy | Backlog |

## 7. Milestone exit gate
- All M requirements for the milestone: tests pass (or signed manual check).
- No open Critical / High bugs.
- Backend + frontend unit/integration suites green in CI.
- Deployed to staging and smoke-tested there.
- `docs/qa/phase-N/signoff.md` updated: date, test counts, open bugs, verdict.

## 8. Phase go-live (UAT)
- Full regression of all earlier phases (regression suite runs on every PR from Phase 2 onwards).
- On-site hardware checklist: each terminal, each KDS, receipt printers, cash drawers, 4G failover (unplug main line, keep billing).
- Client staff test for one week (proposal §5); bugs they find go into `bugs.md` with source "UAT".
- Backup restore drill passed.
