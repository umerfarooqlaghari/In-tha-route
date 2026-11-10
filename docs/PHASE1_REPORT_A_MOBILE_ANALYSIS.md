# Phase 1 · Report A — Complete Mobile Application Analysis

Source: every file under `mobile/src` (10 source files, ~4,600 lines), read in full.
Nothing in this report is taken from the web portal or from assumptions; where the
product spec (`PROJECT_CONTEXT.md`) says something the mobile UI does not show, it is
called out explicitly as "spec only".

---

## 1. Headline findings

| # | Finding | Why it matters |
|---|---------|----------------|
| 1 | The app has **3 roles**: `restaurant`, `driver`, `admin`. | Defined in `UserRole` (`context/InThaRouteContext.tsx:3`). |
| 2 | `driver` has **2 sub-types**: `platform_contracted` and `restaurant_own`. | Same screens, different onboarding and order eligibility. They are a driver *type*, not separate roles. |
| 3 | **There is no signup screen for any role.** | The only auth UI is `LoginScreen.tsx`. Signup fields in Phase 1 are derived from the data models the UI already displays (see §6). |
| 4 | **Login is a demo.** Email is read-only and pre-filled per role, the password is pre-filled with `demo-password` and never checked, and sign-in is a 600 ms timer. | The login screen asks the user to pick a role first. The real backend must ignore that and read the role from the database. |
| 5 | **Everything is mock data held in React state.** No network calls, no storage, no camera, no file picker, no GPS. | Every feature below needs a backend API in a later phase. |
| 6 | The app is a **single route** (`src/app/index.tsx`). "Screens" are switched by an `activeScreen` string in context, via a side drawer. | No nested navigators, no tabs, no deep links. |
| 7 | The drawer contains a **"DEMO · SWITCH VIEW"** role switcher that lets any logged-in user become any role. | Must be removed (or hidden) when real auth is wired, otherwise it bypasses RBAC in the UI. |

---

## 2. App structure and navigation

```
src/app/_layout.tsx      Root: SafeAreaProvider > InThaRouteProvider > Stack (one screen, no header)
src/app/index.tsx        Not logged in -> LoginScreen
                         Logged in     -> AppHeader + (RestaurantView | DriverView | AdminView)
```

**Global chrome (all roles)** — `components/AppHeader.tsx`

- Header: menu button, current screen title, role label, avatar (opens drawer).
- Drawer: profile (name + org), the role's 4 navigation items, demo role switcher, **Log out**.

**Screen inventory (13 screens total)**

| Role | Drawer item | Screen key | Component |
|------|-------------|-----------|-----------|
| — | — | — | `LoginScreen` (role picker → sign-in form) |
| Restaurant | New order | `scan_receipt` | `NewOrderScreen` (4 steps: scan → confirm → prep → done) |
| Restaurant | Live orders | `live_orders` | `LiveOrdersScreen` |
| Restaurant | My drivers | `own_drivers` | `MyDriversScreen` (+ "Add driver" sheet) |
| Restaurant | Delivery settings | `dispatch_policy` | `DeliverySettingsScreen` |
| Driver | Drive | `live_route` | `DriveScreen` (5 states) |
| Driver | Order pool | `open_pool` | `OrderPoolScreen` |
| Driver | Earnings | `earnings` | `EarningsScreen` |
| Driver | Documents | `kyc_docs` | `DocumentsScreen` (+ document sheet) |
| Admin | Overview | `live_ledger` | `OverviewScreen` |
| Admin | Pricing | `pricing_algorithm` | `PricingScreen` |
| Admin | Drivers | `driver_kyc` | `DriversScreen` (Platform / In-house tabs) |
| Admin | Restaurants | `partner_restaurants` | `RestaurantsScreen` |

The first drawer item is each role's landing screen (its "dashboard").

---

## 3. Login screen (shared)

**Flow:** Welcome → choose *Restaurant* / *Driver* / *Admin* card → "{Role} sign in" form → Sign in.

| Field | Behaviour in the UI | Backend requirement |
|-------|--------------------|---------------------|
| Email | Read-only, pre-filled from `constants/personas.ts` | Required, valid email, case-insensitive |
| Password | Editable, masked, pre-filled `demo-password`, **not validated** | Required, verified against a hash |

Buttons: role cards (3), back arrow, **Sign in** (shows a loading state).
Note under the form: "Demo account — details are pre-filled."
There is no "Sign up", "Forgot password", or "Remember me" control.

---

## 4. Role-wise breakdown

### 4.1 Role: Restaurant

