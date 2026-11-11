/**
 * Places and distances.
 *
 * - UK postcode lookup: postcodes.io (free, no key). Always used to validate the postcode.
 * - Exact address pin: Google Geocoding API, when GOOGLE_MAPS_API_KEY is set.
 * - Road miles, drive time and the route line: Google Routes API, when GOOGLE_MAPS_API_KEY is set.
 *
 * Without the key everything falls back to the postcode centre and straight-line
 * miles x DISTANCE_ROAD_FACTOR (default 1), so the app keeps working.
 */
const TIMEOUT_MS = 5000;
const ROUTE_TIMEOUT_MS = 4000;
const ROAD_FACTOR = Number(process.env.DISTANCE_ROAD_FACTOR) > 0 ? Number(process.env.DISTANCE_ROAD_FACTOR) : 1;
const METRES_PER_MILE = 1609.344;

const googleKey = () => process.env.GOOGLE_MAPS_API_KEY || '';
const isGoogleEnabled = () => Boolean(googleKey());

/** A small in-memory cache with a size cap and optional expiry. */
function makeCache(maxEntries) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt && hit.expiresAt < Date.now()) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value, ttlMs) {
      if (map.size >= maxEntries) map.delete(map.keys().next().value);
      map.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
    },
    clear: () => map.clear(),
  };
}

const postcodeCache = makeCache(5000);
const addressCache = makeCache(5000);
const routeCache = makeCache(5000);

const normalise = (postcode) => String(postcode || '').replace(/\s+/g, '').toUpperCase();

/**
 * @returns {{status: 'ok', latitude: number, longitude: number} | {status: 'not_found'} | {status: 'unavailable'}}
 */
async function lookupPostcode(postcode) {
  const key = normalise(postcode);
  if (!key) return { status: 'not_found' };
  const cached = postcodeCache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) {
      const miss = { status: 'not_found' };
      postcodeCache.set(key, miss);
      return miss;
    }
    if (!res.ok) return { status: 'unavailable' };
    const body = await res.json();
    const hit = { status: 'ok', latitude: body.result.latitude, longitude: body.result.longitude };
    if (typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') return { status: 'not_found' };
    postcodeCache.set(key, hit);
    return hit;
  } catch {
    return { status: 'unavailable' };
  }
}

const toRad = (deg) => (deg * Math.PI) / 180;

function straightLineMiles(a, b) {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line delivery distance in miles (x DISTANCE_ROAD_FACTOR), to one decimal place. */
const deliveryMiles = (a, b) => Number((straightLineMiles(a, b) * ROAD_FACTOR).toFixed(1));

const formatPostcode = (postcode) => {
  const v = normalise(postcode);
  return v.length > 3 ? `${v.slice(0, -3)} ${v.slice(-3)}` : v;
};

// A Google answer further than this from the postcode centre is treated as a wrong match.
const MAX_PIN_DRIFT_MILES = 1.5;
const PRECISE_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED']);

async function googleGeocode(address, postcode) {
  const params = new URLSearchParams({
    address: `${address}, ${formatPostcode(postcode)}, UK`,
    components: `country:GB|postal_code:${formatPostcode(postcode)}`,
    region: 'uk',
    key: googleKey(),
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const body = await res.json();
  if (body.status === 'ZERO_RESULTS') return null;
  if (body.status !== 'OK') throw new Error(`Geocoding ${body.status}: ${body.error_message || ''}`);
  const best = body.results.find((r) => PRECISE_TYPES.has(r.geometry.location_type));
  if (!best) return null;
  return { latitude: best.geometry.location.lat, longitude: best.geometry.location.lng };
}

/**
 * Where a delivery address is.
 * The postcode is always checked (an unknown postcode is the user's to fix). With a
 * Google key the street address is pinned to the door; otherwise the postcode centre is used.
 *
 * @returns {{status: 'ok', latitude: number, longitude: number, precision: 'address'|'postcode'}
 *          | {status: 'not_found'} | {status: 'unavailable'}}
 */
async function locateAddress(address, postcode) {
  const area = await lookupPostcode(postcode);
  if (area.status === 'not_found') return area;
  const fallback = area.status === 'ok' ? { ...area, precision: 'postcode' } : area;

  const street = String(address || '').trim();
  if (!isGoogleEnabled() || !street) return fallback;

  const key = `${street.toLowerCase()}|${normalise(postcode)}`;
  const cached = addressCache.get(key);
  if (cached !== undefined) return cached || fallback;

  try {
    const pin = await googleGeocode(street, postcode);
    const sane = pin && (area.status !== 'ok' || straightLineMiles(area, pin) <= MAX_PIN_DRIFT_MILES);
    const hit = sane ? { status: 'ok', ...pin, precision: 'address' } : null;
    addressCache.set(key, hit);
    return hit || fallback;
  } catch (err) {
    console.error(`Address lookup failed, using the postcode: ${err.message}`);
    return fallback;
  }
}

const latLng = (p) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } });
const roundKey = (p, places) => `${p.latitude.toFixed(places)},${p.longitude.toFixed(places)}`;

