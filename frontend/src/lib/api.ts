import type { AuthSession, AuthUser, RestaurantSignup } from "./types";

/**
 * Base URL of the In Tha Route API (the same backend the mobile app uses).
 * Override with NEXT_PUBLIC_API_URL, e.g. http://localhost:5000 for a local backend.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://in-the-route-app.onrender.com").replace(
  /\/+$/,
  ""
);

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** An error the user can act on. `fields` maps API field names to messages. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fields: Record<string, string> = {},
    readonly status: number = 0
  ) {
    super(message);
  }
}

/** A message the user can act on, preferring the first field error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return Object.values(err.fields)[0] ?? err.message;
  return "Something went wrong. Please try again.";
}

// The hosted API sleeps when idle and can take close to a minute to wake.
const TIMEOUT_MS = 75_000;

/** One HTTP call to the API. Throws ApiError for network failures and error responses. */
export async function request<T>(method: HttpMethod, path: string, body?: unknown, accessToken?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Can’t reach the server. Check your connection and try again.", "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;

  const error = data?.error;
  const fields: Record<string, string> = {};
  for (const d of error?.details ?? []) {
    if (d?.field && !fields[d.field]) fields[d.field] = d.message;
  }
  throw new ApiError(
    error?.message ?? "Something went wrong. Please try again.",
    error?.code ?? "UNKNOWN",
    fields,
    res.status
  );
}

export const loginRequest = (email: string, password: string) =>
  request<AuthSession>("POST", "/api/auth/login", { email, password });

export const signupRequest = (input: RestaurantSignup) => request<AuthSession>("POST", "/api/auth/signup", input);

/* -------------------------------------------------------------------------- */
/* Signed-in sessions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Each portal keeps its own session in this browser, so an admin and a merchant
 * account can be open side by side. The whole session (access token included)
 * is stored, so every open tab shares one token pair: refresh tokens work once,
 * and a browser lock makes sure only one tab renews at a time.
 */
export type Portal = "admin" | "merchant";

interface StoredSession {
  user: AuthUser;
  accessToken: string | null;
  accessExpiresAt: number;
  refreshToken: string;
}

const storageKey = (portal: Portal) => `itr.session.${portal}`;
const TOKEN_ERRORS = ["TOKEN_EXPIRED", "INVALID_TOKEN", "UNAUTHENTICATED"];

function read(portal: Portal): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(portal));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function write(portal: Portal, session: StoredSession | null) {
  try {
    if (session) window.localStorage.setItem(storageKey(portal), JSON.stringify(session));
    else window.localStorage.removeItem(storageKey(portal));
  } catch {
    // Storage blocked (private mode): the session lives only as long as this tab.
  }
  memory[portal] = session;
  listeners.forEach((fn) => fn(portal));
}

const memory: Record<Portal, StoredSession | null> = { admin: null, merchant: null };
const listeners = new Set<(portal: Portal) => void>();

/** Current session for a portal (from this tab, else from storage). */
export function getSession(portal: Portal): StoredSession | null {
  return read(portal) ?? memory[portal];
}

/** Notified when this tab or another one signs in, renews or signs out. */
export function onSessionChange(fn: (portal: Portal) => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKey("admin")) fn("admin");
    if (e.key === storageKey("merchant")) fn("merchant");
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveSession(portal: Portal, session: AuthSession) {
  write(portal, {
    user: session.user,
    accessToken: session.tokens.accessToken,
    accessExpiresAt: Date.now() + (session.tokens.expiresIn ?? 900) * 1000,
    refreshToken: session.tokens.refreshToken,
  });
}

export function clearSession(portal: Portal) {
  const s = getSession(portal);
  write(portal, null);
  // Best effort: revoke the refresh token on the server.
  if (s?.refreshToken) request("POST", "/api/auth/logout", { refreshToken: s.refreshToken }).catch(() => {});
}

const fresh = (s: StoredSession | null) => !!s?.accessToken && Date.now() < s.accessExpiresAt - 30_000;

const refreshing: Partial<Record<Portal, Promise<StoredSession>>> = {};

async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request(name, fn) : fn();
}

/** Renews the session once, even when several calls or tabs need it at the same time. */
function renew(portal: Portal): Promise<StoredSession> {
  const running = refreshing[portal];
  if (running) return running;
  const p = withLock(`itr-refresh-${portal}`, async () => {
    const current = read(portal) ?? memory[portal];
    if (!current) throw new ApiError("Please sign in again.", "UNAUTHENTICATED", {}, 401);
    // Another tab may have renewed while we waited for the lock.
    if (fresh(current)) return current;
    try {
      const next = await request<AuthSession>("POST", "/api/auth/refresh", { refreshToken: current.refreshToken });
      saveSession(portal, next);
      return getSession(portal)!;
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACCOUNT_DISABLED") endDisabled(portal);
      else if (err instanceof ApiError && err.code !== "NETWORK_ERROR") write(portal, null);
      throw err;
    }
  }).finally(() => {
    delete refreshing[portal];
  });
  refreshing[portal] = p;
  return p;
}

/* A note for the sign-in page, e.g. why the session ended. Lives for this tab only. */
const noticeKey = (portal: Portal) => `itr.notice.${portal}`;

export function setNotice(portal: Portal, message: string) {
  try {
    window.sessionStorage.setItem(noticeKey(portal), message);
  } catch {}
}

/** Reads the note once and forgets it. */
export function takeNotice(portal: Portal): string | null {
  try {
    const m = window.sessionStorage.getItem(noticeKey(portal));
    window.sessionStorage.removeItem(noticeKey(portal));
    return m;
  } catch {
    return null;
  }
}

export const DISABLED_MESSAGE =
  "This account has been disabled by In Tha Route. Contact support if you think this is a mistake.";

/** The admin disabled this account: sign out here and say why on the sign-in page. */
export function endDisabled(portal: Portal) {
  setNotice(portal, DISABLED_MESSAGE);
  write(portal, null);
}

/** A valid access token, renewed if needed. */
export async function accessToken(portal: Portal): Promise<string> {
  const s = getSession(portal);
  if (fresh(s)) return s!.accessToken!;
  return (await renew(portal)).accessToken ?? "";
}

/** A signed-in API call for one portal. Renews an expired token once and retries. */
export async function api<T>(portal: Portal, method: HttpMethod, path: string, body?: unknown): Promise<T> {
  const token = await accessToken(portal);
  try {
    return await request<T>(method, path, body, token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && TOKEN_ERRORS.includes(err.code)) {
      // Force a renewal: the stored token was rejected.
      const s = getSession(portal);
      if (s) write(portal, { ...s, accessToken: null, accessExpiresAt: 0 });
      const next = await renew(portal);
      return request<T>(method, path, body, next.accessToken ?? undefined);
    }
    if (err instanceof ApiError && err.code === "ACCOUNT_DISABLED") endDisabled(portal);
    throw err;
  }
}

/** Fetches a private file (receipt photo, driver document) as an object URL. */
export async function fetchFile(portal: Portal, path: string): Promise<{ url: string; type: string }> {
  const token = await accessToken(portal);
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new ApiError("The file couldn’t be loaded.", "FILE_ERROR", {}, res.status);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}