Demo persona: *Saffron Richmond · Restaurant staff · staff@saffronrichmond.co.uk*

**Dashboard — New order (`scan_receipt`)**: a 3-step wizard with a progress bar.

| Step | What the user sees and does |
|------|-----------------------------|
| 1 · Scan | Viewfinder frame, "Sample receipts" chips (4 hard-coded receipts), **Scan receipt** button (1.6 s fake scan). |
| 2 · Confirm | Mini map (pickup → drop-off), source badge, order id, distance; customer name + phone (read-only); editable **Delivery address**, **Postcode**, **Access code**; collapsible item list with total. Buttons: **Back**, **Continue**. |
| 3 · Prep time | "Ready in" chips: 10 / 15 / 20 / 30 / 40 min. "Who delivers?" toggle: *Platform driver* / *My driver*. If *My driver*: radio list of own drivers (or hint "Add a driver under My drivers first"). If *Platform driver*: shows delivery fee £5.00. Buttons: **Back**, **Post order** (disabled when *My driver* is chosen with no driver selected). |
| Done | "Order is live", order summary with live countdown. Buttons: **View live orders**, **Scan another receipt**. |

**Live orders (`live_orders`)**: map with restaurant and drop-off pins; stats (Active, Ready, Today); order cards sorted by time remaining, each showing source, order id, countdown pill (turns urgent under 3 min, "Ready" at 0), customer, address, status badge, assigned driver's first name, and a **Mark ready** button. Empty state has a **New order** button.

**My drivers (`own_drivers`)**: hint "In-house drivers don't need documents"; list of own drivers (name, vehicle, trip count, "Online" badge); **Add driver** opens a sheet.

**Delivery settings (`dispatch_policy`)**: three radio cards — *Platform drivers*, *Hybrid* (own first, then platform), *My drivers only*; a read-only Billing card (Platform delivery £5.00 per order, own drivers £0.00).

| Capability | Detail |
|-----------|--------|
| Can create | Orders (from a scanned receipt); own in-house drivers |
| Can view | Own live orders, countdowns, assigned driver, own drivers, own delivery policy, billing rates |
| Can edit | Delivery address / postcode / access code before posting; order status → ready; own delivery policy |
| Can delete | **Nothing** — no delete or cancel control exists for orders or drivers |
| Forms | *Confirm order*: delivery address, postcode (auto-capitals), access code. *Prep*: prep minutes (one of 5), dispatch type, own driver. *Add driver*: Full name (required — the only validation in the app), Phone (phone keypad, optional, saved as "—" if blank), Vehicle (Scooter / Car / E-Bike), Plate (optional, auto-capitals) |
| Workflows | Scan → confirm → set prep → post; mark order ready; add driver; change policy |
| Restrictions | Sees only its own restaurant (`activeRestaurantId`). Cannot see pricing config, other restaurants, or platform drivers' documents |
| Depends on | Driver (accepts / collects / delivers its orders); Admin (sets the fee it is charged, can override its policy) |
| Mock / placeholder | Receipt scanning (no camera, no OCR — picks a hard-coded template); distance (hard-coded per template); fee shown as a literal `£5`; "Today" count is static; **Live orders is not filtered by restaurant** — it shows every restaurant's orders (demo bug); own-driver badge always "Online" |
| Future backend needs | Receipt upload + OCR, order create / list / status update, own-driver CRUD, restaurant policy read / update, real-time countdown and status push, geocoding and distance |

### 4.2 Role: Driver

Demo persona: *Gustavo Oliveira · Platform driver · gustavo.rider@intharoute.co.uk*

Two sub-types share these screens:

| | `platform_contracted` | `restaurant_own` |
|---|---|---|
| Created by | Self-registration (spec), approved by Admin | The restaurant, via "Add driver" |
| Documents | 5 KYC documents required | None ("No docs") |
| Orders | Open pool and multi-restaurant batches | Only orders from the employer restaurant |
| Paid by | Platform (stepped batch payout) | Restaurant, off-platform (£0 fee / payout in app) |

**Dashboard — Drive (`live_route`)**: full-screen map with a bottom sheet and an **Online / Offline** pill. The sheet has five states:

| State | Content and actions |
|-------|--------------------|
| Offline | "You're offline" + **Go online** |
| Offer | "New batch" badge, total payout, orders · miles · ETA, stop timeline (first 4 + "+N more"), **Decline** / **Accept** |
| Navigating | "Stop X of N", progress bar, Pick up / Drop off badge, source, order id, name and address, readiness countdown (pickup) or access code (drop-off), **Call** icon, **Navigate** icon (opens Apple Maps), **Picked up** / **Delivered** |
| Complete | "Batch complete", total earned, **Find new orders** |
| Searching | "Finding orders" pulse, **Order pool**, **Refresh** |

