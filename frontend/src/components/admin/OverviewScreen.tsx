"use client";

import { AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Bike,
  CheckCheck,
  Coins,
  PiggyBank,
  ReceiptText,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { AnimatedNumber, Card, CardHeader, EmptyState, LiveDot, Skeleton } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import { cn, formatGbp, isLive, shortName, sourceColor, sourceLabel } from "@/lib/format";
import { pinFor } from "@/lib/geo";
import { BarList, Columns, Donut } from "./charts";
import { LiveMap, type MapPin } from "./LiveMap";
import { OrderCard } from "./OrderCard";

export function OverviewScreen() {
  const { data, orders } = useAdmin();

  const live = useMemo(() => orders.filter(isLive), [orders]);
  const drivers = useMemo(() => data?.drivers ?? [], [data]);
  const restaurants = useMemo(() => data?.restaurants ?? [], [data]);
  const liveDrivers = useMemo(() => drivers.filter((d) => d.isOnline && d.location), [drivers]);

  const pins = useMemo<MapPin[]>(
    () => [
      ...restaurants.map((r) => {
        const c = pinFor(r.postcode, r.coords);
        return {
          id: `r-${r.id}`,
          kind: "restaurant" as const,
          lat: c.latitude,
          lng: c.longitude,
          popup: [shortName(r.name), `${r.postcode} · ${r.activeOrdersCount} live`],
        };
      }),
      ...live.map((o, i) => {
        const c = pinFor(o.postcode, o.dropoffCoords);
        return {
          id: `o-${o.id}`,
          kind: "dropoff" as const,
          label: `${i + 1}`,
          color: sourceColor(o.source),
          lat: c.latitude,
          lng: c.longitude,
          popup: [`${shortName(o.restaurantName)} · ${o.externalOrderId}`, `${o.customerName} · ${o.postcode}`],
        };
      }),
      ...liveDrivers.map((d) => ({
        id: `d-${d.id}`,
        kind: "driver" as const,
        lat: d.location!.latitude,
        lng: d.location!.longitude,
        popup: [d.name, `${d.activeOrders ?? 0} active order${d.activeOrders === 1 ? "" : "s"}`],
      })),
    ],
    [restaurants, live, liveDrivers]
  );

  if (!data) return <OverviewSkeleton />;

  const totals = data.totals ?? { billedGbp: 0, driverPayGbp: 0, profitGbp: 0 };
  const deliveredToday = orders.filter((o) => o.status === "delivered").length;
  const attention = live.filter((o) => o.attention);

  const bySource = new Map<string, number>();
  orders
    .filter((o) => o.status !== "cancelled")
    .forEach((o) => bySource.set(sourceLabel(o.source), (bySource.get(sourceLabel(o.source)) ?? 0) + 1));
  const sourceSlices = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      key: label,
      label,
      value,
      color: sourceColor(label === "Direct" ? "Eat Presto POS" : label),
    }));

  const count = (...s: string[]) => orders.filter((o) => s.includes(o.status)).length;
  const pipeline = [
    { key: "wait", label: "Waiting", value: count("preparing", "ready_for_pickup"), color: "#C27803" },
    { key: "offer", label: "Offered", value: count("batched_offered"), color: "#7A5AF8" },
    { key: "way", label: "On the way", value: count("driver_assigned"), color: "#2F6FED" },
    { key: "coll", label: "Collected", value: count("picked_up"), color: "#E5484D" },
    { key: "done", label: "Delivered", value: count("delivered"), color: "#14A35A" },
  ];

  const merchantRows = [...restaurants]
    .sort((a, b) => b.activeOrdersCount + b.completedTodayCount - (a.activeOrdersCount + a.completedTodayCount))
    .slice(0, 6)
    .map((r) => ({
      key: r.id,
      label: shortName(r.name),
      value: r.activeOrdersCount + r.completedTodayCount,
      sub: `${r.activeOrdersCount} live`,
      color: "linear-gradient(90deg, var(--color-crimson-700), var(--color-brand))",
    }));

  const platform = drivers.filter((d) => d.driverType === "platform_contracted");
  const pendingDrivers = platform.filter(
    (d) => d.approval === "pending" || (d.approval === "approved" && d.kycDocuments.some((k) => k.status === "pending"))
  ).length;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          delay={0}
          icon={<Coins className="size-5" />}
          label="Billed today"
          value={totals.billedGbp}
          money
          tone="from-white to-white"
          hint="Charged to merchants"
        />
        <Kpi
          delay={0.06}
          icon={<Wallet className="size-5" />}
          label="Driver pay"
          value={totals.driverPayGbp}
          money
          hint="Platform drivers"
        />
        <Kpi
          delay={0.12}
          icon={<PiggyBank className="size-5" />}
          label="Profit"
          value={totals.profitGbp}
          money
          accent
          hint="Billed minus driver pay"
        />
        <Kpi
          delay={0.18}
          icon={<ReceiptText className="size-5" />}
          label="Live orders"
          value={live.length}
          hint={`${deliveredToday} delivered today`}
          live
        />
      </div>

      {/* Map + side column */}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card delay={0.1} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-4">
            <div>
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-ink">
                <LiveDot className="text-success" /> Live map
              </h3>
              <p className="text-[13px] text-ink-3">Merchants, drop-offs and drivers sharing their location</p>
            </div>
            <div className="flex flex-wrap gap-4 text-[12px] font-semibold text-ink-2">
              <Legend color="#14151A" label={`Merchants · ${restaurants.length}`} square />
              <Legend color="#E5484D" label={`Drop-offs · ${live.length}`} />
              <Legend color="#2F6FED" label={`Drivers · ${liveDrivers.length}`} />
            </div>
          </div>
          <LiveMap pins={pins} className="h-[420px] w-full" />
        </Card>

        <div className="grid gap-6">
          <Card delay={0.15} className="p-6">
            <h3 className="text-[15px] font-bold text-ink">Fleet</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniStat icon={<Bike className="size-4" />} value={drivers.filter((d) => d.isOnline).length} label="Online now" tone="info" />
              <MiniStat icon={<CheckCheck className="size-4" />} value={platform.filter((d) => d.approval === "approved").length} label="Approved" tone="success" />
              <MiniStat value={drivers.filter((d) => d.driverType === "restaurant_own").length} label="In-house" />
              <Link href="/admin/drivers" className="block">
                <MiniStat value={pendingDrivers} label="To review" tone={pendingDrivers ? "brand" : undefined} link />
              </Link>
            </div>
          </Card>

          <Card delay={0.2} className="flex flex-col p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-ink">Needs attention</h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-bold tabular",
                  attention.length ? "bg-brand text-white" : "bg-surface-alt text-ink-3"
                )}
              >
                {attention.length}
              </span>
            </div>
            {attention.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                <CheckCheck className="size-8 text-success" />
                <p className="text-sm font-semibold text-ink">All running smoothly</p>
              </div>
            ) : (
              <ul className="scroll-thin mt-3 max-h-56 space-y-2 overflow-y-auto">
                {attention.map((o) => (
                  <li key={o.id} className="flex items-start gap-2.5 rounded-xl bg-brand-soft/60 p-3 text-[13px]">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand" />
                    <div className="min-w-0">
                      <p className="truncate font-bold text-ink">
                        {shortName(o.restaurantName)} · {o.externalOrderId}
                      </p>
                      <p className="text-ink-2">{o.attention === "no_driver" ? "No driver yet" : "Late delivery"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/admin/orders"
              className="group mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-brand"
            >
              Open live orders <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Card>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card delay={0.2}>
          <CardHeader title="Orders by channel" subtitle="Today, not counting cancelled" />
          <div className="p-6">
            {sourceSlices.length ? (
              <Donut slices={sourceSlices} centerLabel="Orders" />
            ) : (
              <EmptyState icon={<ReceiptText className="size-6" />} title="No orders yet today" />
            )}
          </div>
        </Card>
        <Card delay={0.25}>
          <CardHeader title="Delivery pipeline" subtitle="Where today’s orders are right now" />
          <div className="p-6">
            <Columns cols={pipeline} />
          </div>
        </Card>
        <Card delay={0.3} className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Busiest merchants" subtitle="Live and delivered today" />
          <div className="p-6">
            {merchantRows.length ? (
              <BarList rows={merchantRows} />
            ) : (
              <EmptyState icon={<ReceiptText className="size-6" />} title="No merchants yet" />
            )}
          </div>
        </Card>
      </div>

      {/* Latest live orders */}
      <Card delay={0.3}>
        <CardHeader
          title={`Live orders · ${live.length}`}
          subtitle="Newest first"
          right={
            <Link href="/admin/orders" className="group inline-flex items-center gap-1.5 text-sm font-bold text-brand">
              View all <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          }
        />
        <div className="space-y-3 p-6">
          {live.length === 0 ? (
            <EmptyState icon={<ReceiptText className="size-6" />} title="No live orders" body="New orders appear here the moment a merchant posts them." />
          ) : (
            <AnimatePresence initial={false}>
              {live.slice(0, 5).map((o, i) => (
                <OrderCard key={o.id} order={o} index={i} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </Card>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  money,
  hint,
  accent,
  live,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  money?: boolean;
  hint?: string;
  accent?: boolean;
  live?: boolean;
  tone?: string;
  delay: number;
}) {
  return (
    <Card
      delay={delay}
      className={cn(
        "group relative overflow-hidden p-5 transition-transform duration-300 hover:-translate-y-1 sm:p-6",
        accent && "border-transparent !bg-ink text-white"
      )}
    >
      {accent && (
        <div className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-success/40 blur-3xl transition-opacity group-hover:opacity-80" />
      )}
      <div className="relative flex items-center justify-between">
        <span
          className={cn(
            "grid size-10 place-items-center rounded-2xl transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-110",
            accent ? "bg-white/10 text-emerald-300" : "bg-brand-soft text-brand"
          )}
        >
          {icon}
        </span>
        {live && <LiveDot className="text-brand" />}
      </div>
      <p className={cn("relative mt-5 text-[13px] font-semibold", accent ? "text-white/60" : "text-ink-3")}>{label}</p>
      <p
        className={cn(
          "relative mt-1 text-2xl font-extrabold tracking-tight sm:text-[2rem]",
          accent ? "text-emerald-300" : "text-ink"
        )}
      >
        <AnimatedNumber value={value} format={money ? (n) => formatGbp(n) : undefined} />
      </p>
      {hint && <p className={cn("relative mt-1 text-xs", accent ? "text-white/45" : "text-ink-3")}>{hint}</p>}
    </Card>
  );
}

function MiniStat({
  icon,
  value,
  label,
  tone,
  link,
}: {
  icon?: React.ReactNode;
  value: number;
  label: string;
  tone?: "info" | "success" | "brand";
  link?: boolean;
}) {
  const tones = {
    info: "text-info",
    success: "text-success",
    brand: "text-brand",
  };
  return (
    <div
      className={cn(
        "rounded-2xl bg-surface-alt/70 p-3.5 transition",
        link && "hover:bg-brand-soft hover:ring-1 hover:ring-brand-line"
      )}
    >
      <p className={cn("flex items-center gap-1.5 text-2xl font-extrabold tabular", tone ? tones[tone] : "text-ink")}>
        {icon}
        <AnimatedNumber value={value} />
      </p>
      <p className="mt-0.5 text-xs font-semibold text-ink-3">{label}</p>
    </div>
  );
}

function Legend({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2.5", square ? "rounded-[3px]" : "rounded-full")} style={{ background: color }} />
      {label}
    </span>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 rounded-3xl shadow-[var(--shadow-card)]" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Skeleton className="h-[500px] rounded-3xl" />
        <Skeleton className="h-[500px] rounded-3xl" />
      </div>
    </div>
  );
}