/**
 * A driving route through `points` (in order) from the Google Routes API.
 * @param {{traffic?: boolean, cacheSeconds?: number, keyPlaces?: number}} options
 *   traffic: use live traffic (for ETAs); pricing uses traffic-free distances so fees stay stable.
 *   keyPlaces: coordinate rounding for the cache (4 ~ 11 m, 3 ~ 110 m).
 * @returns {Promise<{miles: number, minutes: number, polyline: string} | null>} null when unavailable.
 */
async function drivingRoute(points, { traffic = false, cacheSeconds = 86400, keyPlaces = 4 } = {}) {
  const stops = points.filter(Boolean);
  if (!isGoogleEnabled() || stops.length < 2 || stops.length > 27) return null;

  const key = `${traffic ? 't' : 'n'}|${stops.map((p, i) => roundKey(p, i === 0 ? keyPlaces : 4)).join('|')}`;
  const cached = routeCache.get(key);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googleKey(),
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      body: JSON.stringify({
        origin: latLng(stops[0]),
        destination: latLng(stops[stops.length - 1]),
        intermediates: stops.slice(1, -1).map(latLng),
        travelMode: 'DRIVE',
        routingPreference: traffic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
        regionCode: 'GB',
        units: 'IMPERIAL',
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Routes HTTP ${res.status}: ${detail.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    const route = (await res.json()).routes?.[0];
    const value = route
      ? {
          miles: Number((route.distanceMeters / METRES_PER_MILE).toFixed(1)),
          minutes: Math.max(1, Math.round(parseFloat(route.duration) / 60)),
          polyline: route.polyline?.encodedPolyline || '',
        }
      : null;
    routeCache.set(key, value, cacheSeconds * 1000);
    return value;
  } catch (err) {
    console.error(`Route lookup failed, using straight-line miles: ${err.message}`);
    // Do not hammer a failing API: remember the miss briefly.
    routeCache.set(key, null, 60_000);
    return null;
  }
}

/**
 * Delivery distance for pricing: road miles when Google is set up, otherwise straight-line
 * miles x DISTANCE_ROAD_FACTOR.
 * @returns {Promise<{miles: number, source: 'road' | 'straight'}>}
 */
async function deliveryDistance(from, to) {
  const route = await drivingRoute([from, to]);
  if (route) return { miles: route.miles, source: 'road' };
  return { miles: deliveryMiles(from, to), source: 'straight' };
}

module.exports = {
  lookupPostcode,
  locateAddress,
  drivingRoute,
  deliveryDistance,
  straightLineMiles,
  deliveryMiles,
  formatPostcode,
  isGoogleEnabled,
  _caches: { postcodeCache, addressCache, routeCache },
};
