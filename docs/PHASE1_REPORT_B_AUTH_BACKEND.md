# Phase 1 · Report B — Authentication Backend Implementation

Stack (unchanged from the existing backend): Node.js, Express 4, PostgreSQL via `pg`, CommonJS.
Added: `bcryptjs`, `jsonwebtoken`, `zod`, `helmet`, `express-rate-limit`; dev-only `supertest`, `embedded-postgres`.

Scope: authentication only. No dashboard, order, KYC or pricing API was built. The mobile app was not modified.

---

## 1. Code layout

```
backend/
  src/
    app.js                      Express app (no listen) — used by server.js and tests
    server.js                   Starts the app; optional auto-migrate + admin seed
    config/db.js                pg pool                      (existing)
    config/env.js               JWT secret, token lifetimes, bcrypt cost
    constants/roles.js          ROLES, PUBLIC_SIGNUP_ROLES, VEHICLES
    db/migrate.js               Migration runner  (npm run migrate)
    db/migrations/001_auth.sql  Phase 1 schema
    db/seedAdmin.js             Admin seeder      (npm run seed:admin)
    validators/auth.validator.js  Per-role signup rules, login, refresh
    services/auth.service.js    signup / login / refresh / logout
    services/token.service.js   Access JWTs, refresh-token storage and rotation
    services/password.service.js  bcrypt hash / verify
    services/user.service.js    User lookup + public response shape
    controllers/auth.controller.js
    middleware/authenticate.js  Bearer token → req.user (role read from DB)
    middleware/authorize.js     authorize(...roles)
    middleware/validate.js, rateLimit.js, errorHandler.js
    routes/auth.routes.js       Mounted at /api/auth (with Swagger annotations)
  tests/auth.test.js            86 automated tests
  tests/helpers/testDb.js       Throwaway real PostgreSQL for tests
```

## 2. Database schema (`001_auth.sql`)

**users**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` |
| email | text, unique | must be lower-case (CHECK) |
| password_hash | text | bcrypt |
| role | text | CHECK in `restaurant`, `driver`, `admin` |
| full_name | text | |
| phone | text, nullable | null only for the seeded admin |
| is_active | boolean | default true; false blocks login and existing tokens |
| last_login_at, created_at, updated_at | timestamptz | |

**restaurants** — one per restaurant user

| Column | Notes |
|--------|-------|
| id uuid PK, owner_user_id uuid unique FK → users (cascade) | |
| name, address, postcode, phone | from signup |
| driver_policy | CHECK in `open_platform`, `own_drivers`, `hybrid`; default `open_platform` |
| pickup_safety_note | optional |

**driver_profiles** — one per driver user

| Column | Notes |
|--------|-------|
| id uuid PK, user_id uuid unique FK → users (cascade) | |
| driver_type | CHECK in `platform_contracted`, `restaurant_own`; signup always sets `platform_contracted` |
| employer_restaurant_id | FK → restaurants; must be null for platform drivers (CHECK) |
| vehicle | CHECK in `Motorcycle / Scooter`, `Car`, `E-Bike` |
| plate_number | nullable (E-Bike) |
| status | CHECK in `pending_kyc`, `approved_online`, `offline` (the mobile app's values); signup always sets `pending_kyc` |

**refresh_tokens** — id, user_id FK (cascade), token_hash (SHA-256, unique), expires_at, revoked_at, created_at.

**schema_migrations** — name, applied_at (maintained by the runner).

## 3. API

Base path `/api/auth`. Errors always look like:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed.",
             "details": [ { "field": "postcode", "message": "Enter a valid UK postcode." } ] } }
```

### 3.1 `POST /api/auth/signup` — one endpoint for all public roles

Common fields (both roles):

| Field | Rule |
|-------|------|
| `role` | `restaurant` or `driver`. `admin` → **403**. Anything else → 400. |
| `email` | valid email; trimmed and lower-cased; unique |
| `password` | 8–72 characters, at least one letter and one number |
| `fullName` | 2–100 characters |
| `phone` | UK number (`+44…` or `0…`); spaces and dashes are stripped |

Role-specific fields:

| Role | Field | Rule |
|------|-------|------|
| restaurant | `restaurantName` | 2–120 characters, required |
| restaurant | `address` | 5–200 characters, required |
| restaurant | `postcode` | UK postcode; stored as e.g. `TW9 1DT`, required |
| restaurant | `pickupSafetyNote` | optional, ≤ 500 characters |
| driver | `vehicle` | `Motorcycle / Scooter`, `Car` or `E-Bike`, required |
| driver | `plateNumber` | required unless vehicle is `E-Bike`; ≤ 20 characters, upper-cased |

