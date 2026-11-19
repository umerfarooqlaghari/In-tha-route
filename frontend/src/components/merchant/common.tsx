"use client";

import { Coins } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui";
import { cn, sourceColor, sourceLabel } from "@/lib/format";
import type { CreditSummary, LiveOrder, OrderSource } from "@/lib/types";

/** The delivery app (or "Direct") an order came from, in its colour. */
export function SourceTag({ source, className }: { source: OrderSource | string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold text-white", className)}
      style={{ background: sourceColor(source) }}
    >
      {sourceLabel(source)}
    </span>
  );
}

/** A small figure with a label, for the stat rows at the top of pages. */
export function StatTile({
  label,
  value,
  icon,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: "neutral" | "success" | "brand" | "info" | "warning";
  hint?: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-alt text-ink-2",
    success: "bg-success-soft text-success",
    brand: "bg-brand-soft text-brand",
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning",
  };
  return (
    <div className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      <div className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", tones[tone])}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">{label}</p>
        <p className="truncate text-2xl font-extrabold tracking-tight text-ink tabular">{value}</p>
        {hint && <p className="truncate text-xs text-ink-3">{hint}</p>}
      </div>
    </div>
  );
}

/** Same wording as the app's merchant screens. */
export const MERCHANT_STATUS: Record<LiveOrder["status"], { label: string; tone: "neutral" | "brand" | "success" | "warning" | "info" }> = {
  preparing: { label: "Finding driver", tone: "warning" },
  batched_offered: { label: "Offered", tone: "info" },
  driver_assigned: { label: "Driver assigned", tone: "info" },
  ready_for_pickup: { label: "Ready", tone: "success" },
  picked_up: { label: "Picked up", tone: "success" },
  delivered: { label: "Delivered", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const driverKind = (o: LiveOrder) => (o.assignedDriverType === "restaurant_own" ? "Your driver" : "Platform driver");

/** Credits needed for a platform delivery at this fee, and whether there are enough. */
export function creditCheck(credits: CreditSummary | null, feeGbp: number) {
  const available = credits?.available ?? 0;
  return { enough: !credits || available + 1e-9 >= feeGbp, available, needed: feeGbp };
}

export const OUT_OF_CREDITS = "Sorry, this order can’t be posted: you’re out of credits. Buy credits to keep using deliveries.";

/** The out-of-credits message with a way to buy more. */
export function OutOfCredits({
  available,
  needed,
  className,
  extra,
}: {
  available: number;
  needed: number;
  className?: string;
  extra?: React.ReactNode;
}) {
  const none = available < 1;
  return (
    <div className={cn("rounded-2xl border border-brand-line bg-brand-soft p-4", className)} role="alert">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white">
          <Coins className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">{none ? "You’re out of credits" : "Not enough credits"}</p>
          <p className="mt-0.5 text-sm text-ink-2">
            {none
              ? OUT_OF_CREDITS
              : `Sorry, this order can’t be posted: it needs ${needed.toFixed(2)} credits and you have ${available.toFixed(2)} available. Buy credits to continue.`}
          </p>
          {extra}
        </div>
      </div>
      <Link href="/merchant/credits" className="mt-3 block">
        <Button className="w-full" icon={<Coins className="size-4" />}>
          Buy credits
        </Button>
      </Link>
    </div>
  );
}

export const clock = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
};

export const minutes = (n: number | null) => (n == null ? "—" : `${Math.round(n)} min`);
