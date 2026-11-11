# Setup: Google Maps, push notifications, background location

The code is done. Everything still works without these keys (postcode centres, straight-line
miles, no push, location only while the app is open). Each key below switches a feature on.

| Feature | What you create | Where it goes |
|---|---|---|
| Door-level address pins + road miles + live ETA + route line | Google **server** key (Geocoding API + Routes API) | Render: `GOOGLE_MAPS_API_KEY` |
| Map on Android phones | Google **Android** key (Maps SDK for Android) | EAS env: `GOOGLE_MAPS_ANDROID_API_KEY` |
| Push on iPhone | Apple **APNs key** (.p8) | EAS credentials |
| Push on Android | **Firebase** project: `google-services.json` + FCM V1 service-account JSON | EAS env file `GOOGLE_SERVICES_JSON` + EAS credentials |
| Background location | nothing to create — needs a new build + App Store / Play explanation | — |

---

## 1. Google Maps Platform (two keys)

Use the same Google Cloud project as the Gemini key (console.cloud.google.com → top project picker).
**Billing must be on** for Maps (Google gives a monthly free usage allowance per API).

1. **APIs & Services → Library** → enable: **Geocoding API**, **Routes API**, **Maps SDK for Android**.
2. **APIs & Services → Credentials → Create credentials → API key** — key 1, the **server key**:
   - Name: `intharoute-server`
   - API restrictions → *Restrict key* → tick **Geocoding API** and **Routes API** only.
   - Application restrictions: *None* (Render has no fixed IP on the free plan).
   - Put it on Render as `GOOGLE_MAPS_API_KEY` (and in `backend/.env` for local testing).
3. **Create credentials → API key** again — key 2, the **Android key**:
   - Name: `intharoute-android`
   - Application restrictions → **Android apps** → Add: package `com.intharoute.delivery` +
     SHA-1 fingerprint (get it with `npx eas-cli@latest credentials` → Android → production → keystore).
   - API restrictions → **Maps SDK for Android** only.
   - Save it as an EAS environment variable: expo.dev → project → **Environment variables** →
     `GOOGLE_MAPS_ANDROID_API_KEY`, visibility *Sensitive*, environments preview + production.
4. Set a **budget alert** (Billing → Budgets & alerts), e.g. £20/month.

Cost control already in the code: addresses and pricing routes are cached; a driver's live route is
re-asked at most every `ROUTE_REFRESH_SECONDS` (default 3 min) even though the app polls every 12 s.

iPhones keep using Apple Maps (free, no key).

---

## 2. Push notifications

The server sends through Expo's push service — **no server key is needed**. The phones need
Apple/Google credentials stored in the EAS project (`@umer.farooq/in-tha-route`).

### iPhone (APNs)
`eas.json` production uses `credentialsSource: local`, so EAS will not create the key by itself:
1. developer.apple.com → Certificates, IDs & Profiles → **Keys → +** → name `InThaRoute Push`,
   tick **Apple Push Notifications service (APNs)** → Continue → Register → **Download** the `.p8`
   (only downloadable once) and note the **Key ID**.
2. Identifiers → `com.in-tha-route.delivery` → make sure **Push Notifications** is ticked → Save.
   Regenerate/download the provisioning profile used in `credentials.json` (it must include push).
3. Upload the key: `npx eas-cli@latest credentials` → iOS → production → **Push Notifications: Add a push key** → choose the `.p8`.

### Android (Firebase Cloud Messaging V1)
1. console.firebase.google.com → **Add project** (can reuse the same Google Cloud project).
2. Project settings → **Add app → Android** → package `com.intharoute.delivery` → **download `google-services.json`**.
   - Local builds: put it at `mobile/google-services.json` (git-ignored).
   - EAS builds: expo.dev → project → Environment variables → **Add → type File** → name `GOOGLE_SERVICES_JSON`, upload the file.
3. Project settings → **Service accounts → Generate new private key** (a JSON file).
4. Upload it: `npx eas-cli@latest credentials` → Android → production → **Google Service Account → FCM V1** → upload the JSON.

### What gets notified
| Who | When |
|---|---|
| Platform driver | New batch offer (sent as soon as a restaurant posts an order, or another driver declines or does not answer within 2 min) |
| In-house driver | Restaurant gave them an order |
| Restaurant | Driver accepted · order picked up · order delivered |
| Driver / restaurant | New chat message while the app is not open |
| Platform driver | Documents approved / rejected |

Tapping a notification opens the right screen (chat opens that conversation).

---

## 3. Background location

Code and app config are done (`expo-location` + `expo-task-manager`). While a driver is online or on a
delivery, the app asks once for **"Allow all the time / Always"**; with it, the position keeps updating when
the phone is locked. Android shows a small "sharing your location" notification while it runs.

Before submitting the next store build:
- **App Store review**: in the review notes, explain *"Delivery drivers share their location in the background
  only while they are online or delivering, so restaurants see arrival times and nearby orders are offered.
  Location stops when the driver goes offline."* Apple may ask for a short screen recording.
- **Google Play**: Play Console → App content → **Location permissions** declaration, with the same reason and a
  short video. Background location is reviewed before release.

---

## 4. Testing — needs a new build

Push notifications, background location and the Android map key are **native**: they do not work in
Expo Go (Android) and background location does not work in Expo Go (iOS either). Build once:

```
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile preview --platform android
```

The rest of the app works as before in Expo Go and on the current TestFlight build.
