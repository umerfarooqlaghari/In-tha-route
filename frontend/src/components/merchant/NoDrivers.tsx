"use client";

import { RefreshCw, UserRound } from "lucide-react";
import { useState } from "react";

import { Avatar, Button, Modal } from "@/components/ui";
import { cn } from "@/lib/format";
import { isWaiting, useMerchant } from "@/lib/merchant-store";
import type { LiveOrder } from "@/lib/types";

/**
 * An order nobody took while it was in the pool leaves the pool. On any page the
 * merchant is asked at once; if they close it, the same choices stay on the order's card.
 */
export function NoDriversPrompt() {
  const { orders } = useMerchant();
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Closing it asks again only if the order goes back into the pool and runs out again (a new window).
  const key = (o: LiveOrder) => `${o.id}|${o.poolExpiresAt ?? ""}`;
  const order = orders.filter(isWaiting).find((o) => !dismissed.includes(key(o))) ?? null;
  return <NoDriversDialog order={order} onClose={() => order && setDismissed((d) => [...d, key(order)])} />;
}

/** Look for drivers again, or give the order to one of the merchant's own drivers. */
export function NoDriversDialog({ order, onClose }: { order: LiveOrder | null; onClose: () => void }) {
  const { drivers, data, findDriversAgain, assignOwnDriver } = useMerchant();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | undefined>();
  const max = data?.algorithm.maxBatchSize ?? 3;
  const own = drivers
    .filter((d) => (d.activeOrders ?? 0) < max)
    .sort((a, b) => Number(!!b.isOnline) - Number(!!a.isOnline));
  const driverId = own.some((d) => d.id === picked) ? picked : own[0]?.id;

  const run = async (k: string, fn: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(k);
    const ok = await fn();
    setBusy(null);
    if (ok) onClose();
  };

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      title="No drivers available right now"
      subtitle={
        order
          ? `Nobody accepted ${[order.source, order.externalOrderId].filter(Boolean).join(" ")} in time, so it has left the pool.`
          : undefined
      }
    >
      {order && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line p-4">
            <p className="font-bold text-ink">Look for drivers again</p>
            <p className="mt-1 text-sm text-ink-3">It goes back into the pool for every driver, with a fresh countdown.</p>
            <Button
              className="mt-4 w-full"
              icon={<RefreshCw className="size-4" />}
              loading={busy === "find"}
              disabled={!!busy}
              onClick={() => run("find", () => findDriversAgain(order.id))}
            >
              Find drivers again
            </Button>
          </div>

          {own.length > 0 && (
            <div className="rounded-2xl border border-line p-4">
              <p className="font-bold text-ink">Or give it to your driver</p>
              <div className="mt-3 space-y-2">
                {own.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setPicked(d.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                      driverId === d.id ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-alt"
                    )}
                  >
                    <Avatar name={d.name} tone="info" online={!!d.isOnline} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{d.name}</span>
                      <span className="block text-xs text-ink-3">
                        {d.isOnline ? "Online" : "Offline"} · {d.activeOrders ?? 0}/{max} orders
                      </span>
                    </span>
                    <span
                      className={cn(
                        "size-5 rounded-full border-2",
                        driverId === d.id ? "border-brand bg-brand shadow-[inset_0_0_0_3px_white]" : "border-line-strong"
                      )}
                    />
                  </button>
                ))}
              </div>
              <Button
                variant="dark"
                className="mt-4 w-full"
                icon={<UserRound className="size-4" />}
                loading={busy === "assign"}
                disabled={!!busy || !driverId}
                onClick={() => driverId && run("assign", () => assignOwnDriver(order.id, driverId))}
              >
                Give to this driver
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
