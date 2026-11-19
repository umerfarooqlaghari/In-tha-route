"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  Clock3,
  ImageUp,
  Info,
  ReceiptText,
  ScanLine,
  Send,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { LiveMap } from "@/components/admin/LiveMap";
import { Avatar, Button, Card, Segmented } from "@/components/ui";
import { Field } from "@/components/ui/field";
import { ApiError, errorMessage } from "@/lib/api";
import { cn, formatCountdown, formatGbp, VEHICLE_SHORT } from "@/lib/format";
import { pinFor } from "@/lib/geo";
import { useMerchant, type Dispatch } from "@/lib/merchant-store";
import type { DriverPolicy, LiveOrder, ReceiptTemplate } from "@/lib/types";
import { OutOfCredits, SourceTag, creditCheck, driverKind } from "./common";

const PREP_OPTIONS = [10, 15, 20, 30, 40];

const defaultDispatch = (p?: DriverPolicy): Dispatch =>
  p === "own_drivers" ? "own_driver" : p === "hybrid" ? "hybrid" : "open_platform";

type Step = "scan" | "confirm" | "done";

export function NewOrderScreen() {
  const { restaurant, drivers, data, orders, credits, scanReceipt, postOrder } = useMerchant();
  const max = data?.algorithm.maxBatchSize ?? 3;
  const ownDrivers = drivers.filter((d) => (d.activeOrders ?? 0) < max);
  const platformAllowed = restaurant?.driverPolicy !== "own_drivers";
  const hybridPolicy = restaurant?.driverPolicy === "hybrid";

  const [step, setStep] = useState<Step>("scan");
  const [template, setTemplate] = useState<ReceiptTemplate | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<ApiError | null>(null);
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [note, setNote] = useState("");
  const [showItems, setShowItems] = useState(false);
  const [prep, setPrep] = useState(20);
  const [picked, setPicked] = useState<Dispatch>(defaultDispatch(restaurant?.driverPolicy));
  const [pickedDriverId, setPickedDriverId] = useState<string | undefined>();
  const [published, setPublished] = useState<LiveOrder | null>(null);

  // Follows the delivery setting if it changes while the page is open.
  const dispatch: Dispatch = !platformAllowed
    ? "own_driver"
    : picked === "own_driver"
      ? "own_driver"
      : hybridPolicy
        ? "hybrid"
        : "open_platform";
  const ownDriverId = ownDrivers.some((d) => d.id === pickedDriverId) ? pickedDriverId : ownDrivers[0]?.id;

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const startScan = async (file: File | undefined | null) => {
    if (!file || scanning) return;
    if (!file.type.startsWith("image/")) {
      setScanError("Choose a photo of the receipt (JPG, PNG or HEIC).");
      return;
    }
    setScanError(null);
    setPreview(URL.createObjectURL(file));
    setScanning(true);
    try {
      const draft = await scanReceipt(file);
      setTemplate(draft);
      setAddress(draft.deliveryAddress);
      setPostcode(draft.postcode);
      setAccessCode(draft.phoneAccessCode ?? "");
      setNote(draft.deliveryInstructions ?? "");
      setPrep(
        PREP_OPTIONS.reduce((a, b) =>
          Math.abs(b - draft.suggestedPrepMinutes) < Math.abs(a - draft.suggestedPrepMinutes) ? b : a
        )
      );
      setShowItems(false);
      setPostError(null);
      setStep("confirm");
    } catch (err) {
      setScanError(errorMessage(err));
    } finally {
      setScanning(false);
    }
  };

  const fee = template?.estimatedFeeGbp ?? 0;
  // Out of credits blocks every order, whoever delivers it (the server checks the same).
  // A platform order also needs enough for its own fee; an own-driver order uses none.
  const check = creditCheck(credits, Math.max(dispatch === "own_driver" ? 0 : fee, credits?.feePerDeliveryGbp ?? 0));
  const blockedByCredits = !check.enough;

  const post = async () => {
    if (!template || posting || blockedByCredits) return;
    setPosting(true);
    setPostError(null);
    try {
      const order = await postOrder({
        template,
        prepMinutes: prep,
        dispatchType: dispatch,
        ownDriverId: dispatch === "own_driver" ? ownDriverId : undefined,
        address: address.trim(),
        postcode: postcode.trim(),
        accessCode: accessCode.trim(),
        note: note.trim(),
      });
      setPublished(order);
      setStep("done");
    } catch (err) {
      setPostError(err instanceof ApiError ? err : new ApiError(errorMessage(err), "UNKNOWN"));
    } finally {
      setPosting(false);
    }
  };

  const reset = () => {
    setStep("scan");
    setPublished(null);
    setTemplate(null);
    setPreview(null);
    setPostError(null);
  };

  if (step === "done" && published) {
    const live = orders.find((o) => o.id === published.id) ?? published;
    return (
      <div className="mx-auto max-w-xl">
        <Card className="p-8 text-center">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="mx-auto grid size-20 place-items-center rounded-full bg-success text-white shadow-[0_18px_40px_-16px_rgb(20_163_90/0.9)]"
          >
            <Check className="size-10" strokeWidth={3} />
          </motion.div>
          <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-ink">Order is live</h2>
          <p className="mt-1 text-ink-2">
            {live.assignedDriverName
              ? `${live.assignedDriverName} has it${live.hybrid ? ` · ${driverKind(live)}` : ""}`
              : live.hybrid
                ? "Your drivers and nearby platform drivers can see it now"
                : "Nearby drivers can see it now"}
          </p>
          <div className="mt-6 rounded-2xl border border-line p-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <SourceTag source={live.source} />
              <span className="text-sm font-semibold text-ink-2">{live.externalOrderId}</span>
            </div>
            <p className="mt-3 truncate font-bold text-ink">{live.deliveryAddress}</p>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <span className="text-sm text-ink-3">Ready in</span>
              <span className="text-2xl font-extrabold text-ink tabular">{formatCountdown(live.remainingSeconds)}</span>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link href="/merchant/orders" onClick={reset}>
              <Button variant="dark" className="w-full">
                View live orders
              </Button>
            </Link>
            <Button variant="secondary" onClick={reset}>
              Scan another receipt
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (step === "scan" || !template) {
    return (
      <ScanStep
        scanning={scanning}
        preview={preview}
        error={scanError}
        onFile={startScan}
        credits={credits}
      />
    );
  }

  const pickup = pinFor(template.restaurantPostcode, template.pickupCoords);
  const drop = pinFor(postcode, postcode.trim().toUpperCase() === template.postcode.toUpperCase() ? template.dropoffCoords : null);
  const itemCount = template.items.reduce((n, i) => n + i.quantity, 0);
  const canPost =
    !posting &&
    !!address.trim() &&
    !!postcode.trim() &&
    !(dispatch === "own_driver" && !ownDriverId) &&
    !blockedByCredits;

  return (
    <div className="space-y-5">
      <StepProgress step={1} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Order details */}
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <LiveMap
              key={`${template.id}-${drop.latitude.toFixed(4)}`}
              className="h-56 w-full"
              pins={[
                { id: "p", kind: "restaurant", lat: pickup.latitude, lng: pickup.longitude, popup: [template.restaurantName] },
                { id: "d", kind: "dropoff", lat: drop.latitude, lng: drop.longitude, color: "#E5484D", popup: [address, postcode] },
              ]}
            />
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <SourceTag source={template.source} />
              <span className="truncate text-sm font-semibold text-ink-2">
                {[template.externalOrderId, template.distanceMiles ? `${template.distanceMiles} mi` : ""].filter(Boolean).join(" · ")}
              </span>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Avatar name={template.customerName || "Customer"} />
              <div className="min-w-0">
                <p className="truncate font-bold text-ink">{template.customerName || "Customer"}</p>
                <p className="text-sm text-ink-3">{template.customerPhone || "—"}</p>
              </div>
            </div>
            <Field label="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} error={!address.trim() ? "Enter the delivery address." : undefined} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Postcode"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                error={!postcode.trim() ? "Enter the postcode." : undefined}
              />
              <Field label="Access code" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="order-note" className="block text-[13px] font-semibold text-ink-2">
                Note for the driver
              </label>
              <textarea
                id="order-note"
                value={note}
                maxLength={1000}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
                placeholder="No note on this receipt"
                className="w-full resize-none rounded-2xl border border-line-strong bg-surface px-4 py-3 text-[15px] text-ink outline-none transition placeholder:text-ink-3/70 hover:border-ink-3 focus:border-ink focus:shadow-[0_0_0_4px_rgb(20_21_26/0.06)]"
              />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <button onClick={() => setShowItems((v) => !v)} className="flex w-full items-center justify-between gap-3 px-6 py-5 text-left">
              <span className="font-bold text-ink">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
              <span className="flex items-center gap-2 font-bold text-ink tabular">
                {formatGbp(template.orderTotalGbp)}
                <ChevronDown className={cn("size-5 text-ink-3 transition-transform", showItems && "rotate-180")} />
              </span>
            </button>
            <AnimatePresence initial={false}>
              {showItems && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className="space-y-2 border-t border-line px-6 py-4 text-sm">
                    {template.items.map((it, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="w-8 font-bold text-ink-2">{it.quantity}×</span>
                        <span className="min-w-0 flex-1 truncate text-ink">{it.name}</span>
                        <span className="text-ink-3 tabular">{formatGbp(it.price)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </div>

        {/* Dispatch and post */}
        <div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <Card className="p-6">
            <p className="flex items-center gap-2 font-bold text-ink">
              <Clock3 className="size-4 text-ink-3" /> Ready in
            </p>
            <p className="mt-1 text-4xl font-extrabold tracking-tight text-ink tabular">{prep} min</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {PREP_OPTIONS.map((m) => (
                <button
                  key={m}
                  onClick={() => setPrep(m)}
                  className={cn(
                    "h-9 rounded-full px-4 text-sm font-semibold transition",
                    m === prep ? "bg-ink text-white" : "bg-surface-alt text-ink-2 hover:bg-line"
                  )}
                >
                  {m} min
                </button>
              ))}
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <p className="font-bold text-ink">Who delivers?</p>
            <Segmented<Dispatch>
              value={dispatch}
              onChange={setPicked}
              options={
                !platformAllowed
                  ? [{ value: "own_driver", label: "My driver" }]
                  : hybridPolicy
                    ? [
                        { value: "hybrid", label: "Everyone" },
                        { value: "own_driver", label: "My driver" },
                      ]
                    : [
                        { value: "open_platform", label: "Platform driver" },
                        { value: "own_driver", label: "My driver" },
                      ]
              }
            />
            {dispatch === "own_driver" ? (
              ownDrivers.length ? (
                <div className="space-y-2">
                  {ownDrivers.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setPickedDriverId(d.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                        ownDriverId === d.id ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-alt"
                      )}
                    >
                      <Avatar name={d.name} tone="info" online={!!d.isOnline} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{d.name}</span>
                        <span className="block text-xs text-ink-3">
                          {VEHICLE_SHORT[d.vehicle]} · {d.activeOrders ?? 0}/{max} orders
                        </span>
                      </span>
                      <span
                        className={cn(
                          "size-5 shrink-0 rounded-full border-2",
                          ownDriverId === d.id ? "border-brand bg-brand shadow-[inset_0_0_0_3px_white]" : "border-line-strong"
                        )}
                      />
                    </button>
                  ))}
                  <p className="text-xs text-ink-3">No platform fee and no credits used, but you need credits in your balance to post.</p>
                </div>
              ) : (
                <Hint>
                  {drivers.length
                    ? `All your drivers already have ${max} orders. A driver shows here again as soon as they deliver one.`
                    : "Add a driver under My drivers first."}
                </Hint>
              )
            ) : (
              <>
                {dispatch === "hybrid" && (
                  <Hint>Your drivers and nearby platform drivers all see this order. The first to accept gets it.</Hint>
                )}
                <div className="space-y-2 rounded-2xl bg-surface-alt/70 p-4 text-sm">
                  <Row label={dispatch === "hybrid" ? "Delivery fee (none if your driver takes it)" : "Delivery fee"} value={formatGbp(fee)} />
                  <Row label="Credits used" value={`${fee.toFixed(2)}`} />
                  <Row label="Credits available" value={`${check.available.toFixed(2)}`} strong={!check.enough} />
                </div>
              </>
            )}
          </Card>

          {blockedByCredits && (
            <OutOfCredits available={check.available} needed={check.needed} />
          )}

          {postError && !(blockedByCredits && postError.code === "OUT_OF_CREDITS") && (
            postError.code === "OUT_OF_CREDITS" ? (
              <OutOfCredits available={check.available} needed={check.needed} />
            ) : (
              <div className="rounded-2xl border border-brand-line bg-brand-soft p-4 text-sm font-medium text-ink" role="alert">
                {errorMessage(postError)}
              </div>
            )
          )}

          <div className="flex gap-3">
            <Button variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("scan")}>
              Back
            </Button>
            <Button
              className="flex-1"
              size="lg"
              icon={<Send className="size-4" />}
              loading={posting}
              disabled={!canPost}
              onClick={post}
              title={blockedByCredits ? "Buy credits to post orders" : undefined}
            >
              Post order
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanStep({
  scanning,
  preview,
  error,
  onFile,
  credits,
}: {
  scanning: boolean;
  preview: string | null;
  error: string | null;
  onFile: (f: File | undefined | null) => void;
  credits: ReturnType<typeof useMerchant>["credits"];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Paste a screenshot of the receipt straight in.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) onFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile]);

  const low = credits && credits.available < credits.feePerDeliveryGbp;

  return (
    <div className="space-y-5">
      <StepProgress step={0} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "relative grid min-h-[360px] place-items-center overflow-hidden rounded-3xl border-2 border-dashed transition",
              dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-surface-alt/50"
            )}
          >
            {(["top-5 left-5 border-t-[3px] border-l-[3px] rounded-tl-xl", "top-5 right-5 border-t-[3px] border-r-[3px] rounded-tr-xl", "bottom-5 left-5 border-b-[3px] border-l-[3px] rounded-bl-xl", "bottom-5 right-5 border-b-[3px] border-r-[3px] rounded-br-xl"] as const).map((c) => (
              <span key={c} className={cn("absolute size-8 border-ink", c)} />
            ))}
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen photo
              <img src={preview} alt="Receipt" className={cn("absolute inset-0 m-auto max-h-full max-w-full object-contain p-10", scanning ? "opacity-60" : "opacity-30")} />
            )}
            {scanning && (
              <motion.span
                className="absolute inset-x-10 top-10 h-0.5 rounded-full bg-brand shadow-[0_0_20px_rgb(229_72_77/0.8)]"
                animate={{ y: [0, 280, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-3 px-6 text-center">
              <div className={cn("grid size-16 place-items-center rounded-2xl", scanning ? "bg-brand text-white" : "bg-surface text-ink-3 shadow-sm")}>
                <ReceiptText className="size-8" />
              </div>
              <p className="text-lg font-bold text-ink">{scanning ? "Reading receipt…" : "Drop a photo of the receipt here"}</p>
              <p className="max-w-sm text-sm text-ink-3">
                {scanning ? "This takes a few seconds." : "or choose one below. You can also paste a screenshot (Ctrl/Cmd + V)."}
              </p>
            </div>
          </div>
          {error && (
            <p className="mt-4 rounded-2xl bg-brand-soft p-3 text-sm font-medium text-brand" role="alert">
              {error}
            </p>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Button size="lg" icon={<ImageUp className="size-5" />} loading={scanning} onClick={() => fileRef.current?.click()}>
              {scanning ? "Reading receipt…" : "Upload receipt"}
            </Button>
            <Button size="lg" variant="secondary" icon={<Camera className="size-5" />} disabled={scanning} onClick={() => cameraRef.current?.click()}>
              Take a photo
            </Button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </Card>

        <div className="space-y-5">
          <Card className="p-6">
            <p className="flex items-center gap-2 font-bold text-ink">
              <ScanLine className="size-4 text-brand" /> How it works
            </p>
            <ol className="mt-4 space-y-4 text-sm text-ink-2">
              {[
                ["Scan", "We read the customer, address, items and total from the receipt."],
                ["Check", "Fix anything, set the prep time and pick who delivers."],
                ["Post", "A courier is matched to arrive as the food is ready."],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-bold text-white">{i + 1}</span>
                  <span>
                    <span className="font-semibold text-ink">{t}.</span> {b}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          {credits && (
            <Card className="p-6">
              <p className="text-[12px] font-bold tracking-[0.12em] text-ink-3 uppercase">Credits available</p>
              <p className={cn("mt-1 text-3xl font-extrabold tabular", low ? "text-brand" : "text-ink")}>
                {credits.available.toFixed(2)}
              </p>
              <p className="mt-1 text-sm text-ink-3">
                {credits.deliveriesLeft == null
                  ? "Platform deliveries are free right now."
                  : `≈ ${credits.deliveriesLeft} platform ${credits.deliveriesLeft === 1 ? "delivery" : "deliveries"} at ${formatGbp(credits.feePerDeliveryGbp)} each`}
              </p>
              {low && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-brand-soft p-3 text-[13px] text-ink">
                  <Info className="mt-0.5 size-4 shrink-0 text-brand" />
                  You can still scan, but no orders can be posted, with any driver, until you buy credits.
                </p>
              )}
              <Link href="/merchant/credits" className="mt-4 block">
                <Button variant={low ? "primary" : "secondary"} className="w-full">
                  {low ? "Buy credits" : "Manage credits"}
                </Button>
              </Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StepProgress({ step }: { step: 0 | 1 }) {
  const labels = ["Scan", "Confirm"];
  return (
    <div className="rounded-3xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="flex gap-2">
        {labels.map((_, i) => (
          <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <motion.div className="h-full bg-brand" initial={false} animate={{ width: i <= step ? "100%" : "0%" }} transition={{ duration: 0.5 }} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[13px] font-semibold text-ink-3">
        Step {step + 1} of 2 · {labels[step]}
      </p>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-info-soft p-3 text-[13px] text-ink">
      <UserRound className="mt-0.5 size-4 shrink-0 text-info" />
      {children}
    </p>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-3">{label}</span>
      <span className={cn("font-bold tabular", strong ? "text-brand" : "text-ink")}>{value}</span>
    </div>
  );
}
