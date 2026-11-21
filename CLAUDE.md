# RMS — Restaurant Management System (Santhula Hotel, Netolpitiya)

## Sources of truth
- `Project Proposal — Restaurant Management System.pdf` — scope, phases, price. **Wins on conflicts.**
- `Annex A — Restaurant Management System Requirements Specification.pdf` — how each feature behaves.
- `docs/PLAN.md` — phases, milestones, BE/FE/QA tasks, exit gates.
- `docs/client-decisions.md` — client answers; these override Annex A where they differ.
- `docs/README.md` — index of all design docs (requirements with IDs, architecture, data model, API conventions, permissions, screens, QA strategy, ADRs).

## Client decisions so far (2026-11-21)
- Kitchens: **screens only**, no kitchen printers. Print agent = receipts + cash drawer only (ADR-003).
- **No tax** for now (configurable, 0). **Discount after service charge** (ADR-002).
- English only on receipts.

## Stack
Java 21 + Spring Boot 3 (modular monolith) · PostgreSQL 16 + Flyway · STOMP WebSockets · Vue 3 + TS + Vite + Pinia + PrimeVue (PWA for KDS/rider) · Docker Compose on DigitalOcean Singapore · JUnit/Testcontainers, Vitest, Playwright.

## Team (subagents in `.claude/agents/`)
| Agent | Owns | Never edits |
|---|---|---|
| `backend-dev` | `backend/`, `print-agent/`, `docs/api/`, `deploy/` | `frontend/`, `e2e/` |
| `frontend-dev` | `frontend/` | `backend/`, `print-agent/`, `e2e/` |
| `qa-engineer` | `e2e/`, `docs/qa/` | product code |

## Workflow per milestone
1. backend-dev writes the OpenAPI contract in `docs/api/` (passes `redocly lint`) → lead reviews.
2. Both sides regenerate code from it and build in parallel.
3. qa-engineer tests against Annex A, files bugs in `docs/qa/phase-N/bugs.md`.
4. Owners fix → QA verifies → exit gate in `docs/PLAN.md` §3 → milestone done.

A phase is done only when backend, frontend and QA sign-off are all complete.

## Project-wide rules
- Money: `BigDecimal` / `NUMERIC(12,2)`, LKR. UUID PKs. `branch_id` on business tables. UTC storage, `Asia/Colombo` display.
- Bill numbers sequential, gap-free, never deleted or reused.
- Every sensitive action is permission-checked server-side and audit-logged; overrides need manager/owner PIN.
- Order lines snapshot price/tax/discount/cost at sale time.
- Requirement IDs (e.g. `P1-BILL-02`) go in test names, commit messages and bug reports.
- **Contract-first with codegen (ADR-005):** the OpenAPI spec in `docs/api/` is the single source for the API. Backend interfaces/DTOs (openapi-generator, spring) and frontend types (openapi-typescript) are generated from it. Never hand-write DTOs/API types; never edit or commit generated code; to change the API, change the spec first.
- Out of scope (don't build): online ordering, QR room ordering, payment gateway, expense/supplier-payment accounting, EPF/ETF/PAYE, offline mode (optional upgrade, not in base price).
