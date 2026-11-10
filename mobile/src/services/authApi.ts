import { API_URL } from '@/constants/api';

export type ApiRole = 'restaurant' | 'driver' | 'admin';
export type Vehicle = 'Motorcycle / Scooter' | 'Car' | 'E-Bike';

export interface AuthUser {
  id: string;
  email: string;
  role: ApiRole;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  restaurant?: {
    id: string;
    name: string;
    address: string;
    postcode: string;
    phone: string;
    driverPolicy: 'open_platform' | 'own_drivers' | 'hybrid';
    pickupSafetyNote: string | null;
  };
  driver?: {
    id: string;
    driverType: 'platform_contracted' | 'restaurant_own';
    employerRestaurantId: string | null;
    vehicle: Vehicle;
    plateNumber: string | null;
    status: 'pending_kyc' | 'approved_online' | 'offline';
  };
}

export interface AuthSession {
  user: AuthUser;
  tokens: { accessToken: string; refreshToken: string; tokenType: string; expiresIn: number };
}

interface BaseSignup {
  email: string;
  password: string;
  fullName: string;
  phone: string;
}

export type SignupInput =
  | (BaseSignup & {
      role: 'restaurant';
      restaurantName: string;
      address: string;
      postcode: string;
      pickupSafetyNote?: string;
    })
  | (BaseSignup & { role: 'driver'; vehicle: Vehicle; plateNumber?: string });

/** An error the user can act on. `fields` maps API field names to messages. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fields: Record<string, string> = {}
  ) {
    super(message);
  }
}

// The hosted API sleeps when idle and can take close to a minute to wake.
const TIMEOUT_MS = 75_000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      'Can’t reach the server. Check your connection and try again.',
      'NETWORK_ERROR'
    );
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
    error?.message ?? 'Something went wrong. Please try again.',
    error?.code ?? 'UNKNOWN',
    fields
  );
}

export const signupRequest = (input: SignupInput) => post<AuthSession>('/api/auth/signup', input);

export const loginRequest = (email: string, password: string) =>
  post<AuthSession>('/api/auth/login', { email, password });

/** Trades a refresh token for a new session. Each refresh token works once. */
export const refreshRequest = (refreshToken: string) =>
  post<AuthSession>('/api/auth/refresh', { refreshToken });

/** Best effort: the local session is cleared whether or not this reaches the server. */
export const logoutRequest = (refreshToken: string) => {
  post('/api/auth/logout', { refreshToken }).catch(() => {});
};
