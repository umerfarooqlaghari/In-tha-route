"use client";

import { motion } from "motion/react";
import { Ban, CheckCheck, Coins, Info, MapPin, Pencil, Phone, Power, Search, Store, UserRound, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge, Button, Card, ConfirmDialog, EmptyState, Segmented, Skeleton } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import { cn, formatGbp, shortName } from "@/lib/format";
import type { DriverPolicy, RestaurantPartner } from "@/lib/types";
import { CreditAdjustDialog, FeeDialog } from "./MerchantDialogs";

const POLICY_HELP: Record<DriverPolicy, string> = {
  open_platform: "Orders go to platform drivers.",
  hybrid: "Orders go to the merchant’s own drivers and platform drivers.",
  own_drivers: "Only the merchant’s own drivers deliver. No platform fee.",
};

export function MerchantsScreen() {
  const { data, updatePolicy, setMerchantActive } = useAdmin();
  const [query, setQuery] = useState("");
  const [feeFor, setFeeFor] = useState<RestaurantPartner | null>(null);
  const [creditsFor, setCreditsFor] = useState<RestaurantPartner | null>(null);
  const [toggleFor, setToggleFor] = useState<RestaurantPartner | null>(null);
  const restaurants = data?.restaurants;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (restaurants ?? []).filter(
      (r) => !q || [r.name, r.address, r.postcode, r.phone, r.ownerName ?? "", r.ownerEmail ?? ""].join(" ").toLowerCase().includes(q)
    );
  }, [restaurants, query]);

  if (!data) {
    return (
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-60 rounded-3xl" />
        ))}
      </div>
    );
  }

  const counts = {
    open_platform: data.restaurants.filter((r) => r.driverPolicy === "open_platform").length,
    hybrid: data.restaurants.filter((r) => r.driverPolicy === "hybrid").length,
    own_drivers: data.restaurants.filter((r) => r.driverPolicy === "own_drivers").length,
  };

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search merchant, address or postcode"
              className="h-11 w-full rounded-2xl border border-line-strong bg-surface pr-4 pl-11 text-sm outline-none transition focus:border-ink focus:shadow-[0_0_0_4px_rgb(20_21_26/0.06)]"
            />
          </div>
          <div className="flex gap-2 text-[12px] font-semibold">
            <span className="rounded-full bg-surface-alt px-3 py-1.5 text-ink-2">Platform · {counts.open_platform}</span>
            <span className="rounded-full bg-surface-alt px-3 py-1.5 text-ink-2">Hybrid · {counts.hybrid}</span>
            <span className="rounded-full bg-surface-alt px-3 py-1.5 text-ink-2">Own · {counts.own_drivers}</span>
            {data.restaurants.some((r) => r.isActive === false) && (
              <span className="rounded-full bg-brand-soft px-3 py-1.5 text-brand">
                Disabled · {data.restaurants.filter((r) => r.isActive === false).length}
              </span>
            )}
          </div>
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<Store className="size-6" />} title="No merchants found" />
        </Card>
      ) : (
        <div className="grid items-start gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: Math.min(i, 9) * 0.05, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "group overflow-hidden rounded-3xl border bg-surface shadow-[var(--shadow-card)] transition-shadow hover:shadow-[0_20px_50px_-24px_rgb(0_0_0/0.3)]",
                r.isActive === false ? "border-brand-line" : "border-line"
              )}
            >
              <div className={cn("relative h-16 overflow-hidden", r.isActive === false ? "bg-ink-3" : "brand-gradient")}>
                {r.isActive === false && (
                  <span className="absolute top-3 right-3 z-10">
                    <Badge tone="brand" className="bg-white">
                      <Ban className="size-3" /> Disabled
                    </Badge>
                  </span>
                )}
                <svg className="absolute inset-0 h-full w-full opacity-40" preserveAspectRatio="none" viewBox="0 0 300 60" aria-hidden>
                  <path d="M-10 45 C 60 10, 120 60, 190 25 S 280 5, 320 30" fill="none" stroke="#F5B014" strokeWidth="1.5" strokeDasharray="5 7" className="animate-dash" />
                </svg>
              </div>
              <div className="-mt-8 px-5 pb-5">
                <div className="relative z-10 grid size-14 place-items-center rounded-2xl border-4 border-surface bg-ink text-white shadow-lg transition-transform duration-500 group-hover:-rotate-6">
                  <Store className="size-6" />
                </div>
                <h3 className="mt-3 truncate text-[17px] font-extrabold tracking-tight text-ink">{shortName(r.name)}</h3>
                <div className="mt-1.5 space-y-1 text-[13px] text-ink-3">
                  <p className="flex items-start gap-1.5">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" />
                    <span className="line-clamp-2">
                      {r.address} · {r.postcode}
                    </span>
                  </p>
                  {r.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone className="size-3.5 shrink-0" /> {r.phone}
                    </p>
                  )}
                  {(r.ownerName || r.ownerEmail) && (
                    <p className="flex items-center gap-1.5 truncate">
                      <UserRound className="size-3.5 shrink-0" /> {[r.ownerName, r.ownerEmail].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl bg-surface-alt/70 p-3">
                    <p className="flex items-center gap-1.5 text-xl font-extrabold text-ink tabular">
                      <Zap className="size-4 text-brand" /> {r.activeOrdersCount}
                    </p>
                    <p className="text-[12px] font-semibold text-ink-3">Live now</p>
                  </div>
                  <div className="rounded-2xl bg-surface-alt/70 p-3">
                    <p className="flex items-center gap-1.5 text-xl font-extrabold text-ink tabular">
                      <CheckCheck className="size-4 text-success" /> {r.completedTodayCount}
                    </p>
                    <p className="text-[12px] font-semibold text-ink-3">Delivered today</p>
                  </div>
                </div>

                <p className="mt-5 mb-2 text-[11px] font-bold tracking-[0.14em] text-ink-3 uppercase">Who delivers</p>
                <Segmented<DriverPolicy>
                  value={r.driverPolicy}
                  onChange={(p) => updatePolicy(r.id, p)}
                  size="sm"
                  options={[
                    { value: "open_platform", label: "Platform" },
                    { value: "hybrid", label: "Hybrid" },
                    { value: "own_drivers", label: "Own" },
                  ]}
                />
                <p className="mt-2 flex items-start gap-1.5 text-[12px] text-ink-3">
                  <Info className="mt-px size-3.5 shrink-0" /> {POLICY_HELP[r.driverPolicy]}
                </p>
                {r.pickupSafetyNote && (
                  <p className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-[12px] text-ink-2">
                    <b className="text-warning">Pickup note:</b> {r.pickupSafetyNote}
                  </p>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => setFeeFor(r)}
                    className="group/fee rounded-2xl border border-line p-3 text-left transition hover:border-ink-3"
                  >
                    <p className="flex items-center justify-between text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">
                      Fee <Pencil className="size-3.5 opacity-0 transition group-hover/fee:opacity-100" />
                    </p>
                    <p className="mt-1 text-lg font-extrabold text-ink tabular">{formatGbp(r.feePerDeliveryGbp ?? data.algorithm.baseRestaurantChargeGbp)}</p>
                    <p className={cn("text-[12px] font-semibold", r.customFeeGbp != null ? "text-info" : "text-ink-3")}>
                      {r.customFeeGbp != null ? "Custom rate" : "Standard"}
                    </p>
                  </button>
                  <button
                    onClick={() => setCreditsFor(r)}
                    className="group/cr rounded-2xl border border-line p-3 text-left transition hover:border-ink-3"
                  >
                    <p className="flex items-center justify-between text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">
                      Credits <Pencil className="size-3.5 opacity-0 transition group-hover/cr:opacity-100" />
                    </p>
                    <p
                      className={cn(
                        "mt-1 flex items-center gap-1.5 text-lg font-extrabold tabular",
                        (r.credits?.available ?? 0) < (r.feePerDeliveryGbp ?? 0) ? "text-brand" : "text-ink"
                      )}
                    >
                      <Coins className="size-4 text-road" /> {(r.credits?.available ?? 0).toFixed(2)}
                    </p>
                    <p className="text-[12px] font-semibold text-ink-3">
                      {r.credits?.deliveriesLeft == null ? "—" : `≈ ${r.credits.deliveriesLeft} deliveries`} · {(r.credits?.usedCredits ?? 0).toFixed(0)} used
                    </p>
                  </button>
                </div>

                <Button
                  size="sm"
                  variant={r.isActive === false ? "success" : "ghost"}
                  icon={<Power className="size-4" />}
                  className={cn("mt-4 w-full", r.isActive !== false && "text-brand ring-1 ring-brand-line hover:bg-brand-soft hover:text-brand")}
                  onClick={() => (r.isActive === false ? setMerchantActive(r.id, true) : setToggleFor(r))}
                >
                  {r.isActive === false ? "Enable merchant" : "Disable merchant"}
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <FeeDialog merchant={feeFor} onClose={() => setFeeFor(null)} />
      <CreditAdjustDialog merchant={creditsFor} onClose={() => setCreditsFor(null)} />
      <ConfirmDialog
        open={!!toggleFor}
        title={`Disable ${toggleFor ? shortName(toggleFor.name) : "this merchant"}?`}
        body="They are signed out on the web and in the app straight away and can’t sign in until you enable them again. Their orders, drivers and credits are kept."
        confirmLabel="Disable"
        onConfirm={() => (toggleFor ? setMerchantActive(toggleFor.id, false) : undefined)}
        onClose={() => setToggleFor(null)}
      />
    </div>
  );
}
