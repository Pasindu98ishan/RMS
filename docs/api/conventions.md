# API conventions

Rules every endpoint follows. The contract is OpenAPI 3.1 in `docs/api/`, written by backend-dev **before** implementation. Backend interfaces/DTOs and frontend types are **generated** from it ([ADR-005](../decisions/ADR-005-openapi-codegen.md)) — nobody hand-writes DTOs or API types.

## Basics
- Base path: `/api/v1`. JSON only, UTF-8. Field names `camelCase`.
- Resources are plural nouns: `/orders`, `/orders/{id}/lines`, `/kitchen-stations`.
- State changes that aren't plain edits are **action sub-resources** with POST: `/orders/{id}/send`, `/orders/{id}/payments`, `/kots/{id}/status`, `/shifts/{id}/close`, `/bills/{id}/void`.
- IDs are UUID strings. Human numbers (`billNo`, `orderNo`, `kotNo`) are separate fields.
- Money: JSON **string** with 2 decimals (`"1100.00"`) so no client float rounding. Rates: string (`"10.00"` = 10%).
- Timestamps: ISO-8601 UTC (`2026-11-21T08:30:00Z`). Business dates: `YYYY-MM-DD`.

## Auth
- `POST /auth/login` → `{accessToken, refreshToken, user, permissions[]}`.
- `Authorization: Bearer <accessToken>` on every call; `X-Terminal-Id: <uuid>` on every call from a registered device.
- Two kinds of session (ADR-008): a **terminal session** (login with `X-Terminal-Id` + `deviceToken`; the header is then required on every call and must match the token) and a **personal session** (login without them, only for users holding `LOGIN_ANY_DEVICE`; the header must then be absent). A header on the wrong kind of session gets 403 `TERMINAL_MISMATCH`.
- `x-terminal: REQUIRED` on an operation means it needs a terminal session; a personal session gets 403 `TERMINAL_REQUIRED` (checked with the permission, before any 400/422). Unmarked operations work in either session. The server enforces it from the bundled contract, so marking an operation in the spec is all it takes.
- `POST /auth/refresh`, `POST /auth/logout`.
- Permissions checked server-side with `@PreAuthorize("hasAuthority('ORDER_CREATE')")`. Codes in [`../security/roles-permissions.md`](../security/roles-permissions.md).

## Approvals (manager / owner PIN)
Actions that need approval take an `approval` object in the same request:
```json
{ "reason": "Customer changed mind", "comment": "…",
  "approval": { "approverUsername": "manager1", "pin": "1234" } }
```
Server verifies PIN + approver permission in the same transaction. Errors: `APPROVAL_REQUIRED` (403), `APPROVAL_INVALID` (403), `PIN_LOCKED` (423).

## Idempotency
`POST` that create orders, payments, refunds, settlements, petty cash entries **require** `Idempotency-Key: <uuid>`. Same key + same body within 24 h → the original response is returned; same key + different body → 422 `IDEMPOTENCY_MISMATCH`.

## Concurrency
Editable resources return `version`; updates send it back. Stale version → 409 `VERSION_CONFLICT` (the client reloads and retries).

## Errors — RFC 7807 `application/problem+json`
```json
{
  "type": "https://rms/errors/illegal-status-transition",
  "title": "Order cannot be sent",
  "status": 409,
  "code": "ILLEGAL_STATUS_TRANSITION",
  "detail": "Takeaway orders are sent to the kitchen only after payment.",
  "fieldErrors": [ { "field": "customerName", "message": "Customer name or token number is required" } ],
  "traceId": "…"
}
```
`detail` and `fieldErrors[].message` are written for the cashier, in plain English — the UI shows them as-is.

| Status | When |
|---|---|
| 400 | Malformed request |
| 401 | Not logged in / token expired |
| 403 | Missing permission, approval required/invalid, terminal session required (`TERMINAL_REQUIRED`, `TERMINAL_REQUIRED_FOR_USER`) |
| 404 | Not found (or not visible to this user/station) |
| 409 | Illegal state transition, version conflict, day closed, duplicate |
| 422 | Validation failed (`fieldErrors`) |
| 423 | Account / PIN locked |

