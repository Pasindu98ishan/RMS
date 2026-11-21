# ADR-002: Bill calculation — service charge first, then discount, no tax

**Status:** Accepted · 2026-11-21 · Client decisions #2 and #2b

## Context
Annex A §3 says service charge and taxes apply automatically per order type; §4 defines the discount types but not the order in which charges and discounts are applied. The client confirmed: **no tax for now**, and **discount is applied after service charge**.

## Decision

### Order of calculation
```
line_amount      = qty × (unit_price + Σ modifier_prices)          for each non-cancelled line
subtotal         = Σ line_amount
service_charge   = round(subtotal × sc_rate[order_type])
gross            = subtotal + service_charge
discount         = bill-level:  round(gross × pct)          (or a fixed amount, owner only)
                   item-level:  round(line_amount × (1 + sc_rate) × pct)  for each selected line
tax              = 0   (engine present, rate 0, disabled in Admin)
total            = gross − discount + tax
```

### Worked example (dine-in, service charge 10%, staff discount 30% on the whole bill)
| | LKR |
|---|---|
| Items subtotal | 1,000.00 |
| Service charge 10% | 100.00 |
| Gross | 1,100.00 |
| Staff discount 30% (of 1,100.00) | −330.00 |
| **Total to pay** | **770.00** |

### Rules
- Service charge rate is set per order type in Admin (e.g. dine-in 10%, takeaway 0%, delivery 0%). Rate is copied onto the order when it is created; changing the setting does not change open orders.
- Rounding: each computed amount is rounded to 2 decimals, half-up. Totals are sums of rounded parts, so the printed bill always adds up.
- Only one discount per bill **or** per line (no stacking) unless the client asks otherwise. Owner discount may be a percentage (0–100%) or a fixed amount, never more than gross.
- Owner 100% discount gives a total of 0.00; the bill still gets a number and is reported.
- All amounts on the order are stored, not recomputed later: `subtotal`, `service_charge`, `discount_total`, `tax_total`, `total`, plus the rates used.
- The server is the only place totals are calculated. The POS may show a preview, but the saved values come from the server.
- Tax: the schema keeps `tax_rate` and `tax_total` columns and the Admin setting, so turning tax on later is a configuration change plus one ADR update (where tax sits in the order above must be confirmed then).

## Consequences
- The "Service charge and tax summary" report shows service charge and a tax column of 0.00.
- QA has one formula to test; the worked example becomes a fixed test case.
