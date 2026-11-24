# Phase 1 Requirements — Core POS and kitchens

Every requirement has an ID. Backend, frontend and QA all refer to these IDs: in commit messages, in tests (test names start with the ID) and in bug reports.

**Sources:** proposal §3 Phase 1; Annex A §2–§6, §9, §12, §14 (settings part), §15; client decisions in [`../client-decisions.md`](../client-decisions.md). Where this file and Annex A differ, the reason is a client decision or ADR, linked inline.

**Milestones:** M1.0 Foundation · M1.1 Catalog & floor · M1.2 Orders · M1.3 Kitchen & printing · M1.4 Billing, discounts, cancellations · M1.5 Shifts & reports · M1.6 UAT (see `../PLAN.md`).

**Priority:** **M** = must for go-live · **S** = should, can slip to a warranty fix with client agreement.

---

## 1. Access, roles, audit (M1.0)

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-AUTH-01 | Every user logs in with their own username and password. | M | Wrong password → error, no detail about which part was wrong. 5 failed attempts → account locked 15 min; owner can unlock. |
| P1-AUTH-02 | Sessions use short-lived access tokens with refresh. | M | Access token ≤ 15 min; refresh token ≤ 12 h; logout revokes refresh token. |
| P1-AUTH-03 | Terminals log out automatically when idle. | M | Idle timeout configurable per terminal type (POS default 10 min, admin 30 min) and for personal sessions without a terminal (default 30 min). KDS screens are exempt (they stay logged in as the station). |
| P1-AUTH-04 | Counter and kitchen devices are registered as terminals (Cashier POS, Reception POS, Kitchen 1–3, Admin, Display). Users holding `LOGIN_ANY_DEVICE` (seeded: Owner, Manager, Rider, Inventory, HR) may also log in from any browser without a terminal (client decision #9, ADR-008). | M | Every order, payment, bill, shift and KDS action needs a terminal session (403 `TERMINAL_REQUIRED` otherwise) and stores the terminal id. A user without `LOGIN_ANY_DEVICE` logging in without a terminal gets 403 `TERMINAL_REQUIRED_FOR_USER`. Every audit row stores the terminal id when there is one and always `client_info` (IP, browser). |
| P1-AUTH-05 | Users have a 4–6 digit **PIN** used for approvals at the terminal. | M | PIN stored hashed. 3 wrong PINs in a row → PIN locked for that user for 5 min. |
| P1-RBAC-01 | Access is controlled by permissions; roles are sets of permissions. | M | Seeded roles: Owner, Manager, Cashier, Receptionist, Kitchen, Rider, Inventory, HR (permission matrix in `../security/roles-permissions.md`). |
| P1-RBAC-02 | Owner can create custom roles from the permission list and assign roles to users. | M | Changes take effect on the user's next token refresh; change is audit-logged. |
| P1-RBAC-03 | Every API endpoint enforces permissions on the server. | M | For each endpoint, a role without the permission gets 403. UI hiding is not enough. |
| P1-RBAC-04 | Kitchen users see only their own station. | M | A Kitchen 1 user cannot load Kitchen 2 tickets via UI or API. |
| P1-AUD-01 | Audit log records: login / logout / failed login, every create and edit of master data, price changes, discounts, cancellations, voids, refunds, approvals, settings changes, shift open/close, day-end. | M | Each record: time, user, terminal, action, entity, before / after values, approver (if any), reason (if any). |
| P1-AUD-02 | Audit log cannot be edited or deleted through the system. | M | No update/delete endpoint exists; DB user for the app has no DELETE on the table. |
| P1-AUD-03 | Owner can search the audit log by date, user, action, entity. | M | Paginated; exports to Excel. |

## 2. Settings (M1.0–M1.1)

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-SET-01 | Service charge rate per order type (dine-in, takeaway, delivery, credit follows its service mode). | M | Rate copied to the order at creation (ADR-002). |
| P1-SET-02 | Tax setting exists but is **off with rate 0** ([client decision #2](../client-decisions.md)). | M | All bills show tax 0.00 or hide the tax line. |
| P1-SET-03 | Restaurant details for receipts: name, address, phone, footer text. | M | Printed on every receipt. |
| P1-SET-04 | Business day start time (for shifts / Z report when service passes midnight). | M | Orders after midnight but before the day-end belong to the open business day. |
| P1-SET-05 | Kitchen target preparation time per station (minutes). | M | Used by P1-KDS-05. |
| P1-SET-06 | Discount rules (see §7). | M | Changes audit-logged. |
| P1-SET-07 | Delivery areas with a delivery fee per area. | M | Fee added as a bill line on delivery orders. |
| P1-SET-08 | Cancellation reasons list (editable) plus free-text comment. | S | |

## 3. Menu and floor (M1.1)

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-MENU-01 | Categories with display order and active flag. | M | |
| P1-MENU-02 | Menu items: name, category, code, local price, foreign price, kitchen station, active flag, available flag. | M | Item cannot be saved without exactly one kitchen station. |
| P1-MENU-03 | Modifier groups (e.g. "Spice level") with options that may add a price; required / optional; min / max selections. | M | Required modifier not chosen → item cannot be added to the order. |
| P1-MENU-04 | Two price lists: **Local** and **Foreign**. Each order uses one, chosen by the cashier; default Local. | M | Price list name printed on the bill. Changing the price list on an open order reprices all un-sent lines only; sent lines need manager PIN. |
| P1-MENU-05 | Price changes are audit-logged and do not change existing orders. | M | Order lines keep the price at the time they were added. |
| P1-MENU-06 | Owner can mark an item unavailable (sold out) for today. | M | Unavailable items are greyed out on POS and cannot be added. |
| P1-MENU-07 | Three kitchen stations, names editable (e.g. Kitchen 1 Rice & Curry, Kitchen 2 Grill, Kitchen 3 Juice & Dessert). | M | |
| P1-FLOOR-01 | Tables with number, area/section, seats; a floor plan the owner can arrange. | M | |
| P1-FLOOR-02 | Two ordering points: Cashier counter and Reception. | M | Ordering point stored on every order and shown on KOTs. |
| P1-IMP-01 | Import menu items, categories, tables from a spreadsheet (CSV / XLSX template). | M | Import validates all rows first; any invalid row → nothing imported, error report lists row and reason. |

## 4. Orders — common (M1.2)

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-ORD-01 | Four order types: dine-in, takeaway, delivery, credit. Credit uses one of the other three as its service mode. | M | |
| P1-ORD-02 | Orders can be created at either ordering point. | M | |
| P1-ORD-03 | Menu by category with search by name or code. | M | Search returns results while typing (≤ 300 ms on a 300-item menu). |
| P1-ORD-04 | Per line: quantity, modifiers, kitchen note. | M | Modifiers and note appear on the KDS. |
| P1-ORD-05 | **Custom item** not on the menu: description (mandatory), price, kitchen station. | M | Empty description or price ≤ 0 rejected. Custom items listed in the "Custom items sold" report. |
| P1-ORD-06 | Every order gets a sequential order number per business day, shown to staff and on KOTs. | M | |
| P1-ORD-07 | Hold an order and recall it later. | M | Held orders listed per terminal; held orders older than the business day appear in day-end checks. |
| P1-ORD-08 | Customer lookup by phone pre-fills name and address. | M | New phone → quick-create customer. |
| P1-ORD-09 | Order statuses follow fixed state machines (§5); illegal transitions are rejected. | M | API returns 409 with a message; UI hides actions not allowed in the current state. |
| P1-ORD-10 | Saving an order or payment twice (double click, retry after timeout) never creates duplicates. | M | Create/pay requests carry an idempotency key. |

## 5. Order types and state machines (M1.2)

### Dine-in
`OPEN → SENT_TO_KITCHEN → SERVED → BILL_PRINTED → PAID → CLOSED` (+ `VOID` from any state before CLOSED with approval)

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-DIN-01 | Required: table, number of guests; waiter optional. | M | |
| P1-DIN-02 | "Send to kitchen" creates KOTs for all un-sent lines. | M | |
| P1-DIN-03 | Items can be added at any time before payment; each send creates a **new** KOT for the new lines only. | M | Adding after BILL_PRINTED returns the order to SERVED and requires reprinting the bill (old bill marked superseded). |
| P1-DIN-04 | Table status colours: free, occupied, bill printed. | M | Status updates live on all POS screens. |
| P1-DIN-05 | Move order to another table; merge two tables' orders; split an order's lines to a new order. | M | Totals, KOT history and audit preserved; merge/split audit-logged. |
| P1-DIN-06 | Payment after the meal. | M | |

### Takeaway
`BILLED (paid) → SENT_TO_KITCHEN → PREPARING → READY → HANDED_OVER`

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-TKW-01 | Required: customer name **or** token number; phone optional. | M | |
| P1-TKW-02 | Payment before preparation: KOTs are sent only after the bill is paid. | M | |
| P1-TKW-03 | When ready, POS shows "Ready for handover"; cashier marks handed over to close. | M | |

### Delivery
`SENT_TO_KITCHEN → PREPARING → READY → ASSIGNED → PICKED_UP → DELIVERED → SETTLED`

Phase 1 scope follows the working assumption in [client decision #4](../client-decisions.md) (pending).

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-DEL-01 | Required: customer name, phone, delivery address, area. | M | Delivery fee from the area (P1-SET-07). |
| P1-DEL-02 | Simple rider list (name, phone, active). | M | Full rider registration and app are Phase 4. |
| P1-DEL-03 | Cashier assigns a rider, marks picked up, delivered. | M | |
| P1-DEL-04 | Payment after delivery: cashier records the cash the rider brings back; order SETTLED. | M | Shortage recorded against the rider and visible in rider-wise report. |
| P1-DEL-05 | Delivery failed / returned → manager decides refund / wastage (uses §8 cancellation rules). | S | |

### Credit
Follows the chosen service mode; ends at `CHARGED_TO_ACCOUNT` instead of PAID.

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-CRD-01 | Credit customer record: name, phone, address mandatory; company, NIC, notes optional; status active / blocked. | M | Blocked customer cannot take credit. |
| P1-CRD-02 | Credit order is charged to the customer's account and appears in the credit sales report. | M | |
| P1-CRD-03 | Credit limit, balances, settlements, statements, ageing → **Phase 4**. | — | Phase 1 stores the charge so Phase 4 can build balances from it. |

## 6. Kitchen (M1.3)

Kitchen stations use **screens only** ([ADR-003](../decisions/ADR-003-kitchen-screens-and-printing.md)).

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-KOT-01 | On send, the order is split into one KOT per kitchen station based on each item's station. | M | Order with items for 3 stations → 3 KOTs; a station gets only its items. |
| P1-KOT-02 | KOT content: KOT no, order no, order type, table or customer name, ordering point, time, items with qty, modifiers, notes, note "other kitchens have the rest of this order" when applicable. | M | |
| P1-KOT-03 | KOT reaches the station screen within 3 s of send on a normal connection. | M | Measured in E2E. |
| P1-KDS-01 | Station screen lists open KOTs oldest first, with live updates. | M | |
| P1-KDS-02 | Kitchen staff tap to move each KOT: NEW → PREPARING → READY → HANDED_OVER. | M | One tap per step; undo last step within 10 s. |
| P1-KDS-03 | When every station's KOT for an order is READY, POS shows "Order ready" with a sound. | M | Not before the last station is READY. |
| P1-KDS-04 | Cancelled lines show struck through with CANCELLED and an alert; re-sent tickets labelled RESENT. | M | |
| P1-KDS-05 | Waiting time shown per KOT; KOTs past the station's target time are highlighted. | M | |
| P1-KDS-06 | KDS sends a heartbeat; POS shows "Kitchen N offline" banner with sound after 30 s without one. | M | |
| P1-KDS-07 | After reconnect the KDS reloads all open KOTs for its station. | M | KOTs sent while offline appear after reconnect. |
| P1-KDS-08 | Preparation time (NEW → READY) recorded per KOT for the kitchen report. | M | |

## 7. Billing and payment (M1.4)

Calculation per [ADR-002](../decisions/ADR-002-bill-calculation.md): service charge first, discount after, tax 0.

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-BILL-01 | Server calculates subtotal, service charge, discount, tax, total. | M | ADR-002 worked example: 1,000.00 + 10% SC − 30% = **770.00**. |
| P1-BILL-02 | Bill number: sequential, gap-free, never reused or deleted. | M | 50 concurrent bill creations → 50 consecutive numbers, no gaps or duplicates. |
| P1-BILL-03 | Split bill by item or equal share into separate bills. | M | Sum of split bills = original total. |
| P1-BILL-04 | Several payment methods on one bill: cash, card (standalone machine), bank transfer. | M | Sum of tenders = total; cash tender may exceed → change shown. Card / bank transfer require a reference (optional field). |
| P1-BILL-05 | Receipt printed on 80 mm printer via print agent; cash payment opens the drawer. | M | |
| P1-BILL-06 | Reprint bill → marked REPRINT and audit-logged. | M | |
| P1-BILL-07 | Receipt content: restaurant details, bill no, order no, date/time, cashier, terminal, order type, table/customer, price list, lines, subtotal, service charge, discount (type), total, tenders, change. | M | |

## 8. Discounts (M1.4)

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-DISC-01 | Discount types: Staff 30% fixed, Government 30% fixed, Owner 0–100% or fixed amount, Others (configurable). | M | |
| P1-DISC-02 | Every discount requires a comment; bill cannot be completed until mandatory fields are filled. | M | |
| P1-DISC-03 | Staff: cashier can apply; staff member picked from employee/user list mandatory. Optional monthly limit per staff member. | M | Limit exceeded → blocked with message (manager override). |
| P1-DISC-04 | Government: cashier can apply; department / officer reference mandatory. | M | |
| P1-DISC-05 | Owner: only with owner PIN at the terminal. (Remote approval from the owner's phone → S.) | M | Manager PIN rejected for owner discount. |
| P1-DISC-06 | Others: Admin sets name, rate or max, cashier limit; above the limit needs manager PIN. Reason + comment mandatory. | M | |
| P1-DISC-07 | Discount applies to the whole bill or to selected lines. One discount per bill or per line (no stacking). | M | |
| P1-DISC-08 | Each discount stores type, rate/amount, value, cashier, approver, staff member / reference, comment. | M | All visible in the discount report. |

## 9. Cancellations, voids, refunds (M1.4)

| ID | Stage | Who | System does | Pri |
|---|---|---|---|---|
| P1-CAN-01 | Line before KOT sent | Cashier | Removes the line; logged; no approval | M |
| P1-CAN-02 | Line after KOT, before cooking (KOT status NEW) | Manager PIN + reason | Line cancelled; KDS shows CANCELLED; `prepared = false` | M |
| P1-CAN-03 | Line after cooking started or ready (PREPARING / READY) | Manager PIN + reason | Line cancelled; KDS shows CANCELLED; `prepared = true`, classed **wastage** (or reusable, manager picks). Stock effect comes in Phase 2. | M |
| P1-CAN-04 | After payment (refund) | Manager or owner PIN + reason | Refund by original or chosen method; refund reduces the cashier's expected cash if cash | M |
| P1-CAN-05 | Whole bill void | Owner or manager PIN + reason | Bill kept with status VOID; number never reused; open KOTs cancelled on KDS | M |
| P1-CAN-06 | All cancellations, voids, refunds appear in the void report with reason, approver, prepared-food status. | — | | M |

## 10. Shifts and day-end (M1.5)

| ID | Requirement | Pri | Acceptance criteria |
|---|---|---|---|
| P1-SHIFT-01 | Cashier must open a shift with an opening float before taking payments. | M | No open shift → payment blocked. One open shift per user per terminal. |
| P1-SHIFT-02 | All cash movements are recorded against the shift: sales, refunds, petty cash in/out (with reason), delivery cash received. | M | |
| P1-SHIFT-03 | X report can be printed any time without closing. | M | |
| P1-SHIFT-04 | Close shift: count cash by denomination (5000, 2000, 1000, 500, 100, 50, 20, 10, coins); system shows expected vs counted and difference; card and bank transfer totals confirmed separately. | M | Expected cash = float + cash sales − cash refunds + petty cash in − petty cash out + delivery cash received. |
| P1-SHIFT-05 | Manager reviews and approves the closing, with a note for any shortage or excess. | M | Owner notified of shortage above a set amount (in-app in Phase 1). |
| P1-SHIFT-06 | Day-end (Z report) only when all shifts are closed and no order is open/held. | M | Blocked with a list of what is still open. After day-end the business day is locked: no edits, no new orders on that day. |
| P1-SHIFT-07 | Z report generated and available to the owner (in-app; email in Phase 3). | M | |

## 11. Reports (M1.5)

All reports: date-range filter, on-screen view, export to **PDF and Excel**, permission-controlled. Cashiers see only their own shift.

| ID | Report | Pri |
|---|---|---|
| P1-RPT-01 | Daily sales summary — X (during day) and Z (day close) | M |
| P1-RPT-02 | Daily, weekly, monthly order summaries | M |
| P1-RPT-03 | Sales by order type | M |
| P1-RPT-04 | Sales by payment method | M |
| P1-RPT-05 | Cashier-wise sales and shift closing / cash balancing | M |
| P1-RPT-06 | Item-wise and category-wise sales (best / worst sellers) | M |
| P1-RPT-07 | Hourly sales (peak hours) | M |
| P1-RPT-08 | Discount report by type, cashier, approver, staff member, comment | M |
| P1-RPT-09 | Cancelled and voided orders with reason and prepared-food status | M |
| P1-RPT-10 | Custom items sold | M |
| P1-RPT-11 | Kitchen order summary per station with preparation times | M |
| P1-RPT-12 | Service charge and tax summary (tax 0.00) | M |
| P1-RPT-13 | Delivery-wise and rider-wise sales (incl. shortages) | M |
| P1-RPT-14 | Credit sales | M |

Acceptance for all: totals reconcile exactly with the underlying orders for a seeded test day; voided bills excluded from sales but included in the void report.

## 12. Non-functional (all milestones)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| P1-NFR-01 | Order save and KOT on screen within 3 s on a normal connection. | E2E timing on staging. |
| P1-NFR-02 | Works in current Chrome / Edge on PC, Android tablet; POS at 1366×768, KDS at 1280×800. | |
| P1-NFR-03 | HTTPS only; passwords and PINs hashed (bcrypt / argon2). | |
| P1-NFR-04 | Automatic daily database backup, copied off-site; restore tested before go-live. | Restore drill documented in `deploy/`. |
| P1-NFR-05 | Availability target 99.5%/month excluding planned maintenance after closing. | |
| P1-NFR-06 | English UI and printouts; LKR currency. | |
| P1-NFR-07 | All times shown in Asia/Colombo. | |

## 13. Not in Phase 1

Inventory and stock effects (Phase 2) · sales/profit dashboard, email/SMS notifications (Phase 3) · rider app, credit limits/settlements/statements, room booking (Phase 4) · HR and payroll (Phase 5) · kitchen printers ([ADR-003](../decisions/ADR-003-kitchen-screens-and-printing.md)) · tax (off) · offline mode (optional upgrade).
