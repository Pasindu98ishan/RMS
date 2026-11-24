# RMS documentation

Restaurant Management System for Santhula Hotel, Netolpitiya. Documentation is written **before** code; agents read it at the start of every task.

## Read in this order

| # | Document | What it answers |
|---|---|---|
| 1 | [PLAN.md](PLAN.md) | Phases, milestones, BE / FE / QA tasks, exit gates, risks |
| 2 | [client-decisions.md](client-decisions.md) | What the client has decided, what's pending, and what changed from Annex A |
| 3 | [requirements/phase-1-requirements.md](requirements/phase-1-requirements.md) | Every Phase 1 rule with an ID and acceptance criteria |
| 3a | [requirements/m1.1-scope.md](requirements/m1.1-scope.md) | Exact M1.1 scope, import file format, sample data |
| 4 | [architecture/architecture.md](architecture/architecture.md) | System view, modules, key flows, real-time topics, environments |
| 5 | [architecture/data-model.md](architecture/data-model.md) | Phase 1 tables and constraints |
| 6 | [api/conventions.md](api/conventions.md) | REST / WebSocket rules every endpoint follows |
| 7 | [security/roles-permissions.md](security/roles-permissions.md) | Permission codes and default grants per role |
| 8 | [ui/screens.md](ui/screens.md) | Every screen, route, and the requirements it covers |
| 9 | [qa/test-strategy.md](qa/test-strategy.md) | Test levels, traceability, severity, exit gate |

## Running the system
- [run-and-test-guide.md](run-and-test-guide.md) — how to start the stack, dev logins, sample data, what to try.

## Decisions (ADRs)
| ADR | Decision |
|---|---|
| [ADR-001](decisions/ADR-001-architecture.md) | Modular monolith, UUIDs, branch-ready schema |
| [ADR-002](decisions/ADR-002-bill-calculation.md) | Service charge first, then discount; no tax |
| [ADR-003](decisions/ADR-003-kitchen-screens-and-printing.md) | Kitchen screens only; print agent for receipts |
| [ADR-004](decisions/ADR-004-inventory-costing.md) | Weighted average cost, snapshotted per sale (Phase 2) |
| [ADR-005](decisions/ADR-005-openapi-codegen.md) | OpenAPI is the contract; backend and frontend code generated from it |
| [ADR-006](decisions/ADR-006-auth-and-terminals.md) | Terminal-bound login, rotating 12 h refresh, inline-credential terminal registration, no `nullable` |
| [ADR-008](decisions/ADR-008-personal-login-without-terminal.md) | Personal login without a terminal for Owner/Manager/Rider/Inventory/HR; counter and kitchen work still needs a terminal |
| [ADR-007](decisions/ADR-007-catalog-and-import.md) | Catalog, floor and import (M1.1): nothing deleted, one POS menu read, sold-out outside locking, import rules |

## Written later
- `api/openapi.yaml`, `api/paths/*.yaml`, `api/components/*.yaml`: the OpenAPI contract, written by backend-dev at the start of each milestone. Backend and frontend code is generated from it (ADR-005).
- `requirements/phase-2-requirements.md` … `phase-5-…` — before each phase starts.
- `qa/phase-N/test-plan.md`, `bugs.md`, `signoff.md` — by qa-engineer during each phase.

## Source documents (project root)
- `Project Proposal — Restaurant Management System.pdf` — wins on conflicts.
- `Annex A — Restaurant Management System Requirements Specification.pdf`.
