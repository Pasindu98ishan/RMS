# Client decisions log

Answers from the client to the open questions in `PLAN.md` §6. Every entry is dated. When a decision changes behaviour described in Annex A, the change is written here and in the relevant ADR in `decisions/`.

| # | Question | Answer | Date | Affects | ADR |
|---|---|---|---|---|---|
| 1 | Kitchen hardware: screen, printer or both per station? | **Screen only** (KDS per station). No kitchen printers. | 2026-11-21 | M1.3 | [ADR-003](decisions/ADR-003-kitchen-screens-and-printing.md) |
| 2 | Which taxes and rates? | **No tax for now.** Tax stays configurable in Admin, set to 0 and switched off. | 2026-11-21 | M1.4, reports | [ADR-002](decisions/ADR-002-bill-calculation.md) |
| 2b | Is a discount applied before or after service charge? | **After service charge.** Service charge is calculated on the item subtotal, then the discount is taken off subtotal + service charge. | 2026-11-21 | M1.4 | [ADR-002](decisions/ADR-002-bill-calculation.md) |
| 3 | Sinhala on receipts / KOTs? | **No.** English only. | 2026-11-21 | M1.3, print agent | [ADR-003](decisions/ADR-003-kitchen-screens-and-printing.md) |
| 4 | Delivery in Phase 1: cashier assigns riders and settles cash by hand until the rider app (Phase 4)? | **Pending** — client will answer later. | — | M1.2 | — |
| 5 | Fingerprint device model | **Pending** — not needed until Phase 5. | — | Phase 5 | — |
| 6 | SMS provider | Open | — | Phase 3 / 4 | — |
| 7 | Booking cancellation policy for advances | Open | — | Phase 4 | — |
| 8 | Dates for menu, recipes, tables, staff, supplier spreadsheets | Open | — | M1.1 data load, Phase 2 | — |
| 9 | Must every user log in from a registered terminal? | **No.** Owner, Manager, Rider, Inventory and HR log in from any device with username and password. Counter (POS) and kitchen devices stay registered terminals; cashier, reception and kitchen staff log in only there. Orders, payments, shifts and kitchen screens need a registered terminal. | 2026-11-24 | M1.0 auth, M1.2+ | [ADR-008](decisions/ADR-008-personal-login-without-terminal.md) |

## Working assumptions while answers are pending

- **#4 Delivery in Phase 1.** Phase 1 builds delivery orders (customer, phone, address, area) and a simple rider list so the cashier can assign a rider, mark the order delivered and settle the cash. This is the smallest version that still gives the Phase 1 delivery-wise and rider-wise reports the proposal lists. If the client answers differently, only M1.2 changes. The full rider app stays in Phase 4.
- **#5 Fingerprint.** Phase 5 designs an adapter interface so the device model can be plugged in once known.

## What changed from Annex A because of these answers

| Annex A text | Now |
|---|---|
| §5 "KDS and / or KOT printer per station", "LAN thermal printer as backup" | KDS screen only. No KOT printing, no printer redirect. |
| §5 "If a kitchen printer is offline, the POS warns the cashier and can redirect" | Replaced by: if a kitchen **screen** goes offline, the POS warns the cashier (station heartbeat). |
| §5 / §6 "CANCEL KOT", "REPRINT" | Shown on the kitchen screen as a cancelled line / re-sent ticket, not printed. Receipt reprints are still marked REPRINT. |
| §3 "Service charge and taxes applied automatically per order type" | Service charge only; tax rate 0 and disabled until the client asks. |
| §15 "Sinhala on receipts and KOTs if required" | English only. |
| P1-AUTH-04 "Unregistered browser can only reach login / terminal setup" (our reading of Annex A) | Users with `LOGIN_ANY_DEVICE` log in from any browser; only counter and kitchen work needs a registered terminal (#9). |
