"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowLeftRight,
  Bike,
  ChevronDown,
  Clock3,
  MapPin,
  Phone,
  ReceiptText,
  Store,
  X,
} from "lucide-react";
import { useState } from "react";

import { Badge, Button, ConfirmDialog, Modal } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import {
  ADMIN_STATUS,
  cn,
  formatCountdown,
  formatGbp,
  isLive,
  shortName,
  sourceColor,
  sourceLabel,
} from "@/lib/format";
import type { LiveOrder } from "@/lib/types";
import { FileViewer } from "./FileViewer";

const STATUS_TONE: Record<LiveOrder["status"], "neutral" | "success" | "warning" | "info" | "brand"> = {
  preparing: "warning",
  ready_for_pickup: "warning",
  batched_offered: "info",
  driver_assigned: "info",
  picked_up: "success",
  delivered: "success",
  cancelled: "neutral",
};

/** Progress through the delivery, for the little track on each card. */
const STEP: Record<LiveOrder["status"], number> = {
  preparing: 0,
  ready_for_pickup: 1,
  batched_offered: 1,
  driver_assigned: 2,
  picked_up: 3,
  delivered: 4,
  cancelled: -1,
};

/** One order as the admin sees it, with the same controls as the app: receipt, move driver, cancel. */
export function OrderCard({ order: o, index, compact }: { order: LiveOrder; index?: number; compact?: boolean }) {
  const { cancelOrder, releaseOrder } = useAdmin();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"cancel" | "release" | "receipt" | null>(null);

  const live = isLive(o);
  const inHouse = o.dispatchType === "own_driver";
  const margin = o.platformMarginGbp ?? o.restaurantFeeGbp - o.driverPayoutGbp;
  const withDriver = !!o.batchId && (o.status === "batched_offered" || o.status === "driver_assigned");
  const collected = o.status === "picked_up";
  const driver = o.assignedDriverName?.split(" ")[0];
  const ref = o.externalOrderId || "this order";
  const step = STEP[o.status];
  const prepping = live && (o.status === "preparing" || o.status === "ready_for_pickup") && o.remainingSeconds > 0;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group rounded-2xl border bg-surface transition-shadow hover:shadow-[var(--shadow-card)]",
        o.attention ? "border-brand-line" : "border-line"
      )}
    >
      <div className="flex items-center gap-3 p-4 sm:gap-4">
        <div className="relative shrink-0">
          <div
            className="grid size-11 place-items-center rounded-2xl text-sm font-extrabold text-white shadow-sm"
            style={{ background: sourceColor(o.source) }}
            title={sourceLabel(o.source)}
          >
            {index !== undefined ? index + 1 : <ReceiptText className="size-5" />}
          </div>
          {o.attention && (
            <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-brand ring-2 ring-surface">
              <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-[15px] font-bold text-ink">
              {shortName(o.restaurantName)} <span className="text-ink-3">·</span> {o.externalOrderId}
            </p>
            {!compact && (
              <Badge tone={STATUS_TONE[o.status]} className="max-sm:!hidden">
                {ADMIN_STATUS[o.status]}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-3">
            {compact ? ADMIN_STATUS[o.status] : (
              <>
                <span className="font-semibold text-ink-2 sm:hidden">{ADMIN_STATUS[o.status]} · </span>
                {sourceLabel(o.source)}
              </>
            )}
            {driver && o.status !== "preparing" && o.status !== "ready_for_pickup" ? ` · ${driver}` : ""}
            {" · "}
            {o.postcode} · {o.distanceMiles.toFixed(1)} mi · {o.createdAtLabel}
          </p>
        </div>

        {prepping && !compact && (
          <div className="hidden items-center gap-1.5 rounded-xl bg-warning-soft px-2.5 py-1.5 text-[13px] font-bold text-warning md:flex">
            <Clock3 className="size-3.5" />
            <span className="tabular">{formatCountdown(o.remainingSeconds)}</span>
          </div>
        )}

        <div className="shrink-0 text-right">
          {inHouse ? (
            <Badge>No fee</Badge>
          ) : (
            <>
              <p className={cn("text-[15px] font-extrabold tabular", o.status === "cancelled" ? "text-ink-3 line-through" : "text-success")}>
                +{formatGbp(margin)}
              </p>
              {!compact && (
                <p className="hidden text-[12px] text-ink-3 tabular sm:block">
                  {formatGbp(o.restaurantFeeGbp)} in · {formatGbp(o.driverPayoutGbp)} out
                </p>
              )}
            </>
          )}
        </div>

        {!compact && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-xl p-2 text-ink-3 transition hover:bg-surface-alt hover:text-ink"
            aria-label={open ? "Hide details" : "Show details"}
            aria-expanded={open}
          >
            <ChevronDown className={cn("size-5 transition-transform duration-300", open && "rotate-180")} />
          </button>
        )}
      </div>

      {!compact && step >= 0 && (
        <div className="px-4">
          <div className="grid grid-cols-4 gap-1.5">
            {["Preparing", "Ready", "On the way", "Collected"].map((label, i) => (
              <div key={label} className="h-1 overflow-hidden rounded-full bg-surface-alt" title={label}>
                <motion.div
                  className={cn("h-full rounded-full", step >= 4 ? "bg-success" : "bg-brand")}
                  initial={{ width: 0 }}
                  animate={{ width: step > i || step >= 4 ? "100%" : step === i ? "50%" : "0%" }}
                  transition={{ duration: 0.8, delay: i * 0.08 }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {o.attention && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-brand-soft p-3 text-[13px] text-ink">
          <AlertCircle className="mt-px size-4 shrink-0 text-brand" />
          {o.attention === "no_driver" ? "No driver has taken this yet." : "Collected but not delivered for a long time."}
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && !compact && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-4 px-4 pt-4 md:grid-cols-3">
              <Detail icon={<Store className="size-4" />} title="Pickup">
                <p className="font-semibold text-ink">{o.restaurantName}</p>
                <p>
                  {o.restaurantAddress}, {o.restaurantPostcode}
                </p>
                {o.restaurantPhone && <p>{o.restaurantPhone}</p>}
              </Detail>
              <Detail icon={<MapPin className="size-4" />} title="Drop-off">
                <p className="font-semibold text-ink">{o.customerName}</p>
                <p>
                  {o.deliveryAddress}, {o.postcode}
                </p>
                {o.deliveryInstructions && <p className="italic">“{o.deliveryInstructions}”</p>}
              </Detail>
              <Detail icon={<Phone className="size-4" />} title="Contact & driver">
                <p>
                  {o.customerPhone}
                  {o.phoneAccessCode ? ` · code ${o.phoneAccessCode}` : ""}
                </p>
                {o.directCustomerPhone && <p>Direct: {o.directCustomerPhone}</p>}
                <p className="flex items-center gap-1.5">
                  <Bike className="size-3.5" />
                  {o.assignedDriverName
                    ? `${o.assignedDriverName} · ${o.assignedDriverType === "restaurant_own" ? "in-house" : "platform"}`
                    : inHouse
                      ? "In-house driver"
                      : o.hybrid
                        ? "Open to in-house and platform drivers"
                        : "Platform pool"}
                </p>
              </Detail>
            </div>
            {o.items.length > 0 && (
              <div className="mx-4 mt-4 rounded-xl bg-surface-alt/70 p-3">
                <div className="grid gap-1 text-[13px]">
                  {o.items.map((it, i) => (
                    <div key={i} className="flex justify-between gap-3 text-ink-2">
                      <span>
                        <span className="font-semibold text-ink">{it.quantity}×</span> {it.name}
                      </span>
                      <span className="tabular">{formatGbp(it.price)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-line pt-1.5 font-bold text-ink">
                    <span>Order total</span>
                    <span className="tabular">{formatGbp(o.orderTotalGbp)}</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {(o.hasReceipt || withDriver || live) && (
        <div className="flex flex-wrap gap-2 p-4">
          {o.hasReceipt && (
            <Button size="sm" variant="secondary" icon={<ReceiptText className="size-4" />} onClick={() => setDialog("receipt")}>
              Receipt
            </Button>
          )}
          {withDriver && (
            <Button size="sm" variant="secondary" icon={<ArrowLeftRight className="size-4" />} onClick={() => setDialog("release")}>
              Move driver
            </Button>
          )}
          {live && (
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => setDialog("cancel")} className="ml-auto hover:text-brand">
              Cancel
            </Button>
          )}
        </div>
      )}
      {!o.hasReceipt && !withDriver && !live && <div className="h-4" />}

      <ConfirmDialog
        open={dialog === "release"}
        title={`Move ${ref} to another driver?`}
        body={`${driver ?? "The driver"} will be told not to collect it, and it is offered to other drivers.`}
        confirmLabel="Move"
        tone="dark"
        onConfirm={() => releaseOrder(o.id)}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        title={`Cancel ${ref}?`}
        body={
          collected
            ? `${driver ?? "The driver"} already has the food and will be told not to deliver it. The fee and driver pay for this trip stay.`
            : "The merchant and driver are told. The merchant is not charged."
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        onConfirm={() => cancelOrder(o.id)}
        onClose={() => setDialog(null)}
      />
      <Modal
        open={dialog === "receipt"}
        onClose={() => setDialog(null)}
        title={`Receipt ${o.externalOrderId}`.trim()}
        subtitle={shortName(o.restaurantName)}
      >
        {dialog === "receipt" && <FileViewer key={o.id} path={`/api/admin/orders/${o.id}/receipt`} name={`receipt-${o.externalOrderId}`} />}
      </Modal>
    </motion.div>
  );
}

function Detail({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 text-[13px] text-ink-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-ink-3 uppercase">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}
