import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { Brand } from '@/constants/brand';
import type { LatLng } from '@/constants/geo';
import { api } from '@/services/apiClient';

// Send a new position at most this often, or sooner after moving this far.
const SEND_EVERY_MS = 15_000;
const SEND_AFTER_METRES = 75;

/** Background task that keeps reporting the position while the phone is locked or the app is in the background. */
export const BACKGROUND_LOCATION_TASK = 'itr-driver-location';

const metresBetween = (a: LatLng, b: LatLng) => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

// Shared by the on-screen watcher and the background task, so a position is never sent twice.
let lastSent: { at: number; where: LatLng } | null = null;

function report(where: LatLng) {
  const due =
    !lastSent || Date.now() - lastSent.at >= SEND_EVERY_MS || metresBetween(lastSent.where, where) >= SEND_AFTER_METRES;
  if (!due) return;
  lastSent = { at: Date.now(), where };
  // Best effort: a missed update is replaced by the next one. Without a signed-in
  // session (e.g. after sign-out) the call fails quietly.
  api('PUT', '/api/driver/location', where).catch(() => {});
}

// Must be defined when the app starts (the root layout imports this module), so the OS can
// deliver positions to it while the app is in the background. Expo Go on Android has no
// TaskManager: there the app simply reports while it is open.
try {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const fix = data.locations[data.locations.length - 1];
    report({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
  });
} catch {
  // Background tasks are not available in this build.
}

async function stopBackgroundUpdates() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {
    // Not running, or not supported in this build.
  }
}

async function startBackgroundUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) return;
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: SEND_EVERY_MS,
    distanceInterval: 50,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'In Tha Route is sharing your location',
      notificationBody: 'Only while you are online or on a delivery.',
      notificationColor: Brand.colors.primary,
    },
  });
}

/** Asks for "Always" location once per session, with a reason first. Resolves to whether it is allowed. */
async function ensureBackgroundPermission(askedBefore: { current: boolean }): Promise<boolean> {
  const current = await Location.getBackgroundPermissionsAsync();
  if (current.granted) return true;
  if (askedBefore.current || !current.canAskAgain) return false;
  askedBefore.current = true;
  const agree = await new Promise<boolean>((resolve) =>
    Alert.alert(
      'Keep sharing your location',
      'Choose “Allow all the time” / “Always” so restaurants and offers still see where you are when your phone is locked during a delivery. It is only used while you are online.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ]
    )
  );
  if (!agree) return false;
  return (await Location.requestBackgroundPermissionsAsync()).granted;
}

/**
 * Follows the driver's GPS position while `active` (online or on a run) and reports it to
 * the server, which uses it for nearby offers, route estimates and the live maps.
 * With "Always" permission it keeps reporting when the phone is locked or the app is in the
 * background (needs a development or store build; Expo Go only reports while open).
 * Returns the latest position, or null if location is off or not allowed.
 */
export function useDriverLocation(active: boolean): LatLng | null {
  const [position, setPosition] = useState<LatLng | null>(null);
  const askedForSettings = useRef(false);
  const askedForAlways = useRef(false);

  useEffect(() => {
    if (!active) {
      stopBackgroundUpdates();
      return;
    }
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

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
            report(where);
          }
        );
        if (cancelled) {
          subscription.remove();
          return;
        }
        // Keep reporting in the background when the driver allows it.
        try {
          if (await ensureBackgroundPermission(askedForAlways)) {
            if (!cancelled) await startBackgroundUpdates();
          }
        } catch {
          // Background location is not available in this build (e.g. Expo Go): foreground only.
        }
      } catch {
        // Location services unavailable (e.g. turned off): carry on without a position.
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [active]);

  // Stop background updates when the screen that owns them goes away (sign-out, app closed by the user).
  useEffect(() => () => void stopBackgroundUpdates(), []);

  return position;
}
