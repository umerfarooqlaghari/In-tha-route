import { ApiError, AuthSession, HttpMethod, refreshRequest, request } from '@/services/authApi';

/**
 * Signed-in API calls. Keeps the short-lived access token in memory, renews it
 * with the refresh token when it runs out, and tells the app when the session
 * can no longer be renewed.
 */
interface Handlers {
  /** A new token pair (and fresh profile) arrived: persist it. */
  onSession: (session: AuthSession) => void;
  /** The server rejected the session: sign the user out. */
  onExpired: () => void;
}

let accessToken: string | null = null;
let accessExpiresAt = 0;
let refreshToken: string | null = null;
let handlers: Handlers | null = null;
let refreshing: Promise<AuthSession> | null = null;

export function configureApiClient(next: Handlers) {
  handlers = next;
}

/** Call after login, signup or restoring a saved session (which has no access token yet). */
export function setApiSession(tokens: { accessToken?: string; refreshToken: string; expiresIn?: number } | null) {
  if (!tokens) {
    accessToken = null;
    refreshToken = null;
    accessExpiresAt = 0;
    return;
  }
  refreshToken = tokens.refreshToken;
  accessToken = tokens.accessToken ?? null;
  accessExpiresAt = tokens.accessToken ? Date.now() + (tokens.expiresIn ?? 900) * 1000 : 0;
}

/** Renews the session. Concurrent callers share one request, because each refresh token works once. */
export function refreshSession(): Promise<AuthSession> {
  if (refreshing) return refreshing;
  const token = refreshToken;
  if (!token) return Promise.reject(new ApiError('Please log in again.', 'UNAUTHENTICATED'));

  refreshing = refreshRequest(token)
    .then((session) => {
      // Ignore the result if the user signed out while this was in flight.
      if (refreshToken === token) {
        setApiSession(session.tokens);
        handlers?.onSession(session);
      }
      return session;
    })
    .catch((err) => {
      if (err instanceof ApiError && err.code !== 'NETWORK_ERROR' && refreshToken === token) {
        setApiSession(null);
        handlers?.onExpired();
      }
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** A valid access token, renewed if needed (for requests made outside `api`, such as images). */
export async function getAccessToken(): Promise<string> {
  if (!accessToken || Date.now() > accessExpiresAt - 30_000) await refreshSession();
  return accessToken ?? '';
}

/** Current refresh token, so logout can revoke it on the server. */
export function currentRefreshToken(): string | null {
  return refreshToken;
}

const TOKEN_ERRORS =['TOKEN_EXPIRED', 'INVALID_TOKEN', 'UNAUTHENTICATED'];

export async function api<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  if (!accessToken || Date.now() > accessExpiresAt - 30_000) await refreshSession();
  try {
    return await request<T>(method, path, body, accessToken ?? undefined);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && TOKEN_ERRORS.includes(err.code)) {
      await refreshSession();
      return request<T>(method, path, body, accessToken ?? undefined);
    }
    if (err instanceof ApiError && err.code === 'ACCOUNT_DISABLED') {
      setApiSession(null);
      handlers?.onExpired();
    }
    throw err;
  }
}
