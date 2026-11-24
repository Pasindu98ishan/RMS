# RMS backend

Java 21 · Spring Boot 3.5 · PostgreSQL 16 · Flyway. It is a modular monolith under `com.santhula.rms`. The modules are `common`, `auth` (users, roles, terminals, tokens, PIN approval), `audit`, `settings` (restaurant details, service charge, tax, business day, delivery areas, reasons), `menu` (stations, categories, items, modifiers, POS menu), `floor` (ordering points, tables, floor plan) and `dataimport` (spreadsheet import), plus `devseed` (dev-only sample data). Each module has `api` / `domain` / `service` / `repo` packages, and modules talk to each other only through `service` (an ArchUnit test enforces this).

## Prerequisites
- JDK 21
- Node.js 20+ with `npx` on the PATH. The build bundles the OpenAPI contract with `npx @redocly/cli@2.82.0`.
- Docker, for the dev database and for Testcontainers in `verify`.

Maven does not need to be installed: use the wrapper (`./mvnw`, or `mvnw.cmd` on Windows). **Run Maven from `backend/`**, because the generator reads `target/openapi.bundled.yaml` by relative path.

## How the contract becomes code (ADR-005)
During `generate-sources` the build:
1. runs `npx --yes @redocly/cli@2.82.0 bundle ../docs/api/openapi.yaml -o target/openapi.bundled.yaml` (exec-maven-plugin);
2. runs `openapi-generator-maven-plugin` 7.10.0 (`spring`, `interfaceOnly`, `useTags`, `skipDefaultInterface`, Bean Validation) on the bundle, which writes `*Api` interfaces and DTOs to `target/generated-sources/openapi`. These are never committed.
3. copies the bundle onto the classpath (`openapi/openapi.bundled.yaml`), where `PermissionInterceptor` reads each operation's `x-permission`.

To build offline without Node, reusing an existing `target/openapi.bundled.yaml`, add `-Dskip.bundle`.

Controllers implement the generated interfaces and map DTOs to service types by hand (`*Mapper` classes in `api`). Money and rates are `BigDecimal` and travel as JSON strings. Null fields are omitted from responses.

## Run locally
```bash
docker compose -f ../deploy/docker-compose.dev.yml up -d   # Postgres 16 on localhost:15432
./mvnw spring-boot:run                                      # dev profile, http://localhost:8080
```
The `dev` profile (`application-dev.yml`) points at the compose database and uses dev-only credentials:
- the app role is `rms_app` / `rms_app_dev`;
- Flyway runs as `rms_owner` / `rms_owner_dev`;
- the bootstrap owner is `owner` / `owner-dev-pass`, PIN `1234`.

It also allows CORS from `http://localhost:3000` and `http://localhost:5173`.

Health: `GET http://localhost:8080/actuator/health`. API: `http://localhost:8080/api/v1/...`

### Dev logins (profile `dev` only)
With the `dev` profile (`spring-boot:run` uses it) the app also creates one user per seeded role. This is a dev convenience: it is **never** active in the default profile or in tests (`DevDataSeeder` is a `@Profile("dev")` bean). It is idempotent, so users that already exist are left alone, and it logs what it creates.

| Username | Role | Password | PIN |
|---|---|---|---|
| `owner` | Owner (bootstrap owner, `owner-dev-pass`) | `owner-dev-pass` | `1234` |
| `manager1` | Manager | `dev-pass-1234` | `1234` |
| `cashier1` | Cashier | `dev-pass-1234` | `1234` |
| `reception1` | Receptionist | `dev-pass-1234` | `1234` |
| `kitchen1` | Kitchen | `dev-pass-1234` | `1234` |
| `rider1` | Rider | `dev-pass-1234` | `1234` |
| `inventory1` | Inventory | `dev-pass-1234` | `1234` |
| `hr1` | HR | `dev-pass-1234` | `1234` |

These passwords are public. Never enable the `dev` profile on a server people use.

