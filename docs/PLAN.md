# RMS — Delivery Plan

Restaurant Management System for **Santhula Hotel, Netolpitiya**.
Source of truth: `Project Proposal — Restaurant Management System.pdf` (wins on conflicts) and
`Annex A — Restaurant Management System Requirements Specification.pdf`.

- **Timeline:** 16 weeks, 5 phases. POS live after week 5.
- **Rule:** every phase ships **backend + frontend + QA sign-off** together. No phase is "done" with only one side built.
- **Payments tied to:** Phase 1 live (25%), Phase 3 accepted (25%), Phase 5 accepted (20%).

---

## 1. Tech stack (fixed by the proposal)

| Layer | Choice |
|---|---|
| Backend | Java 21, Spring Boot 3.x, **modular monolith** (one deployable, one package per module) |
| DB | PostgreSQL 16, Flyway migrations |
| Live updates | Spring WebSocket + STOMP (`/ws`) |
| Frontend | Vue 3 + TypeScript + Vite, Pinia, Vue Router, PrimeVue; PWA (vite-plugin-pwa) for kitchen + rider screens |
| Print agent | Small Java app on each POS PC (cashier + reception): **receipts and cash drawer only** — kitchens use screens (ADR-003). Subscribes over WebSocket, sends ESC/POS to the receipt printer |
| API contract | OpenAPI 3.1 in `docs/api/` → **generated code**: backend `openapi-generator` (spring, interface-only), frontend `openapi-typescript` + `openapi-fetch` (ADR-005) |
| Reports export | PDF (OpenPDF / JasperReports) and Excel (Apache POI) |
| Hosting | Docker Compose on DigitalOcean (Singapore), Nginx + Let's Encrypt, nightly `pg_dump` off-site |
| Tests | BE: JUnit 5, Spring Boot Test, Testcontainers · FE: Vitest + Vue Test Utils · E2E: Playwright |

## 2. Repository layout

```
RMS/
├── backend/            Spring Boot app      (owner: backend-dev agent)
├── frontend/           Vue 3 SPA            (owner: frontend-dev agent)
├── print-agent/        Cashier PC printing  (owner: backend-dev agent)
├── e2e/                Playwright suites    (owner: qa-engineer agent)
├── docs/
│   ├── PLAN.md         this file
│   ├── api/            OpenAPI contract (written BEFORE code; BE + FE code generated from it)
│   ├── qa/             test plans + bug reports per phase
│   └── decisions/      short ADRs for non-obvious choices
├── deploy/             docker-compose, nginx, backup scripts
└── .claude/agents/     backend-dev, frontend-dev, qa-engineer
```

## 3. How each phase / milestone runs

```
 ┌──────────────┐   ┌───────────────────────────────┐   ┌──────────────┐   ┌───────────┐
 │ 1. Contract  │──▶│ 2. Build in parallel           │──▶│ 3. QA verify │──▶│ 4. Accept │
 │ OpenAPI +    │   │  backend-dev: API, DB, tests   │   │ qa-engineer  │   │ demo/UAT  │
 │ WS events    │   │  frontend-dev: screens vs mock │   │ E2E + bugs   │   │ with staff│
 └──────────────┘   └───────────────────────────────┘   └──────────────┘   └───────────┘
```

1. **Contract first.** backend-dev writes/updates the OpenAPI spec in `docs/api/` (paths, schemas, WebSocket event payloads, `x-permission`, `x-requirements`). It must pass `redocly lint`. You review it.
2. **Generate, then build in parallel.** Both sides regenerate from the spec (ADR-005). backend-dev implements the generated `*Api` interfaces. frontend-dev builds screens on the generated types, with `openapi-msw` mocks until the real API lands. A contract mismatch fails to compile on whichever side is behind.
3. **QA.** qa-engineer derives test cases from Annex A, writes backend integration + Playwright E2E tests, files bugs in `docs/qa/phase-N/bugs.md`. BE/FE agents fix; QA re-verifies.
4. **Exit gate** (all must be true): every Annex A item for the milestone has a passing test or a signed manual check · no open Critical/High bug · deployed to staging · role permissions verified.

---

## 4. Cross-cutting rules (apply from day 1)

