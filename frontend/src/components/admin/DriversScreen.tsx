"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Mail,
  Phone,
  Search,
  Star,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar, Badge, Button, Card, EmptyState, Modal, Segmented, Skeleton } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import { cleanTitle, cn, shortName, VEHICLE_SHORT } from "@/lib/format";
import type { DriverProfile, KycDocument } from "@/lib/types";
import { FileViewer } from "./FileViewer";

type Status = "all" | "pending" | "active" | "rejected";

const approvedOf = (d: DriverProfile) => (d.approval ? d.approval === "approved" : d.status === "approved_online");

export function DriversScreen() {
  const { data, approveDriver, rejectDriver } = useAdmin();
  const [tab, setTab] = useState<"platform" | "inhouse">("platform");
  const [status, setStatus] = useState<Status>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<DriverProfile | null>(null);
  const [reason, setReason] = useState("");
  // The uploaded files of one driver, stepped through one at a time.
  const [viewer, setViewer] = useState<{ driver: DriverProfile; docs: KycDocument[]; index: number } | null>(null);

  const drivers = data?.drivers ?? [];
  const platform = drivers.filter((d) => d.driverType === "platform_contracted");
  const inHouse = drivers.filter((d) => d.driverType === "restaurant_own");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tab === "platform" ? platform : inHouse;
    return list
      .filter((d) => {
        if (tab === "inhouse" || status === "all") return true;
        const approved = approvedOf(d);
        if (status === "active") return approved;
        if (status === "rejected") return d.approval === "rejected";
        return !approved && d.approval !== "rejected";
      })
      .filter((d) =>
        !q ? true : [d.name, d.email, d.phone, d.plateNumber, d.employerRestaurantName ?? ""].join(" ").toLowerCase().includes(q)
      )
      // Drivers waiting for a decision first.
      .sort((a, b) => Number(approvedOf(a)) - Number(approvedOf(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, tab, status, query]);

  if (!data) {
    return (
      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-64 rounded-3xl" />
        ))}
      </div>
    );
  }

  const approve = async (d: DriverProfile) => {
    setBusy(`approve-${d.id}`);
    await approveDriver(d.id);
    setBusy(null);
  };

  const openDoc = (d: DriverProfile, doc: KycDocument) => {
    const docs = d.kycDocuments.filter((k) => k.hasFile);
    setViewer({ driver: d, docs, index: Math.max(0, docs.findIndex((k) => k.id === doc.id)) });
  };
  const doc = viewer ? viewer.docs[viewer.index] : null;

  const pendingCount = platform.filter((d) => !approvedOf(d) && d.approval !== "rejected").length;

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Segmented
            value={tab}
            onChange={setTab}
            className="lg:w-[360px]"
            options={[
              { value: "platform", label: `Platform · ${platform.length}` },
              { value: "inhouse", label: `In-house · ${inHouse.length}` },
            ]}
          />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, phone or plate"
              className="h-11 w-full rounded-2xl border border-line-strong bg-surface pr-4 pl-11 text-sm outline-none transition focus:border-ink focus:shadow-[0_0_0_4px_rgb(20_21_26/0.06)]"
            />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {tab === "platform" && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-2 pt-4">
                {(
                  [
                    ["all", "All"],
                    ["pending", `Pending${pendingCount ? ` · ${pendingCount}` : ""}`],
                    ["active", "Active"],
                    ["rejected", "Rejected"],
                  ] as [Status, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setStatus(k)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-[13px] font-semibold transition",
                      status === k ? "bg-ink text-white" : "bg-surface-alt text-ink-2 hover:text-ink"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="size-6" />} title="No drivers here" body={query ? "Try a different search." : undefined} />
        </Card>
      ) : (
        <motion.div layout className="grid items-start gap-5 md:grid-cols-2 2xl:grid-cols-3">
          <AnimatePresence initial={false} mode="popLayout">
            {filtered.map((d, i) =>
              tab === "platform" ? (
                <PlatformDriver
                  key={d.id}
                  driver={d}
                  index={i}
                  busy={busy}
                  onApprove={() => approve(d)}
                  onReject={() => {
                    setReason("");
                    setRejecting(d);
                  }}
                  onOpenDoc={(doc) => openDoc(d, doc)}
                />
              ) : (
                <InHouseDriver key={d.id} driver={d} index={i} />
              )
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Reject */}
      <Modal open={!!rejecting} onClose={() => !busy && setRejecting(null)} title={`Reject ${rejecting?.name ?? ""}?`} width="max-w-md">
        <p className="text-[15px] leading-relaxed text-ink-2">
          Their documents are cleared and they will be asked to upload them again.
        </p>
        <label className="mt-5 block text-[13px] font-semibold text-ink-2">
          Reason (optional)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="e.g. The licence photo is blurry"
            className="mt-1.5 w-full resize-none rounded-2xl border border-line-strong p-3 text-sm font-normal text-ink outline-none focus:border-ink"
          />
        </label>
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setRejecting(null)} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            loading={busy === `reject-${rejecting?.id}`}
            onClick={async () => {
              if (!rejecting) return;
              setBusy(`reject-${rejecting.id}`);
              await rejectDriver(rejecting.id, reason.trim() || undefined);
              setBusy(null);
              setRejecting(null);
            }}
          >
            Reject
          </Button>
        </div>
      </Modal>

      {/* Document viewer */}
      <Modal
        open={!!doc}
        onClose={() => setViewer(null)}
        title={doc ? cleanTitle(doc.title) : ""}
        subtitle={doc ? `${viewer?.driver.name} · should show: ${doc.subtitle}` : undefined}
        width="max-w-3xl"
      >
        {viewer && doc && (
          <div className="space-y-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <FileViewer
                  path={`/api/admin/kyc-documents/${doc.id}/file`}
                  kind={doc.fileType ?? "image"}
                  name={`${viewer.driver.name} - ${cleanTitle(doc.title)}`}
                />
              </motion.div>
            </AnimatePresence>
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <DocIcon status={doc.status} /> {doc.status === "verified" ? "Verified" : doc.status === "pending" ? "Waiting for review" : "Missing"}
              </span>
              <span>{doc.updatedAt}</span>
            </div>
            {viewer.docs.length > 1 && (
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  className="flex-1"
                  icon={<ChevronLeft className="size-4" />}
                  disabled={viewer.index === 0}
                  onClick={() => setViewer((v) => v && { ...v, index: v.index - 1 })}
                >
                  Previous
                </Button>
                <span className="text-sm font-semibold text-ink-2 tabular">
                  {viewer.index + 1} of {viewer.docs.length}
                </span>
                <Button
                  variant="secondary"
                  className="flex-1 flex-row-reverse"
                  icon={<ChevronRight className="size-4" />}
                  disabled={viewer.index === viewer.docs.length - 1}
                  onClick={() => setViewer((v) => v && { ...v, index: v.index + 1 })}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function PlatformDriver({
  driver: d,
  index,
  busy,
  onApprove,
  onReject,
  onOpenDoc,
}: {
  driver: DriverProfile;
  index: number;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
  onOpenDoc: (doc: KycDocument) => void;
}) {
  const verified = d.kycDocuments.filter((k) => k.status === "verified").length;
  const total = d.kycDocuments.length;
  const approved = approvedOf(d);
  const rejected = d.approval === "rejected";
  const missing = d.kycDocuments.some((k) => k.status === "missing");
  // An approved driver who uploads a new or replaced document still needs it checked.
  const toVerify = approved && d.kycDocuments.some((k) => k.status === "pending");
  const [open, setOpen] = useState(!approved && !rejected);
  const pct = (verified / Math.max(total, 1)) * 100;
  const expired = d.kycDocuments.filter((k) => k.expiryState === "expired").length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "rounded-3xl border bg-surface p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[0_20px_50px_-24px_rgb(0_0_0/0.3)]",
        !approved && !rejected ? "border-warning/30" : toVerify ? "border-info/30" : "border-line"
      )}
    >
      <div className="flex items-start gap-3.5">
        <Avatar name={d.name} tone={approved ? "success" : rejected ? "brand" : "warning"} online={d.isOnline} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-ink">{d.name}</p>
          <p className="truncate text-[13px] text-ink-3">
            {VEHICLE_SHORT[d.vehicle]} · {d.plateNumber || "No plate"}
          </p>
        </div>
        <Badge tone={approved ? (toVerify ? "info" : "success") : rejected ? "brand" : "warning"} dot>
          {approved ? (toVerify ? "Check docs" : "Active") : rejected ? "Rejected" : "Pending"}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-2">
        <span className="flex items-center gap-1">
          <Star className="size-3.5 fill-road text-road" /> {d.rating ? d.rating.toFixed(1) : "–"}
        </span>
        <span>{d.completedDeliveries} deliveries</span>
        {d.activeOrders ? <span className="font-semibold text-info">{d.activeOrders} active</span> : null}
      </div>
      <div className="mt-2 space-y-1 text-[12px] text-ink-3">
        <p className="flex items-center gap-1.5 truncate">
          <Mail className="size-3.5 shrink-0" /> {d.email}
        </p>
        {d.phone && (
          <p className="flex items-center gap-1.5">
            <Phone className="size-3.5 shrink-0" /> {d.phone}
          </p>
        )}
      </div>

      <button onClick={() => setOpen((o) => !o)} className="mt-4 flex w-full items-center gap-3 text-left" aria-expanded={open}>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-ink-2">
            {verified} of {total} documents verified
            {expired > 0 && (
              <span className="ml-2 font-bold text-brand">· {expired} expired</span>
            )}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-alt">
            <motion.div
              className={cn("h-full rounded-full", verified === total && total > 0 ? "bg-success" : "bg-warning")}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
        <ChevronDown className={cn("size-4 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-1">
              {d.kycDocuments.map((k) => (
                <li key={k.id} className="rounded-xl transition hover:bg-surface-alt/60">
                  <button
                    disabled={!k.hasFile}
                    onClick={() => onOpenDoc(k)}
                    className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px]"
                  >
                    <DocIcon status={k.status} />
                    <span className="flex-1 truncate text-ink">{cleanTitle(k.title)}</span>
                    {k.hasFile ? (
                      <span className="flex items-center gap-1 font-semibold text-brand opacity-80 group-hover:opacity-100">
                        <Eye className="size-3.5" /> View
                      </span>
                    ) : (
                      <span className="text-ink-3">Not uploaded</span>
                    )}
                  </button>
                  {k.canExpire && k.hasFile && <DocExpiry doc={k} />}
                </li>
              ))}
            </div>
          </motion.ul>
        )}
      </AnimatePresence>

      {(!approved || toVerify) && (
        <div className="mt-4 flex gap-2.5">
          {!approved && !rejected && (
            <Button variant="secondary" className="flex-1" icon={<X className="size-4" />} disabled={!!busy} loading={busy === `reject-${d.id}`} onClick={onReject}>
              Reject
            </Button>
          )}
          <Button
            variant="success"
            className="flex-[2]"
            icon={<Check className="size-4" />}
            loading={busy === `approve-${d.id}`}
            disabled={!!busy || (!approved && missing) || d.kycDocuments.length === 0}
            onClick={onApprove}
            title={!approved && missing ? "Every document must be uploaded first" : undefined}
          >
            {approved ? "Verify documents" : "Approve driver"}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

function InHouseDriver({ driver: d, index }: { driver: DriverProfile; index: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.04 }}
      className="flex items-center gap-3.5 rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]"
    >
      <Avatar name={d.name} tone="info" online={d.isOnline} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-ink">{d.name}</p>
        <p className="truncate text-[13px] text-ink-3">
          {shortName(d.employerRestaurantName ?? "")} · {VEHICLE_SHORT[d.vehicle]}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">{d.completedDeliveries} deliveries</p>
      </div>
      <Badge tone="info">No docs</Badge>
    </motion.div>
  );
}

const expiryDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const daysUntil = (iso: string) => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((new Date(`${iso}T12:00:00`).getTime() - today.getTime()) / 86_400_000);
};

/** The date a document runs out: the admin types it in while checking the document. */
function DocExpiry({ doc }: { doc: KycDocument }) {
  const { setDocumentExpiry } = useAdmin();
  const [value, setValue] = useState(doc.expiresOn ?? "");
  const [saving, setSaving] = useState(false);
  // Follow the server when it changes (another admin, or a new upload clearing it).
  const [seen, setSeen] = useState(doc.expiresOn ?? "");
  if ((doc.expiresOn ?? "") !== seen) {
    setSeen(doc.expiresOn ?? "");
    setValue(doc.expiresOn ?? "");
  }

  const save = async (next: string) => {
    if ((next || null) === (doc.expiresOn ?? null) || saving) return;
    setSaving(true);
    const ok = await setDocumentExpiry(doc.id, next || null);
    setSaving(false);
    if (!ok) setValue(doc.expiresOn ?? "");
  };

  const days = doc.expiresOn ? daysUntil(doc.expiresOn) : null;
  const state = doc.expiryState;
  return (
    <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2 pl-9 text-[12px]">
      <label className="flex items-center gap-1.5 text-ink-3">
        <CalendarClock className="size-3.5 shrink-0" />
        <span className="font-semibold">Expires</span>
        <input
          type="date"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label={`Expiry date for ${cleanTitle(doc.title)}`}
          className={cn(
            "h-8 rounded-lg border bg-surface px-2 text-[12px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15",
            state === "expired" ? "border-brand/50" : state === "expiring" ? "border-warning/50" : "border-line"
          )}
        />
      </label>
      {doc.expiresOn && state === "expired" && <Badge tone="brand">Expired {expiryDate(doc.expiresOn)}</Badge>}
      {doc.expiresOn && state === "expiring" && (
        <Badge tone="warning">{days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`}</Badge>
      )}
      {!doc.expiresOn && <span className="text-ink-3">Not set</span>}
      {doc.expiresOn && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            save("");
          }}
          className="font-semibold text-ink-3 underline-offset-2 hover:text-ink hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function DocIcon({ status }: { status: KycDocument["status"] }) {
  if (status === "verified") return <CheckCircle2 className="size-4 shrink-0 text-success" />;
  if (status === "missing") return <XCircle className="size-4 shrink-0 text-brand" />;
  return <Clock3 className="size-4 shrink-0 text-warning" />;
}
