# ADR-001: Modular monolith, UUIDs, branch-ready schema

**Status:** Accepted · 2026-11-21

## Context
The proposal fixes the stack: Java + Spring Boot as one application with modules, PostgreSQL, Vue.js, WebSockets, Docker on one 2 CPU / 4 GB cloud server. Annex A §15 asks that a second branch can be added later, and offers offline mode as an optional upgrade.

## Decision
1. **One Spring Boot application, one package per module** (`com.santhula.rms.<module>`). Modules expose a service interface and publish Spring application events; they do not read another module's tables or repositories directly. This keeps the option of splitting later without paying for microservices now.
2. **UUID primary keys** everywhere. Human-facing numbers (bill no, order no, KOT no, GRN no) are separate columns. UUIDs mean records created on a local server (offline upgrade) can be merged without clashes.
3. **`branch_id` on every business table** from day one, defaulting to the single branch. A second branch is then data, not a schema rewrite.
4. **One Vue SPA** with a layout per role (POS, Kitchen, Rider, Admin, Display) instead of separate apps. Kitchen and rider routes are installable as a PWA.
5. **STOMP over WebSocket** for live updates, with the in-memory simple broker (one server instance). If the system ever runs on more than one instance, swap to a broker relay.

## Consequences
- Simple deploy: one app container + Postgres + Nginx.
- Module boundaries must be enforced by review (and an ArchUnit test in the backend).
- UUIDs are larger than integers; acceptable at this scale (one restaurant, ≤ 20 staff).
