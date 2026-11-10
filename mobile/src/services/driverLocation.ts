import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';

import type { LatLng } from '@/constants/geo';
import { api } from '@/services/apiClient';

// Send a new position at most this often, or sooner after moving this far.
const SEND_EVERY_MS = 15_000;
const SEND_AFTER_METRES = 75;

const metresBetween = (a: LatLng, b: LatLng) => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

/**
 * Follows the driver's GPS position while `active` (online or on a run, app open)
 * and reports it to the server, which uses it for nearby offers and the admin map.
 * Returns the latest position, or null if location is off or not allowed.
 */
export function useDriverLocation(active: boolean): LatLng | null {
  const [position, setPosition] = useState<LatLng | null>(null);
  const lastSent = useRef<{ at: number; where: LatLng } | null>(null);
  const askedForSettings = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    const send = (where: LatLng) => {
      const prev = lastSent.current;
      const due =
        !prev || Date.now() - prev.at >= SEND_EVERY_MS || metresBetween(prev.where, where) >= SEND_AFTER_METRES;
      if (!due) return;
      lastSent.current = { at: Date.now(), where };
      // Best effort: a missed update is replaced by the next one.
      api('PUT', '/api/driver/location', where).catch(() => {});
    };

    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!permission.granted) {
          if (!askedForSettings.current) {
            askedForSettings.current = true;
            Alert.alert(
              'Location is off',
              'Allow location access so you get offers near you and restaurants can see you on the map.',
              [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ]
            );
          }
          return;
        }
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 10_000, distanceInterval: 25 },
          (fix) => {
            const where = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
            setPosition(where);
            send(where);
          }
        );
        if (cancelled) subscription.remove();
      } catch {
        // Location services unavailable (e.g. turned off): carry on without a position.
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [active]);

  return position;
}
