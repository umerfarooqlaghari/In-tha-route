import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { LatLng, registerPostcodeCoords } from '@/constants/geo';
import { ApiError, AuthSession, AuthUser, logoutRequest } from '@/services/authApi';
import {
  api,
  configureApiClient,
  currentRefreshToken,
  refreshSession,
  setApiSession,
} from '@/services/apiClient';
import { useDriverLocation } from '@/services/driverLocation';
import { clearSession, loadSession, saveSession } from '@/services/sessionStore';
import type { PickedImage } from '@/utils/pickImage';

export type UserRole = 'restaurant' | 'driver' | 'admin';

export type OrderSource = 'Deliveroo' | 'Uber Eats' | 'Eat Presto POS' | 'Just Eat' | 'Other';

export type DriverPolicy = 'open_platform' | 'own_drivers' | 'hybrid';

export type Vehicle = 'Motorcycle / Scooter' | 'Car' | 'E-Bike';

export interface OrderItem {
  quantity: number;
  name: string;
  price: number;
}

/** A receipt read by OCR on the server: a draft order the staff check before posting. */
export interface ReceiptTemplate {
  id: string;
  source: OrderSource;
  externalOrderId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  restaurantPostcode: string;
  customerName: string;
  customerPhone: string;
  phoneAccessCode?: string;
  directCustomerPhone?: string;
  deliveryAddress: string;
  postcode: string;
  deliveryInstructions: string;
  restaurantPickupNote: string;
  distanceMiles: number;
  suggestedPrepMinutes: number;
  printedTime: string;
  orderTotalGbp: number;
  items: OrderItem[];
  /** What the restaurant will be charged for a platform driver. */
  estimatedFeeGbp: number;
  pickupCoords?: LatLng | null;
  dropoffCoords?: LatLng | null;
  mapCoords: {
    pickupX: number;
    pickupY: number;
    dropoffX: number;
    dropoffY: number;
  };
}

export type OrderStatus =
  | 'preparing'
  | 'ready_for_pickup'
  | 'batched_offered'
  | 'driver_assigned'
  | 'picked_up'
  | 'delivered';

export interface LiveOrder {
  id: string;
  source: OrderSource;
  externalOrderId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  restaurantPostcode: string;
  /** Only sent to drivers and admins. */
  restaurantPhone?: string;
  customerName: string;
  customerPhone: string;
  phoneAccessCode?: string;
  directCustomerPhone?: string;
  deliveryAddress: string;
  postcode: string;
  deliveryInstructions: string;
  restaurantPickupNote: string;
  distanceMiles: number;
  prepMinutes: number;
  readyAt?: string;
  /** Counts down locally between refreshes. */
  remainingSeconds: number;
  orderTotalGbp: number;
  items: OrderItem[];
  dispatchType: 'open_platform' | 'own_driver';
  status: OrderStatus;
  assignedDriverId?: string;
  assignedDriverName?: string;
  batchId?: string;
  batchPosition?: number;
  restaurantFeeGbp: number;
  driverPayoutGbp: number;
  /** Admin only. */
  platformMarginGbp?: number;
  /** Order pool only: what this order would pay the driver if added now. */
  nextPayoutGbp?: number;
  createdAtLabel: string;
  pickupCoords?: LatLng | null;
  dropoffCoords?: LatLng | null;
  mapCoords: {
    pickupX: number;
    pickupY: number;
    dropoffX: number;
    dropoffY: number;
  };
}

export interface KycDocument {
  id: string;
  type?: string;
  title: string;
  subtitle: string;
  value: string;
  status: 'verified' | 'pending' | 'missing';
  updatedAt: string;
  hasFile?: boolean;
}

export interface DriverProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  driverType: 'platform_contracted' | 'restaurant_own';
  employerRestaurantId?: string;
  employerRestaurantName?: string;
  vehicle: Vehicle;
  plateNumber: string;
  status: 'approved_online' | 'pending_kyc' | 'offline';
  approval?: 'approved' | 'rejected' | 'pending';
  isOnline?: boolean;
  /** Last GPS position, if recent (admin map and the driver's own profile). */
  location?: (LatLng & { updatedAt: string }) | null;
  rating: number;
  completedDeliveries: number;
  niNumber?: string;
  bankAccount?: string;
  kycDocuments: KycDocument[];
}

