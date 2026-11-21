"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { api, clearSession, errorMessage, getSession, onSessionChange } from "./api";
import type { AdminDashboard, AlgorithmConfig, AuthUser, LiveOrder } from "./types";

/**
 * The admin's live state, shared by every admin page.
 *
 * Same contract as the mobile app: `GET /api/admin/dashboard` is the single
 * source of truth, every change endpoint answers with a fresh dashboard, and
 * the data is re-read on a short interval and whenever the tab comes back into
 * view. Changes made from the phone show up here (and the other way round)
 * within seconds. Open web tabs also tell each other straight away.
 */
const POLL_MS = 10_000;
const CHANNEL = "itr-admin-sync";

interface AdminState {
  user: AuthUser | null;
  data: AdminDashboard | null;
  /** Orders with countdowns ticking locally between refreshes. */
  orders: LiveOrder[];
  error: string | null;
  syncedAt: number;
  syncing: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  cancelOrder: (id: string, reason?: string) => Promise<boolean>;
  releaseOrder: (id: string) => Promise<boolean>;
  approveDriver: (id: string) => Promise<boolean>;
  rejectDriver: (id: string, reason?: string) => Promise<boolean>;
  /** When a driver's document runs out (YYYY-MM-DD); null clears it. */
  setDocumentExpiry: (documentId: string, expiresOn: string | null) => Promise<boolean>;
  updateAlgorithm: (partial: Partial<AlgorithmConfig>) => Promise<boolean>;
  updateSteppedPayoutAt: (index: number, amountGbp: number) => Promise<boolean>;
  /** A merchant's own per-delivery fee; null goes back to the standard fee. */
  updateMerchantFee: (restaurantId: string, feeGbp: number | null) => Promise<boolean>;
  /** Disable (signed out everywhere, can't sign in) or enable a merchant account. */
  setMerchantActive: (restaurantId: string, active: boolean) => Promise<boolean>;
  /** Add (positive) or remove (negative) credits by hand. */
  adjustCredits: (restaurantId: string, credits: number, note: string) => Promise<boolean>;
}

const AdminContext = createContext<AdminState | null>(null);

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminProvider>");
  return ctx;
}

export function AdminProvider({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const toast = useToast();
  const [state, setState] = useState<{ data: AdminDashboard | null; receivedAt: number }>({
    data: null,
    receivedAt: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Responses are applied only if no newer request has been applied already,
  // so a slow poll never overwrites the result of a later change.
  const requestSeq = useRef(0);
  const appliedSeq = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  const apply = useCallback((d: AdminDashboard | undefined, seq: number) => {
    if (!d || seq < appliedSeq.current) return;
    appliedSeq.current = seq;
    setState({ data: d, receivedAt: Date.now() });
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!getSession("admin")) return;
    const seq = ++requestSeq.current;
    setSyncing(true);
    try {
      apply(await api<AdminDashboard>("admin", "GET", "/api/admin/dashboard"), seq);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  }, [apply]);

  /** Calls a change endpoint that answers with `{ dashboard }`; shows errors as a toast. */
  const attempt = useCallback(
    async (method: "POST" | "PUT" | "PATCH", path: string, body?: unknown, success?: string) => {
      const seq = ++requestSeq.current;
      try {
        const res = await api<{ dashboard?: AdminDashboard }>("admin", method, path, body);
        apply(res.dashboard, seq);
        channel.current?.postMessage("changed");
        if (success) toast({ tone: "success", title: success });
        return true;
      } catch (err) {
        toast({ tone: "error", title: "Couldn’t complete that", body: errorMessage(err) });
        return false;
      }
    },
    [apply, toast]
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

  const patch = (fn: (d: AdminDashboard) => AdminDashboard) =>
    setState((prev) => (prev.data ? { ...prev, data: fn(prev.data) } : prev));

  const updateAlgorithm = async (partial: Partial<AlgorithmConfig>) => {
    // Steppers can be clicked quickly: show the value now so the next click
    // builds on it. All money figures still come from the server's answer.
    patch((d) => ({ ...d, algorithm: { ...d.algorithm, ...partial } }));
    const ok = await attempt("PUT", "/api/admin/pricing", partial);
    if (!ok) refresh();
    return ok;
  };

  const updateSteppedPayoutAt = (index: number, amountGbp: number) => {
    const steps = [...(state.data?.algorithm.steppedDriverPayoutsGbp ?? [])];
    steps[index] = Number(Math.max(0.5, amountGbp).toFixed(2));
    return updateAlgorithm({ steppedDriverPayoutsGbp: steps });
  };

  const value: AdminState = {
    user,
    data: state.data,
    orders,
    error,
    syncedAt: state.receivedAt,
    syncing,
    refresh,
    logout: () => clearSession("admin"),
    cancelOrder: (id, reason) =>
      attempt("POST", `/api/admin/orders/${id}/cancel`, reason ? { reason } : {}, "Order cancelled"),
    releaseOrder: (id) => attempt("POST", `/api/admin/orders/${id}/release`, undefined, "Order offered to other drivers"),
    approveDriver: (id) => attempt("POST", `/api/admin/drivers/${id}/approve`, undefined, "Driver approved"),
    setDocumentExpiry: (documentId, expiresOn) =>
      attempt(
        "PATCH",
        `/api/admin/kyc-documents/${documentId}/expiry`,
        { expiresOn },
        expiresOn ? "Expiry date saved" : "Expiry date removed"
      ),
    rejectDriver: (id, reason) =>
      attempt("POST", `/api/admin/drivers/${id}/reject`, reason ? { reason } : {}, "Driver rejected"),
    updateAlgorithm,
    updateSteppedPayoutAt,
    updateMerchantFee: (id, fee) =>
      attempt("PATCH", `/api/admin/restaurants/${id}/fee`, { customFeeGbp: fee }, fee == null ? "Back to the standard fee" : "Merchant fee saved"),
    setMerchantActive: (id, active) =>
      attempt("PATCH", `/api/admin/restaurants/${id}/status`, { active }, active ? "Merchant enabled" : "Merchant disabled"),
    adjustCredits: (id, credits, note) =>
      attempt("POST", `/api/admin/restaurants/${id}/credits`, { credits, note }, credits > 0 ? "Credits added" : "Credits removed"),
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

/** The signed-in admin (or null), kept in step with other tabs. `undefined` until read. */
export function useAdminSession() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => {
    const read = () => {
      const s = getSession("admin");
      setUser(s && s.user.role === "admin" ? s.user : null);
    };
    read();
    return onSessionChange((p) => p === "admin" && read());
  }, []);
  return user;
}
