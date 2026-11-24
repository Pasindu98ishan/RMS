# RMS frontend

Vue 3 + TypeScript + Vite + Pinia + PrimeVue app for Santhula Hotel (POS, kitchen display, admin, rider PWA).
Types for the API are generated from the contract in `../docs/api` (never hand-written).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000, needs the backend on http://localhost:8080
npm run dev:mock   # http://localhost:3000, no backend: in-browser mock API (openapi-msw)
```

- The dev server uses **port 3000** by default (Windows reserves 5141-5640) and fails if it is taken. `/api` and `/ws`
  are proxied to `http://localhost:8080`.
- To run a second stack beside this one, set `RMS_FRONTEND_PORT` (dev server port, default `3000`) and
  `RMS_BACKEND_URL` (proxy target, default `http://localhost:8080`), in the shell or a `.env.local` file, e.g.
  `RMS_FRONTEND_PORT=3100 RMS_BACKEND_URL=http://localhost:8180 npm run dev`.
- `npm run dev`, `build`, `type-check` and `test` first run `npm run api:gen`, which bundles `../docs/api/openapi.yaml`
  and generates `src/api/generated/` (git-ignored).
- `VITE_USE_MOCKS=true npm run dev` is the same as `npm run dev:mock`.

### First use

Every device opens on the **login page** (ADR-008):

- **Owner, manager, HR, inventory, riders** (users with the "Sign in on any device" permission, `LOGIN_ANY_DEVICE`)
  just log in on their own phone or computer. That is a *personal session*: the header shows "Personal device";
  owner/manager land on `/admin`, riders on `/rider`, others on a simple home page. POS and kitchen screens are not
  available in a personal session.
- **Counter and kitchen devices** (cashier and reception PCs, kitchen tablets, the admin PC, displays) are registered
  once: on the login page press **Set up this device**, sign in with the owner account, name the terminal and choose
  what it is used for (kitchen screens also pick their station), then **Go to login**. From then on the login page
  shows the terminal name and everyone logs in there as a *terminal session*, landing by terminal type
  (Cashier/Reception POS -> `/pos`, Kitchen -> `/kitchen`, Admin -> `/admin`). Cashier, reception and kitchen users
  can only log in on a registered device.

With `dev:mock`, Terminal setup also shows a **Mock tools** panel to adopt a seeded terminal, and the seed users and
test password are in `src/mocks/seed.ts`. Mock data is kept in localStorage; `rmsMock.reset()` in the browser console
(or "Reset mock data") restores it.
## Checks

```bash
npm run lint && npm run type-check && npm run test
```