**Order pool (`open_pool`)**: map; "Your route X / max orders" bar; list of un-batched open-platform orders with incremental payout ("+£3.20"), restaurant, drop-off area, distance, readiness, and an **Add** button (disabled when the batch is full); toast with the result.

**Earnings (`earnings`)**: this week's total with a 7-day bar chart; stats (Trips, Online hours, Rating); "Batch pay" table (payout for 1st…Nth order — read-only view of the Admin's pricing); recent trips.

**Documents (`kyc_docs`)**: verification summary ("You're verified" / "Under review", X of 5 approved, progress bar); 5 required documents with status badges (Verified / Pending / Missing); tapping one opens a sheet with the current value and **Upload new photo**.

The five required documents: UK Driving Licence · National Insurance number · UK bank account & sort code · Hire & Reward vehicle insurance · Personal / Right-to-Work ID.

| Capability | Detail |
|-----------|--------|
| Can create | A batch membership (adding a pool order to own route); a document submission |
| Can view | Offered batch, own route and stops, pickup notes, customer address / access code, open order pool, own earnings and trips, payout table, own documents |
| Can edit | Own availability (online / offline); batch offer (accept / decline); stop progress (picked up / delivered); own documents (re-upload → status back to *pending*) |
| Can delete | **Nothing** (declining an offer releases the orders but deletes nothing) |
| Forms | None with text inputs. Document upload is a single button |
| Workflows | Go online → receive offer → accept → pick up each order → drop off each order → batch complete → earnings updated. Add pool orders up to the max batch size. Upload documents → wait for Admin approval |
| Restrictions | Sees only own batch, earnings and documents. Cannot change pricing. Batch capped at Admin's `maxBatchSize`. Pool lists only `open_platform` orders |
| Depends on | Restaurant (creates orders, marks ready); Admin (approves KYC, sets payouts and batch size) |
| Mock / placeholder | Driver identity hard-coded to `drv-gustavo`; one hard-coded batch id; no GPS (position jumps between stops); **Call** button does nothing; "Upload new photo" re-submits the existing value (no camera / file); weekly chart, Trips / Online / Rating stats and recent trips are static; ETA is a formula; an un-approved driver is **not** blocked from accepting orders |
| Future backend needs | Availability + live location, batch offer / accept / decline, stop progression, order-pool list and join, earnings ledger and trip history, KYC document upload and status, push notifications, masked calling |

### 4.3 Role: Admin

Demo persona: *Christian Bark · Owner · christian@intharoute.co.uk*

**Dashboard — Overview (`live_ledger`)**: map of restaurants, drop-offs and a driver with a legend; stats (Billed, Driver pay, Profit); a live-order ledger — per order: restaurant · order id, "£x in · £y out", margin, or "In-house driver / No fee".

**Pricing (`pricing_algorithm`)**:

| Control | Type | Range enforced by the UI |
|---------|------|--------------------------|
| Batch simulator — orders per run | Segmented 1…max batch | — (read-only calculator: restaurants pay / driver earns / profit) |
| Restaurant fee (per order) | Stepper ± £0.25 | £2.50 – £12.00 |
| Max batch (orders per run) | Stepper ± 1 | 1 – 5 |
| Driver pay for 1st…Nth order | Stepper ± £0.10 each | £1.00 – £8.00 |

Changing any rate immediately recalculates fees and payouts on all live orders.

**Drivers (`driver_kyc`)**: tabs *Platform · n* / *In-house · n*. Platform driver cards show name, vehicle, plate, Active / Pending badge, "X of 5 documents" (expandable list with per-document status) and an **Approve driver** button for pending drivers (marks all documents verified and the driver approved). The in-house tab is a read-only list (name, employer restaurant, "No docs").

**Restaurants (`partner_restaurants`)**: a card per restaurant (name, area, postcode, live count, completed today) with a Platform / Hybrid / Own policy selector.

