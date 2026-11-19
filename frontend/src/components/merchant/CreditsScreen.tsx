"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Coins,
  CreditCard,
  Gift,
  Hourglass,
  Info,
  Lock,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Truck,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AnimatedNumber, Badge, Button, Card, CardHeader, EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { cn, formatGbp } from "@/lib/format";
import { useMerchant } from "@/lib/merchant-store";
import type { CreditKind, CreditSummary, CreditTransaction } from "@/lib/types";

const deliveriesFor = (amount: number, fee: number) => (fee > 0 ? Math.floor((amount + 1e-9) / fee) : null);

export const KIND_META: Record<CreditKind, { label: string; icon: React.ReactNode; tone: string }> = {
  purchase: { label: "Card payment", icon: <CreditCard className="size-4" />, tone: "bg-success-soft text-success" },
  grant: { label: "Free credits", icon: <Gift className="size-4" />, tone: "bg-info-soft text-info" },
  adjustment: { label: "Adjustment", icon: <Wrench className="size-4" />, tone: "bg-warning-soft text-warning" },
  delivery: { label: "Delivery", icon: <Truck className="size-4" />, tone: "bg-surface-alt text-ink-2" },
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function CreditsScreen() {
  const { credits, setCredits, data } = useMerchant();
  const toast = useToast();
  const [tx, setTx] = useState<CreditTransaction[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Activity reloads whenever the balance moves (a delivery charged, a payment, an admin change).
  const version = credits ? `${credits.balance}|${credits.usedCredits}|${credits.addedCredits}` : "";
  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    api<{ credits: CreditSummary; transactions: CreditTransaction[] }>("merchant", "GET", "/api/restaurant/credits")
      .then((r) => !cancelled && setTx(r.transactions))
      .catch(() => !cancelled && setTx((t) => t ?? []));
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Back from Stripe: add the credits if the payment went through.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("checkout");
    const cancelled = params.get("cancelled");
    if (!sessionId && !cancelled) return;
    window.history.replaceState(null, "", "/merchant/credits");
    if (cancelled) {
      toast({ tone: "error", title: "Payment cancelled", body: "No money was taken and your credits haven’t changed." });
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runs once, on the return from Stripe
    setConfirming(true);
    api<{ status: "paid" | "pending" | "expired"; credits: CreditSummary }>("merchant", "POST", "/api/restaurant/credits/confirm", { sessionId })
      .then((r) => {
        setCredits(r.credits);
        if (r.status === "paid") toast({ tone: "success", title: "Payment received", body: "Your credits have been added." });
        else if (r.status === "pending") toast({ tone: "success", title: "Payment processing", body: "Your credits appear here as soon as the payment clears." });
        else toast({ tone: "error", title: "Payment not completed", body: "The checkout expired. No money was taken." });
      })
      .catch((err) => toast({ tone: "error", title: "Couldn’t confirm the payment", body: errorMessage(err) }))
      .finally(() => setConfirming(false));
  }, [setCredits, toast]);

  if (!data || !credits) {
    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Skeleton className="h-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const fee = credits.feePerDeliveryGbp;
  const low = credits.available < fee;

  return (
    <div className="space-y-6">
      {confirming && (
        <div className="flex items-center gap-3 rounded-2xl bg-info-soft p-4 text-sm font-medium text-ink">
          <Hourglass className="size-4 animate-pulse text-info" /> Confirming your payment…
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          {/* Balance */}
          <Card className="relative overflow-hidden p-0">
            <div className="brand-gradient grain relative isolate overflow-hidden p-7 text-white">
              <Coins className="pointer-events-none absolute -right-6 -bottom-8 size-48 rotate-12 text-white/10" />
              <p className="text-[12px] font-bold tracking-[0.16em] text-white/70 uppercase">Credits available</p>
              <p className="mt-2 text-6xl font-extrabold tracking-tight">
                <AnimatedNumber value={credits.available} format={(n) => n.toFixed(2)} />
              </p>
              <p className="mt-2 text-white/80">
                {credits.deliveriesLeft == null ? (
                  "Platform deliveries are free right now."
                ) : (
                  <>
                    ≈ <span className="font-bold text-white">{credits.deliveriesLeft}</span> platform{" "}
                    {credits.deliveriesLeft === 1 ? "delivery" : "deliveries"} left at {formatGbp(fee)} each
                  </>
                )}
              </p>
              {low && (
                <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-brand">
                  <Info className="size-3.5" /> Not enough for a platform delivery. Top up to keep posting.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              <Mini label="Balance" value={credits.balance.toFixed(2)} />
              <Mini label="Held for live orders" value={credits.held.toFixed(2)} />
              <Mini label="Fee per delivery" value={formatGbp(fee)} badge={credits.customFee ? "Your rate" : undefined} />
              <Mini label="Deliveries charged" value={String(credits.deliveriesCharged)} />
            </div>
          </Card>

          <Card className="p-6">
            <p className="font-bold text-ink">How credits work</p>
            <ul className="mt-3 grid gap-3 text-sm text-ink-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <li className="flex gap-2"><Coins className="mt-0.5 size-4 shrink-0 text-road" /> 1 credit = £1. £100 buys 100 credits.</li>
              <li className="flex gap-2"><Truck className="mt-0.5 size-4 shrink-0 text-brand" /> Each platform delivery uses {formatGbp(fee)} in credits, taken when it’s delivered.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> Orders for your own drivers and cancelled orders don’t use credits, but with no credits left you can’t post any order.</li>
            </ul>
          </Card>

          <Card className="pb-2">
            <CardHeader
              title="Activity"
              subtitle="Payments, free credits and deliveries"
              right={
                <span className="flex gap-3 text-xs font-semibold text-ink-3">
                  <span>+{credits.addedCredits.toFixed(2)} added</span>
                  <span>−{credits.usedCredits.toFixed(2)} used</span>
                </span>
              }
            />
            <div className="mt-3">
              {tx == null ? (
                <div className="space-y-2 px-6 pb-4">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
                </div>
              ) : tx.length === 0 ? (
                <EmptyState icon={<ReceiptText className="size-6" />} title="No activity yet" body="Your payments and deliveries appear here." />
              ) : (
                <ul className="divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {tx.map((t) => (
                      <motion.li key={t.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 px-6 py-3.5">
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", KIND_META[t.kind].tone)}>{KIND_META[t.kind].icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {t.kind === "delivery" ? `Delivery${t.externalOrderId ? ` ${t.externalOrderId}` : ""}` : t.note || KIND_META[t.kind].label}
                          </span>
                          <span className="block truncate text-xs text-ink-3">
                            {when(t.createdAt)}
                            {t.kind === "purchase" && t.amountPaidGbp != null ? ` · paid ${formatGbp(t.amountPaidGbp)}` : ""}
                            {t.kind === "delivery" && t.note ? ` · ${t.note}` : ""}
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

        <BuyPanel credits={credits} />
      </div>
    </div>
  );
}

function Mini({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="border-t border-line p-4">
      <p className="text-[11px] font-bold tracking-[0.12em] text-ink-3 uppercase">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-lg font-extrabold text-ink tabular">
        {value}
        {badge && <Badge tone="info">{badge}</Badge>}
      </p>
    </div>
  );
}

function BuyPanel({ credits }: { credits: CreditSummary }) {
  const fee = credits.feePerDeliveryGbp;
  const packs = credits.packsGbp.length ? credits.packsGbp : [50, 100, 200, 500];
  const [pack, setPack] = useState<number | "custom">(packs.includes(100) ? 100 : packs[0]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = pack === "custom" ? Number(custom) : pack;
  const customError = useMemo(() => {
    if (pack !== "custom" || custom === "") return null;
    if (!Number.isFinite(amount)) return "Enter an amount in pounds.";
    if (amount < credits.minPurchaseGbp) return `The smallest top-up is ${formatGbp(credits.minPurchaseGbp)}.`;
    if (amount > credits.maxPurchaseGbp) return `The largest top-up is £${credits.maxPurchaseGbp.toLocaleString("en-GB")}.`;
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return "Use whole pence.";
    return null;
  }, [pack, custom, amount, credits]);
  const valid = Number.isFinite(amount) && amount >= credits.minPurchaseGbp && amount <= credits.maxPurchaseGbp && !customError;
  const deliveries = valid ? deliveriesFor(amount, fee) : null;

  const pay = async () => {
    if (!valid || busy || !credits.paymentsEnabled) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ url: string }>("merchant", "POST", "/api/restaurant/credits/checkout", {
        amountGbp: Math.round(amount * 100) / 100,
        returnUrl: window.location.origin,
      });
      window.location.assign(r.url);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card className="self-start p-6 xl:sticky xl:top-6">
      <p className="flex items-center gap-2 text-lg font-extrabold text-ink">
        <Sparkles className="size-5 text-road" /> Buy credits
      </p>
      <p className="mt-1 text-sm text-ink-3">
        Your rate is {formatGbp(fee)} per platform delivery{credits.customFee ? ", set for your account" : ""}.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {packs.map((p) => {
          const n = deliveriesFor(p, fee);
          const active = pack === p;
          return (
            <button
              key={p}
              onClick={() => setPack(p)}
              className={cn(
                "relative rounded-2xl border-2 p-4 text-left transition",
                active ? "border-brand bg-brand-soft" : "border-line hover:border-ink-3"
              )}
            >
              {active && (
                <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-brand text-white">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              )}
              <span className="block text-2xl font-extrabold text-ink tabular">£{p}</span>
              <span className="block text-xs font-semibold text-ink-2">{p} credits</span>
              <span className="mt-2 block text-xs text-ink-3">{n == null ? "—" : `≈ ${n} ${n === 1 ? "delivery" : "deliveries"}`}</span>
            </button>
          );
        })}
      </div>

      <button
        onClick={() => setPack("custom")}
        className={cn("mt-3 w-full rounded-2xl border-2 p-4 text-left transition", pack === "custom" ? "border-brand bg-brand-soft" : "border-line hover:border-ink-3")}
      >
        <span className="block text-sm font-bold text-ink">Another amount</span>
        {pack === "custom" ? (
          <span className="mt-2 flex items-center gap-2 rounded-xl bg-surface px-3 ring-1 ring-line-strong focus-within:ring-ink">
            <span className="font-bold text-ink-2">£</span>
            <input
              autoFocus
              inputMode="decimal"
              value={custom}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder={`${credits.minPurchaseGbp} – ${credits.maxPurchaseGbp}`}
              className="h-11 w-full bg-transparent text-lg font-bold text-ink outline-none tabular placeholder:text-sm placeholder:font-medium placeholder:text-ink-3"
            />
          </span>
        ) : (
          <span className="block text-xs text-ink-3">
            From {formatGbp(credits.minPurchaseGbp)} to £{credits.maxPurchaseGbp.toLocaleString("en-GB")}
          </span>
        )}
      </button>
      {customError && <p className="mt-2 text-[13px] font-medium text-brand">{customError}</p>}

      <div className="mt-5 space-y-2 rounded-2xl bg-surface-alt/70 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-3">You pay</span>
          <span className="font-bold text-ink tabular">{valid ? formatGbp(amount) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-3">Credits added</span>
          <span className="font-bold text-ink tabular">{valid ? amount.toFixed(2) : "—"}</span>
        </div>
        <div className="flex justify-between border-t border-line pt-2">
          <span className="text-ink-3">Platform deliveries</span>
          <span className="font-extrabold text-brand tabular">{deliveries == null ? "—" : `≈ ${deliveries}`}</span>
        </div>
      </div>

      {error && <p className="mt-3 rounded-2xl bg-brand-soft p-3 text-sm font-medium text-brand">{error}</p>}

      <Button
        size="lg"
        className="mt-5 w-full"
        icon={credits.paymentsEnabled ? <CreditCard className="size-5" /> : <Lock className="size-4" />}
        loading={busy}
        disabled={!valid || !credits.paymentsEnabled}
        onClick={pay}
      >
        {credits.paymentsEnabled ? (valid ? `Pay ${formatGbp(amount)}` : "Pay") : "Card payments coming soon"}
      </Button>
      <p className="mt-3 flex items-start gap-2 text-xs text-ink-3">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        {credits.paymentsEnabled
          ? "You’ll pay on Stripe’s secure page, then come straight back here. Longer trips use a little more than the base fee."
          : "Card payments aren’t switched on yet. Contact the In Tha Route team to add credits meanwhile."}
      </p>
    </Card>
  );
}