export interface RestaurantPartner {
  id: string;
  name: string;
  address: string;
  postcode: string;
  phone: string;
  driverPolicy: DriverPolicy;
  activeOrdersCount: number;
  completedTodayCount: number;
  pickupSafetyNote: string;
  coords?: LatLng | null;
}

export interface AlgorithmConfig {
  baseDistanceMiles: number;
  baseRestaurantChargeGbp: number;
  extraMileRestaurantChargeGbp: number;
  extraMileDriverPayoutGbp: number;
  maxBatchSize: number;
  steppedDriverPayoutsGbp: number[];
  maxPrepTimeWindowMinutes: number;
  maxPickupRadiusMiles: number;
}

export interface DriverEarnings {
  week: { day: string; value: number }[];
  totalGbp: number;
  trips: number;
  onlineHours: number;
  rating: number;
  recentTrips: { id: string; title: string; time: string; pay: number }[];
}

/** Admin pricing screen figures, calculated by the server. */
export interface PricingSummary {
  tiers: { position: number; driverPayGbp: number; platformKeepsGbp: number }[];
  simulations: {
    orders: number;
    restaurantsPayGbp: number;
    driverEarnsGbp: number;
    profitGbp: number;
    driverShare: number;
  }[];
}

export interface AdminTotals {
  billedGbp: number;
  driverPayGbp: number;
  profitGbp: number;
}

type BatchStatus = 'offered' | 'accepted_navigating' | 'declined';

/** Server estimate for the stops still to do in the current run. */
export interface RouteEstimate {
  miles: number;
  minutes: number;
}

/** What `GET /api/{role}/dashboard` returns. Every change endpoint returns a fresh one too. */
interface Dashboard {
  role: UserRole;
  orders: LiveOrder[];
  drivers: DriverProfile[];
  restaurants: RestaurantPartner[];
  algorithm: AlgorithmConfig;
  activeRestaurantId?: string;
  me?: DriverProfile;
  currentBatchId?: string | null;
  driverBatchStatus?: BatchStatus;
  activeStopIndex?: number;
  isOnline?: boolean;
  routeEstimate?: RouteEstimate | null;
  earnings?: DriverEarnings;
  pricingSummary?: PricingSummary;
  totals?: AdminTotals;
}

export interface RoleScreen {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
}

export const ROLE_SCREENS: Record<UserRole, RoleScreen[]> = {
  restaurant: [
    { key: 'scan_receipt', title: 'New order', subtitle: 'Scan a receipt', icon: 'scan-outline' },
    { key: 'live_orders', title: 'Live orders', subtitle: 'Prep timers & couriers', icon: 'time-outline' },
    { key: 'own_drivers', title: 'My drivers', subtitle: 'Your in-house team', icon: 'people-outline' },
    { key: 'dispatch_policy', title: 'Delivery settings', subtitle: 'Who delivers your orders', icon: 'options-outline' },
  ],
  driver: [
    { key: 'live_route', title: 'Drive', subtitle: 'Offers & navigation', icon: 'navigate-outline' },
    { key: 'open_pool', title: 'Order pool', subtitle: 'Add orders to your route', icon: 'layers-outline' },
    { key: 'earnings', title: 'Earnings', subtitle: 'Payouts & trips', icon: 'wallet-outline' },
    { key: 'kyc_docs', title: 'Documents', subtitle: 'Licence, insurance & ID', icon: 'document-text-outline' },
  ],
  admin: [
    { key: 'live_ledger', title: 'Overview', subtitle: 'Live map & revenue', icon: 'map-outline' },
    { key: 'pricing_algorithm', title: 'Pricing', subtitle: 'Fees & batch payouts', icon: 'calculator-outline' },
    { key: 'driver_kyc', title: 'Drivers', subtitle: 'Approve & contract', icon: 'shield-checkmark-outline' },
    { key: 'partner_restaurants', title: 'Restaurants', subtitle: 'Partners & policies', icon: 'storefront-outline' },
  ],
};

/** Shown until the first dashboard arrives; the server's values replace it. */
const DEFAULT_ALGORITHM: AlgorithmConfig = {
  baseDistanceMiles: 2.0,
  baseRestaurantChargeGbp: 5.0,
  extraMileRestaurantChargeGbp: 1.25,
  extraMileDriverPayoutGbp: 0.9,
  maxBatchSize: 5,
  steppedDriverPayoutsGbp: [4.0, 3.2, 2.8, 2.5, 2.2, 2.0, 1.9, 1.8],
  maxPrepTimeWindowMinutes: 15,
  maxPickupRadiusMiles: 0.8,
};

