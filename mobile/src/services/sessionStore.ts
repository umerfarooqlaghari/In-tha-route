import * as SecureStore from 'expo-secure-store';

import type { AuthSession, AuthUser } from '@/services/authApi';

/**
 * Keeps the signed-in session in the device keychain / keystore so the user
 * stays logged in between launches. Only the long-lived refresh token and the
 * profile are stored; access tokens are short-lived and fetched again on launch.
 */
const REFRESH_KEY = 'itr.refreshToken';
const USER_KEY = 'itr.user';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface StoredSession {
  refreshToken: string;
  user: AuthUser;
}

export async function saveSession(session: AuthSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(REFRESH_KEY, session.tokens.refreshToken, OPTIONS);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user), OPTIONS);
  } catch {
    // Storage unavailable: the session still works until the app is closed.
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const [refreshToken, user] = await Promise.all([
      SecureStore.getItemAsync(REFRESH_KEY, OPTIONS),
      SecureStore.getItemAsync(USER_KEY, OPTIONS),
    ]);
    if (!refreshToken || !user) return null;
    return { refreshToken, user: JSON.parse(user) as AuthUser };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS);
    await SecureStore.deleteItemAsync(USER_KEY, OPTIONS);
  } catch {
    // Nothing to clear.
  }
}
