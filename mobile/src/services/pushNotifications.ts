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
 *  - 'offer'   a platform driver was offered a batch
 *  - 'order'   a driver got an order / a restaurant's order was accepted, collected or delivered
 *  - 'chat'    a new message (only sent when the app is not open)
 *  - 'account' a driver's documents were approved or rejected
 *
 * Needs a development or store build: Expo Go on Android cannot receive remote pushes.
 */
export type PushData = { type?: 'offer' | 'order' | 'chat' | 'account'; conversationId?: string; orderId?: string };

// While the app is open, chat messages already appear live, so they do not need a banner.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as PushData;
    const quiet = data?.type === 'chat' && AppState.currentState === 'active';
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
