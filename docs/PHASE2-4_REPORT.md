# Phases 2–4: Restaurant, Driver and Admin — backend + app integration

Status: implemented, **not yet tested** (testing deferred until requested). Nothing committed yet.

## How the app talks to the backend

- Each role loads one dashboard: `GET /api/restaurant|driver|admin/dashboard`.
- Every change endpoint returns `{ dashboard }`, so the screen updates from the server's answer.
- The app refreshes the dashboard every 12 s while open, and again when it returns to the foreground.
- Countdowns tick locally between refreshes, starting from the server's `remainingSeconds`.
- Money is visible by role: restaurants see fees only, drivers see their pay only, the admin sees everything.
- Access tokens renew automatically (`mobile/src/services/apiClient.ts`). If the session is rejected, the user is signed out.

## Phase 2 — Restaurant

| Screen | Backend |
|---|---|
| New order → **Scan receipt** (camera) / **Upload receipt** (photo library, new button under Scan) | `POST /api/restaurant/receipts/scan` → Gemini OCR → draft (nothing saved yet) |
| Confirm → Prep time → Post order | `POST /api/restaurant/orders` (postcode looked up on postcodes.io, distance and fee calculated on the server) |
| Live orders → Mark ready | `POST /api/restaurant/orders/:id/ready` |
| My drivers → Add driver | `POST /api/restaurant/drivers` (the sheet now asks for **Email** and **Password**, because the in-house driver signs in with them; no documents or approval needed) |
| Delivery settings | `PATCH /api/restaurant/policy`; the billing row shows the real platform fee |

The demo "Sample receipts" chips were removed, since receipts now come from the camera or photo library.

## Phase 3 — Driver (platform and in-house use the same screens)

- **Pending or rejected platform drivers** can sign in but only see **Documents** until the admin approves them.
- Documents: tap a document → take a photo or choose one → `POST /api/driver/documents/:id/upload`. If an admin rejected the driver, re-uploading sends them back for review.
- Online/Offline toggle → `PUT /api/driver/availability`.
- Batch offer → Accept / Decline / Picked up / Delivered / Find new orders → `POST /api/driver/batch/accept|decline|advance|next`.
- Batching: orders are grouped by ready time (`maxPrepTimeWindowMinutes`) and pickup distance (`maxPickupRadiusMiles`), up to `maxBatchSize`. Stops are all pickups first, then all drop-offs.
- Order pool → Add → `POST /api/driver/pool/:id/add`. The "+£" amount shown is calculated by the server for the next batch position.
- The Call button dials the restaurant at a pickup and the customer at a drop-off.
- Earnings (week chart, trips, online hours, rating, recent trips) come from real delivered orders.
- **Live location (GPS):** while a driver is online or on a run with the app open, the phone sends its position to `PUT /api/driver/location` (about every 15 s, or after moving 75 m).
  - The driver's map uses the real position.
  - With a position less than 10 minutes old, the driver is only offered pickups within `DRIVER_OFFER_RADIUS_MILES` (default 3). Without one, every open order is considered.
  - The offer card shows route miles and "~min" calculated by the server: the driver's position → the remaining stops, at a typical town speed for their vehicle, plus 3 minutes per stop.
  - "Finding orders" shows the real number of open orders in the pool.

## Phase 4 — Admin

- Overview: the Billed / Driver pay / Profit totals and the per-order margin come from the server. The map shows every online driver at their latest GPS position.
- Pricing: the steppers save through `PUT /api/admin/pricing`. The batch simulator and the "You keep" amounts come from the server's `pricingSummary`. Undelivered platform orders are re-priced when rates change.
- Drivers: **Approve** (only possible once every document is uploaded) and a new **Reject** button with a confirmation. Tapping a document opens the photo the driver uploaded.
- Restaurants: policy switch → `PATCH /api/admin/restaurants/:id/policy`.

### Pricing formula (same as the app had, now in `backend/src/services/pricing.service.js`)

```
own_driver → fee 0, pay 0
extraMiles   = max(0, distance − baseDistanceMiles)
fee          = round2(baseRestaurantCharge + extraMiles × extraMileRestaurantCharge)
step         = clamp(batchPosition − 1, 0, tiers − 1)
driverPay    = round2((steppedPayouts[step] ?? 2.20) + extraMiles × extraMileDriverPayout)
margin       = fee − driverPay
Simulator(n) : restaurantsPay = n × fee, driverEarns = sum(first n tiers), profit, driverShare
```

## Database

Migration `003_driver_location.sql` adds the driver's last GPS position. Migration `002_operations.sql` (applied automatically on Render because `AUTO_MIGRATE=true`) adds:
pricing_config, orders, batches, batch_declines, kyc_documents, files, driver_online_sessions, restaurant coordinates, driver rating/rejected status.

## External setup needed (you can do these later)

1. **Gemini API key (required for receipt scanning)**: create one at https://aistudio.google.com/apikey and add it on Render → web service → Environment:
   - `GEMINI_API_KEY=<key>`
   - optional `GEMINI_MODEL` (default `gemini-2.5-flash`)
   Until it is set, Scan and Upload receipt show "Receipt scanning is not set up yet".
2. **Postcode lookup**: postcodes.io, free with no key. Nothing to set up.
   - Optional `DISTANCE_ROAD_FACTOR` (e.g. `1.3`) to turn straight-line miles into road miles. The default is 1.
3. **File storage (AWS S3 or similar)**: optional for now. Document photos are currently stored in Postgres (max 6 MB each), which is fine for launch. When S3 is wanted, you will need a bucket, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `S3_BUCKET`. Only `backend/src/services/file.service.js` needs to change.
4. **New app build**: the camera and photo library use `expo-image-picker`, and GPS uses `expo-location`. Both are native modules. Make a new development build (`npx expo run:ios` or `eas build --profile development`). Expo Go also includes it, so Expo Go works for testing.
5. **Deploy**: push to GitHub → Render redeploys → migrations 002 and 003 run on start.
6. **Background location (later, optional)**: GPS is only sent while the app is open. Tracking with the app in the background needs a development build with background location enabled and App Store / Play Store justification.
