"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import {
  API_URL,
  ApiError,
  accessToken,
  api,
  clearSession,
  endDisabled,
  errorMessage,
  getSession,
  onSessionChange,
} from "./api";
import type {
  AuthUser,
  CreditSummary,
  DriverPolicy,
  DriverProfile,
  LiveOrder,
  MerchantDashboard,
  ReceiptTemplate,
  RestaurantPartner,
  Vehicle,
} from "./types";

/**
 * The merchant's live state, shared by every merchant page.
 *
 * Same contract as the mobile app: `GET /api/restaurant/dashboard` is the
 * source of truth and every change endpoint answers with a fresh dashboard.
 * A WebSocket (`/ws`, the same one the app uses) says the moment an order
 * moves or a chat message arrives; a short poll keeps riders' positions and
 * everything else fresh. Open web tabs also tell each other straight away.
 */
const POLL_MS = 8_000;
const CHANNEL = "itr-merchant-sync";
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000];
const SOCKET_URL = `${API_URL.replace(/^http/, "ws")}/ws`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket events are plain JSON
export type SocketEvent = { type: string; [key: string]: any };

export type Dispatch = "open_platform" | "own_driver" | "hybrid";

export interface PostOrderInput {
  template: ReceiptTemplate;
  prepMinutes: number;
  dispatchType: Dispatch;
  ownDriverId?: string;
  address: string;
  postcode: string;
  accessCode: string;
  note: string;
}

export interface NewDriverInput {
  fullName: string;
  email: string;
  password: string;
  phone: string;
  vehicle: Vehicle;
  plateNumber: string;
}

interface MerchantState {
  user: AuthUser;
  data: MerchantDashboard | null;
  restaurant: RestaurantPartner | null;
  /** Live orders with countdowns ticking locally between refreshes. */
  orders: LiveOrder[];
  /** The merchant's own drivers. */
  drivers: DriverProfile[];
  credits: CreditSummary | null;
  error: string | null;
  syncedAt: number;
  syncing: boolean;
  /** The live socket is open (orders and messages arrive instantly). */
  connected: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  /** Listen to live socket events (chat uses this). */
  subscribe: (fn: (e: SocketEvent) => void) => () => void;
  scanReceipt: (file: File) => Promise<ReceiptTemplate>;
  postOrder: (input: PostOrderInput) => Promise<LiveOrder>;
  markReady: (id: string) => Promise<boolean>;
  cancelOrder: (id: string) => Promise<boolean>;
  findDriversAgain: (id: string) => Promise<boolean>;
  assignOwnDriver: (orderId: string, driverId: string) => Promise<boolean>;
  addDriver: (input: NewDriverInput) => Promise<void>;
  updatePolicy: (policy: DriverPolicy) => Promise<boolean>;
  /** Replace the credit summary (after a payment), without waiting for the next refresh. */
  setCredits: (c: CreditSummary) => void;
}

const MerchantContext = createContext<MerchantState | null>(null);

export function useMerchant() {
  const ctx = useContext(MerchantContext);
  if (!ctx) throw new Error("useMerchant must be used inside <MerchantProvider>");
  return ctx;
}

