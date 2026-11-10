/**
 * Real-world coordinates for the South West London demo area
 * (Richmond, Twickenham, Isleworth, Hounslow, Teddington).
 */
export interface LatLng {
  latitude: number;
  longitude: number;
}

const POSTCODE_COORDS: Record<string, LatLng> = {
  // Restaurants
  'TW9 1DT': { latitude: 51.4613, longitude: -0.3037 }, // Saffron — Richmond
  'TW9 1BP': { latitude: 51.4632, longitude: -0.3011 }, // Amorino — Richmond
  'TW7 7BG': { latitude: 51.4686, longitude: -0.3245 }, // Eat Presto — Isleworth

  // Customers
  'TW10 6QN': { latitude: 51.4566, longitude: -0.2951 },
  'TW1 1FF': { latitude: 51.4512, longitude: -0.3262 },
  'TW7 4NA': { latitude: 51.4721, longitude: -0.3405 },
  'TW2 7PR': { latitude: 51.4433, longitude: -0.3462 },
  'TW2 7EX': { latitude: 51.4489, longitude: -0.3489 },
  'TW4 5HT': { latitude: 51.4612, longitude: -0.3861 },
  'TW1 4HU': { latitude: 51.4469, longitude: -0.3292 },
  'TW11 0DQ': { latitude: 51.4271, longitude: -0.3336 },
};

export const AREA_CENTER: LatLng = { latitude: 51.4555, longitude: -0.3290 };

export const DRIVER_START: LatLng = { latitude: 51.4598, longitude: -0.3105 };

// Real coordinates sent by the API, keyed by postcode without spaces.
const liveCoords = new Map<string, LatLng>();
const compact = (postcode: string) => postcode.replace(/\s+/g, '').toUpperCase();

/** Remember where a postcode really is, so the maps place its pin correctly. */
export function registerPostcodeCoords(postcode: string | undefined, coords: LatLng | null | undefined) {
  if (postcode && coords) liveCoords.set(compact(postcode), coords);
}

export function coordsForPostcode(postcode: string): LatLng {
  const live = liveCoords.get(compact(postcode));
  if (live) return live;
  const key = postcode.trim().toUpperCase();
  if (POSTCODE_COORDS[key]) return POSTCODE_COORDS[key];
  // Deterministic fallback near the area centre for unknown postcodes
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 1000;
  return {
    latitude: AREA_CENTER.latitude + ((hash % 40) - 20) / 1000,
    longitude: AREA_CENTER.longitude + ((Math.floor(hash / 40) % 40) - 20) / 1000,
  };
}