- **Money:** `BigDecimal` / `NUMERIC(12,2)`, LKR. Never floats.
- **IDs:** UUID primary keys (keeps the offline upgrade possible later). Human numbers (bill no, KOT no) are separate.
- **Bill numbers:** sequential, gap-free, never reused/deleted → counter table with row lock, not a DB sequence.
- **Branch-ready:** every business table has `branch_id` (Annex A §15 scalability), even with one branch.
- **Audit:** every create/edit/discount/void/refund/login/price change → `audit_log` (user, terminal, time, before/after).
- **Approvals:** sensitive actions take a manager/owner **PIN** at the terminal; approver is stored on the record.
- **Permissions:** permission-based (not hard-coded roles); the 8 roles in Annex A §2 are seeded, admin can make custom roles.
- **Time:** stored UTC, shown `Asia/Colombo`. Business day boundary configurable (day-end Z report).
- **Snapshots:** order lines copy name, price, tax, and (from Phase 2) unit cost at sale time — reports must not change when the menu changes.
- **Idle logout** on terminals; HTTPS only.

---

## 5. Phases

### Phase 1 — Core POS and kitchens · weeks 1–5 · LKR 130,000

Large phase, so it is split into milestones. Each milestone is BE + FE + QA.

#### M1.0 Foundation (week 1)
| Backend | Frontend | QA |
|---|---|---|
| Project scaffold, Docker Compose (app + Postgres), Flyway, CI | Vite/Vue/TS scaffold, PrimeVue, layouts per role (POS, Kitchen, Admin, Rider-later) | Test harness: Testcontainers base class, Playwright project, seed-data script |
| **OpenAPI pipeline:** `docs/api/` skeleton (root, `common.yaml`, `auth` paths), redocly lint + bundle, `openapi-generator-maven-plugin`, Jackson BigDecimal-as-string, `x-permission` ↔ `@PreAuthorize` check test, `oasdiff` in CI | `npm run api:gen` (openapi-typescript), `openapi-fetch` client with auth / terminal / idempotency / problem+json middleware, `openapi-msw` mock setup | Permission-matrix test generator that reads `x-permission` from the bundled spec |
| Auth: login, JWT + refresh, idle timeout; terminal registration | Login, role-guarded routes, idle logout, terminal setup | Auth + permission matrix tests (every role × every route) |
| Users, roles, permissions (seed 8 roles), manager/owner PIN check endpoint | Admin: users, roles/permission editor | |
| Audit log module + query API | Audit log viewer (admin) | |
| Settings: tax, service charge per order type, business day | Settings screens | |

#### M1.1 Catalog & floor (week 1–2)
| Backend | Frontend | QA |
|---|---|---|
| Categories, menu items, modifiers, kitchen stations (3), item → station mapping | Admin menu editor, modifier groups, station mapping | Every item must map to exactly one station |
| Price lists: local + foreign price per item | Price list editor | Price list selection prints correctly |
| Tables + floor plan, ordering points (cashier, reception) | Floor-plan editor | |
| Bulk import from client spreadsheet (menu, tables) | Import screen with validation report | Import with bad rows is rejected with clear errors |

#### M1.2 Orders (weeks 2–3)
| Backend | Frontend | QA |
|---|---|---|
| Order aggregate + state machines for dine-in, takeaway, delivery, credit (Annex A §3) | **POS screen**: category grid + search, cart, modifiers, kitchen notes, order-type selector | State-machine tests: every legal and illegal transition |
| Custom items (price + mandatory description) | Custom item dialog | Custom item without description is rejected |
| Add items to running dine-in order → new KOT | Table plan with status colours, move/merge/split | Merge/split keeps totals and KOTs consistent |
| Hold / recall; customer lookup by phone; minimal customer record for credit (name, phone, address mandatory) | Hold/recall list, customer lookup & quick-create | |
| Minimal rider list (name/phone) so delivery orders can be assigned and reported — full rider app is Phase 4 | Delivery: address, area, assign rider, mark delivered/settled by cashier | |

