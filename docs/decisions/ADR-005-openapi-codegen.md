# ADR-005: OpenAPI is the contract; backend and frontend code is generated from it

**Status:** Accepted · 2026-11-21

## Context
Backend and frontend are built in parallel by separate agents (see `PLAN.md` §3). If both sides hand-write request/response classes, they drift apart and the mismatch only shows up in QA. The user decided: write the API in OpenAPI and **generate classes from it**.

## Decision

### 1. One spec, split into files
```
docs/api/
  openapi.yaml               root: info, servers, security, tags, $ref to every path file
  paths/<module>.yaml        paths per module (auth, settings, menu, floor, orders, kitchen,
                             billing, discounts, shifts, reports, printing, …)
  components/common.yaml     Money, Rate, Problem, FieldError, Page, Approval, Idempotency-Key header, …
  components/<module>.yaml   schemas per module
  components/events.yaml     WebSocket event payloads (STOMP) — generated like any other model
  conventions.md             the rules (human-readable)
```
CI runs `redocly lint` and `redocly bundle docs/api/openapi.yaml -o build/openapi.bundled.yaml`. **Both generators read the bundled file**, so they always see the same contract.

### 2. Backend — `openapi-generator-maven-plugin`, generator `spring`
| Option | Value | Why |
|---|---|---|
| `interfaceOnly` | `true` | Generates `OrdersApi` interfaces + DTOs; our controllers implement them |
| `useSpringBoot3` | `true` | Jakarta namespace |
| `useTags` | `true` | One interface per tag = per module |
| `skipDefaultInterface` | `true` | Forgetting to implement an endpoint is a compile error, not a silent 501 |
| `useBeanValidation` | `true` | `required`, `minLength`, `pattern` become `@NotNull`, `@Size`, `@Pattern` |
| `openApiNullable` | `false` | Plain fields, no `JsonNullable` |
| `apiPackage` / `modelPackage` | `com.santhula.rms.api.generated.api` / `.model` | Kept apart from hand-written code |
| `schemaMappings` | `Money=java.math.BigDecimal`, `Rate=java.math.BigDecimal` | Money is a string on the wire, BigDecimal in Java |

- Output goes to `target/generated-sources/openapi` and is **never committed or edited**.
- Jackson is configured to read and write `BigDecimal` as a JSON string, matching the `Money` schema.
- Generated DTOs live only at the edge: controller → MapStruct mapper → module service. Entities are never returned from controllers.

### 3. Frontend — `openapi-typescript` + `openapi-fetch`
- `npm run api:gen` → `frontend/src/api/generated/schema.d.ts` (types only, no runtime code). Runs automatically before `dev`, `build`, `type-check`. Git-ignored.
- One typed client in `frontend/src/api/client.ts` (`createClient<paths>()`) with middleware for: `Authorization`, `X-Terminal-Id`, `Idempotency-Key` on create/pay calls, token refresh on 401, and turning `problem+json` into a typed error the UI can show.
- Mocks while the backend isn't ready: **`openapi-msw`** handlers typed from the same `paths`, so a mock that doesn't match the contract fails `type-check`.
- Why not openapi-generator's `typescript-axios`: it generates a lot of runtime code and classes; `openapi-typescript` gives the same type safety with no generated runtime.

### 4. Extensions we add to the spec
| Extension | On | Used by |
|---|---|---|
| `x-permission: ORDER_CREATE` | every operation | Backend test asserts each controller method's `@PreAuthorize` matches it; **qa-engineer generates the permission-matrix tests from it** |
| `x-approval: MANAGER` / `OWNER` | operations that need a PIN | Frontend shows `PinPrompt`; QA tests approval rules |
| `x-idempotent: true` | create / pay operations | Frontend client adds `Idempotency-Key`; QA tests duplicate submits |
| `x-requirements: [P1-BILL-01, …]` | operations | Traceability from API to requirement IDs |
| `x-websocket-events` | root | Lists STOMP topics and which `events.yaml` schema each carries |

### 5. Change control
- Spec changes come first, in their own commit, before code that implements them.
- CI runs **`oasdiff breaking`** against `main`; a breaking change fails the build unless the PR is labelled `api-breaking` and the change is noted at the top of the path file.
- Because both sides compile against the generated code, a contract change shows up as compile / type errors on whichever side hasn't caught up.

## Consequences
- No hand-written DTOs or API types on either side.
- The spec must be complete before a milestone's parallel build starts. That's the contract step already in `PLAN.md` §3.
- Generator version is pinned in `pom.xml` and `package.json`. Upgrading it is a deliberate change.
- WebSocket payload types are generated too, via `components/events.yaml`. During M1.0, check that the generator emits these unreferenced schemas (backend: reference them from a dummy schema or enable the generator option if needed).
