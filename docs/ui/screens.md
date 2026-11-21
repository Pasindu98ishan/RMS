# Screen inventory

Phase 1 screens in detail; later phases listed so routes and layouts are planned now. Requirement IDs refer to [`../requirements/phase-1-requirements.md`](../requirements/phase-1-requirements.md).

## Design rules
- **POS & KDS are touch-first:** targets ≥ 48 px, large type, no hover-only actions, no tiny dropdowns for frequent choices.
- **Status colours (used everywhere):** Free / New = grey · Occupied / Preparing = amber · Ready = green · Bill printed = blue · Overdue / Offline / Error = red. Never colour alone: always a label too.
- **Shared dialogs:** `PinPrompt` (approver + PIN), `ReasonDialog` (reason list + mandatory comment), `ConfirmDialog`, `MoneyInput` (LKR, 2 decimals), `DenominationCounter`.
- Server error `detail` text is shown as-is in a toast / inline.
- Target sizes: POS 1366×768, KDS 1280×800 landscape, admin works at 360 px wide.

## Phase 1

### Shared
| Route | Screen | Who | Reqs |
|---|---|---|---|
| `/login` | Login (username + password) | All | P1-AUTH-01 |
| `/setup/terminal` | Register this device as a terminal (owner login) | Owner | P1-AUTH-04 |
| — | Idle lock overlay → back to login | All POS/admin | P1-AUTH-03 |

### POS (`/pos`, PosLayout — header shows terminal, user, shift status, kitchen status dots, alerts bell)
| Route | Screen | Key elements | Reqs |
|---|---|---|---|
| `/pos/shift/open` | Open shift | Opening float | P1-SHIFT-01 |
| `/pos` | Home / floor | Table plan with live status colours; buttons New takeaway / New delivery / New credit; held orders; live order list with "Ready" badges | P1-DIN-04, P1-ORD-07 |
| `/pos/order/:id` | **Order screen** | Left: category tabs + item grid + search. Right: cart (lines, qty, modifiers, notes, status per line), order header (type, table/customer, price list), actions: Send to kitchen, Hold, Discount, Cancel line, Print bill, Pay | P1-ORD-*, P1-DIN-*, P1-TKW-*, P1-DEL-* |
| (dialog) | Modifier picker | Required groups enforced | P1-MENU-03 |
| (dialog) | Custom item | Description*, price*, station* | P1-ORD-05 |
| (dialog) | Customer lookup / quick-create | Phone search, name, address | P1-ORD-08, P1-CRD-01 |
| (dialog) | Table ops | Move / merge / split | P1-DIN-05 |
| (dialog) | Discount | Type → mandatory fields per type → PinPrompt if needed; whole bill or selected lines | P1-DISC-* |
| (dialog) | Cancel line / void bill / refund | Stage-aware: shows whether PIN needed, prepared? wastage/reusable | P1-CAN-* |
| `/pos/order/:id/pay` | Payment | Bill summary (ADR-002 breakdown), split bill, tenders (cash/card/bank), change due, Print receipt | P1-BILL-* |
| `/pos/delivery` | Delivery board | Ready / assigned / out / delivered columns; assign rider; settle cash | P1-DEL-* |
| `/pos/shift` | Shift panel | Petty cash in/out, X report, close shift | P1-SHIFT-02/03 |
| `/pos/shift/close` | Close shift | DenominationCounter, expected vs counted, card/bank confirm | P1-SHIFT-04 |
| (global) | Alerts | "Order ready" (sound), "Kitchen N offline" banner (sound), "Receipt not printed — retry" | P1-KDS-03/06, P1-BILL-05 |

### Kitchen (`/kitchen`, KitchenLayout — full screen, station name, clock, connection indicator)
| Route | Screen | Key elements | Reqs |
|---|---|---|---|
| `/kitchen` | **KDS board** | KOT cards oldest first: KOT no, order no, type, table/customer, ordering point, waiting timer (red past target), items + modifiers + notes, "other kitchens have the rest" note, big status button (Start → Ready → Handed over), undo 10 s; CANCELLED lines struck through; RESENT label; offline banner + auto-reconnect | P1-KOT-*, P1-KDS-* |
| `/kitchen/done` | Recently handed over | Last 2 hours, for checking | P1-KDS-02 |

### Admin (`/admin`, AdminLayout — responsive side menu)
| Route | Screen | Reqs |
|---|---|---|
| `/admin` | Phase 1 home: today's sales, open orders, kitchen status, alerts (full dashboard is Phase 3) | — |
| `/admin/users`, `/admin/roles` | Users (incl. PIN reset, unlock), role & permission editor | P1-RBAC-* |
| `/admin/terminals` | Terminals | P1-AUTH-04 |
| `/admin/menu/categories`, `/admin/menu/items`, `/admin/menu/modifiers` | Menu editor (local + foreign price, station mapping), modifier groups | P1-MENU-* |
| `/admin/kitchens` | Kitchen stations, target times | P1-MENU-07, P1-SET-05 |
| `/admin/floor` | Table / floor-plan editor (drag) | P1-FLOOR-01 |
| `/admin/settings` | Restaurant details, service charge per type, tax (off), business day, idle timeouts | P1-SET-01..04 |
| `/admin/discounts` | Discount rules | P1-SET-06, P1-DISC-* |
| `/admin/delivery-areas`, `/admin/riders` | Delivery areas + fees, simple rider list | P1-SET-07, P1-DEL-02 |
| `/admin/reasons` | Reason lists | P1-SET-08 |
| `/admin/import` | Spreadsheet import with validation report | P1-IMP-01 |
| `/admin/shifts` | Shifts awaiting approval, approve with note; day-end | P1-SHIFT-05/06 |
| `/admin/audit` | Audit log search | P1-AUD-03 |

### Reports (`/reports`)
| Route | Screen | Reqs |
|---|---|---|
| `/reports` | Report list (filtered by permission) | — |
| `/reports/:reportId` | Report viewer: date range + filters, table, totals, Export PDF / Excel | P1-RPT-01..14 |

## Later phases (planned routes)
| Phase | Routes |
|---|---|
| 2 | `/inventory/items`, `/inventory/suppliers`, `/inventory/grn`, `/inventory/recipes`, `/inventory/adjustments`, `/inventory/counts`, `/inventory/alerts`, `/display` (large screen) |
| 3 | `/admin` full owner dashboard, `/reports/sales-dashboard`, `/reports/profit`, notification settings |
| 4 | `/rider` (PWA: assigned / pool / history), `/pos/credit` (customers, settlements, statements), `/booking` (calendar day/week/month, booking form) |
| 5 | `/hr/employees`, `/hr/roster`, `/hr/attendance`, `/hr/overtime`, `/hr/payroll`, `/hr/devices` |