Any other key in the body (`driverType`, `status`, `isActive`, `id`, …) is discarded.
User, profile and first refresh token are written in one transaction.

Example:

```bash
curl -X POST http://localhost:5000/api/auth/signup -H "Content-Type: application/json" -d '{
  "role": "driver", "email": "gustavo@example.com", "password": "Passw0rd123",
  "fullName": "Gustavo Oliveira", "phone": "+44 7841 902145",
  "vehicle": "Motorcycle / Scooter", "plateNumber": "LR23 KXM" }'
```

`201` response:

```json
{
  "user": {
    "id": "…", "email": "gustavo@example.com", "role": "driver",
    "fullName": "Gustavo Oliveira", "phone": "+447841902145", "isActive": true, "createdAt": "…",
    "driver": { "id": "…", "driverType": "platform_contracted", "employerRestaurantId": null,
                "vehicle": "Motorcycle / Scooter", "plateNumber": "LR23 KXM", "status": "pending_kyc" }
  },
  "tokens": { "accessToken": "…", "refreshToken": "…", "tokenType": "Bearer", "expiresIn": 900 }
}
```

A restaurant user gets a `restaurant` object instead of `driver`.
Status codes: `201`, `400` validation, `403` admin signup, `409` email already registered, `429` rate limited.

### 3.2 `POST /api/auth/login` — one endpoint for all roles

Body: `{ "email": "...", "password": "..." }`. Nothing else is read — a `role` in the body is ignored and the role in the response comes from the database.

Response `200`: same shape as signup.
Status codes: `400` validation, `401 INVALID_CREDENTIALS` (identical for unknown email and wrong password), `403 ACCOUNT_DISABLED`, `429`.

### 3.3 Session endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/refresh` `{ refreshToken }` | Returns a new access + refresh pair. Each refresh token works once. |
| `POST /api/auth/logout` `{ refreshToken }` | Revokes that refresh token. `204`. |
| `GET /api/auth/me` (Bearer token) | The signed-in user's profile. |

Interactive docs: `http://localhost:5000/swagger` (development only, as before).

## 4. Token and session management

- **Access token**: JWT (HS256), 15 minutes, sent as `Authorization: Bearer <token>`.
- **Refresh token**: random opaque string, 30 days, stored only as a SHA-256 hash.
- **Rotation**: refreshing revokes the old token and issues a new one. If an already-used refresh token is presented again, every session of that user is revoked (stolen-token defence).
- **Passwords**: bcrypt, cost 12. Passwords over 72 bytes are rejected rather than silently truncated.
- Login and signup are rate-limited to 30 requests per 15 minutes per IP.

## 5. Role-based access control

```js
const authenticate = require('./middleware/authenticate');
const authorize = require('./middleware/authorize');
const { ROLES } = require('./constants/roles');

router.get('/pricing', authenticate, authorize(ROLES.ADMIN), handler);
router.patch('/restaurant', authenticate, authorize(ROLES.RESTAURANT, ROLES.ADMIN), handler);
```

- `authenticate` verifies the token, then **loads the user from the database on every request**. `req.user.role` is the stored role, not the claim inside the token, so a role change or a disabled account takes effect immediately.
- `authorize(...roles)` returns `403 FORBIDDEN` when the stored role is not allowed, `401` when there is no user.
- In Phase 1 the only protected production route is `GET /api/auth/me`. The role guards are exercised by the test suite on test-only routes; they get real routes from Phase 2.

**Admin protection** — three layers:

1. The signup controller rejects `role: "admin"` with 403 before validation.
2. Only `restaurant` and `driver` have a signup schema; no other role string can reach the service.
3. The only code that inserts an admin is `src/db/seedAdmin.js`.

## 6. Admin seeder