const POLL_MS = 12_000;

/** A message the user can act on, preferring the first field error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const first = Object.values(err.fields)[0];
    return first ?? err.message;
  }
  return 'Something went wrong. Please try again.';
}

const showError = (err: unknown, title = 'Couldn’t complete that') => Alert.alert(title, errorMessage(err));

/** Remember real coordinates the server sent, so map pins land in the right place. */
function registerCoords(d: Dashboard) {
  d.restaurants.forEach((r) => registerPostcodeCoords(r.postcode, r.coords));
  d.orders.forEach((o) => {
    registerPostcodeCoords(o.restaurantPostcode, o.pickupCoords);
    registerPostcodeCoords(o.postcode, o.dropoffCoords);
  });
}

type AddDriverResult = { ok: true } | { ok: false; message: string; fields: Record<string, string> };

interface InThaRouteContextType {
  /** True while the saved session is being read on launch. */
  isRestoring: boolean;
  isLoggedIn: boolean;
  role: UserRole;
  activeScreen: string;
  setActiveScreen: (screen: string) => void;
  /** Screens this account may open (a driver awaiting approval only sees Documents). */
  screens: RoleScreen[];
  /** The signed-in account, as returned by the API. */
  user: AuthUser | null;
  /** Enter the app with a session from the signup or login API. */
  signIn: (session: AuthSession) => void;
  logout: () => void;

  /** True once the first dashboard for this account has loaded. */
  isDashboardReady: boolean;
  dashboardError: string | null;
  refreshDashboard: () => Promise<void>;

  orders: LiveOrder[];
  drivers: DriverProfile[];
  restaurants: RestaurantPartner[];
  algorithm: AlgorithmConfig;
  activeRestaurantId: string;
  setActiveRestaurantId: (id: string) => void;

  // Driver
  me: DriverProfile | null;
  isOnline: boolean;
  setOnline: (online: boolean) => Promise<boolean>;
  /** This device's GPS position while the driver is online or on a run. */
  myLocation: LatLng | null;
  routeEstimate: RouteEstimate | null;
  earnings: DriverEarnings | null;
  currentBatchId: string | null;
  driverBatchStatus: BatchStatus;
  activeStopIndex: number;
  acceptCurrentBatch: () => Promise<boolean>;
  declineCurrentBatch: () => Promise<boolean>;
  advanceActiveStop: () => Promise<boolean>;
  /** "Find new orders" / "Refresh": closes a finished run and asks for the next offer. */
  findNewOrders: () => Promise<boolean>;
  appendOrderToDriverBatch: (orderId: string) => Promise<{ ok: boolean; message: string }>;
  uploadDriverKycDoc: (docId: string, image: PickedImage) => Promise<boolean>;

  // Restaurant
  scanReceipt: (image: PickedImage) => Promise<ReceiptTemplate | null>;
  publishScannedOrder: (params: {
    template: ReceiptTemplate;
    prepMinutes: number;
    dispatchType: 'open_platform' | 'own_driver';
    ownDriverId?: string;
    customAddress?: string;
    customPostcode?: string;
    customAccessCode?: string;
  }) => Promise<LiveOrder | null>;
  markOrderReady: (orderId: string) => Promise<boolean>;
  addRestaurantOwnDriver: (params: {
    name: string;
    email: string;
    password: string;
    phone: string;
    vehicle: Vehicle;
    plateNumber: string;
  }) => Promise<AddDriverResult>;
  updateRestaurantPolicy: (restaurantId: string, policy: DriverPolicy) => Promise<boolean>;

  // Admin
  pricingSummary: PricingSummary | null;
  totals: AdminTotals | null;
  approveDriverKyc: (driverId: string) => Promise<boolean>;
  rejectDriverKyc: (driverId: string, reason?: string) => Promise<boolean>;
  updateAlgorithmConfig: (partial: Partial<AlgorithmConfig>) => Promise<boolean>;
  updateSteppedPayoutAt: (orderPositionIndex: number, amountGbp: number) => Promise<boolean>;
}

const InThaRouteContext = createContext<InThaRouteContextType | undefined>(undefined);

interface DashboardState {
  data: Dashboard | null;
  /** When `data` arrived, so countdowns keep ticking between refreshes. */
  receivedAt: number;
}

const EMPTY: DashboardState = { data: null, receivedAt: 0 };