| Capability | Detail |
|-----------|--------|
| Can create | **Nothing in the mobile UI** — no "add restaurant" or "add driver" control |
| Can view | All live orders and their financials, all restaurants, all drivers of both types, every platform driver's document status, pricing configuration |
| Can edit | Pricing configuration; a platform driver's approval; any restaurant's delivery policy |
| Can delete | **Nothing** — no reject, suspend, or remove control |
| Forms | None with text inputs — only steppers and segmented controls |
| Workflows | Monitor live operations and margin; tune pricing; review and approve driver KYC; set restaurant policy |
| Restrictions | None within the app (full visibility). Cannot act as a driver or post orders |
| Depends on | Restaurant and Driver activity supplies everything it monitors |
| Mock / placeholder | Single static driver pin; totals are computed from in-memory orders only; approval is all-or-nothing (no per-document decision, no reject); `extraMile…`, `maxPrepTimeWindowMinutes`, `maxPickupRadiusMiles`, `baseDistanceMiles` exist in the config model but have **no UI control** |
| Future backend needs | Pricing config read / update with audit, driver list + KYC review + approve, restaurant list + policy update, live operations feed, financial ledger |

Admin registration: there is no admin signup in the UI, and the spec names a single owner. Admin accounts are created only by the backend seeder.

---

## 5. Cross-role features

**Shared by all roles:** login, header, drawer, logout, the live map component, the order model, the pricing formula (`calculateOrderFinancials`).

**Features that need more than one role**

| Feature | Roles | Interaction |
|---------|-------|-------------|
| Order lifecycle | Restaurant → Driver → (Admin watches) | `preparing` → `batched_offered` → `driver_assigned` → `ready_for_pickup` → `picked_up` → `delivered` |
| Prep countdown | Restaurant, Driver, Admin | Set by restaurant, shown to driver at pickup and to restaurant on live orders |
| Own-driver dispatch | Restaurant ↔ own Driver | Restaurant creates the driver and assigns orders directly; no fee |
| Platform batching | Restaurant, Driver, Admin | Admin's max batch + stepped payouts decide what the driver is offered and paid |
| Driver KYC | Driver ↔ Admin | Driver uploads; Admin approves |
| Delivery policy | Restaurant, Admin | Either can change a restaurant's policy |
| Pricing | Admin → Restaurant, Driver | Admin sets; restaurant sees the fee, driver sees the payout table |

**Status values in the UI that nothing ever sets:** `picked_up` (the driver flow jumps from assigned to delivered), document status `missing`, driver status `offline`.

---

## 6. Permission matrix (as implied by the UI)

| Action | Restaurant | Driver | Admin |
|--------|:---------:|:------:|:-----:|
| Create order | ✅ own | — | — |
| View orders | own | own batch + open pool | all |
| Mark order ready | ✅ own | — | — |
| Accept / decline / progress a batch | — | ✅ own | — |
| Add in-house driver | ✅ own | — | — |
| View drivers | own in-house | self | all |
| Upload KYC document | — | ✅ self (platform) | — |
| Approve driver | — | — | ✅ |
| Change delivery policy | ✅ own | — | ✅ any |
| View / change pricing | fee only (read) | payout table (read) | ✅ full |
| View financial ledger | — | own earnings | ✅ all |

---

## 7. Registration fields (derived — there is no signup UI)

Because the mobile app has no signup screen, the Phase 1 signup API takes the fields the
UI already stores and displays for each role. No field below is invented; each maps to a
property in `InThaRouteContext.tsx`.

| Role | Field | Source in the UI | Validation chosen |
|------|-------|------------------|-------------------|
| all | `email` | Login form, `Persona.email` | valid email, unique, stored lower-case |
| all | `password` | Login form | 8–72 chars, at least one letter and one digit |
| all | `fullName` | `Persona.name`, `DriverProfile.name` | 2–100 chars |
| all | `phone` | `DriverProfile.phone`, `RestaurantPartner.phone` | UK number (`+44…` or `0…`) |
| restaurant | `restaurantName` | `RestaurantPartner.name` | 2–120 chars |
| restaurant | `address` | `RestaurantPartner.address` | 5–200 chars |
| restaurant | `postcode` | `RestaurantPartner.postcode` | UK postcode format |
| restaurant | `pickupSafetyNote` | `RestaurantPartner.pickupSafetyNote` | optional, ≤ 500 chars |
| driver | `vehicle` | `DriverProfile.vehicle` | one of `Motorcycle / Scooter`, `Car`, `E-Bike` |
| driver | `plateNumber` | `DriverProfile.plateNumber` | required unless vehicle is `E-Bike`; ≤ 20 chars |

Defaults set by the server, never by the client: restaurant `driverPolicy = open_platform`;
driver `driverType = platform_contracted`, `status = pending_kyc`.

**Open points for your decision** (they do not block Phase 1):