## Lists
- Pagination: `?page=0&size=50` (max 200) → `{ items: [], page, size, totalItems }`.
- Sorting: `?sort=createdAt,desc`. Filtering: plain query params (`?status=OPEN&orderType=DINE_IN`).
- Date ranges: `?from=2026-11-01&to=2026-11-30` (business dates, inclusive).

## Reports
- `GET /reports/{reportId}?from=&to=&…` → JSON.
- `GET /reports/{reportId}/export?format=pdf|xlsx&…` → file download.

## WebSocket (STOMP)
- Endpoint `/ws`; CONNECT header `Authorization: Bearer …`.
- Topics: see `../architecture/architecture.md` §4. Message envelope:
```json
{ "event": "KOT_CREATED", "id": "<uuid>", "at": "…", "data": { … } }
```
- Messages are notifications; after any reconnect the client reloads state over REST.

## Contract files and code generation
```
docs/api/
  openapi.yaml               root — $refs every path file; x-websocket-events
  paths/<module>.yaml        auth, settings, menu, floor, orders, kitchen, billing,
                             discounts, shifts, reports, printing (more per phase)
  components/common.yaml     Money, Rate, Problem, FieldError, Page, Approval, headers
  components/<module>.yaml   module schemas
  components/events.yaml     STOMP event payloads
```
- Bundled by `redocly bundle` → `build/openapi.bundled.yaml`; both generators read the bundle.
- Backend: `openapi-generator` `spring` (`interfaceOnly`) → controllers implement the generated `*Api` interfaces.
- Frontend: `openapi-typescript` → `src/api/generated/schema.d.ts`, used through `openapi-fetch`; mocks via `openapi-msw`.
- Generated code is never committed or edited.
- CI: `redocly lint`, `oasdiff breaking` against `main`.

### Spec rules
- Every operation has: `operationId` (camelCase verb, e.g. `sendOrderToKitchen`), exactly one tag (= module), `x-permission`, `x-requirements`, and `x-approval` / `x-idempotent` / `x-terminal: REQUIRED` where they apply.
- Every schema is a named component. No inline object schemas in operations (they generate ugly class names like `InlineObject3`).
- Mark `required` and `nullable` correctly. They become `@NotNull` in Java and non-optional fields in TypeScript.
- Enums are named components (`OrderType`, `OrderStatus`), UPPER_SNAKE values.
- Request and response schemas are separate: `CreateOrderRequest`, `Order`, `OrderSummary`. Don't reuse one schema for both.
- Errors reference `components/common.yaml#/components/responses/Problem*`.
- A breaking change is listed at the top of the path file with the date.

### Example
```yaml
# components/common.yaml
Money:
  type: string
  pattern: '^-?\d{1,10}\.\d{2}$'
  example: "1100.00"
Approval:
  type: object
  required: [approverUsername, pin]
  properties:
    approverUsername: { type: string }
    pin: { type: string, pattern: '^\d{4,6}$' }

# paths/billing.yaml
/orders/{orderId}/payments:
  post:
    tags: [billing]
    operationId: payOrder
    x-permission: BILL_PAY
    x-idempotent: true
    x-requirements: [P1-BILL-01, P1-BILL-02, P1-BILL-04]
    parameters:
      - $ref: '../components/common.yaml#/components/parameters/OrderId'
      - $ref: '../components/common.yaml#/components/parameters/IdempotencyKey'
    requestBody:
      required: true
      content:
        application/json:
          schema: { $ref: '../components/billing.yaml#/components/schemas/PayOrderRequest' }
    responses:
      '201':
        content:
          application/json:
            schema: { $ref: '../components/billing.yaml#/components/schemas/Bill' }
      '409': { $ref: '../components/common.yaml#/components/responses/Conflict' }
      '422': { $ref: '../components/common.yaml#/components/responses/ValidationFailed' }
```
