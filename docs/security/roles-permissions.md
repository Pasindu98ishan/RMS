# Roles and permissions

Source: Annex A §2. The system checks **permissions**; roles are just default bundles. The owner can create custom roles (P1-RBAC-02). Seeded roles cannot be deleted, but their permissions can be edited.

Legend: ✅ granted · 🔑 can approve with PIN · `own` = only own records / own shift / own station · — not granted.

## Phase 1 permissions

| Permission code | Owner | Manager | Cashier | Reception | Kitchen | Rider | Inventory | HR |
|---|---|---|---|---|---|---|---|---|
| **Admin** | | | | | | | | |
| `USER_MANAGE` | ✅ | — | — | — | — | — | — | — |
| `ROLE_MANAGE` | ✅ | — | — | — | — | — | — | — |
| `TERMINAL_MANAGE` | ✅ | — | — | — | — | — | — | — |
| `SETTINGS_MANAGE` | ✅ | — | — | — | — | — | — | — |
| `AUDIT_VIEW` | ✅ | — | — | — | — | — | — | — |
| `MENU_MANAGE` (items, prices, modifiers, stations) | ✅ | — | — | — | — | — | — | — |
| `MENU_AVAILABILITY` (sold-out toggle) | ✅ | ✅ | ✅ | — | — | — | — | — |
| `FLOOR_MANAGE` | ✅ | ✅ | — | — | — | — | — | — |
| `DATA_IMPORT` | ✅ | — | — | — | — | — | — | — |
| **Orders** | | | | | | | | |
| `ORDER_CREATE` (all types) | ✅ | ✅ | ✅ | ✅ dine-in¹ | — | — | — | — |
| `ORDER_VIEW` | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| `ORDER_CUSTOM_ITEM` | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| `ORDER_TABLE_OPS` (move / merge / split) | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| `ORDER_PRICE_LIST_CHANGE_SENT` | ✅ 🔑 | ✅ 🔑 | — | — | — | — | — | — |
| `DELIVERY_MANAGE` (assign rider, settle) | ✅ | ✅ | ✅ | — | — | — | — | — |
| `CUSTOMER_MANAGE` | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| `RIDER_LIST_MANAGE` | ✅ | ✅ | — | — | — | — | — | — |
| **Billing** | | | | | | | | |
| `BILL_PAY` | ✅ | ✅ | ✅ | ✅¹ | — | — | — | — |
| `BILL_REPRINT` | ✅ | ✅ | ✅ | ✅¹ | — | — | — | — |
| `LINE_CANCEL_BEFORE_KOT` | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| `LINE_CANCEL_AFTER_KOT` | ✅ 🔑 | ✅ 🔑 | — | — | — | — | — | — |
| `REFUND` | ✅ 🔑 | ✅ 🔑 | — | — | — | — | — | — |
| `BILL_VOID` | ✅ 🔑 | ✅ 🔑 | — | — | — | — | — | — |
| **Discounts** | | | | | | | | |
| `DISCOUNT_STAFF` | ✅ | ✅ | ✅ | ✅¹ | — | — | — | — |
| `DISCOUNT_GOVERNMENT` | ✅ | ✅ | ✅ | ✅¹ | — | — | — | — |
| `DISCOUNT_OTHER_WITHIN_LIMIT` | ✅ | ✅ | ✅ | ✅¹ | — | — | — | — |
| `DISCOUNT_OTHER_ABOVE_LIMIT` | ✅ 🔑 | ✅ 🔑 | — | — | — | — | — | — |
| `DISCOUNT_OWNER` | ✅ 🔑 | — | — | — | — | — | — | — |
| `DISCOUNT_LIMIT_OVERRIDE` (staff monthly limit) | ✅ 🔑 | ✅ 🔑 | — | — | — | — | — | — |
| **Kitchen** | | | | | | | | |
| `KDS_OPERATE` | ✅ | ✅ | — | — | ✅ own | — | — | — |
| `KDS_VIEW_ALL` | ✅ | ✅ | ✅ (read) | — | — | — | — | — |
| **Shifts** | | | | | | | | |
| `SHIFT_OPERATE` (open, petty cash, X report, close) | ✅ | ✅ | ✅ own | ✅ own¹ | — | — | — | — |
| `SHIFT_APPROVE` | ✅ | ✅ | — | — | — | — | — | — |
| `DAY_END` | ✅ | ✅ | — | — | — | — | — | — |
| **Reports** | | | | | | | | |
| `REPORT_OWN_SHIFT` | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| `REPORT_POS_ALL` | ✅ | ✅ | — | — | — | — | — | — |
| `REPORT_EXPORT` | ✅ | ✅ | — | — | — | — | — | — |

¹ Receptionist billing is "if enabled" in Annex A §2 — granted by default, owner can remove it.

## Later phases (granted when built)
| Permission | Owner | Manager | Inventory | HR | Cashier | Reception | Rider |
|---|---|---|---|---|---|---|---|
| `INVENTORY_*` (GRN, suppliers, adjustments, counts, recipes) | ✅ | — | ✅ | — | — | — | — |
| `REPORT_INVENTORY` | ✅ | ✅ | ✅ | — | — | — | — |
| `REPORT_PROFIT`, `DASHBOARD_OWNER` | ✅ | — | — | — | — | — | — |
| `RIDER_APP` (own orders) | — | — | — | — | — | — | ✅ |
| `RIDER_REASSIGN`, `RIDER_APPROVE` | ✅ | ✅ | — | — | ✅ reassign | — | — |
| `CREDIT_LIMIT_OVERRIDE` | ✅ 🔑 | ✅ 🔑 | — | — | — | — | — |
| `CREDIT_SETTLE` | ✅ | ✅ | — | — | ✅ | ✅ | — |
| `BOOKING_MANAGE` | ✅ | ✅ | — | — | ✅ | ✅ | — |
| `HR_EMPLOYEES`, `HR_ATTENDANCE`, `HR_OT_APPROVE` | ✅ | — | — | ✅ | — | — | — |
| `HR_SALARY_VIEW`, `HR_PAYROLL_RUN` | ✅ | grant only | — | ✅ | — | — | — |

## Rules
- Every PIN approval stores the approver and appears in the audit log.
- Approver must hold the permission themselves; a cashier's PIN never approves anything.
- `own` scoping is enforced in queries (e.g. a cashier calling `/reports/cashier-sales?userId=<other>` gets 403).
- QA tests the full matrix: every permission × every seeded role (P1-RBAC-03).
