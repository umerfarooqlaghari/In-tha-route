"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  MessageSquare,
  ReceiptText,
  RefreshCw,
  ScanLine,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { FileViewer } from "@/components/admin/FileViewer";
import { LiveMap, type MapPin } from "@/components/admin/LiveMap";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Modal, Skeleton } from "@/components/ui";
import { cn, formatCountdown, formatGbp, isLive, sourceColor } from "@/lib/format";
import { pinFor } from "@/lib/geo";
import { useChat } from "@/lib/merchant-chat";
import { isWaiting, useMerchant } from "@/lib/merchant-store";
import type { LiveOrder } from "@/lib/types";
import { MERCHANT_STATUS, SourceTag, StatTile, driverKind } from "./common";
import { NoDriversDialog } from "./NoDrivers";

const canCancel = (o: LiveOrder) => o.status !== "picked_up" && o.status !== "delivered" && o.status !== "cancelled";

export function LiveOrdersScreen() {
  const { data, orders, restaurant, drivers } = useMerchant();
  const [receipt, setReceipt] = useState<LiveOrder | null>(null);
  const [choice, setChoice] = useState<LiveOrder | null>(null);
  const [cancel, setCancel] = useState<LiveOrder | null>(null);
  const { cancelOrder } = useMerchant();

  const active = useMemo(
    () => orders.filter(isLive).sort((a, b) => a.remainingSeconds - b.remainingSeconds),
    [orders]
  );
  const ready = active.filter((o) => o.remainingSeconds === 0 || o.status === "ready_for_pickup").length;
  const onRoad = active.filter((o) => o.status === "picked_up").length;

  const pins = useMemo<MapPin[]>(() => {
    const list: MapPin[] = [];
    if (restaurant) {
      const c = pinFor(restaurant.postcode, restaurant.coords);
      list.push({ id: "r", kind: "restaurant", lat: c.latitude, lng: c.longitude, popup: [restaurant.name] });
    }
    active.forEach((o, i) => {
      const c = pinFor(o.postcode, o.dropoffCoords);
      list.push({
        id: `d-${o.id}`,
        kind: "dropoff",
        label: `${i + 1}`,
        color: sourceColor(o.source),
        lat: c.latitude,
        lng: c.longitude,
        popup: [`${o.externalOrderId} · ${o.customerName}`, `${o.deliveryAddress}, ${o.postcode}`],
      });
    });
    // Your own riders who are out right now.
    drivers
      .filter((d) => d.isOnline && d.location)
      .forEach((d) =>
        list.push({
          id: `rider-${d.id}`,
          kind: "driver",
          lat: d.location!.latitude,
          lng: d.location!.longitude,
          popup: [d.name, `${d.activeOrders ?? 0} active order${d.activeOrders === 1 ? "" : "s"}`],
        })
      );
    return list;
  }, [active, restaurant, drivers]);

  if (!data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="Active" value={active.length} icon={<ReceiptText className="size-5" />} tone="brand" />
        <StatTile label="Ready" value={ready} icon={<Check className="size-5" />} tone="success" />
        <StatTile label="On the road" value={onRoad} icon={<Clock3 className="size-5" />} tone="info" />
        <StatTile label="Delivered today" value={restaurant?.completedTodayCount ?? 0} icon={<CheckCheck className="size-5" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4 xl:order-1">
          {active.length === 0 ? (
            <Card>
              <EmptyState icon={<ReceiptText className="size-6" />} title="No live orders" body="Scan a receipt to post one." />
              <div className="flex justify-center pb-8">
                <Link href="/merchant">
                  <Button icon={<ScanLine className="size-4" />}>New order</Button>
                </Link>
              </div>
            </Card>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {active.map((o, i) => (
                <OrderTile
                  key={o.id}
                  order={o}
                  index={i}
                  hasOwnDrivers={drivers.length > 0}
                  onReceipt={() => setReceipt(o)}
                  onChoose={() => setChoice(o)}
                  onCancel={() => setCancel(o)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        <Card className="overflow-hidden xl:sticky xl:top-6 xl:order-2 xl:self-start">
          <LiveMap className="h-80 w-full xl:h-[520px]" pins={pins} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 text-xs text-ink-3">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-ink" /> Your shop</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-brand" /> Drop-offs (numbered)</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-info" /> Your riders</span>
          </div>
        </Card>
      </div>

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title={receipt ? `Receipt ${receipt.externalOrderId}`.trim() : ""}>
        {receipt && (
          <FileViewer key={receipt.id} portal="merchant" path={`/api/restaurant/orders/${receipt.id}/receipt`} name={`receipt-${receipt.externalOrderId}`} />
        )}
      </Modal>
      <NoDriversDialog order={choice} onClose={() => setChoice(null)} />
      <ConfirmDialog
        open={!!cancel}
        title={`Cancel ${cancel?.externalOrderId || "this order"}?`}
        body={
          cancel?.assignedDriverName
            ? `${cancel.assignedDriverName.split(" ")[0]} will be told not to collect it. You will not be charged.`
            : "It will be taken off the board. You will not be charged."
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        onConfirm={() => (cancel ? cancelOrder(cancel.id) : undefined)}
        onClose={() => setCancel(null)}
      />
    </div>
  );
}

function OrderTile({
  order: o,
  index,
  hasOwnDrivers,
  onReceipt,
  onChoose,
  onCancel,
}: {
  order: LiveOrder;
  index: number;
  hasOwnDrivers: boolean;
  onReceipt: () => void;
  onChoose: () => void;
  onCancel: () => void;
}) {
  const { markReady, findDriversAgain } = useMerchant();
  const { openForOrder } = useChat();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const isReady = o.remainingSeconds === 0 || o.status === "ready_for_pickup";
  const meta = isReady && o.status !== "picked_up" ? MERCHANT_STATUS.ready_for_pickup : MERCHANT_STATUS[o.status];
  const urgent = !isReady && o.remainingSeconds < 180;
  const showChat = !!o.assignedDriverId && (o.status === "driver_assigned" || o.status === "picked_up");
  const waiting = isWaiting(o);
  const total = Math.max(1, o.prepMinutes * 60);
  const progress = isReady ? 1 : 1 - o.remainingSeconds / total;

  const run = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "overflow-hidden rounded-3xl border bg-surface shadow-[var(--shadow-card)]",
        o.attention || waiting ? "border-brand-line" : "border-line"
      )}
    >
      <div className="flex items-start gap-4 p-5">
        <div
          className="grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-extrabold text-white"
          style={{ background: sourceColor(o.source) }}
        >
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SourceTag source={o.source} />
            <span className="truncate text-sm font-semibold text-ink-3">{o.externalOrderId}</span>
          </div>
          <p className="mt-1.5 truncate text-[17px] font-bold text-ink">{o.customerName || "Customer"}</p>
          <p className="truncate text-sm text-ink-3">
            {o.deliveryAddress}, {o.postcode} · {o.distanceMiles.toFixed(1)} mi
          </p>
        </div>
        {/* Prep timer: a ring that fills as the food gets ready. */}
        <div className="relative grid size-[72px] shrink-0 place-items-center">
          <svg viewBox="0 0 72 72" className="absolute inset-0 -rotate-90">
            <circle cx="36" cy="36" r="31" fill="none" stroke="var(--color-surface-alt)" strokeWidth="6" />
            <motion.circle
              cx="36"
              cy="36"
              r="31"
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              stroke={isReady ? "var(--color-success)" : urgent ? "var(--color-brand)" : "var(--color-ink)"}
              strokeDasharray={2 * Math.PI * 31}
              animate={{ strokeDashoffset: (1 - progress) * 2 * Math.PI * 31 }}
              transition={{ duration: 0.6 }}
            />
          </svg>
          <span className={cn("relative text-sm font-extrabold tabular", isReady ? "text-success" : urgent ? "text-brand" : "text-ink")}>
            {isReady ? "Ready" : formatCountdown(o.remainingSeconds)}
          </span>
        </div>
      </div>

      {o.deliveryInstructions && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-2xl bg-warning-soft p-3 text-[13px] text-ink">
          <FileText className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <span className="font-semibold">Note: </span>
            {o.deliveryInstructions}
          </span>
        </div>
      )}
      {o.attention && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-2xl bg-brand-soft p-3 text-[13px] text-ink">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-brand" />
          {o.attention === "no_driver"
            ? "No driver has taken this yet. We are still trying — you can also cancel it."
            : "Collected a while ago and not marked delivered. Message the driver to check."}
        </div>
      )}
      {waiting && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-2xl bg-brand-soft p-3 text-[13px] text-ink">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-brand" />
          Nobody accepted this in time, so it has left the pool. Look again or give it to your driver.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {o.assignedDriverName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink-2">
            <UserRound className="size-4 shrink-0" />
            <span className="truncate">{o.assignedDriverName}</span>
            {o.assignedDriverType && <Badge tone={o.assignedDriverType === "restaurant_own" ? "info" : "neutral"}>{driverKind(o)}</Badge>}
          </span>
        ) : o.hybrid ? (
          <Badge>Hybrid pool</Badge>
        ) : null}
        <span className="ml-auto text-sm font-semibold text-ink-3 tabular">
          {o.dispatchType === "own_driver" ? "No fee" : `Fee ${formatGbp(o.restaurantFeeGbp)}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 bg-surface-alt/40 px-5 py-3">
        {o.hasReceipt && (
          <Button size="sm" variant="secondary" icon={<ReceiptText className="size-4" />} onClick={onReceipt}>
            Receipt
          </Button>
        )}
        {showChat && (
          <Button
            size="sm"
            variant="secondary"
            icon={<MessageSquare className="size-4" />}
            loading={busy === "chat"}
            onClick={() =>
              run("chat", async () => {
                if (await openForOrder(o.id)) router.push("/merchant/messages");
              })
            }
          >
            Chat
          </Button>
        )}
        {!isReady && (
          <Button size="sm" variant="secondary" icon={<Check className="size-4" />} loading={busy === "ready"} onClick={() => run("ready", () => markReady(o.id))}>
            Mark ready
          </Button>
        )}
        {waiting && (
          <>
            <Button size="sm" icon={<RefreshCw className="size-4" />} loading={busy === "find"} onClick={() => run("find", () => findDriversAgain(o.id))}>
              Find drivers again
            </Button>
            {hasOwnDrivers && (
              <Button size="sm" variant="secondary" icon={<Users className="size-4" />} onClick={onChoose}>
                My drivers
              </Button>
            )}
          </>
        )}
        {canCancel(o) && (
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} className="ml-auto hover:text-brand" onClick={onCancel}>
            Cancel order
          </Button>
        )}
      </div>
    </motion.div>
  );
}
