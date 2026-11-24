# Run and test guide — M1.0 + M1.1

How to start the system on your machine and what to try. Written 2026-11-24.

## 1. Start

Three terminals (PowerShell), from `E:\RMS`:

```powershell
docker compose -f deploy/docker-compose.dev.yml up -d
```
Database on `localhost:15432` (database `rms`).

```powershell
cd backend
./mvnw spring-boot:run
```
Backend on http://localhost:8080 (profile `dev`). First start applies the migrations (V1–V7) and loads the sample data. Do not run `./mvnw verify` while this is running (Windows locks the jar).

```powershell
cd frontend
npm install
npm run dev
```
Frontend on http://localhost:3000. (Port 5173 does not work on this machine: Windows reserves 5141–5640.)

Restart the backend after pulling any change; it must be running before you open the frontend.

## 2. First use

Open http://localhost:3000. Every device starts at the **login page** (ADR-008).

**Owner, Manager, HR, Inventory, Rider:** just log in. No device setup needed (personal session). Owner and manager land on `/admin`, the rider on `/rider`.

**Cashier, Reception, Kitchen:** can only log in on a registered counter or kitchen device. To register one:
1. On the login page press **Set up this device**.
2. Sign in with the owner account, give the terminal a name, choose the type, press **Register this device**.
   - **Kitchen** needs a station (Kitchen 1 / 2 / 3).
   - **Cashier POS / Reception POS** can pick an ordering point.
3. Press **Go to login**. The login page now shows the terminal name; log in as the cashier/kitchen user. The terminal type decides where you land.

One browser profile = one device; use a private window or another browser to act as a second device.

## 3. Logins (dev only)

| User | Password | PIN | Role |
|---|---|---|---|
| `owner` | `owner-dev-pass` | 1234 | Owner |
| `manager1` | `dev-pass-1234` | 1234 | Manager |
| `cashier1` | `dev-pass-1234` | 1234 | Cashier |
| `reception1` | `dev-pass-1234` | 1234 | Reception |
| `kitchen1` | `dev-pass-1234` | 1234 | Kitchen |
| `rider1` | `dev-pass-1234` | 1234 | Rider |
| `inventory1` | `dev-pass-1234` | 1234 | Inventory |
| `hr1` | `dev-pass-1234` | 1234 | HR |

Five wrong passwords lock an account for 15 minutes. Who may log in without a registered device is the permission `LOGIN_ANY_DEVICE` (Admin → Roles); by default Owner, Manager, Rider, Inventory and HR have it.

## 4. Sample data (loaded automatically, never overwrites your edits)

- 3 kitchen stations: Rice & Curry (15 min), Grill (20 min), Juice & Dessert (8 min). Names and times are editable.
- 6 categories, 46 items (25 with a foreign price), 3 modifier groups (Spice level, Extras, Size).
- 12 tables: Indoor 1–8, Garden G1–G4.
- 3 delivery areas (Netolpitiya 150, Nearby 300, Far 500). Default reasons for every reason list.

## 5. What to try

**Admin (log in as `owner` or `manager1` on an Admin terminal)**
- **Menu → Items:** search and filter, create an item (code, one station, local price, optional foreign price, modifier groups), change a price (the audit log records it), deactivate an item.
- **Menu → Categories / Modifiers / Kitchens:** add and edit; change station target minutes.
- **Floor plan:** drag tables (mouse, touch or arrow keys), then **Save plan**. Add a table.
- **Delivery areas / Reasons:** add, edit, switch off.
- **Import:** download a template, edit it, press **Check file** (nothing is saved), then **Import**. Import categories and modifier groups before items. Try a file with a wrong price to see the row/column error report. A blank optional cell clears the value on re-import.
- **Settings:** the new Menu block (sold-out reset each day).
- **Terminals:** register a Kitchen terminal with a station.
- **Audit log:** see what you just did.

**Sold-out toggle (log in as `cashier1` on a Cashier terminal)**
- POS home links to the sold-out screen; tap items to mark them sold out. The cashier cannot open the item admin.

**Roles:** log in as `kitchen1`, `rider1`, `inventory1`, `hr1` and check they see none of the menu admin screens.

**Login rules:** on an unregistered browser, `cashier1` is refused with "only on a registered counter or kitchen device"; `owner` gets in. The audit log shows the browser/IP for every action, and the terminal when there is one.

## 6. Not built yet (don't be surprised)
Orders, table status, kitchen display, billing, shifts and reports are M1.2 onwards. The POS and kitchen screens are placeholders for now.

## 7. If something goes wrong
- **"Invalid CORS request" or a 403 on setup:** the backend only allows http://localhost:3000 and http://localhost:5173; restart the backend after changes.
- **Frontend won't start (EACCES):** the port is reserved or taken; use `RMS_FRONTEND_PORT=3000` and free that port.
- **Backend can't reach the database:** run the docker command above and check `docker ps`.
- **Need a clean database:** `docker compose -f deploy/docker-compose.dev.yml down -v`, then start again (this deletes all dev data and re-seeds).
- **Try the screens without the backend:** `npm run dev:mock` in `frontend` (in-browser mock data).

## 8. Feedback
Write what you find (screen, what you did, what you expected) in any form; I'll turn it into bug or change items. Note anything the client should decide.