`npm run seed:admin` reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` and creates the admin.
It is idempotent: if the admin already exists it is left untouched (the password is **not** reset).
It refuses a weak password and refuses to take over an email already registered under another role.

## 7. Environment configuration

| Variable | Required | Purpose |
|----------|:-------:|---------|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | **yes in production** | ≥ 32 random characters. In development a temporary one is generated per run. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | for seeding | Admin account |
| `AUTO_MIGRATE` | no | `true` = apply migrations (and seed the admin if its variables are set) on server start |
| `ACCESS_TOKEN_TTL_SECONDS` | no | default 900 |
| `REFRESH_TOKEN_TTL_DAYS` | no | default 30 |
| `BCRYPT_ROUNDS` | no | default 12 |
| `PORT`, `NODE_ENV` | no | as before |

`backend/.env.example` lists all of them.

## 8. Running, migrating and seeding

**Local**

```bash
cd backend
npm install
cp .env.example .env        # fill DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run migrate
npm run seed:admin
npm run dev                 # or: npm start
npm test
```

**Render** (the free plan has no shell, so the server migrates itself on start)

Add these environment variables to the web service **before** deploying this code — without
`JWT_SECRET` the server refuses to start in production:

```
JWT_SECRET      = <48+ random characters>
AUTO_MIGRATE    = true
ADMIN_EMAIL     = <owner's email>
ADMIN_PASSWORD  = <strong password>
ADMIN_NAME      = <owner's name>
```

Build and start commands stay `npm install` and `npm start`. Migrations take a database lock, so two instances starting together is safe.

## 9. Test results

Command: `npm test` (Node's built-in test runner + supertest, against a real PostgreSQL 18 server started for the run and deleted afterwards — not a mock).

```
ℹ tests 86
ℹ suites 10
ℹ pass 86
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

| Suite | Tests | What is covered |
|-------|:-----:|-----------------|
| migrations | 2 | Applies on an empty database; re-run is a no-op |
| admin seeder | 4 | Needs credentials; rejects weak password; hashes password; idempotent and does not reset the password |
| signup | 32 | Restaurant and driver success; hash stored, never the password; privileged fields ignored; E-Bike plate rule; **admin signup → 403 and no row**; 9 role-bypass variants (`"Admin"`, `"ADMIN"`, `" admin"`, arrays, objects, null…); duplicate email (case-insensitive) → 409; no partial rows after failure; 12 validation cases |
| login | 9 | All three roles; **client-supplied role ignored**; case-insensitive email; identical response for wrong password and unknown email; input type checks; SQL-injection string; last-login recorded; malformed JSON |
| access tokens | 7 | `/me` per role; missing / malformed header; wrong secret; `alg: none`; expired; refresh token used as access token; deleted user |
| role-based authorization | 22 | Full 3-role × 5-route matrix plus anonymous; **token claiming `admin` for a driver is still treated as a driver**; role change in the DB applies to already-issued tokens |
| refresh and logout | 6 | Rotation; single use; reuse revokes all sessions; stored hashed; unknown / expired; access token rejected as refresh token; logout |
| disabled accounts | 1 | Cannot log in, use an existing token, or refresh |
| database constraints | 2 | Unknown role, upper-case email and platform driver with employer rejected; deleting a user cascades |
| existing routes | 1 | `/`, `/api/health`, `/api/health/db`, 404 |

All 86 passed on the first full run; no fixes were needed after it. One test comment was corrected afterwards and the suite re-run (86 / 86).

In addition, an end-to-end run against a fresh database confirmed the real commands and server:
`npm run migrate` (applied, then "up to date"), `npm run seed:admin` (created, then "left unchanged"),
server start with `AUTO_MIGRATE=true` in production mode, admin login → 200 with role `admin`
(while sending `role: "driver"`), `/api/auth/me` → 200, admin signup → 403, `/swagger` → 404 in production.

**Not tested:** the deployed Render service and the Render database — this code has not been pushed or deployed.

## 10. Remaining issues and open points

1. **Not deployed.** The Render database still has no tables. Set the variables in §8 first, then push.
2. **The mobile app has no signup screen** and its login is still the demo. Wiring the app to these APIs (and removing the demo role switcher) is separate work.
3. **In-house (restaurant-own) drivers cannot log in yet.** The app's "Add driver" form has no email or password. The schema supports them (`driver_type = restaurant_own` + `employer_restaurant_id`); how they get credentials is a Phase 2 decision.
4. **No forgot-password or email verification** — the UI has neither, so neither was built.
5. **Pending drivers can log in** (they need the Documents screen). The login response carries `driver.status` so later phases can restrict what an un-approved driver may do.
6. **Signup fields are derived, not copied from a screen** (Report A §7). If the eventual signup screen differs, the validators are the only place to change.
7. **Driver `status` mixes approval and availability** (`pending_kyc` / `approved_online` / `offline`), exactly as the mobile model does. Phase 4 should split availability into its own field.
8. **`npm test` needs the embedded PostgreSQL package's install script to run.** On this machine npm blocks install scripts, so it was run once by hand: `cd node_modules/@embedded-postgres/darwin-arm64 && node scripts/hydrate-symlinks.js`. On a default npm setup it runs automatically.
9. CORS is still open to all origins (unchanged from before); tighten when the web portal's domain is known.