**Logging in with or without a terminal (ADR-008).** `owner`, `manager1`, `rider1`, `inventory1` and `hr1` hold `LOGIN_ANY_DEVICE`, so they can log in straight away at http://localhost:3000 (or 5173) without registering the browser: that is a **personal session** (`sessionType: PERSONAL`, no terminal, idle logout `idleTimeoutPersonalMinutes`, default 30). `cashier1`, `reception1` and `kitchen1` get 403 `TERMINAL_REQUIRED_FOR_USER` there; register the browser as a terminal first ("Set up this device", owner credentials, see below) and log in on it (**terminal session**). With curl, a personal login is just `POST /api/v1/auth/login` with `{"username","password"}` and no `X-Terminal-Id` header; later calls must then not send the header either (403 `TERMINAL_MISMATCH`). Operations marked `x-terminal: REQUIRED` in the contract (none yet; orders, payments, shifts and kitchen screens from M1.2) return 403 `TERMINAL_REQUIRED` in a personal session. Every audit row stores `client_info` (IP and trimmed browser User-Agent).

### Dev sample data (profile `dev` only)
With the `dev` profile the app also loads the sample restaurant from `docs/requirements/m1.1-scope.md`, so there is something to click on: 3 kitchen stations named and timed (Kitchen 1 "Rice & Curry" 15 min, Kitchen 2 "Grill" 20 min, Kitchen 3 "Juice & Dessert" 8 min), 6 categories, **46 menu items** (25 with a foreign price), 3 modifier groups (Spice level, Extras, Size), **12 tables** (Indoor 1-8, Garden G1-G4) and 3 delivery areas (Netolpitiya 150.00, Nearby 300.00, Far 500.00). The default reason lists come from the V6 migration in every environment.

It only ever **creates what is missing**: running it twice creates nothing, and a developer's own edits (a new price, a renamed station, a deactivated item) are never overwritten. It goes through the same services and validation as the import screen and logs what it created. It is a `@Profile("dev")` bean, so it does not exist in any other profile (`DevDataSeederAbsentIT`).

### Spreadsheet import (P1-IMP-01)
Admin > Import uploads one CSV (UTF-8, comma or semicolon) or XLSX file per type: categories, menu items, modifier groups, tables. Templates: `GET /api/v1/import/{type}/template?format=CSV|XLSX`. Rules:
- **All or nothing.** Every row is checked first; if any row is invalid nothing is saved and the report lists each error with row, column and reason ("menu_items row 14, local_price: 'abc' is not a number").
- **Matching by key** (categories by name, menu items by code, modifier groups by name, tables by number): a match is updated, never duplicated. A blank (or absent) optional cell clears that value on a re-import, e.g. a blank `foreign_price` removes the foreign price; `active` and the table position are kept when the column is absent.
- `dryRun=true` does all the checks and works out the exact counts (created / updated / unchanged) without writing anything (no audit row either). A real import writes one `DATA_IMPORTED` audit row plus one audit row per created or changed record.
- **Speed (BUG-1-008).** Time grows in proportion to the rows: the categories, stations, groups and existing items or tables are read once into maps, rows are inserted in JDBC batches (`hibernate.jdbc.batch_size=100`, `reWriteBatchedInserts`), and there is one flush and one batch of audit rows at the end. On a developer laptop with Docker Postgres a 5000-row menu items import takes under 1 s as a dry run and about 7 s for real (it was about 190 s). `ImportPerformanceIT` guards it with a 20 s bound.
- Limits: 5 MB and 5000 rows per file. The row number is the spreadsheet row (the header is row 1).
- Import categories and modifier groups before the menu items that name them.

