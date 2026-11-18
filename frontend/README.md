# In Tha Route — Web portal

Next.js web portal for the platform team (Administrator) and, in a later phase, merchants.
It uses the same API as the mobile app (`backend/`), so the web panel and the app always show the same data.

## Pages

| Path | What it is |
| --- | --- |
| `/` | Welcome page: choose Administrator or Merchant |
| `/admin/login` | Administrator sign-in (admin accounts only) |
| `/admin` | Overview: revenue today, live map, fleet, charts, latest live orders |
| `/admin/orders` | Live orders: search, filters, receipt, move driver, cancel |
| `/admin/pricing` | Batch simulator, fees, extra miles, max batch, driver radius, pay per order |
| `/admin/drivers` | Platform driver approvals with document viewer; in-house drivers |
| `/admin/merchants` | Merchants and their delivery policy (Platform / Hybrid / Own) |
| `/merchant/login`, `/merchant/signup` | Merchant sign-in and sign-up (the merchant portal itself is the next phase) |

## Live sync with the app

The admin panel re-reads `GET /api/admin/dashboard` every 10 seconds while the tab is visible, straight away when the tab
regains focus, and after every change (each change endpoint also returns the fresh dashboard). The mobile app does the
same, so a change made on either side shows on the other within seconds. Open web tabs also notify each other at once.

## Running it

```bash
npm install
npm run dev
```

The API defaults to the live backend (`https://in-the-route-app.onrender.com`). To use a local backend:

```bash
NEXT_PUBLIC_API_URL=http://localhost:5000 npm run dev
```

Map tiles come from OpenStreetMap.
