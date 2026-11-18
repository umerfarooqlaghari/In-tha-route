"use client";

import { AnimatePresence, motion } from "motion/react";
import { ReceiptText, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Card, EmptyState, Skeleton } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import { cn, formatGbp, isLive, shortName } from "@/lib/format";
import type { LiveOrder } from "@/lib/types";
import { OrderCard } from "./OrderCard";

type Filter = "live" | "attention" | "waiting" | "moving" | "delivered" | "cancelled";

const FILTERS: { key: Filter; label: string; test: (o: LiveOrder) => boolean }[] = [
  { key: "live", label: "All live", test: isLive },
  { key: "attention", label: "Needs attention", test: (o) => isLive(o) && !!o.attention },
  {
    key: "waiting",
    label: "Waiting for driver",
    test: (o) => o.status === "preparing" || o.status === "ready_for_pickup" || o.status === "batched_offered",
  },
  { key: "moving", label: "With a driver", test: (o) => o.status === "driver_assigned" || o.status === "picked_up" },
  { key: "delivered", label: "Delivered today", test: (o) => o.status === "delivered" },
  { key: "cancelled", label: "Cancelled today", test: (o) => o.status === "cancelled" },
];

export function OrdersScreen() {
  const { data, orders } = useAdmin();
  const [filter, setFilter] = useState<Filter>("live");
  const [query, setQuery] = useState("");
  const [merchant, setMerchant] = useState("all");

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, orders.filter(f.test).length])) as Record<Filter, number>,
    [orders]
  );

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    return orders.filter(
      (o) =>
        f.test(o) &&
        (merchant === "all" || o.restaurantId === merchant) &&
        (!q ||
          [o.externalOrderId, o.restaurantName, o.customerName, o.postcode, o.deliveryAddress, o.assignedDriverName ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q))
    );
  }, [orders, filter, query, merchant]);

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-3xl" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  const margin = shown
    .filter((o) => o.status !== "cancelled" && o.dispatchType === "open_platform")
    .reduce((s, o) => s + (o.platformMarginGbp ?? o.restaurantFeeGbp - o.driverPayoutGbp), 0);

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order number, merchant, customer, postcode or driver"
              className="h-11 w-full rounded-2xl border border-line-strong bg-surface pr-4 pl-11 text-sm outline-none transition focus:border-ink focus:shadow-[0_0_0_4px_rgb(20_21_26/0.06)]"
            />
          </div>
          <select
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            className="h-11 rounded-2xl border border-line-strong bg-surface px-4 text-sm font-semibold text-ink outline-none focus:border-ink"
            aria-label="Merchant"
          >
            <option value="all">All merchants</option>
            {data.restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {shortName(r.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="scroll-thin mt-4 -mb-1 flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors",
                  active ? "text-white" : "text-ink-2 hover:bg-surface-alt"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="order-filter"
                    className="absolute inset-0 rounded-full bg-ink"
                    transition={{ type: "spring", stiffness: 450, damping: 36 }}
                  />
                )}
                <span className="relative">{f.label}</span>
                <span
                  className={cn(
                    "relative rounded-full px-1.5 text-[11px] font-bold tabular",
                    active
                      ? "bg-white/20"
                      : f.key === "attention" && counts.attention
                        ? "bg-brand text-white"
                        : "bg-surface-alt text-ink-3"
                  )}
                >
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="flex items-center justify-between px-1 text-sm text-ink-3">
        <span>
          Showing <b className="text-ink">{shown.length}</b> order{shown.length === 1 ? "" : "s"}
        </span>
        {margin > 0 && (
          <span>
            Platform margin <b className="text-success tabular">{formatGbp(margin)}</b>
          </span>
        )}
      </div>

      <div className="space-y-3">
        {shown.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ReceiptText className="size-6" />}
              title="No orders here"
              body={query ? "Try a different search." : "Orders show up here as soon as they match this filter."}
            />
          </Card>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((o, i) => (
              <OrderCard key={o.id} order={o} index={i} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
