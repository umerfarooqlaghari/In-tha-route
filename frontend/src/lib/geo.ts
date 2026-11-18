import type { LatLng } from "./types";

/** Centre of the South-West London service area (Richmond, Twickenham, Isleworth…). */
export const AREA_CENTER: LatLng = { latitude: 51.4555, longitude: -0.329 };

const KNOWN: Record<string, LatLng> = {
  "TW9 1DT": { latitude: 51.4613, longitude: -0.3037 },
  "TW9 1BP": { latitude: 51.4632, longitude: -0.3011 },
  "TW7 7BG": { latitude: 51.4686, longitude: -0.3245 },
  "TW10 6QN": { latitude: 51.4566, longitude: -0.2951 },
  "TW1 1FF": { latitude: 51.4512, longitude: -0.3262 },
  "TW7 4NA": { latitude: 51.4721, longitude: -0.3405 },
  "TW2 7PR": { latitude: 51.4433, longitude: -0.3462 },
  "TW2 7EX": { latitude: 51.4489, longitude: -0.3489 },
  "TW4 5HT": { latitude: 51.4612, longitude: -0.3861 },
  "TW1 4HU": { latitude: 51.4469, longitude: -0.3292 },
  "TW11 0DQ": { latitude: 51.4271, longitude: -0.3336 },
};

/**
 * Where to put a pin: the coordinates the server sent, else a known postcode,
 * else a stable spot near the area centre (same fallback as the mobile app).
 */
export function pinFor(postcode: string, coords?: LatLng | null): LatLng {
  if (coords) return coords;
  const key = (postcode ?? "").trim().toUpperCase();
  if (KNOWN[key]) return KNOWN[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 1000;
  return {
    latitude: AREA_CENTER.latitude + ((hash % 40) - 20) / 1000,
    longitude: AREA_CENTER.longitude + ((Math.floor(hash / 40) % 40) - 20) / 1000,
  };
}
