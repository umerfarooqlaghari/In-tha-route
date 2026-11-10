/**
 * UK postcode lookup (postcodes.io — free, no API key) and distance.
 * Distance is straight-line miles multiplied by DISTANCE_ROAD_FACTOR (default 1).
 */
const cache = new Map();
const TIMEOUT_MS = 5000;
const ROAD_FACTOR = Number(process.env.DISTANCE_ROAD_FACTOR) > 0 ? Number(process.env.DISTANCE_ROAD_FACTOR) : 1;

const normalise = (postcode) => String(postcode || '').replace(/\s+/g, '').toUpperCase();

/**
 * @returns {{status: 'ok', latitude: number, longitude: number} | {status: 'not_found'} | {status: 'unavailable'}}
 */
async function lookupPostcode(postcode) {
  const key = normalise(postcode);
  if (!key) return { status: 'not_found' };
  if (cache.has(key)) return cache.get(key);

  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) {
      const miss = { status: 'not_found' };
      cache.set(key, miss);
      return miss;
    }
    if (!res.ok) return { status: 'unavailable' };
    const body = await res.json();
    const hit = { status: 'ok', latitude: body.result.latitude, longitude: body.result.longitude };
    if (typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') return { status: 'not_found' };
    cache.set(key, hit);
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

/** Delivery distance in miles, to one decimal place. */
const deliveryMiles = (a, b) => Number((straightLineMiles(a, b) * ROAD_FACTOR).toFixed(1));

const formatPostcode = (postcode) => {
  const v = normalise(postcode);
  return v.length > 3 ? `${v.slice(0, -3)} ${v.slice(-3)}` : v;
};

module.exports = { lookupPostcode, straightLineMiles, deliveryMiles, formatPostcode };