/** Shrinks a photo so it uploads quickly (the server reads it with OCR). */
async function photoToBase64(file: File): Promise<{ imageBase64: string; mimeType: string }> {
  const MAX = 2000;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new ApiError("That file isn’t a photo we can read. Try a JPG or PNG.", "BAD_IMAGE"));
      i.src = url;
    });
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ApiError("Your browser couldn’t read that photo.", "BAD_IMAGE");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    return { imageBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function MerchantProvider({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const toast = useToast();
  const [state, setState] = useState<{ data: MerchantDashboard | null; receivedAt: number }>({
    data: null,
    receivedAt: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const subscribers = useRef(new Set<(e: SocketEvent) => void>());

  const apply = useCallback((d: MerchantDashboard | undefined, seq: number) => {
    if (!d || seq < appliedSeq.current) return;
    appliedSeq.current = seq;
    setState({ data: d, receivedAt: Date.now() });
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!getSession("merchant")) return;
    const seq = ++requestSeq.current;
    setSyncing(true);
    try {
      apply(await api<MerchantDashboard>("merchant", "GET", "/api/restaurant/dashboard"), seq);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  }, [apply]);

  /** Calls a change endpoint that answers with `{ dashboard }`; throws on failure. */
  const change = useCallback(
    async <T extends { dashboard?: MerchantDashboard }>(
      method: "POST" | "PATCH",
      path: string,
      body?: unknown
    ): Promise<T> => {
      const seq = ++requestSeq.current;
      const res = await api<T>("merchant", method, path, body);
      apply(res.dashboard, seq);
      channel.current?.postMessage("changed");
      return res;
    },
    [apply]
  );

  /** Same, but reports the outcome as a toast and answers true/false. */
  const attempt = useCallback(
    async (method: "POST" | "PATCH", path: string, body?: unknown, success?: string) => {
      try {
        await change(method, path, body);
        if (success) toast({ tone: "success", title: success });
        return true;
      } catch (err) {
        toast({ tone: "error", title: "Couldn’t complete that", body: errorMessage(err) });
        refresh();
        return false;
      }
    },
    [change, refresh, toast]
  );

  // Load now, poll while visible, re-read when the tab comes back.
  useEffect(() => {
    // Fetching from the API is the external system this effect syncs with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    let timer: ReturnType<typeof setInterval> | null = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
        if (!timer) timer = setInterval(refresh, POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    if ("BroadcastChannel" in window) {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = () => refresh();
    }
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      channel.current?.close();
      channel.current = null;
    };
  }, [refresh]);

  // The live socket: the same one the app opens. Reconnects with back-off.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let attemptNo = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const scheduleReconnect = () => {
      if (stopped) return;
      const delay = RECONNECT_DELAYS[Math.min(attemptNo, RECONNECT_DELAYS.length - 1)];
      attemptNo += 1;
      retryTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (stopped) return;
      let token: string;
      try {
        token = await accessToken("merchant");
      } catch {
        scheduleReconnect();
        return;
      }
      if (stopped) return;
      const socket = new WebSocket(SOCKET_URL);
      ws = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token }));
      socket.onmessage = (e) => {
        let event: SocketEvent;
        try {
          event = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (event.type === "ready") {
          attemptNo = 0;
          setConnected(true);
          pingTimer = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
          }, 25_000);
          refreshRef.current();
        } else if (event.type === "orders") {
          refreshRef.current();
        } else if (event.type === "error" && event.code === "ACCOUNT_DISABLED") {
          stopped = true;
          endDisabled("merchant");
        } else if (event.type === "error" && event.code === "TOKEN_EXPIRED") {
          // The next connect asks for a fresh token.
        }
        subscribers.current.forEach((fn) => fn(event));
      };
      socket.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        setConnected(false);
        scheduleReconnect();
      };
      socket.onerror = () => {};
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      ws?.close(1000);
    };
  }, []);

  // One clock for every countdown on screen.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const orders = useMemo<LiveOrder[]>(() => {
    if (!state.data) return [];
    const elapsed = Math.max(0, Math.floor((now - state.receivedAt) / 1000));
    return state.data.orders.map((o) =>
      o.status === "delivered"
        ? o
        : {
            ...o,
            remainingSeconds: Math.max(0, o.remainingSeconds - elapsed),
            poolSecondsLeft: o.poolSecondsLeft === undefined ? undefined : Math.max(0, o.poolSecondsLeft - elapsed),
          }
    );
  }, [state, now]);

  const data = state.data;
  const restaurant = data?.restaurants.find((r) => r.id === data.activeRestaurantId) ?? data?.restaurants[0] ?? null;
  const drivers = useMemo(
    () => (data?.drivers ?? []).filter((d) => d.driverType === "restaurant_own"),
    [data]
  );

  const subscribe = useCallback((fn: (e: SocketEvent) => void) => {
    subscribers.current.add(fn);
    return () => {
      subscribers.current.delete(fn);
    };
  }, []);

  const scanReceipt = async (file: File) => {
    const photo = await photoToBase64(file);
    const { draft } = await api<{ draft: ReceiptTemplate }>("merchant", "POST", "/api/restaurant/receipts/scan", photo);
    return draft;
  };

  const postOrder = async ({ template, prepMinutes, dispatchType, ownDriverId, address, postcode, accessCode, note }: PostOrderInput) => {
    const res = await change<{ order: LiveOrder; dashboard: MerchantDashboard }>("POST", "/api/restaurant/orders", {
      source: template.source,
      externalOrderId: template.externalOrderId,
      customerName: template.customerName,
      customerPhone: template.customerPhone,
      phoneAccessCode: accessCode,
      directCustomerPhone: template.directCustomerPhone ?? "",
      deliveryAddress: address || template.deliveryAddress,
      postcode: postcode || template.postcode,
      deliveryInstructions: note,
      orderTotalGbp: template.orderTotalGbp,
      items: template.items.filter((i) => i.name && i.quantity > 0),
      prepMinutes,
      dispatchType,
      ...(dispatchType === "own_driver" && { ownDriverId }),
      ...(template.receiptFileId && { receiptFileId: template.receiptFileId }),
    });
    return res.order;
  };

  const updatePolicy = async (policy: DriverPolicy) => {
    const previous = restaurant?.driverPolicy;
    const patch = (p: DriverPolicy) =>
      setState((prev) =>
        prev.data
          ? { ...prev, data: { ...prev.data, restaurants: prev.data.restaurants.map((r) => ({ ...r, driverPolicy: p })) } }
          : prev
      );
    patch(policy);
    const ok = await attempt("PATCH", "/api/restaurant/policy", { driverPolicy: policy }, "Delivery settings saved");
    if (!ok && previous) patch(previous);
    return ok;
  };

  const value: MerchantState = {
    user,
    data,
    restaurant,
    orders,
    drivers,
    credits: data?.credits ?? null,
    error,
    syncedAt: state.receivedAt,
    syncing,
    connected,
    refresh,
    logout: () => clearSession("merchant"),
    subscribe,
    scanReceipt,
    postOrder,
    markReady: (id) => attempt("POST", `/api/restaurant/orders/${id}/ready`, undefined, "Marked ready"),
    cancelOrder: (id) => attempt("POST", `/api/restaurant/orders/${id}/cancel`, {}, "Order cancelled"),
    findDriversAgain: (id) =>
      attempt("POST", `/api/restaurant/orders/${id}/find-drivers`, undefined, "Looking for drivers again"),
    assignOwnDriver: (orderId, driverId) =>
      attempt("POST", `/api/restaurant/orders/${orderId}/assign-driver`, { ownDriverId: driverId }, "Given to your driver"),
    addDriver: async (input) => {
      await change("POST", "/api/restaurant/drivers", {
        fullName: input.fullName,
        email: input.email,
        password: input.password,
        phone: input.phone,
        vehicle: input.vehicle,
        ...(input.plateNumber && { plateNumber: input.plateNumber }),
      });
    },
    updatePolicy,
    setCredits: (c) => setState((prev) => (prev.data ? { ...prev, data: { ...prev.data, credits: c } } : prev)),
  };

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

/** The signed-in merchant (or null), kept in step with other tabs. `undefined` until read. */
export function useMerchantSession() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => {
    const read = () => {
      const s = getSession("merchant");
      setUser(s && s.user.role === "restaurant" ? s.user : null);
    };
    read();
    return onSessionChange((p) => p === "merchant" && read());
  }, []);
  return user;
}

/** Waiting in the open pool with its time run out: nobody took it. */
export const isWaiting = (o: LiveOrder) =>
  o.dispatchType === "open_platform" &&
  !o.batchId &&
  (o.status === "preparing" || o.status === "ready_for_pickup") &&
  o.poolSecondsLeft === 0;
