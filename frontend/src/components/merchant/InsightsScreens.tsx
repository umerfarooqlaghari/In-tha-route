"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Bike,
  CheckCheck,
  ChevronDown,
  Flame,
  History,
  Home,
  PoundSterling,
  ReceiptText,
  ShoppingBag,
  Tag,
  Timer,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { BarList } from "@/components/admin/charts";
import { FileViewer } from "@/components/admin/FileViewer";
import { AnimatedNumber, Badge, Button, Card, CardHeader, EmptyState, LiveDot, Modal, Segmented, Skeleton } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn, formatGbp, sourceColor } from "@/lib/format";
import { useMerchant } from "@/lib/merchant-store";
import type { HistoryPage, MerchantAnalytics, PastOrder } from "@/lib/types";
import { SourceTag, StatTile, clock, minutes } from "./common";

/** Changes whenever a live order is posted, moves on or finishes, so these pages reload at once. */
function useOrdersVersion() {
  const { orders } = useMerchant();
  return orders.map((o) => `${o.id}:${o.status}`).join("|");
}

/** Runs `fn` when `version` changes after the first render. */
function useOnChange(version: string, fn: () => void) {
  const first = useRef(version);
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (first.current === version) return;
    first.current = version;
    latest.current();
  }, [version]);
}

/* ========================================================================== */
/* Past orders                                                                 */
/* ========================================================================== */

export function PastOrdersScreen() {
  const [orders, setOrders] = useState<PastOrder[]>([]);
  const [totals, setTotals] = useState<HistoryPage["totals"] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PastOrder | null>(null);
  const [query, setQuery] = useState("");

  const fetchPage = async (before?: string) => {
    try {
      const page = await api<HistoryPage>(
        "merchant",
        "GET",
        `/api/restaurant/history${before ? `?before=${encodeURIComponent(before)}` : ""}`
      );
      setOrders((prev) => (before ? [...prev, ...page.orders.filter((o) => !prev.some((p) => p.id === o.id))] : page.orders));
      setTotals(page.totals);
      setNextBefore(page.nextBefore);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  const load = (before?: string) => {
    setLoading(true);
    fetchPage(before);
  };

  useEffect(() => {
    Promise.resolve().then(() => fetchPage());
  }, []);
  useOnChange(useOrdersVersion(), () => fetchPage());

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? orders.filter((o) =>
          [o.externalOrderId, o.customerName, o.postcode, o.deliveryAddress, o.assignedDriverName ?? ""].some((s) =>
            (s ?? "").toLowerCase().includes(q)
          )
        )
      : orders;
    const out: { day: string; orders: PastOrder[] }[] = [];
    list.forEach((o) => {
      const day = (o.finishedLabel ?? o.deliveredLabel ?? "").split(",")[0];
      const last = out[out.length - 1];
      if (last && last.day === day) last.orders.push(o);
      else out.push({ day, orders: [o] });
    });
    return out;
  }, [orders, query]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Delivered" value={totals?.orders ?? 0} icon={<CheckCheck className="size-5" />} tone="success" />
        <StatTile label="Sales" value={formatGbp(totals?.salesGbp ?? 0)} icon={<PoundSterling className="size-5" />} tone="brand" />
        <StatTile label="Delivery fees" value={formatGbp(totals?.feesGbp ?? 0)} icon={<Truck className="size-5" />} />
      </div>

      <Card className="p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by order number, customer, postcode or driver"
          className="h-11 w-full rounded-2xl bg-surface-alt px-4 text-sm text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-ink/10"
        />
      </Card>

      {error && (
        <Card className="flex items-center justify-between gap-4 p-5">
          <p className="text-sm text-ink-2">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => load()}>
            Try again
          </Button>
        </Card>
      )}

      {!error && !loading && orders.length === 0 && (
        <Card>
          <EmptyState
            icon={<History className="size-6" />}
            title="No past orders yet"
            body="Orders appear here once the driver has delivered them, or if one is cancelled after collection."
          />
        </Card>
      )}
      {!loading && orders.length > 0 && groups.length === 0 && (
        <Card>
          <EmptyState icon={<History className="size-6" />} title="No matches" body="Try another search." />
        </Card>
      )}
      {loading && orders.length === 0 && <Skeleton className="h-64" />}

      {groups.map((g) => (
        <section key={g.day} className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h3 className="text-[13px] font-bold tracking-[0.14em] text-ink-3 uppercase">{g.day}</h3>
            <span className="text-xs text-ink-3">
              {g.orders.length} {g.orders.length === 1 ? "order" : "orders"}
            </span>
          </div>
          <Card className="divide-y divide-line overflow-hidden">
            {g.orders.map((o) => (
              <PastOrderRow
                key={o.id}
                order={o}
                open={openId === o.id}
                onToggle={() => setOpenId((c) => (c === o.id ? null : o.id))}
                onReceipt={() => setReceipt(o)}
              />
            ))}
          </Card>
        </section>
      ))}

      {nextBefore && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loading} onClick={() => load(nextBefore)}>
            Load more
          </Button>
        </div>
      )}

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title={receipt ? `Receipt ${receipt.externalOrderId}`.trim() : ""}>
        {receipt && (
          <FileViewer key={receipt.id} portal="merchant" path={`/api/restaurant/orders/${receipt.id}/receipt`} name={`receipt-${receipt.externalOrderId}`} />
        )}
      </Modal>
    </div>
  );
}

