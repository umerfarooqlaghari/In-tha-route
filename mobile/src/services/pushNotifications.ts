import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { api } from '@/services/apiClient';

/**
 * Push notifications (Expo push service → Apple APNs / Google FCM).
 *
 * What the server sends (`data.type`):
 *  - 'offer'   a new order nearby in the open pool (platform drivers)
 *  - 'order'   a driver got an order / a restaurant's order was accepted, collected or delivered
 *  - 'chat'    a new message (only sent when the app is not open)
 *  - 'account' a driver's documents were approved or rejected
 *
 * Needs a development or store build: Expo Go on Android cannot receive remote pushes.
 */
export type PushData = { type?: 'offer' | 'order' | 'chat' | 'account'; conversationId?: string; orderId?: string };

// New pool orders this phone has already rung for. Null until the first pool arrives
// (orders already there when the app opens stay quiet).
let announced: Set<string> | null = null;
// The orders in the driver's pool right now: a ring stops once its order is no longer here.
let inPool = new Set<string>();
const RING_FOR = 'local-pool-order';
// A new order rings this many times, this far apart (about 10 seconds), like the server's pushes.
const RINGS = 3;
const RING_EVERY_MS = 5000;

// While the app is open, chat messages already appear live, so they do not need a banner;
// and the app rings for new orders itself, so the server's order pushes stay silent then
// (they still refresh the pool straight away).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as PushData & { source?: string };
    const open = AppState.currentState === 'active';
    const quiet = open && (data?.type === 'chat' || (data?.type === 'offer' && data.source !== RING_FOR));
    return {
      shouldShowBanner: !quiet,
      shouldShowList: !quiet,
      shouldPlaySound: !quiet,
      shouldSetBadge: false,
    };
  },
});

let channelsReady: Promise<void> | null = null;
function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelsReady ??= Promise.all([
    Notifications.setNotificationChannelAsync('orders', {
      name: 'Orders and offers',
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    }),
    Notifications.setNotificationChannelAsync('chat', {
      name: 'Messages',
      importance: AndroidImportance.HIGH,
      sound: 'default',
    }),
  ]).then(() => undefined);
  return channelsReady;
}

/** A new order the driver can take, as the pool shows it. */
type PoolOrder = { id: string; restaurantName: string; postcode: string; driverPayoutGbp?: number };

/**
 * Rings (sound, vibration and a banner) for every order that is new in the driver's pool,
 * as soon as the app sees it: three times over about 10 seconds, stopping early once the
 * order is taken, rejected or leaves the pool. Works while the app is open on both iOS and Android, without
 * waiting for a server push. The first pool after opening the app only sets the starting point.
 */
export function announceNewPoolOrders(pool: PoolOrder[]) {
  // Orders that left the pool (taken, rejected, timed out): stop ringing, take the banner away.
  const now = new Set(pool.map((o) => o.id));
  for (const id of inPool) {
    if (!now.has(id)) Notifications.dismissNotificationAsync(`pool-${id}`).catch(() => {});
  }
  inPool = now;
  if (!announced) {
    announced = new Set(now);
    return;
  }
  for (const o of pool) {
    if (announced.has(o.id)) continue;
    announced.add(o.id);
    ring(o, 1);
  }
}

/** One ring for a new order; rings again 5 s later while it is still in the pool. */
function ring(o: PoolOrder, count: number) {
  const pay = o.driverPayoutGbp ? ` · £${o.driverPayoutGbp.toFixed(2)}` : '';
  ensureAndroidChannels()
    .then(() =>
      Notifications.scheduleNotificationAsync({
        // The same id each time, so the banner is replaced rather than stacked.
        identifier: `pool-${o.id}`,
        content: {
          title: `New order${pay}`,
          body: `${o.restaurantName} to ${o.postcode}. First driver to accept gets it.`,
          data: { type: 'offer', orderId: o.id, source: RING_FOR },
          sound: 'default',
        },
        trigger: Platform.OS === 'android' ? { channelId: 'orders' } : null,
      })
    )
    .catch(() => {});
  if (count >= RINGS) return;
  setTimeout(() => {
    if (inPool.has(o.id) && AppState.currentState === 'active') ring(o, count + 1);
  }, RING_EVERY_MS);
}

// In the background the server's pushes ring; on return, start again from what is there
// so an order is never rung twice.
AppState.addEventListener('change', (state) => {
  if (state === 'background') {
    announced = null;
    inPool = new Set();
  }
});

/** Forget which orders rang (sign-out, or the driver goes offline). */
export function resetPoolAnnouncements() {
  announced = null;
  inPool = new Set();
}

let registeredToken: string | null = null;

/** Asks for permission (once), gets this phone's Expo push token and saves it on the server. */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // simulators cannot receive remote pushes
    await ensureAndroidChannels();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api('PUT', '/api/auth/push-token', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    registeredToken = token;
    return token;
  } catch {
    // No push in this build (e.g. Expo Go on Android) or offline: the app still works by polling.
    return null;
  }
}

/** Stops notifications to this phone for the signed-in user. Call before signing out. */
export async function unregisterForPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  await api('DELETE', '/api/auth/push-token', { token }).catch(() => {});
}

/**
 * Registers while signed in, and calls `onActivity` when a notification arrives or is tapped
 * (so the screen refreshes), and `onOpen` with the notification's data when it is tapped.
 */
export function usePushNotifications(
  enabled: boolean,
  { onActivity, onOpen }: { onActivity?: () => void; onOpen?: (data: PushData) => void }
) {
  const handlers = useRef({ onActivity, onOpen });
  // Always call the latest callbacks without re-registering the listeners.
  useEffect(() => {
    handlers.current = { onActivity, onOpen };
  });

  useEffect(() => {
    if (!enabled) return;
    registerForPush();
    const received = Notifications.addNotificationReceivedListener(() => handlers.current.onActivity?.());
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      handlers.current.onActivity?.();
      handlers.current.onOpen?.(response.notification.request.content.data as PushData);
    });
    // The app was opened from a notification while it was closed.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handlers.current.onOpen?.(response.notification.request.content.data as PushData);
      })
      .catch(() => {});
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [enabled]);
}
