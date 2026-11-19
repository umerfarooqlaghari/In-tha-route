"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import { Button, Modal } from "@/components/ui";
import { Field } from "@/components/ui/field";
import { useAdmin } from "@/lib/admin-store";
import { cn, formatGbp, shortName } from "@/lib/format";
import type { RestaurantPartner } from "@/lib/types";

/** Sets a merchant's own per-delivery fee, or puts them back on the standard fee. */
export function FeeDialog({ merchant, onClose }: { merchant: RestaurantPartner | null; onClose: () => void }) {
  return (
    <Modal
      open={!!merchant}
      onClose={onClose}
      title="Delivery fee"
      subtitle={merchant ? `What ${shortName(merchant.name)} is charged per platform delivery, in credits.` : undefined}
      width="max-w-md"
    >
      {merchant && <FeeForm key={merchant.id} merchant={merchant} onDone={onClose} />}
    </Modal>
  );
}

function FeeForm({ merchant, onDone }: { merchant: RestaurantPartner; onDone: () => void }) {
  const { data, updateMerchantFee } = useAdmin();
  const standard = data?.algorithm.baseRestaurantChargeGbp ?? 0;
  const [value, setValue] = useState(merchant.customFeeGbp != null ? String(merchant.customFeeGbp) : "");
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const n = Number(value);
  const error =
    value === "" ? undefined : !Number.isFinite(n) || n < 0 ? "Enter an amount of £0 or more." : n > 100 ? "The most is £100." : undefined;
  const credits = merchant.credits?.available ?? 0;

  const run = async (k: "save" | "reset", fee: number | null) => {
    setBusy(k);
    const ok = await updateMerchantFee(merchant.id, fee);
    setBusy(null);
    if (ok) onDone();
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-surface-alt/70 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-3">Standard fee (everyone)</span>
          <span className="font-bold text-ink tabular">{formatGbp(standard)}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-ink-3">This merchant now</span>
          <span className="font-bold text-ink tabular">
            {formatGbp(merchant.feePerDeliveryGbp ?? standard)} {merchant.customFeeGbp != null ? "(custom)" : ""}
          </span>
        </div>
      </div>
      <Field
        label="Custom fee per delivery (£)"
        inputMode="decimal"
        placeholder={standard.toFixed(2)}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
        error={error}
        hint={
          value !== "" && !error && n > 0
            ? `${Math.floor(credits / n)} deliveries with their ${credits.toFixed(2)} credits. Longer trips add the per-mile charge.`
            : "Live orders are re-priced straight away."
        }
        autoFocus
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        {merchant.customFeeGbp != null && (
          <Button variant="secondary" className="flex-1" loading={busy === "reset"} disabled={!!busy} onClick={() => run("reset", null)}>
            Use standard fee
          </Button>
        )}
        <Button
          variant="dark"
          className="flex-1"
          loading={busy === "save"}
          disabled={!!busy || value === "" || !!error}
          onClick={() => run("save", Math.round(n * 100) / 100)}
        >
          Save fee
        </Button>
      </div>
    </div>
  );
}

/** Adds or removes a merchant's credits by hand. */
export function CreditAdjustDialog({ merchant, onClose }: { merchant: RestaurantPartner | null; onClose: () => void }) {
  return (
    <Modal
      open={!!merchant}
      onClose={onClose}
      title="Adjust credits"
      subtitle={merchant ? `${shortName(merchant.name)} has ${(merchant.credits?.available ?? 0).toFixed(2)} credits available.` : undefined}
      width="max-w-md"
    >
      {merchant && <AdjustForm key={merchant.id} merchant={merchant} onDone={onClose} />}
    </Modal>
  );
}

function AdjustForm({ merchant, onDone }: { merchant: RestaurantPartner; onDone: () => void }) {
  const { adjustCredits } = useAdmin();
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const n = Number(amount);
  const error = amount === "" ? undefined : !Number.isFinite(n) || n <= 0 ? "Enter a number above 0." : n > 100000 ? "That is too many credits." : undefined;
  const fee = merchant.feePerDeliveryGbp ?? 0;

  const save = async () => {
    if (!amount || error) return;
    setBusy(true);
    const ok = await adjustCredits(merchant.id, mode === "add" ? n : -n, note.trim());
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-alt p-1">
        {(["add", "remove"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
              mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink-2"
            )}
          >
            {m === "add" ? <Plus className="size-4" /> : <Minus className="size-4" />}
            {m === "add" ? "Add credits" : "Remove credits"}
          </button>
        ))}
      </div>
      <Field
        label="Credits"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
        error={error}
        hint={amount && !error && fee > 0 ? `≈ ${Math.floor(n / fee)} deliveries at ${formatGbp(fee)}` : "1 credit = £1"}
        autoFocus
      />
      <Field label="Note (shown to the merchant)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Goodwill credit" />
      <Button className="w-full" variant={mode === "add" ? "dark" : "primary"} loading={busy} disabled={!amount || !!error} onClick={save}>
        {mode === "add" ? "Add" : "Remove"} {amount && !error ? n.toFixed(2) : ""} credits
      </Button>
    </div>
  );
}