#### M1.3 Kitchen & printing (week 3)
| Backend | Frontend | QA |
|---|---|---|
| Split order into one KOT per station; WebSocket topics per station and for POS | **KDS screen** per station: New → Preparing → Ready → Handed Over, waiting timer, overdue highlight | Order with items for 3 stations → 3 KOTs, each station sees only its items |
| "Order ready" when all stations Ready; cancelled lines and re-sent tickets pushed to the KDS (no kitchen printing — ADR-003) | POS "Order ready" alert with sound; KDS shows CANCELLED / RESENT | Ready only fires when *all* stations are Ready |
| KDS heartbeat + station online/offline status; KDS reload of open tickets on reconnect | POS "Kitchen N offline" banner with sound | Unplug a KDS → POS warns within 30 s; tickets sent meanwhile appear on reconnect |
| **print-agent** (receipts only): WebSocket client, ESC/POS 80 mm receipt layout, cash-drawer kick, job de-duplication, failure reporting | "Receipt not printed — retry" prompt | Agent reconnects after network drop; no duplicate receipts |

#### M1.4 Billing, discounts, cancellations (weeks 3–4)
| Backend | Frontend | QA |
|---|---|---|
| Bill calculation per ADR-002: service charge per order type → discount on subtotal + service charge; tax 0 / disabled; price list | Bill / payment screen | ADR-002 worked example (1,000 + 10% SC − 30% = 770.00) and rounding cases |
| Split bill (by item / equal), multiple payment methods (cash, card machine, bank transfer) | Split-bill UI, multi-tender | |
| Discount engine (Annex A §4): staff 30% + employee, government 30% + reference, owner 0–100% (owner PIN), configurable others with cashier limit / manager above; whole bill or selected items | Discount dialog with mandatory fields; PIN prompt | Each discount type × each role; bill blocked until mandatory fields filled |
| Cancellation matrix (Annex A §6): before KOT / after KOT / after cooking (wastage flag) / refund / whole-bill VOID | Cancel / void / refund flows with reason + PIN | Every row of the §6 table; voided bill number never reused |
| Sequential bill numbers; reprint marked REPRINT | Receipt preview | |

#### M1.5 Shifts, day-end, POS reports (week 4)
| Backend | Frontend | QA |
|---|---|---|
| Shift open (float), petty cash in/out, close with denomination count, expected vs counted, manager approval | Shift open/close screens, denomination counter | Expected cash = float + cash sales − cash refunds ± petty cash (+ later: settlements, advances, rider cash) |
| Day-end lock (only when all shifts closed), X and Z reports, send to owner | Day-end screen | Cannot close day with an open shift; no edits after lock |
| All Phase 1 POS reports (proposal §3 list, 14 reports), date filter, PDF + Excel export | Reports area with filters + export buttons | Report totals reconcile with raw orders for a seeded day |

#### M1.6 UAT & go-live (week 5)
- Staging + production deploy, HTTPS, backups verified by a restore test.
- Load client menu/tables/users; on-site printer + KDS setup.
- qa-engineer runs full Phase 1 regression; staff test week.
- **Exit:** POS live in the restaurant → 25% payment.

---

### Phase 2 — Inventory · weeks 6–7 · LKR 70,000
| Backend | Frontend | QA |
|---|---|---|
| Inventory items with tracking type (POS-deducted / manual), units, min stock, perishable flag | Item master | |
| Suppliers, GRN (supplier, invoice, qty, unit cost, expiry mandatory if perishable) | Supplier + GRN entry screens | GRN without expiry on perishable rejected |
| Recipes (BOM) per menu item; auto-deduct on sale; restore on cancel-before-prep; wastage deduct on cancel-after-cooking (hooks into Phase 1 cancellation flow) | Recipe editor | Sale → exact BOM deduction; cancel paths per Annex A §6 |
| Costing: **weighted average cost** (ADR), cost snapshot stored on each sale line | — | Cost snapshot unchanged after later GRNs |
| Manual consumption, adjustments, wastage/damage, stock counts → adjustments, movement history | Stock count, adjustment, wastage screens | |
| Expiry + low-stock alerts, reorder list; POS-deducted item at zero → unavailable on POS | Alert centre; POS greys out unavailable items | Zero stock hides item on POS in real time |
| Liquor stock & sales | Liquor views | |
| **Large inventory display** (read-only, auto-refresh) | Full-screen display route | |
| 8 inventory reports (proposal §3) + export | Inventory reports | |

