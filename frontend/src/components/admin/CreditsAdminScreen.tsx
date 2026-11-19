"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Coins, CreditCard, Gift, PiggyBank, Search, Store, Truck, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AnimatedNumber, Badge, Button, Card, CardHeader, EmptyState, LiveDot, Segmented, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAdmin } from "@/lib/admin-store";
import { cn, formatGbp, shortName } from "@/lib/format";
import type { CreditKind, CreditTransaction, RestaurantPartner } from "@/lib/types";
import { CreditAdjustDialog } from "./MerchantDialogs";

const KIND: Record<CreditKind, { label: string; icon: React.ReactNode; tone: string }> = {
  purchase: { label: "Payment", icon: <CreditCard className="size-4" />, tone: "bg-success-soft text-success" },
  grant: { label: "Free credits", icon: <Gift className="size-4" />, tone: "bg-info-soft text-info" },
  adjustment: { label: "Adjustment", icon: <Wrench className="size-4" />, tone: "bg-warning-soft text-warning" },
  delivery: { label: "Delivery", icon: <Truck className="size-4" />, tone: "bg-surface-alt text-ink-2" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Filter = "all" | CreditKind;
type Sort = "available" | "paid" | "used" | "name";

/** Merchant credits: who paid, how much they bought and used, live. */
export function CreditsAdminScreen() {
  const { data, syncedAt } = useAdmin();
  const [filter, setFilter] = useState<Filter>("all");
  const [tx, setTx] = useState<CreditTransaction[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("available");
  const [adjust, setAdjust] = useState<RestaurantPartner | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // Re-read the activity with every dashboard refresh (every 10 s) and when the filter changes.
  useEffect(() => {
    let cancelled = false;
    api<{ transactions: CreditTransaction[] }>("admin", "GET", `/api/admin/credits?limit=150${filter === "all" ? "" : `&kind=${filter}`}`)
      .then((r) => {
        if (cancelled) return;
        // New rows since the last read glow briefly.
        if (seen.current) {
          const added = r.transactions.filter((t) => !seen.current!.has(t.id)).map((t) => t.id);
          if (added.length) setFresh(new Set(added));
        }
        seen.current = new Set(r.transactions.map((t) => t.id));
        setTx(r.transactions);
      })
      .catch(() => !cancelled && setTx((t) => t ?? []));
    return () => {
      cancelled = true;
    };
  }, [filter, syncedAt]);

  useEffect(() => {
    seen.current = null;
  }, [filter]);

  const restaurants = useMemo(() => data?.restaurants ?? [], [data]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return restaurants
      .filter((r) => !q || `${r.name} ${r.postcode} ${r.ownerEmail ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const ca = a.credits;
        const cb = b.credits;
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "paid") return (cb?.paidGbp ?? 0) - (ca?.paidGbp ?? 0);
        if (sort === "used") return (cb?.usedCredits ?? 0) - (ca?.usedCredits ?? 0);
        return (ca?.available ?? 0) - (cb?.available ?? 0);
      });
  }, [restaurants, query, sort]);

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const sum = (f: (r: RestaurantPartner) => number) => restaurants.reduce((s, r) => s + f(r), 0);
  const paid = sum((r) => r.credits?.paidGbp ?? 0);
  const purchased = sum((r) => r.credits?.purchasedCredits ?? 0);
  const used = sum((r) => r.credits?.usedCredits ?? 0);
  const outstanding = sum((r) => Math.max(0, r.credits?.balance ?? 0));
  const low = restaurants.filter((r) => r.isActive !== false && (r.credits?.available ?? 0) < (r.feePerDeliveryGbp ?? 0)).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi icon={<PiggyBank className="size-5" />} label="Paid by card" value={paid} format={formatGbp} tone="success" />
        <Kpi icon={<CreditCard className="size-5" />} label="Credits bought" value={purchased} tone="info" />
        <Kpi icon={<Truck className="size-5" />} label="Credits used" value={used} tone="brand" />
        <Kpi icon={<Coins className="size-5" />} label="Credits held by merchants" value={outstanding} hint={low ? `${low} merchant${low === 1 ? "" : "s"} can’t post` : undefined} />
      </div>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card className="overflow-hidden pb-2">
          <CardHeader
            title="Merchants"
            subtitle="Balance, purchases and usage per merchant"
            right={
              <span className="flex items-center gap-2 text-xs font-bold text-success">
                <LiveDot /> Live
              </span>
            }
          />
          <div className="flex flex-col gap-3 px-6 pt-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search merchant"
                className="h-10 w-full rounded-2xl border border-line-strong bg-surface pr-4 pl-11 text-sm outline-none focus:border-ink"
              />
            </div>
            <Segmented<Sort>
              size="sm"
              value={sort}
              onChange={setSort}
              options={[
                { value: "available", label: "Lowest" },
                { value: "paid", label: "Paid" },
                { value: "used", label: "Used" },
                { value: "name", label: "A–Z" },
              ]}
            />
          </div>
          <div className="scroll-thin mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-alt/50 text-left text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">
                  <th className="px-6 py-3">Merchant</th>
                  <th className="px-3 py-3 text-right">Available</th>
                  <th className="px-3 py-3 text-right">Bought</th>
                  <th className="px-3 py-3 text-right">Used</th>
                  <th className="px-3 py-3 text-right">Paid</th>
                  <th className="px-3 py-3">Last payment</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const c = r.credits;
                  const isLow = (c?.available ?? 0) < (r.feePerDeliveryGbp ?? 0);
                  return (
                    <tr key={r.id} className={cn("transition hover:bg-surface-alt/40", r.isActive === false && "opacity-60")}>
                      <td className="px-6 py-3">
                        <p className="flex items-center gap-2 font-bold text-ink">
                          {shortName(r.name)}
                          {r.isActive === false && <Badge tone="brand">Disabled</Badge>}
                        </p>
                        <p className="text-xs text-ink-3">
                          {formatGbp(r.feePerDeliveryGbp ?? 0)}/delivery{r.customFeeGbp != null ? " · custom" : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <p className={cn("font-extrabold tabular", isLow ? "text-brand" : "text-ink")}>{(c?.available ?? 0).toFixed(2)}</p>
                        <p className="text-xs text-ink-3">{c?.deliveriesLeft == null ? "—" : `≈ ${c.deliveriesLeft} deliveries`}</p>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-ink-2 tabular">{(c?.purchasedCredits ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-ink-2 tabular">{(c?.usedCredits ?? 0).toFixed(2)}</td>
                      <td className="px-3 py-3 text-right font-bold text-success tabular">{formatGbp(c?.paidGbp ?? 0)}</td>
                      <td className="px-3 py-3 text-xs text-ink-3">{c?.lastPurchaseAt ? when(c.lastPurchaseAt) : "Never"}</td>
                      <td className="px-6 py-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => setAdjust(r)}>
                          Adjust
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <EmptyState icon={<Store className="size-6" />} title="No merchants found" />}
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden 2xl:max-h-[760px]">
          <CardHeader title="Activity" subtitle="Payments, free credits, adjustments and deliveries" />
          <div className="px-6 pt-4">
            <Segmented<Filter>
              size="sm"
              value={filter}
              onChange={(f) => {
                setFilter(f);
                setTx(null);
              }}
              options={[
                { value: "all", label: "All" },
                { value: "purchase", label: "Payments" },
                { value: "delivery", label: "Deliveries" },
                { value: "grant", label: "Free" },
                { value: "adjustment", label: "Manual" },
              ]}
            />
          </div>
          <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto">
            {tx == null ? (
              <div className="space-y-2 px-6 py-3">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : tx.length === 0 ? (
              <EmptyState icon={<Coins className="size-6" />} title="Nothing yet" body="Activity appears here as merchants buy and use credits." />
            ) : (
              <ul className="divide-y divide-line">
                <AnimatePresence initial={false}>
                  {tx.map((t) => (
                    <motion.li
                      key={t.id}
                      layout
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn("flex items-center gap-3 px-6 py-3 transition-colors duration-1000", fresh.has(t.id) && "bg-success-soft/60")}
                    >
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", KIND[t.kind].tone)}>{KIND[t.kind].icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {shortName(t.restaurantName)} · {t.kind === "delivery" ? `Delivery${t.externalOrderId ? ` ${t.externalOrderId}` : ""}` : KIND[t.kind].label}
                        </span>
                        <span className="block truncate text-xs text-ink-3">
                          {when(t.createdAt)}
                          {t.kind === "purchase" && t.amountPaidGbp != null ? ` · paid ${formatGbp(t.amountPaidGbp)} · successful` : ""}
                          {t.note && t.kind !== "purchase" ? ` · ${t.note}` : ""}
                          {t.createdByName && t.kind === "adjustment" ? ` · by ${t.createdByName}` : ""}
                        </span>
                      </span>
                      <span className={cn("flex items-center gap-1 text-sm font-extrabold tabular", t.credits >= 0 ? "text-success" : "text-ink")}>
                        {t.credits >= 0 ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                        {t.credits >= 0 ? "+" : "−"}
                        {Math.abs(t.credits).toFixed(2)}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </Card>
      </div>

      <CreditAdjustDialog merchant={adjust} onClose={() => setAdjust(null)} />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  format = (n) => n.toFixed(2),
  tone = "neutral",
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  format?: (n: number) => string;
  tone?: "neutral" | "success" | "info" | "brand";
  hint?: string;
}) {
  const tones = {
    neutral: "bg-surface-alt text-ink-2",
    success: "bg-success-soft text-success",
    info: "bg-info-soft text-info",
    brand: "bg-brand-soft text-brand",
  };
  return (
    <Card className="p-5">
      <span className={cn("grid size-11 place-items-center rounded-2xl", tones[tone])}>{icon}</span>
      <p className="mt-4 text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink">
        <AnimatedNumber value={value} format={format} />
      </p>
      {hint && <p className="mt-1 text-xs font-semibold text-brand">{hint}</p>}
    </Card>
  );
}
