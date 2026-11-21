# Architecture

Decisions behind this: [ADR-001](../decisions/ADR-001-architecture.md), [ADR-003](../decisions/ADR-003-kitchen-screens-and-printing.md).

## 1. System view

```
                RESTAURANT (LAN + main internet + 4G backup router)
 ┌─────────────────────────────────────────────────────────────────┐
 │  Cashier POS PC ───── print-agent ── USB/LAN ─► receipt printer │
 │     (browser)                                   └► cash drawer  │
 │  Reception POS PC ─── print-agent ── USB/LAN ─► receipt printer │
 │     (browser)                                   └► cash drawer  │
 │  Kitchen 1 / 2 / 3 tablets (browser / PWA, KDS)                 │
 │  Large inventory display (Phase 2)   Fingerprint device (Ph. 5) │
 └───────────────────────────────┬─────────────────────────────────┘
                                 │ HTTPS + WSS
 ┌───────────────────────────────▼─────────────────────────────────┐
 │ CLOUD — DigitalOcean droplet, Singapore, 2 vCPU / 4 GB          │
 │  Nginx (TLS, Let's Encrypt) ─┬─► /         Vue SPA (static)     │
 │                              ├─► /api/v1   Spring Boot app      │
 │                              └─► /ws       STOMP WebSocket      │
 │  Spring Boot app ──► PostgreSQL 16 (Docker volume)              │
 │  Nightly pg_dump ──► off-site storage (DO Spaces)               │
 └─────────────────────────────────▲───────────────────────────────┘
                                   │ HTTPS + WSS
             Owner phone / laptop (admin)     Rider phones (Phase 4)
```

All screens talk to the cloud. The only local traffic is print-agent → receipt printer.

## 2. Backend modules

One Spring Boot app, package `com.santhula.rms`. Each module has `api/` (controllers, DTOs), `domain/` (entities, rules), `service/`, `repo/`. Modules call each other through service interfaces or Spring events — never another module's repositories (enforced with an ArchUnit test).

| Module | Phase | Responsibility | Publishes events |
|---|---|---|---|
| `common` | 1 | Money, IDs, errors, idempotency, time/business-day utils | — |
| `auth` | 1 | Users, roles, permissions, login, tokens, PIN check, terminals | `UserLoggedIn` |
| `audit` | 1 | Append-only audit log; listens to all auditable events | — |
| `settings` | 1 | Restaurant details, service charge, tax, business day, delivery areas, reasons | `SettingsChanged` |
| `menu` | 1 | Categories, items, modifiers, price lists, kitchen stations, import | `MenuItemChanged` |
| `floor` | 1 | Tables, floor plan, ordering points | `TableStatusChanged` |
| `customers` | 1 (basic) / 4 | Customer records; credit accounts in Phase 4 | — |
| `orders` | 1 | Order aggregate, state machines, lines, hold/recall, table ops | `OrderSent`, `OrderLineCancelled`, `OrderPaid`, `OrderVoided` |
| `kitchen` | 1 | KOT split, KOT status, KDS heartbeat, prep times | `KotStatusChanged`, `OrderReady`, `StationOffline` |
| `billing` | 1 | Bill calculation (ADR-002), bill numbers, payments, refunds, split bills, receipts | `BillPaid`, `RefundIssued` |
| `discounts` | 1 | Discount rules, approval levels, application | `DiscountApplied` |
| `shifts` | 1 | Shifts, float, petty cash, close, day-end | `ShiftClosed`, `DayClosed` |
| `printing` | 1 | Print job queue per terminal, ESC/POS document model, job status | — |
| `reports` | 1+ | Read-only report queries + PDF/Excel export | — |
| `riders` | 1 (basic) / 4 | Rider list; full rider app in Phase 4 | — |
| `notifications` | 1 (in-app) / 3 | In-app notifications; email/SMS in Phase 3 | — |
| `inventory` | 2 | Items, suppliers, GRN, BOM, stock movements, alerts | `StockLow`, `ItemUnavailable` |
| `booking` | 4 | Rooms, bookings, advances, reminders | — |
| `hr` | 5 | Employees, attendance, OT, payroll, device sync | — |