### Daily sold-out reset
Sold-out items (`available = false`) become available again at the start of each business day (the business-day start time from Settings, default 06:00 Asia/Colombo), unless the menu setting `resetAvailabilityDaily` is switched off. `AvailabilityResetScheduler` checks once a minute and shortly after start-up (which catches up a missed day); the reset is audit-logged as the system. The scheduler is switched off in the integration tests (`rms.menu.reset-scheduler-enabled=false`); they call `AvailabilityResetService` with the test clock. A cashier's sold-out toggle does not change the item's `version`, so it never breaks an admin's open edit form.

**Known and accepted (QA Q36):** because the check runs once a minute, the reset can happen up to one minute after the business-day start time (06:00:00 to 06:00:59 by default), not exactly on the minute. Do not rely on items being available at 06:00:00 sharp.

### First start: owner and first terminal
1. **Bootstrap owner.** On startup, if no active user holds the Owner role, the app creates one from these variables:

   | Variable | Meaning |
   |---|---|
   | `RMS_BOOTSTRAP_OWNER_USERNAME` | 3-32 of `a-z 0-9 . _ -` |
   | `RMS_BOOTSTRAP_OWNER_PASSWORD` | 8-72 characters |
   | `RMS_BOOTSTRAP_OWNER_PIN` | optional, 4-6 digits |
   | `RMS_BOOTSTRAP_OWNER_FULL_NAME` | optional, default `Owner` |

   Once an owner exists, these variables are ignored. If they are missing and there is no owner, the app logs a warning and nobody can log in.
2. **Owner login.** The owner can log in at once without a terminal (personal session, ADR-008):
   ```bash
   curl -X POST localhost:8080/api/v1/auth/login -H 'Content-Type: application/json'      -d '{"username":"owner","password":"owner-dev-pass"}'
   curl localhost:8080/api/v1/auth/me -H 'Authorization: Bearer <accessToken>'      # no X-Terminal-Id
   ```
3. **First terminal.** Counter and kitchen devices (and anyone without `LOGIN_ANY_DEVICE`) need a registered terminal, and registering one needs only the owner's credentials (no token):
   ```bash
   curl -X POST localhost:8080/api/v1/terminals -H 'Content-Type: application/json' \
     -d '{"credentials":{"username":"owner","password":"owner-dev-pass"},"name":"Admin PC","type":"ADMIN"}'
   # -> {"terminal":{"id":"<tid>",...},"deviceToken":"<token>"}   (the device keeps both)
   curl -X POST localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' -H 'X-Terminal-Id: <tid>' \
     -d '{"username":"owner","password":"owner-dev-pass","deviceToken":"<token>"}'
   curl localhost:8080/api/v1/auth/me -H 'Authorization: Bearer <accessToken>' -H 'X-Terminal-Id: <tid>'
   ```
   A KITCHEN terminal needs the id of an active kitchen station, and a POS terminal can have an ordering point. The setup screen reads the choices without a token, with the owner's credentials in the body: `POST /api/v1/terminals/setup-options` (same per-IP limit as registration).

### Owner recovery (needs server access)
If the owner is locked out or has forgotten the password:
1. Set `RMS_RECOVERY_OWNER_USERNAME` and `RMS_RECOVERY_OWNER_PASSWORD` (8-72 characters).
2. Restart the app. On startup it resets that owner's password, clears the password and PIN locks, revokes their sessions, and writes `PASSWORD_RESET` and `ACCOUNT_UNLOCKED` to the audit log (the actor is `system`).
3. **Remove both variables and restart again.** The app logs a warning on every start while they are set.

Recovery only works for a user who holds the Owner role.

Failed terminal registrations never lock an account. Instead, they are rate-limited per client IP: 5 failures in 15 minutes return 429 `TOO_MANY_ATTEMPTS`. Behind nginx the client IP comes from `X-Forwarded-For` (`server.forward-headers-strategy: native`).

