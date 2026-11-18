"use client";

import { motion } from "motion/react";
import { CheckCheck, Info, MapPin, Phone, Search, Store, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { Card, EmptyState, Segmented, Skeleton } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import { shortName } from "@/lib/format";
import type { DriverPolicy } from "@/lib/types";

const POLICY_HELP: Record<DriverPolicy, string> = {
  open_platform: "Orders go to platform drivers.",
  hybrid: "Orders go to the merchant’s own drivers and platform drivers.",
  own_drivers: "Only the merchant’s own drivers deliver. No platform fee.",
};

export function MerchantsScreen() {
  const { data, updatePolicy } = useAdmin();
  const [query, setQuery] = useState("");
  const restaurants = data?.restaurants;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (restaurants ?? []).filter(
      (r) => !q || [r.name, r.address, r.postcode, r.phone].join(" ").toLowerCase().includes(q)
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
              className="group overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow-card)] transition-shadow hover:shadow-[0_20px_50px_-24px_rgb(0_0_0/0.3)]"
            >
              <div className="brand-gradient relative h-16 overflow-hidden">
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
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
