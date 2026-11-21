# ADR-004: Weighted average cost, snapshotted on each sale

**Status:** Accepted (applies from Phase 2) · 2026-11-21

## Context
Phase 3 profit reports are "sales minus the cost of ingredients used" (proposal §3). GRN unit costs change from delivery to delivery, so the system needs one rule for the cost of stock consumed.

## Decision
- Each inventory item keeps a **weighted average unit cost**, recalculated on every GRN:
  `new_avg = (qty_on_hand × old_avg + grn_qty × grn_unit_cost) / (qty_on_hand + grn_qty)`.
  If on-hand stock is zero or negative, `new_avg = grn_unit_cost`.
- Every stock movement (sale, wastage, adjustment, manual consumption) stores the **unit cost at that moment**.
- Each sold order line stores its **ingredient cost snapshot** = Σ (BOM qty × current avg cost). Profit reports read these snapshots, so later GRNs never change past profit.
- Menu items without a recipe have cost 0 and are flagged in the profit report ("no recipe — cost unknown").

## Consequences
- Simple and good enough for a single restaurant; no FIFO batch tracking.
- Expiry is still tracked per GRN line for alerts, independent of costing.
- Phase 1 order lines get a nullable `cost_snapshot` column now, so Phase 2 doesn't need to backfill the schema.