### Phase 3 — Sales & profit reports · weeks 8–10 · LKR 35,000
| Backend | Frontend | QA |
|---|---|---|
| Aggregation queries / materialized views for daily, weekly, monthly sales; vs previous period; month vs same month last year; YTD vs last year (hide until a year of data) | Sales dashboard with charts | Period comparisons on seeded multi-period data |
| Profit = sales − ingredient cost (from snapshots); by day/week/month, by item and category, food cost % | Profit reports, best/least profitable | Profit reconciles with line-level cost snapshots |
| Admin dashboard API (Annex A §14): today's sales, orders by type, avg bill, live orders, alerts | **Owner dashboard** (phone-friendly) | Mobile viewport E2E |
| Notifications: in-app + email (SMS provider pluggable) for day-end, alerts, large discounts/voids, cash shortage | Notification bell / settings | |
- **Exit:** Phase 3 accepted → 25% payment.

### Phase 4 — Riders, credit, booking · weeks 11–13 · LKR 60,000
| Backend | Frontend | QA |
|---|---|---|
| Rider registration (NIC, vehicle, photo) + approval; upgrades Phase 1 minimal rider list | Rider admin | |
| Rider assignment, optional pool, statuses Accepted → Picked up → Delivered / Failed / Returned; release request → reassign or switch to takeaway | **Rider mobile PWA**: assigned/pending filters, tap-to-call, map link | Rider cannot see others' orders or change prices; release → reassign flow |
| Rider cash-in-hand + settlement into cashier shift; delivery fee by area | Rider settlement screen | Shift expected cash includes rider settlement |
| Credit customers: limit check + override, partial/full settlements across bills, statements, ageing 0–30/31–60/61–90/90+ | Credit customer screens, statement print | Over-limit needs manager override |
| Room booking: rooms, calendar, double-booking block, statuses, optional items/services, advance (into shift), advance deducted from final bill, cancellation policy | **Booking calendar** (day/week/month, drag to move) | Overlap rejected; advance flows into shift and bill |
| Scheduler: reminders to assigned staff 2 days before (in-app/SMS) | Today/tomorrow bookings widget | Reminder job fires exactly once |
| Delivery, rider, credit, booking reports | Reports | |

### Phase 5 — HR & payroll · weeks 14–16 · LKR 55,000
| Backend | Frontend | QA |
|---|---|---|
| Employees (linked to login + staff discounts) | Employee screens | |
| Fingerprint device sync (model TBC — adapter interface + one implementation) | Device status screen | Sync is idempotent (re-sync creates no duplicates) |
| Shifts incl. split shifts; daily attendance: in/out, late, early leave, absent; HR correction with reason | Roster + attendance grid | Split-shift edge cases, midnight crossover |
| Overtime from punches beyond shift, min threshold, rates, manager approval | OT approval screen | |
| Salary: basic + allowances + approved OT − no-pay − advances; salary sheet, payslips | Payroll run + payslip print | Payroll worked examples agreed with client |
| Attendance + payroll reports; salary data visible only to authorised roles | HR reports | Salary endpoints return 403 for every unauthorised role |
- **Exit:** final acceptance → 20% payment. 3-month warranty per phase from its go-live.

---

## 6. Client decisions and open questions

Full log with dates: [`client-decisions.md`](client-decisions.md).

| # | Topic | Status |
|---|---|---|
| 1 | Kitchen hardware | ✅ Screens only (ADR-003) |
| 2 | Tax | ✅ No tax for now; configurable, set to 0 (ADR-002) |
| 2b | Discount vs service charge | ✅ Discount after service charge (ADR-002) |
| 3 | Sinhala on printouts | ✅ No, English only |
| 4 | Delivery handling in Phase 1 | ⏳ Pending — working assumption in the log |
| 5 | Fingerprint device model | ⏳ Pending — needed for Phase 5 only |
| 6 | SMS provider | ❓ Open (Phase 3/4) |
| 7 | Booking advance cancellation policy | ❓ Open (Phase 4) |
| 8 | Data spreadsheet dates | ❓ Open (needed for M1.6 data load) |

## 7. Risks

| Risk | Mitigation |
|---|---|
| Phase 1 is ~40% of scope in 5 weeks | Milestones above; reports in M1.5 built on one shared query layer |
| Receipt printer / cash drawer on real hardware | Build print-agent in week 3, test on the client's actual 80 mm printer and drawer before UAT |
| No kitchen printer backup (screens only) | KDS heartbeat + POS offline banner, reload on reconnect; recommend one spare tablet on site |
| Internet outage stops billing | 4G router required; keep data model offline-friendly (UUIDs) for the optional upgrade |
| Inventory accuracy depends on recipes | Recipe import + validation report; QA reconciles stock after a seeded day |