## Configuration (environment)
| Variable | Default | Notes |
|---|---|---|
| `RMS_DB_URL` | (required; dev: `jdbc:postgresql://localhost:15432/rms`) | |
| `RMS_DB_APP_USER` / `RMS_DB_APP_PASSWORD` | `rms_app` / (required) | The app's login. No UPDATE/DELETE/TRUNCATE on `audit_log`. |
| `RMS_DB_MIGRATION_USER` / `RMS_DB_MIGRATION_PASSWORD` | `rms_owner` / (required) | Schema owner, used only by Flyway. |
| `RMS_JWT_SECRET` | random per start | Base64, at least 32 bytes. **Set it outside local dev**, otherwise tokens die on every restart. |
| `RMS_BOOTSTRAP_OWNER_*`, `RMS_RECOVERY_OWNER_*` | | See above. |

Token lifetimes: the access token lasts 15 min and refresh tokens slide up to 12 h (ADR-006). The app refuses to start if they are configured longer.

### Database roles and the append-only audit log (P1-AUD-02)
The app connects as `rms_app` and Flyway migrates as the schema owner. `V3__app_role_grants.sql` grants CRUD on every table, then revokes `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log`, so the app role keeps only `SELECT, INSERT`. It also takes away all rights on `flyway_schema_history`.

Default privileges give tables from later migrations CRUD automatically. **A future append-only table must revoke UPDATE/DELETE/TRUNCATE in its own migration.**

The login role itself (with its password) is created outside Flyway:
- dev: `deploy/postgres-init/01-app-role.sql`;
- tests: `src/test/resources/db/test-init.sql`;
- production: the ops runbook. If the role doesn't exist yet, V3 creates it without LOGIN.

In production you can also run Flyway as a one-shot step, so that the app container never holds the owner credentials.

## Tests
```bash
./mvnw verify          # unit tests (surefire, *Test) + integration tests (failsafe, *IT, Testcontainers)
```
- **Unit tests:** lockout policy, atomic-counter rules, registration rate limiter, access / refresh token logic, PIN approval rules, strict money / integer parsing, rate validation, the import file reader, the dev sample data.
- **`PermissionContractTest`:** every one of the 81 spec operations has a controller method whose `@PreAuthorize` matches its `x-permission`. `src/test/resources/not-yet-implemented-operations.txt` lists operations that exist in the contract before their code (empty now; it must be emptied when a milestone ends).
- **`ModuleBoundariesTest`:** ArchUnit checks of the module boundaries (modules only use each other's `service` package).
- **`*IT` classes:** every endpoint is tested for a happy path, a validation error and a 403 for a role without the permission. There are also tests for 403 coming before 400/422, the audit-log DB grants, PIN approval, concurrent logins and parallel wrong passwords, session revocation, the import (CSV, XLSX, dry run, error reports), the daily reset and the test-profile helpers. The M1.1 test classes call `POST /test/reset` first, so they start from the seeded database.

Integration tests start `postgres:16-alpine` via Testcontainers, so Docker must be running.

## Test profile (QA only)
Run with `--spring.profiles.active=dev,test` (or add `test` to your profiles). This adds endpoints that are **not part of the public contract** and **do not exist in any other profile** (they return 404 there):

| Call | Effect |
|---|---|
| `POST /api/v1/test/clock/advance` `{"minutes": 16}` | Moves the server clock forward. This affects account and PIN locks, refresh-token expiry and access-token expiry. Returns `{now, offsetMinutes}`. |
| `POST /api/v1/test/clock/reset` | Back to real time. |
| `POST /api/v1/test/reset` | Truncates every table (audit log included) and re-runs the seed migrations (V2, V6, V9). It then re-creates the bootstrap owner and clears the rate limits and the clock offset. Registered terminals are gone afterwards, so register again. |

These calls need no token. Never enable the `test` profile on staging data you want to keep, or in production.

## Errors
Every error is RFC 7807 `application/problem+json` with `code`, `fieldErrors` (for 422) and `traceId` (also sent in the `X-Trace-Id` header). Permission is checked before the request body is read: a caller without the permission gets 403 even when the body is invalid.