## 3. Key flows

### Order → kitchen → ready
```
POS ──POST /orders/{id}/send──► orders: lines → SENT
                                 └─ event OrderSent
kitchen (listener): group lines by station → create KOTs
   └─ STOMP /topic/kitchen.{stationId}   → KDS shows ticket
KDS ──POST /kots/{id}/status (READY)──► kitchen
   └─ all KOTs of order READY? → event OrderReady
        └─ STOMP /topic/pos.orders      → POS "Order ready" + sound
```

### Payment → receipt
```
POS ──POST /orders/{id}/payments (Idempotency-Key)──► billing
   ├─ allocate bill number (counter row FOR UPDATE)
   ├─ save payments, update shift totals (event BillPaid → shifts)
   └─ printing: create job → STOMP /topic/print.{terminalId}
print-agent ── ESC/POS ─► printer (+ drawer kick if cash)
print-agent ──POST /print-jobs/{id}/ack (PRINTED | FAILED)
```

### Approval with PIN
The client sends the action plus `approval: {approverUsername, pin}`. The server checks the PIN and the approver's permission for that action **inside the same transaction**, stores the approver on the record, and writes the audit entry. There is no separate "approval token" to steal or replay.

## 4. Real-time (STOMP)

| Destination | Subscribers | Payload |
|---|---|---|
| `/topic/kitchen.{stationId}` | KDS for that station | KOT created / updated / line cancelled |
| `/topic/pos.orders` | All POS terminals | Order status, order ready, table status |
| `/topic/pos.alerts` | All POS terminals | Station offline / online, print failed |
| `/topic/print.{terminalId}` | print-agent on that PC | Print job |
| `/user/queue/notifications` | Logged-in user | In-app notifications |

Subscriptions are authorised on the server (a Kitchen 1 token cannot subscribe to `kitchen.2`). Clients reload state over REST after every reconnect; WebSocket messages are hints, REST is the source of truth.

## 5. Frontend

One Vue 3 SPA, routes grouped by layout:

| Route prefix | Layout | Device | Phase |
|---|---|---|---|
| `/pos` | PosLayout | Cashier / reception PC (touch) | 1 |
| `/kitchen` | KitchenLayout (PWA) | Station tablet | 1 |
| `/admin` | AdminLayout | Laptop / phone | 1 |
| `/reports` | AdminLayout | Laptop / phone | 1 |
| `/inventory` | AdminLayout | PC | 2 |
| `/display` | DisplayLayout | Large screen | 2 |
| `/booking` | PosLayout | POS PC | 4 |
| `/rider` | RiderLayout (PWA) | Rider phone | 4 |
| `/hr` | AdminLayout | PC | 5 |

Screen list: [`../ui/screens.md`](../ui/screens.md).

## 6. Environments

| Env | Where | Data | Deploy |
|---|---|---|---|
| local | Developer PC, `docker compose up` | Seed script | manual |
| staging | Same droplet type, separate DB | Seed + anonymised copy | on merge to `main` |
| production | Client's DigitalOcean account | Live | tagged release, after closing time |

CI (GitHub Actions), on every PR:
1. **API contract:** `redocly lint`, `redocly bundle`, `oasdiff breaking` against `main` (ADR-005).
2. **Backend:** generate from the bundle, then `verify` (compile, unit + integration tests, ArchUnit, `x-permission` check).
3. **Frontend:** `api:gen`, then lint + type-check + unit tests.
4. Build images, run Playwright E2E against docker-compose.

## 7. Backups and operations
- Nightly `pg_dump` at 03:00 Asia/Colombo → DO Spaces, 30 days kept; plus DigitalOcean weekly droplet backups.
- Restore drill before Phase 1 go-live and after each phase.
- Health endpoint `/actuator/health`; uptime check alerts the developer.
- Logs: JSON to stdout, rotated by Docker; 14 days kept.