function PastOrderRow({
  order: o,
  open,
  onToggle,
  onReceipt,
}: {
  order: PastOrder;
  open: boolean;
  onToggle: () => void;
  onReceipt: () => void;
}) {
  const own = o.assignedDriverType === "restaurant_own";
  const cancelled = o.status === "cancelled";
  return (
    <div>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-surface-alt/50">
        <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: sourceColor(o.source) }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <SourceTag source={o.source} />
            <span className="truncate text-sm text-ink-3">{o.externalOrderId}</span>
          </span>
          <span className="mt-1 block truncate font-bold text-ink">{o.customerName || "Customer"}</span>
          <span className="block truncate text-sm text-ink-3">
            {cancelled ? "Cancelled" : "Delivered"} {clock(o.finishedAt ?? o.deliveredAt)} · {o.postcode}
            {o.assignedDriverName ? ` · ${o.assignedDriverName}` : ""}
          </span>
        </span>
        {cancelled ? <Badge tone="brand">Cancelled</Badge> : <span className="font-extrabold text-ink tabular">{formatGbp(o.orderTotalGbp)}</span>}
        <ChevronDown className={cn("size-5 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-5 px-5 pb-5 md:grid-cols-2">
              <div className="space-y-4">
                <Detail icon={<Home className="size-4" />} title={o.deliveryAddress} subtitle={o.postcode} />
                <Detail icon={own ? <Users className="size-4" /> : <Bike className="size-4" />} title={o.assignedDriverName ?? "Driver"} subtitle={own ? "Your driver" : "Platform driver"} />
                {o.items.length > 0 && (
                  <div className="space-y-1.5 rounded-2xl bg-surface-alt/70 p-4 text-sm">
                    {o.items.map((it, i) => (
                      <div key={`${it.name}-${i}`} className="flex gap-3">
                        <span className="w-7 font-bold text-ink-2">{it.quantity}×</span>
                        <span className="min-w-0 flex-1 text-ink">{it.name}</span>
                        {it.price > 0 && <span className="text-ink-3 tabular">{formatGbp(it.price)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2 rounded-2xl border border-line p-4">
                  <Step label="Posted" time={clock(o.createdAt)} />
                  <span className="mt-2 h-0.5 flex-1 bg-line" />
                  <Step label="Picked up" time={clock(o.pickedUpAt)} />
                  <span className="mt-2 h-0.5 flex-1 bg-line" />
                  {cancelled ? <Step label="Cancelled" time={clock(o.cancelledAt)} tone="brand" /> : <Step label="Delivered" time={clock(o.deliveredAt)} tone="success" />}
                </div>
                <div className="space-y-2 rounded-2xl bg-surface-alt/70 p-4 text-sm">
                  <KV label="Order total" value={formatGbp(o.orderTotalGbp)} strong />
                  <KV label="Delivery fee" value={own ? "Your driver" : formatGbp(o.restaurantFeeGbp)} />
                  <KV label="Distance" value={`${o.distanceMiles} mi`} />
                  <KV label="Prep time" value={`${o.prepMinutes} min`} />
                  {!cancelled && <KV label="On the road" value={minutes(o.deliveryMinutes)} />}
                  {!cancelled && <KV label="Posted to delivered" value={minutes(o.totalMinutes)} />}
                </div>
                {o.hasReceipt && (
                  <Button variant="secondary" className="w-full" icon={<ReceiptText className="size-4" />} onClick={onReceipt}>
                    View receipt
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Detail({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-alt text-ink-2">{icon}</span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-sm text-ink-3">{subtitle}</span>
      </span>
    </div>
  );
}

function Step({ label, time, tone }: { label: string; time: string; tone?: "success" | "brand" }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className={cn("size-4 rounded-full", tone === "success" ? "bg-success" : tone === "brand" ? "bg-brand" : "bg-ink-3")} />
      <span className="text-sm font-bold text-ink tabular">{time}</span>
      <span className="text-xs text-ink-3">{label}</span>
    </div>
  );
}

function KV({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-3">{label}</span>
      <span className={cn("tabular", strong ? "font-extrabold text-ink" : "font-semibold text-ink-2")}>{value}</span>
    </div>
  );
}

/* ========================================================================== */
/* Analytics                                                                   */
/* ========================================================================== */

type Range = "7" | "30" | "90";
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const shortDate = (ymd: string) => {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
};

export function AnalyticsScreen() {
  const [range, setRange] = useState<Range>("7");
  const [data, setData] = useState<MerchantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rangeNow = useRef(range);

  const fetchRange = async (r: Range) => {
    try {
      setData(await api<MerchantAnalytics>("merchant", "GET", `/api/restaurant/analytics?days=${r}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  const pick = (r: Range) => {
    setRange(r);
    rangeNow.current = r;
    setLoading(true);
    fetchRange(r);
  };

  useEffect(() => {
    Promise.resolve().then(() => fetchRange("7"));
    const t = setInterval(() => fetchRange(rangeNow.current), 30_000);
    return () => clearInterval(t);
  }, []);
  useOnChange(useOrdersVersion(), () => fetchRange(rangeNow.current));

  const s = data?.summary;
  const empty = !!s && s.orders === 0 && s.cancelled === 0 && s.active === 0;

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <Segmented<Range>
          className="w-full max-w-md"
          value={range}
          onChange={pick}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
        />
        <span className="flex items-center gap-2 px-3 text-xs font-bold tracking-[0.14em] text-success uppercase">
          <LiveDot /> Live
        </span>
      </Card>

      {error && (
        <Card className="flex items-center justify-between gap-4 p-5">
          <p className="text-sm text-ink-2">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => pick(range)}>
            Try again
          </Button>
        </Card>
      )}

      {!data && loading && (
        <div className="grid gap-4 lg:grid-cols-4">
          <Skeleton className="h-64 lg:col-span-4" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      )}

      {data && s && (
        <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
          <SalesHero data={data} />

          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi icon={<ShoppingBag className="size-5" />} label="Orders delivered" value={s.orders} delta={change(s.orders, data.previous.orders)} />
            <Kpi icon={<Tag className="size-5" />} label="Average order" value={s.averageOrderGbp} format={formatGbp} />
            <Kpi icon={<Truck className="size-5" />} label="Delivery fees" value={s.feesGbp} format={formatGbp} />
            <Kpi
              icon={<CheckCheck className="size-5" />}
              label="Completed"
              value={s.completionRate ?? 0}
              format={(n) => (s.completionRate == null ? "—" : `${Math.round(n)}%`)}
              hint={s.cancelled ? `${s.cancelled} cancelled` : undefined}
            />
          </div>

          {s.active > 0 && (
            <div className="flex items-center gap-2 rounded-2xl bg-info-soft p-4 text-sm text-ink">
              <Activity className="size-4 shrink-0 text-info" />
              {s.active} {s.active === 1 ? "order is" : "orders are"} live right now. {s.active === 1 ? "It counts" : "They count"} here once delivered.
            </div>
          )}

          {empty ? (
            <Card>
              <EmptyState icon={<TrendingUp className="size-6" />} title="No orders in this period" body="Your charts fill in as orders are delivered." />
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="pb-6">
                <CardHeader title="Speed" subtitle="Average per delivered order" />
                <div className="grid grid-cols-3 gap-3 px-6 pt-5">
                  <Speed icon={<Flame className="size-5" />} label="Prep" value={minutes(s.prepMinutes)} />
                  <Speed icon={<Bike className="size-5" />} label="On the road" value={minutes(s.deliveryMinutes)} />
                  <Speed icon={<Timer className="size-5" />} label="Start to door" value={minutes(s.totalMinutes)} />
                </div>
              </Card>

              <Card className="pb-6">
                <CardHeader title="Orders per day" subtitle={`${s.orders} delivered`} />
                <div className="px-6 pt-5">
                  <Bars
                    values={data.daily.map((d) => d.orders)}
                    tips={data.daily.map((d) => `${shortDate(d.date)}: ${d.orders} orders · ${formatGbp(d.salesGbp)}`)}
                    labels={data.daily.length <= 7 ? data.daily.map((d) => d.weekday) : [0, Math.floor((data.daily.length - 1) / 2), data.daily.length - 1].map((i) => shortDate(data.daily[i].date))}
                  />
                </div>
              </Card>

              <Card className="pb-6">
                <CardHeader
                  title="Busiest hours"
                  subtitle="When delivered orders were posted"
                  right={(() => {
                    const peak = data.hours.reduce((a, b) => (b.orders > a.orders ? b : a), data.hours[0]);
                    return peak && peak.orders > 0 ? (
                      <Badge tone="warning">
                        <Zap className="size-3" /> {peak.hour.toString().padStart(2, "0")}:00
                      </Badge>
                    ) : null;
                  })()}
                />
                <div className="px-6 pt-5">
                  <Bars
                    height={120}
                    values={data.hours.map((h) => h.orders)}
                    tips={data.hours.map((h) => `${h.hour.toString().padStart(2, "0")}:00 · ${h.orders} orders`)}
                    labels={["00:00", "06:00", "12:00", "18:00", "23:00"]}
                  />
                </div>
              </Card>

              {data.drivers.own + data.drivers.platform > 0 && (
                <Card className="pb-6">
                  <CardHeader title="Who delivered" subtitle="Your drivers and platform drivers" />
                  <div className="space-y-4 px-6 pt-5">
                    <div className="flex h-4 overflow-hidden rounded-full bg-surface-alt">
                      <motion.div className="h-full bg-ink-2" initial={{ width: 0 }} animate={{ width: `${(data.drivers.own / (data.drivers.own + data.drivers.platform)) * 100}%` }} transition={{ duration: 0.9 }} />
                      <motion.div className="h-full bg-[#F27D81]" initial={{ width: 0 }} animate={{ width: `${(data.drivers.platform / (data.drivers.own + data.drivers.platform)) * 100}%` }} transition={{ duration: 0.9, delay: 0.1 }} />
                    </div>
                    {[
                      ["Your drivers", data.drivers.own, "bg-ink-2"],
                      ["Platform drivers", data.drivers.platform, "bg-[#F27D81]"],
                    ].map(([l, n, c]) => (
                      <div key={l as string} className="flex items-center gap-3 text-sm">
                        <span className={cn("size-2.5 rounded-full", c as string)} />
                        <span className="flex-1 font-medium text-ink-2">{l}</span>
                        <span className="font-bold text-ink tabular">
                          {n as number} · {Math.round(((n as number) / (data.drivers.own + data.drivers.platform)) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {data.topItems.length > 0 && (
                <Card className="pb-6 lg:col-span-2">
                  <CardHeader title="Top items" subtitle="Most ordered" />
                  <div className="px-6 pt-5">
                    <BarList
                      rows={data.topItems.map((it, i) => ({
                        key: it.name,
                        label: `${i + 1}. ${it.name}`,
                        value: it.quantity,
                        color: "linear-gradient(90deg, #F27D81, var(--color-brand))",
                      }))}
                      format={(n) => `${n} sold`}
                    />
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SalesHero({ data }: { data: MerchantAnalytics }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 220;
  const values = data.daily.map((d) => d.salesGbp);
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({
    x: values.length === 1 ? W / 2 : 10 + (i / (values.length - 1)) * (W - 20),
    y: 14 + (1 - v / max) * (H - 28),
  }));
  let line = "";
  pts.forEach((p, i) => {
    if (i === 0) line = `M ${p.x} ${p.y}`;
    else {
      const a = pts[i - 1];
      const mx = (a.x + p.x) / 2;
      line += ` C ${mx} ${a.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
    }
  });
  const area = pts.length ? `${line} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z` : "";
  const delta = change(data.summary.salesGbp, data.previous.salesGbp);
  const h = hover != null ? data.daily[hover] : null;
  const labels =
    data.daily.length <= 7
      ? data.daily.map((d) => d.weekday)
      : [0, Math.floor((data.daily.length - 1) / 2), data.daily.length - 1].map((i) => shortDate(data.daily[i].date));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6">
        <div>
          <p className="text-[12px] font-bold tracking-[0.14em] text-ink-3 uppercase">{h ? shortDate(h.date) : "Sales"}</p>
          <p className="mt-1 text-4xl font-extrabold tracking-tight text-ink">
            {h ? formatGbp(h.salesGbp) : <AnimatedNumber value={data.summary.salesGbp} format={formatGbp} />}
          </p>
          <p className="mt-1 text-sm text-ink-3">{h ? `${h.orders} orders delivered` : `Delivered orders, last ${data.days} days`}</p>
        </div>
        <Delta value={delta} />
      </div>
      <div className="mt-4 px-2">
        <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-56 w-full" onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#F27D81" stopOpacity="0.28" />
              <stop offset="1" stopColor="#F27D81" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path key={`a-${line}`} d={area} fill="url(#salesFill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
          <motion.path
            key={`l-${line}`}
            d={line}
            fill="none"
            stroke="#E5484D"
            strokeWidth="3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
          {pts.map((p, i) => (
            <rect
              key={i}
              x={p.x - W / Math.max(2, pts.length) / 2}
              y={0}
              width={W / Math.max(2, pts.length)}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
          {hover != null && pts[hover] && (
            <line x1={pts[hover].x} x2={pts[hover].x} y1={0} y2={H} stroke="#E5484D" strokeOpacity="0.3" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {hover != null && pts[hover] && (
          <span
            className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-brand bg-surface"
            style={{ left: `${(pts[hover].x / W) * 100}%`, top: `${(pts[hover].y / H) * 100}%` }}
          />
        )}
        </div>
      </div>
      <div className="flex justify-between px-6 pt-1 pb-5 text-xs text-ink-3">
        {labels.map((l, i) => (
          <span key={`${l}-${i}`}>{l}</span>
        ))}
      </div>
    </Card>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold", up ? "bg-success-soft text-success" : "bg-brand-soft text-brand")}>
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {up ? "+" : ""}
      {value}% vs previous
    </span>
  );
}

function Kpi({
  icon,
  label,
  value,
  format = (n) => Math.round(n).toString(),
  delta,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  format?: (n: number) => string;
  delta?: number | null;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</span>
        {delta != null && (
          <span className={cn("text-xs font-bold", delta >= 0 ? "text-success" : "text-brand")}>
            {delta >= 0 ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
      <p className="mt-3 truncate text-2xl font-extrabold tracking-tight text-ink">
        <AnimatedNumber value={value} format={format} />
      </p>
      <p className="truncate text-sm text-ink-3">{hint ? `${label} · ${hint}` : label}</p>
    </Card>
  );
}

function Speed({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-alt/70 p-4 text-center">
      <span className="text-[#E5484D]">{icon}</span>
      <span className="text-xl font-extrabold text-ink tabular">{value}</span>
      <span className="text-xs text-ink-3">{label}</span>
    </div>
  );
}

function Bars({ values, labels, tips, height = 150 }: { values: number[]; labels: string[]; tips: string[]; height?: number }) {
  const max = Math.max(...values, 1);
  const top = Math.max(...values);
  const gap = values.length > 40 ? 2 : values.length > 14 ? 3 : 10;
  return (
    <div>
      <div className="flex items-end" style={{ height, gap }}>
        {values.map((v, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end" title={tips[i]}>
            <motion.div
              className="w-full rounded-t-md transition-[filter] group-hover:brightness-95"
              style={{ background: v > 0 && v === top ? "#F27D81" : v > 0 ? "#FCE1E2" : "var(--color-line)" }}
              initial={{ height: 0 }}
              animate={{ height: v > 0 ? Math.max(4, (v / max) * height) : 3 }}
              transition={{ duration: 0.7, delay: (i / values.length) * 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-3">
        {labels.map((l, i) => (
          <span key={`${l}-${i}`}>{l}</span>
        ))}
      </div>
    </div>
  );
}
