# ADR-003: Kitchen screens only; print agent for receipts

**Status:** Accepted · 2026-11-21 · Client decisions #1 and #3

## Context
Annex A §5 allows a kitchen display (KDS) and / or a KOT printer per station. The client chose **screens only**, and **English only** on printed output. Receipts (80 mm) and cash drawers at the two POS terminals (cashier and reception) are still required (Annex A §3, proposal §2).

## Decision

### Kitchen
- Each of the 3 stations has one KDS (10–15" tablet or touch screen) running the kitchen route in a browser / installed PWA, logged in as that station.
- KOTs reach the station only over WebSocket. There is no KOT printing and no printer redirect.
- **Station heartbeat:** each KDS sends a heartbeat every 10 s. If a station misses 3 heartbeats (30 s) the POS shows a red "Kitchen N offline" banner with a sound, so the cashier can tell the kitchen verbally. When the KDS reconnects it reloads all open tickets for its station, so nothing sent while it was offline is lost.
- Cancelled lines appear on the KDS struck through with a CANCELLED label and an alert; a re-sent ticket is labelled RESENT.

### Receipts and cash drawer
- The **print agent** stays, but only for receipts: a small Java service on each POS PC that subscribes to its terminal's print queue over WebSocket and sends ESC/POS to the receipt printer (USB or LAN), including the cash-drawer kick command on cash payments.
- Why not plain browser printing: browser print shows a dialog unless Chrome runs in kiosk-printing mode, cannot reliably open the cash drawer, and layout differs between drivers. ESC/POS gives silent, consistent 80 mm output.
- Print jobs carry a UUID; the agent ignores a job id it has already printed (no duplicates after reconnect). Failed jobs are reported back so the POS can show "Receipt not printed — retry".
- English only, so the agent uses the printer's built-in text mode; no image/raster rendering of text.

## Consequences
- Kitchen screens become critical hardware: recommend one spare tablet on site.
- Annex A features dropped: KOT printing, kitchen printer offline/redirect. Added: KDS offline warning at POS.
- The print agent is smaller than in the proposal (receipts only) and is installed on both POS PCs.
