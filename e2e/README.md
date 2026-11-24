# RMS end-to-end tests (owner: qa-engineer)

Playwright + TypeScript. Traceability: `docs/qa/phase-1/test-plan.md`; bugs: `docs/qa/phase-1/bugs.md`; sign-off: `docs/qa/phase-1/signoff.md`.

## Test tiers (docs/qa/test-strategy.md §2a)

| Tier | Command | What | Time |
|---|---|---|---|
| **1 Smoke** (developers: run it after every backend or frontend change) | `npm run test:smoke` | API only: login / refresh / logout (terminal and personal session, ADR-008), one happy path per module, and a permission-matrix sample read from the bundled contract (every operation: the owner is not refused, one role without the permission gets 403) | about 20 s |
| **2 Milestone** (QA, once per milestone) | `npx playwright test specs/<new specs> --project=chromium-desktop` + the matrix for changed operations | the milestone's specs in full, plus only the operations added or changed in the matrix (`-g "<operationId>"`) | under 15 min |
| **3 Full regression** (phase exit gate, before UAT) | `npm run test:all` | everything: unit, all specs, the full role × operation matrix (`permission-matrix.spec.ts`) and UI route matrix, then the serial phase | 20-40 min, run in the background |

Smoke needs a running backend with profile `test` (see below) and the same `.env`. It creates uniquely named records and re-seeds at start (global setup), so use a disposable database.

## Run it

```bash
# 1. contract bundle (repo root)
npx --yes @redocly/cli@2.82.0 bundle docs/api/openapi.yaml -o build/openapi.bundled.yaml

# 2. a disposable stack (never your dev data): database, backend with profiles dev,test, frontend
#    backend:  RMS_DB_URL=jdbc:postgresql://localhost:15432/rms_e2e RMS_BOOTSTRAP_OWNER_USERNAME=owner1 \
#              RMS_BOOTSTRAP_OWNER_PASSWORD=... RMS_BOOTSTRAP_OWNER_PIN=246810 \
#              RMS_CORS_ALLOWED_ORIGINS=http://localhost:3001 \
#              java -jar rms-backend.jar --spring.profiles.active=dev,test --server.port=8082
#    frontend: RMS_BACKEND_URL=http://localhost:8082 RMS_FRONTEND_PORT=3001 npm run dev   (in frontend/)

# 3. the suite (in e2e/)
cp .env.example .env                 # fill in the bootstrap owner; set RMS_BASE_URL / RMS_API_URL for your ports
npm install && npx playwright install chromium
npm run typecheck                    # regenerates generated/schema.d.ts from the bundle, then tsc --noEmit
npm run test:smoke                   # Tier 1, API only, about 20 s
npm run test:unit                    # QA tooling only, no backend needed
npm run test:all                     # unit + parallel phase, then the serial phase (clock / global state)
npx playwright test --project=edge-desktop   # smoke in installed Microsoft Edge
```

`RMS_SEED=1` + `RMS_TEST_RESET=1` (set in `.env`) make every `playwright test` invocation call `POST /test/reset` and re-seed through the API: **it wipes the database**. For one extra backend with a low audit export limit (P1-AUD-03-T12) start a second instance with `RMS_AUDIT_EXPORT_MAX_ROWS=30` and set `RMS_API_URL_LOW_EXPORT`.

## Layout
- `specs/`: one file per Annex A area (`tier1-smoke.spec.ts` = Tier 1); titles start with the test id (`P1-AUTH-01-T05 …`). `serial.spec.ts` holds the tests that change global state (server clock, idle settings, system roles, owner count, rate limit) and runs alone after the others. `auth-personal.spec.ts` / `auth-personal-ui.spec.ts` cover personal login (ADR-008); the permission matrix also runs every operation in a personal session for the roles holding `LOGIN_ANY_DEVICE` and reads `x-terminal: REQUIRED`. Tag `@kds` runs in `kds-tablet` (1280×800, touch), `@smoke` also in `edge-desktop`.
- `specs/permission-matrix.spec.ts`: generated from the bundled contract (every operation × every seeded role, plus unauthenticated). `specs/ui-permissions.spec.ts`: generated UI route matrix.
- `utils/permission-matrix.ts` (generator) + `utils/role-grants.ts` (roles-permissions.md as data: change both together) + `utils/route-permissions.ts`; `utils/admin-api.ts` (throwaway users / roles, test clock, audit lookups); `utils/api-client.ts` (typed client; login retries a 409, see BUG-1-001).
- `fixtures/seed.ts` (seed data, API seeding), `fixtures/test.ts` (`owner`, `apiAs(role)` = terminal session, `apiPersonal(role)` = personal session without a terminal (ADR-008), `makeUser`, `uiAs(role)`, `freshDevice`, `registeredDevice`), `fixtures/ui.ts` (writes the device registration / session into browser localStorage).
- `pages/`: page objects and `testids.ts` (they match `frontend/src`).
- `generated/`: API types from the contract (git-ignored, never edited).

Rules: a test that fails because the product is wrong stays in the suite as `test.fail(true, 'BUG-1-nnn …')`, never weakened or deleted. No edits to `backend/`, `frontend/` or `docs/api/`.
