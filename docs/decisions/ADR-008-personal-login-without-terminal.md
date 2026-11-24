# ADR-008: Personal login without a terminal

**Status:** Accepted · 2026-11-24 · Amends [ADR-006](ADR-006-auth-and-terminals.md) decisions 1, 2 and 4 · Client decision #9

## Context
ADR-006 made every login require a registered terminal. In practice the owner (phone, home), managers, HR, inventory and riders (own phone) use personal devices. Registering each of those devices needs the owner's password typed into it, which is friction and spreads the owner's password. A terminal only adds value where the device itself matters: the cash drawer, receipt printer, shift and ordering point at a counter, and the station of a kitchen screen.

## Decision
1. **Two kinds of session.**
   - **Terminal session:** login from a registered device (`X-Terminal-Id` header + `deviceToken`), exactly as ADR-006. The access token carries `tid`.
   - **Personal session:** login with username and password only, no terminal header or device token. The access token has **no** `tid`.
2. **Who may start a personal session:** users holding the new permission **`LOGIN_ANY_DEVICE`**. Seeded grants: Owner, Manager, Rider, Inventory, HR. Not granted: Cashier, Reception, Kitchen (they work only at counters and kitchen screens). Roles stay editable, so the owner can change this.
   - A user without it who logs in without a terminal gets **403 `TERMINAL_REQUIRED_FOR_USER`** ("This account can only sign in on a registered counter or kitchen device"). This failure does not count towards the account lock (the password was right).
   - Wrong password without a terminal counts towards the lock exactly as before (P1-AUTH-01).
3. **Which actions need a terminal session:** an operation marked `x-terminal: REQUIRED` in the contract returns **403 `TERMINAL_REQUIRED`** in a personal session. In M1.0/M1.1 no operation is marked. From M1.2 on, orders, payments, bills, shifts, petty cash, cash drawer, receipt printing and the kitchen-screen operations are marked. Everything else (admin, menu, floor, reports, settings, audit, HR, inventory, rider app) works in either session. The permission check still applies on top.
4. **Header check:** in a terminal session `X-Terminal-Id` must match `tid` (unchanged, 403 `TERMINAL_MISMATCH`). In a personal session the header must be absent; if present, 403 `TERMINAL_MISMATCH`.
5. **Refresh tokens:** a personal session's refresh tokens have no terminal. Same 15 min access / 12 h sliding refresh, same single-use rotation and session (`sid`) rules as ADR-006 #4 and #11. Refreshing re-checks that the user still holds `LOGIN_ANY_DEVICE`; if not, 403 and the session ends.
6. **Idle logout:** personal sessions use a new setting **`idleTimeoutPersonalMinutes`** (default 30). Kitchen and display exemptions are unchanged.
7. **Audit:** personal-session records have no terminal id; the audit row stores **`client_info`** (IP address and a trimmed User-Agent) instead. Terminal sessions also store it. `AuthSession` tells the client which kind of session it is (`sessionType`: `TERMINAL` or `PERSONAL`).
8. **Terminal registration is unchanged** (inline owner credentials, per-IP 429). It is reached from a "Set up this device" link on the login page, not as the first screen.
9. **First screen is the login page.** A registered device shows its terminal name on the login page and logs in as a terminal session; an unregistered device logs in as a personal session.
10. **Landing after login:** terminal session → by terminal type (unchanged). Personal session → `/admin` if the user holds any admin permission, otherwise `/rider` for riders, otherwise a simple home page. POS and kitchen routes need a terminal session; the frontend shows "Use a registered counter device" instead of the screen.

### Clarifications (lead, QA Q39-Q41, 2026-11-24)
- **Q39:** a login refused with `TERMINAL_REQUIRED_FOR_USER` had the correct password, so it resets the failed-attempt counter like any correct password check; it never counts or locks.
- **Q40:** after a refresh is refused because `LOGIN_ANY_DEVICE` was removed, the refresh token is revoked (the session ends) but the access token already issued stays valid until it expires (at most 15 min), as in ADR-006 #11.
- **Q41:** a refresh refused only because `X-Terminal-Id` does not match the session kind is a malformed request, not theft: the refresh token is NOT revoked. Rotation-based reuse detection is unchanged.

## Consequences
- Owner access from anywhere is now possible, so the owner account is internet-facing with password + lockout only. Recommended later: SMS one-time code for owner and manager personal logins (depends on client decision #6, SMS provider).
- P1-AUTH-04 is amended: "Every order, payment and audit record stores the terminal id" holds because those operations require a terminal session; other audit rows may have no terminal but always have `client_info`.
- QA's permission matrix adds a session-type dimension: each `x-terminal: REQUIRED` operation is also tested in a personal session (403 `TERMINAL_REQUIRED`), and login is tested with and without a terminal per role.