export function InThaRouteProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRoleState] = useState<UserRole>('restaurant');
  const [activeScreen, setActiveScreen] = useState<string>('scan_receipt');

  const [dash, setDash] = useState<DashboardState>(EMPTY);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const roleRef = useRef<UserRole | null>(null);
  // Responses are applied only if no newer request has already been applied,
  // so a slow poll never overwrites the result of a later change.
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);

  /* ---------------------------------------------------------------------- */
  /* Session                                                                 */
  /* ---------------------------------------------------------------------- */

  // The role always comes from the server (or from the profile it returned
  // earlier and we stored securely), never from a choice in the UI.
  const enter = useCallback((account: AuthUser) => {
    setUser(account);
    if (roleRef.current !== account.role) {
      roleRef.current = account.role;
      setRoleState(account.role);
      setActiveScreen(ROLE_SCREENS[account.role][0].key);
      setDash(EMPTY);
    }
    setIsLoggedIn(true);
  }, []);

  const signOutLocally = useCallback(() => {
    setApiSession(null);
    roleRef.current = null;
    requestSeq.current += 1;
    appliedSeq.current = requestSeq.current;
    setUser(null);
    setDash(EMPTY);
    setDashboardError(null);
    setIsLoggedIn(false);
    clearSession();
  }, []);

  const signIn = (next: AuthSession) => {
    setApiSession(next.tokens);
    enter(next.user);
    saveSession(next);
  };

  const logout = () => {
    const token = currentRefreshToken();
    if (token) logoutRequest(token);
    signOutLocally();
  };

  // On launch: reopen the saved account straight away, then confirm it with the
  // server. If the server rejects the session (expired, revoked, account
  // disabled) the user is signed out; if the server is just unreachable they stay in.
  useEffect(() => {
    let cancelled = false;
    configureApiClient({
      onSession: (session) => {
        if (cancelled) return;
        enter(session.user);
        saveSession(session);
      },
      onExpired: () => {
        if (!cancelled) signOutLocally();
      },
    });
    (async () => {
      const stored = await loadSession();
      if (cancelled) return;
      if (!stored) {
        setIsRestoring(false);
        return;
      }
      setApiSession({ refreshToken: stored.refreshToken });
      enter(stored.user);
      setIsRestoring(false);
      // Sign-out on rejection is handled by onExpired; network errors keep the user in.
      refreshSession().catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [enter, signOutLocally]);

  /* ---------------------------------------------------------------------- */
  /* Dashboard                                                               */
  /* ---------------------------------------------------------------------- */

  const apply = useCallback((d: Dashboard | undefined, seq: number) => {
    if (!d || seq < appliedSeq.current || d.role !== roleRef.current) return;
    appliedSeq.current = seq;
    registerCoords(d);
    setDash({ data: d, receivedAt: Date.now() });
    setDashboardError(null);
  }, []);

  /** Calls an endpoint that answers with `{ dashboard }` and shows the new state. */
  const call = useCallback(
    async <T extends { dashboard?: Dashboard }>(
      method: 'GET' | 'POST' | 'PUT' | 'PATCH',
      path: string,
      body?: unknown
    ): Promise<T> => {
      const seq = ++requestSeq.current;
      const res = await api<T>(method, path, body);
      apply(res.dashboard, seq);
      return res;
    },
    [apply]
  );

  const refreshDashboard = useCallback(async () => {
    const current = roleRef.current;
    if (!current) return;
    const seq = ++requestSeq.current;
    try {
      const d = await api<Dashboard>('GET', `/api/${current}/dashboard`);
      apply(d, seq);
    } catch (err) {
      if (roleRef.current === current) setDashboardError(errorMessage(err));
    }
  }, [apply]);

  // Load on sign-in, then keep it fresh while the app is in the foreground.
  useEffect(() => {
    if (!isLoggedIn) return;
    refreshDashboard();
    let timer: ReturnType<typeof setInterval> | null = setInterval(refreshDashboard, POLL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshDashboard();
        if (!timer) timer = setInterval(refreshDashboard, POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [isLoggedIn, role, refreshDashboard]);

  // One clock for every countdown on screen.
  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  const data = dash.data;

  const orders = useMemo<LiveOrder[]>(() => {
    if (!data) return [];
    const elapsed = Math.max(0, Math.floor((now - dash.receivedAt) / 1000));
    return data.orders.map((o) =>
      o.status === 'delivered' ? o : { ...o, remainingSeconds: Math.max(0, o.remainingSeconds - elapsed) }
    );
  }, [data, dash.receivedAt, now]);

  /* ---------------------------------------------------------------------- */
  /* Screens                                                                 */
  /* ---------------------------------------------------------------------- */

  const me = data?.me ?? null;
  const driverApproval: DriverProfile['approval'] =
    me?.approval ??
    (user?.driver
      ? user.driver.status === 'approved_online' || user.driver.status === 'offline'
        ? 'approved'
        : user.driver.status === 'rejected'
        ? 'rejected'
        : 'pending'
      : 'approved');

  const screens = useMemo(
    () =>
      role === 'driver' && driverApproval !== 'approved'
        ? ROLE_SCREENS.driver.filter((s) => s.key === 'kyc_docs')
        : ROLE_SCREENS[role],
    [role, driverApproval]
  );

  useEffect(() => {
    if (!screens.some((s) => s.key === activeScreen)) setActiveScreen(screens[0].key);
  }, [screens, activeScreen]);

  // Track GPS while an approved driver is online or still on a run.
  const onRun = data?.driverBatchStatus === 'accepted_navigating' && !!data.currentBatchId;
  const myLocation = useDriverLocation(
    isLoggedIn && role === 'driver' && driverApproval === 'approved' && (!!data?.isOnline || onRun)
  );

  /* ---------------------------------------------------------------------- */
  /* Actions                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Runs a change and reports failure to the user. */
  const attempt = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  };

  // Driver
  const setOnline = (online: boolean) => attempt(() => call('PUT', '/api/driver/availability', { online }));
  const acceptCurrentBatch = () => attempt(() => call('POST', '/api/driver/batch/accept'));
  const declineCurrentBatch = () => attempt(() => call('POST', '/api/driver/batch/decline'));
  const advanceActiveStop = () => attempt(() => call('POST', '/api/driver/batch/advance'));
  const findNewOrders = () => attempt(() => call('POST', '/api/driver/batch/next'));

  const appendOrderToDriverBatch = async (orderId: string) => {
    try {
      const res = await call<{ ok: boolean; message: string; dashboard: Dashboard }>(
        'POST',
        `/api/driver/pool/${orderId}/add`
      );
      return { ok: res.ok, message: res.message };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  };

  const uploadDriverKycDoc = (docId: string, image: PickedImage) =>
    attempt(() =>
      call('POST', `/api/driver/documents/${docId}/upload`, {
        imageBase64: image.base64,
        mimeType: image.mimeType,
      })
    );

  // Restaurant
  const scanReceipt = async (image: PickedImage) => {
    try {
      const { draft } = await api<{ draft: ReceiptTemplate }>('POST', '/api/restaurant/receipts/scan', {
        imageBase64: image.base64,
        mimeType: image.mimeType,
      });
      registerPostcodeCoords(draft.restaurantPostcode, draft.pickupCoords);
      registerPostcodeCoords(draft.postcode, draft.dropoffCoords);
      return draft;
    } catch (err) {
      showError(err, 'Couldn’t read the receipt');
      return null;
    }
  };

  const publishScannedOrder: InThaRouteContextType['publishScannedOrder'] = async ({
    template,
    prepMinutes,
    dispatchType,
    ownDriverId,
    customAddress,
    customPostcode,
    customAccessCode,
  }) => {
    try {
      const res = await call<{ order: LiveOrder; dashboard: Dashboard }>('POST', '/api/restaurant/orders', {
        source: template.source,
        externalOrderId: template.externalOrderId,
        customerName: template.customerName,
        customerPhone: template.customerPhone,
        phoneAccessCode: customAccessCode ?? template.phoneAccessCode ?? '',
        directCustomerPhone: template.directCustomerPhone ?? '',
        deliveryAddress: customAddress || template.deliveryAddress,
        postcode: customPostcode || template.postcode,
        deliveryInstructions: template.deliveryInstructions,
        orderTotalGbp: template.orderTotalGbp,
        items: template.items.filter((i) => i.name && i.quantity > 0),
        prepMinutes,
        dispatchType,
        ...(dispatchType === 'own_driver' && { ownDriverId }),
      });
      return res.order;
    } catch (err) {
      showError(err, 'Couldn’t post the order');
      return null;
    }
  };

  const markOrderReady = (orderId: string) =>
    attempt(() => call('POST', `/api/restaurant/orders/${orderId}/ready`));

  const addRestaurantOwnDriver: InThaRouteContextType['addRestaurantOwnDriver'] = async (p) => {
    try {
      await call('POST', '/api/restaurant/drivers', {
        fullName: p.name,
        email: p.email,
        password: p.password,
        phone: p.phone,
        vehicle: p.vehicle,
        ...(p.plateNumber && { plateNumber: p.plateNumber }),
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: errorMessage(err),
        fields: err instanceof ApiError ? err.fields : {},
      };
    }
  };

  const patchData = (fn: (d: Dashboard) => Dashboard) =>
    setDash((prev) => (prev.data ? { ...prev, data: fn(prev.data) } : prev));

  const updateRestaurantPolicy = async (restaurantId: string, policy: DriverPolicy) => {
    const previous = data?.restaurants.find((r) => r.id === restaurantId)?.driverPolicy;
    // Show the choice straight away; the server's answer replaces it.
    patchData((d) => ({
      ...d,
      restaurants: d.restaurants.map((r) => (r.id === restaurantId ? { ...r, driverPolicy: policy } : r)),
    }));
    const path =
      role === 'admin' ? `/api/admin/restaurants/${restaurantId}/policy` : '/api/restaurant/policy';
    const ok = await attempt(() => call('PATCH', path, { driverPolicy: policy }));
    if (!ok && previous) {
      patchData((d) => ({
        ...d,
        restaurants: d.restaurants.map((r) => (r.id === restaurantId ? { ...r, driverPolicy: previous } : r)),
      }));
    }
    return ok;
  };

  // Admin
  const approveDriverKyc = (driverId: string) =>
    attempt(() => call('POST', `/api/admin/drivers/${driverId}/approve`));

  const rejectDriverKyc = (driverId: string, reason?: string) =>
    attempt(() => call('POST', `/api/admin/drivers/${driverId}/reject`, reason ? { reason } : {}));

  const algorithm = data?.algorithm ?? DEFAULT_ALGORITHM;

  const updateAlgorithmConfig = async (partial: Partial<AlgorithmConfig>) => {
    // Steppers can be tapped quickly: show the new value now so the next tap
    // builds on it. All money figures still come from the server's response.
    patchData((d) => ({ ...d, algorithm: { ...d.algorithm, ...partial } }));
    const ok = await attempt(() => call('PUT', '/api/admin/pricing', partial));
    if (!ok) refreshDashboard();
    return ok;
  };

  const updateSteppedPayoutAt = (orderPositionIndex: number, amountGbp: number) => {
    const steps = [...algorithm.steppedDriverPayoutsGbp];
    steps[orderPositionIndex] = Number(Math.max(0.5, amountGbp).toFixed(2));
    return updateAlgorithmConfig({ steppedDriverPayoutsGbp: steps });
  };

  return (
    <InThaRouteContext.Provider
      value={{
        isLoggedIn,
        role,
        activeScreen,
        setActiveScreen,
        screens,
        isRestoring,
        user,
        signIn,
        logout,
        isDashboardReady: !!data && data.role === role,
        dashboardError,
        refreshDashboard,
        orders,
        drivers: data?.drivers ?? [],
        restaurants: data?.restaurants ?? [],
        algorithm,
        activeRestaurantId: data?.activeRestaurantId ?? user?.restaurant?.id ?? '',
        // A restaurant account manages exactly one restaurant.
        setActiveRestaurantId: () => {},
        me,
        isOnline: data?.isOnline ?? false,
        setOnline,
        myLocation,
        routeEstimate: data?.routeEstimate ?? null,
        earnings: data?.earnings ?? null,
        currentBatchId: data?.currentBatchId ?? null,
        driverBatchStatus: data?.driverBatchStatus ?? 'declined',
        activeStopIndex: data?.activeStopIndex ?? 0,
        acceptCurrentBatch,
        declineCurrentBatch,
        advanceActiveStop,
        findNewOrders,
        appendOrderToDriverBatch,
        uploadDriverKycDoc,
        scanReceipt,
        publishScannedOrder,
        markOrderReady,
        addRestaurantOwnDriver,
        updateRestaurantPolicy,
        pricingSummary: data?.pricingSummary ?? null,
        totals: data?.totals ?? null,
        approveDriverKyc,
        rejectDriverKyc,
        updateAlgorithmConfig,
        updateSteppedPayoutAt,
      }}>
      {children}
    </InThaRouteContext.Provider>
  );
}

export function useInThaRoute() {
  const ctx = useContext(InThaRouteContext);
  if (!ctx) {
    throw new Error('useInThaRoute must be used inside InThaRouteProvider');
  }
  return ctx;
}