1. **In-house drivers have no login.** The "Add driver" form collects name, phone, vehicle and plate — no email or password — and the demo invents an address like `name@inhouse.local`. The spec says "name, phone, login". Phase 2 needs to decide how they sign in (restaurant sets a password, or an invite / SMS code). They are not publicly registrable in Phase 1.
2. **A signup screen has to be added to the mobile app** before real users can register.
3. Should a pending (un-approved) platform driver be able to log in? Phase 1 allows it, because the Documents screen is where they upload KYC; the login response includes their status so the app can restrict the rest.

---

## 8. Preliminary backend roadmap

### 8.1 Entities

| Entity | Key fields (from the UI models) | Phase |
|--------|---------------------------------|:-----:|
| `users` | email, password hash, role, full name, phone, active flag | **1** |
| `restaurants` | owner user, name, address, postcode, phone, driver policy, pickup safety note, lat / lng | **1** (profile) |
| `driver_profiles` | user, driver type, employer restaurant, vehicle, plate, status, rating, completed deliveries | **1** (profile) |
| `refresh_tokens` | user, token hash, expiry, revoked | **1** |
| `kyc_documents` | driver, document type (5), value / file URL, status, reviewed by, timestamps | 2 |
| `orders` | restaurant, source, external id, customer name / phone / access code / direct phone, delivery address, postcode, instructions, pickup note, distance, prep minutes, ready-at, total, dispatch type, status, assigned driver, batch, batch position, restaurant fee, driver payout | 3 |
| `order_items` | order, quantity, name, price | 3 |
| `receipt_scans` | restaurant, image URL, raw OCR JSON, resulting order | 3 |
| `batches` | driver, status (offered / accepted / declined / completed), totals | 4 |
| `batch_stops` | batch, order, type (pickup / drop-off), sequence, completed-at | 4 |
| `driver_availability` / `driver_locations` | driver, online flag, lat / lng, timestamp | 4 |
| `pricing_config` | base distance, base restaurant charge, extra-mile charge and payout, max batch size, stepped payouts[], prep-time window, pickup radius; versioned | 5 |
| `ledger_entries` | order, restaurant fee, driver payout, platform margin | 5 |
| `driver_payouts` / `restaurant_invoices` | period totals, status | 5 |

### 8.2 Relationships

```
users 1—1 restaurants          (role = restaurant)
users 1—1 driver_profiles      (role = driver)
restaurants 1—N driver_profiles  (employer, only for restaurant_own)
restaurants 1—N orders 1—N order_items
driver_profiles 1—N kyc_documents
driver_profiles 1—N batches 1—N batch_stops N—1 orders
orders N—1 batches (nullable), orders N—1 driver_profiles (assigned, nullable)
orders 1—1 ledger_entries
pricing_config — singleton, versioned; each order stores the fee and payout it was priced at
```

### 8.3 Future APIs and authorisation

| Module | Endpoints (indicative) | Allowed roles |
|--------|------------------------|---------------|
| Auth *(Phase 1)* | signup, login, refresh, logout, me | public / any authenticated |
| Restaurant profile & policy | GET / PATCH own restaurant; GET / PATCH any | restaurant (own), admin (any) |
| In-house drivers | POST / GET (PATCH / DELETE not in UI yet) | restaurant (own) |
| Driver KYC | GET own docs, POST upload; GET all, POST approve | driver (self); admin |
| Receipt scan | POST image → parsed order draft | restaurant |
| Orders | POST create, GET list, PATCH mark-ready | restaurant (own); admin read-all |
| Order pool | GET open orders, POST add to my batch | driver (approved platform) |
| Batches | GET current offer, POST accept / decline, POST stop complete | driver (self) |
| Availability / location | PUT online flag, POST location | driver (self) |
| Earnings | GET week summary, GET trips | driver (self) |
| Pricing | GET (limited view for restaurant / driver), PUT | admin write |
| Overview / ledger | GET live orders + totals, GET map feed | admin |
| Real-time | WebSocket channels for order status, countdowns, offers, locations | per role |

CRUD summary: the UI today only needs **Create + Read + Update**. No screen has a delete
action, so Delete endpoints should be added only when the UI gains one (likely: remove
in-house driver, cancel order, reject / suspend driver).

### 8.4 Module dependencies and suggested phase order

```
Phase 1  Auth + user / restaurant / driver profiles      (this phase)
Phase 2  Restaurant settings, in-house drivers, KYC      needs 1
Phase 3  Orders + receipt OCR + geocoding                needs 1, 2
Phase 4  Batching, driver flow, real-time                needs 3
Phase 5  Pricing config, ledger, earnings, admin views   needs 3, 4 (pricing formula needed by 3 — seed defaults early)
```
