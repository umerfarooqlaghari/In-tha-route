"use client";

import { motion } from "motion/react";
import {
  Crosshair,
  GitMerge,
  Globe,
  Lock,
  Mail,
  MapPinned,
  Navigation,
  Phone,
  ShieldCheck,
  Store,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useState } from "react";

import { LiveMap, type MapPin } from "@/components/admin/LiveMap";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Modal, Skeleton } from "@/components/ui";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, errorMessage } from "@/lib/api";
import { cn, formatGbp, initials, VEHICLE_SHORT } from "@/lib/format";
import { milesBetween, pinFor } from "@/lib/geo";
import { useMerchant } from "@/lib/merchant-store";
import type { DriverPolicy, DriverProfile, Vehicle } from "@/lib/types";
import { StatTile } from "./common";

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m} min ago`;
};

/* ========================================================================== */
/* Live riders                                                                 */
/* ========================================================================== */

/** Your own riders: who is online, where they are and how far from the shop, live. */
export function LiveRidersScreen() {
  const { data, drivers, restaurant, syncedAt } = useMerchant();
  const [focus, setFocus] = useState<{ key: string; lat: number; lng: number } | null>(null);
  const shop = restaurant ? pinFor(restaurant.postcode, restaurant.coords) : null;
  // Re-rendered on every refresh; the "x ago" labels follow the last sync.
  const now = syncedAt || 0;

  // A handful of riders: cheap to recompute on every refresh.
  const riders = drivers
      .map((d) => ({
        d,
        miles: d.isOnline && d.location && shop ? milesBetween(shop, d.location) : null,
      }))
      .sort((a, b) => {
        const rank = (x: typeof a) => (x.d.isOnline ? (x.miles != null ? 0 : 1) : 2);
        return rank(a) - rank(b) || (a.miles ?? 0) - (b.miles ?? 0) || a.d.name.localeCompare(b.d.name);
      });

  const online = riders.filter((r) => r.d.isOnline);
  const located = online.filter((r) => r.miles != null);

  const pins: MapPin[] = [];
  {
    const list = pins;
    if (shop && restaurant) list.push({ id: "shop", kind: "restaurant", lat: shop.latitude, lng: shop.longitude, popup: [restaurant.name, restaurant.postcode] });
    located.forEach(({ d, miles }) =>
      list.push({
        id: `rider-${d.id}`,
        kind: "driver",
        label: initials(d.name) || "?",
        color: (d.activeOrders ?? 0) > 0 ? "#E5484D" : "#14A35A",
        lat: d.location!.latitude,
        lng: d.location!.longitude,
        popup: [d.name, `${miles!.toFixed(1)} mi from you · ${d.activeOrders ?? 0} active order${d.activeOrders === 1 ? "" : "s"}`],
      })
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28" />
        <Skeleton className="h-[480px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="Online now" value={online.length} icon={<Wifi className="size-5" />} tone="success" />
        <StatTile label="On a delivery" value={online.filter((r) => (r.d.activeOrders ?? 0) > 0).length} icon={<Navigation className="size-5" />} tone="brand" />
        <StatTile
          label="Nearest"
          value={located.length ? `${located[0].miles!.toFixed(1)} mi` : "—"}
          icon={<Crosshair className="size-5" />}
          tone="info"
          hint={located[0]?.d.name}
        />
        <StatTile label="Team" value={drivers.length} icon={<Users className="size-5" />} hint={`${drivers.length - online.length} offline`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="overflow-hidden">
          <div className="relative">
            <LiveMap className="h-[420px] w-full xl:h-[600px]" pins={pins} focus={focus} />
            <div className="pointer-events-none absolute top-4 left-4 z-[500] flex flex-col gap-2">
              <span className="flex items-center gap-2 rounded-full bg-surface/95 px-3 py-1.5 text-xs font-bold text-ink shadow-[var(--shadow-card)] backdrop-blur">
                <span className="relative flex size-2.5">
                  <span className="absolute inset-0 animate-pulse-ring rounded-full bg-success" />
                  <span className="relative size-2.5 rounded-full bg-success" />
                </span>
                Live · {located.length} on the map
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3 text-xs text-ink-3">
            <span className="flex items-center gap-1.5"><Store className="size-3.5" /> Your shop</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success" /> Free</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-brand" /> On a delivery</span>
            <span className="ml-auto">Distances are in a straight line from your shop.</span>
          </div>
        </Card>

        <Card className="flex flex-col xl:max-h-[652px]">
          <CardHeader title="Your riders" subtitle="Positions update every few seconds" />
          <div className="scroll-thin mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {riders.length === 0 ? (
              <EmptyState icon={<Users className="size-6" />} title="No drivers yet" body="Add your in-house drivers under My drivers." />
            ) : (
              riders.map(({ d, miles }) => {
                const busy = (d.activeOrders ?? 0) > 0;
                const clickable = miles != null;
                return (
                  <motion.button
                    layout="position"
                    key={d.id}
                    disabled={!clickable}
                    onClick={() =>
                      clickable && setFocus({ key: `${d.id}-${Date.now()}`, lat: d.location!.latitude, lng: d.location!.longitude })
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                      clickable ? "border-line hover:border-ink-3 hover:bg-surface-alt/60" : "cursor-default border-line opacity-80"
                    )}
                  >
                    <Avatar name={d.name} tone={d.isOnline ? (busy ? "brand" : "success") : "neutral"} online={!!d.isOnline} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-ink">{d.name}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {!d.isOnline
                          ? "Offline"
                          : miles == null
                            ? "Online · waiting for GPS"
                            : `${busy ? `${d.activeOrders} active order${d.activeOrders === 1 ? "" : "s"}` : "Free"} · seen ${ago(d.location!.updatedAt, now)}`}
                      </span>
                    </span>
                    {miles != null ? (
                      <span className="text-right">
                        <span className="block text-lg font-extrabold text-ink tabular">{miles.toFixed(1)}</span>
                        <span className="block text-[10px] font-bold tracking-[0.12em] text-ink-3 uppercase">miles</span>
                      </span>
                    ) : d.isOnline ? (
                      <Badge tone="warning">No GPS</Badge>
                    ) : (
                      <WifiOff className="size-4 text-ink-3" />
                    )}
                  </motion.button>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* My drivers                                                                  */
/* ========================================================================== */

const VEHICLES: Vehicle[] = ["Motorcycle / Scooter", "Car", "E-Bike"];

export function MyDriversScreen() {
  const { data, drivers } = useMerchant();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <p className="flex items-center gap-3 text-sm text-ink-2">
          <span className="grid size-10 place-items-center rounded-xl bg-success-soft text-success">
            <ShieldCheck className="size-5" />
          </span>
          In-house drivers don’t need documents. They sign in to the app with the email and password you set.
        </p>
        <Button variant="dark" icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>
          Add driver
        </Button>
      </div>

      {!data ? (
        <Skeleton className="h-64" />
      ) : drivers.length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="size-6" />} title="No drivers yet" body="Add your first in-house driver to deliver orders yourself, with no platform fee." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {drivers.map((d, i) => (
            <DriverCard key={d.id} d={d} delay={i * 0.04} />
          ))}
        </div>
      )}

      <AddDriverModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function DriverCard({ d, delay }: { d: DriverProfile; delay: number }) {
  return (
    <Card delay={delay} className="p-5">
      <div className="flex items-center gap-3">
        <Avatar name={d.name} tone="info" online={!!d.isOnline} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-ink">{d.name}</p>
          <p className="truncate text-xs text-ink-3">
            {VEHICLE_SHORT[d.vehicle]}
            {d.plateNumber ? ` · ${d.plateNumber}` : ""}
          </p>
        </div>
        {d.isOnline ? <Badge tone="success" dot>Online</Badge> : <Badge>Offline</Badge>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-2xl bg-surface-alt/70 p-3">
          <p className="text-xl font-extrabold text-ink tabular">{d.completedDeliveries}</p>
          <p className="text-xs text-ink-3">Trips</p>
        </div>
        <div className="rounded-2xl bg-surface-alt/70 p-3">
          <p className="text-xl font-extrabold text-ink tabular">{d.activeOrders ?? 0}</p>
          <p className="text-xs text-ink-3">Active now</p>
        </div>
      </div>
      <div className="mt-4 space-y-1 text-sm text-ink-2">
        {d.email && (
          <p className="flex items-center gap-2">
            <Mail className="size-4 shrink-0 text-ink-3" /> <span className="min-w-0 truncate">{d.email}</span>
          </p>
        )}
        {d.phone && (
          <p className="flex items-center gap-2">
            <Phone className="size-4 shrink-0 text-ink-3" /> {d.phone}
          </p>
        )}
      </div>
    </Card>
  );
}

function AddDriverModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addDriver } = useMerchant();
  const toast = useToast();
  const empty = { fullName: "", email: "", password: "", confirm: "", phone: "", plateNumber: "" };
  const [f, setF] = useState(empty);
  const [vehicle, setVehicle] = useState<Vehicle>("Motorcycle / Scooter");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const canSave = !!f.fullName.trim() && !!f.email.trim() && f.password.length > 0 && f.confirm === f.password && !saving;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      await addDriver({ ...f, fullName: f.fullName.trim(), email: f.email.trim(), phone: f.phone.trim(), plateNumber: f.plateNumber.trim(), vehicle });
      toast({ tone: "success", title: "Driver added", body: `${f.fullName.trim()} can now sign in to the app.` });
      setF(empty);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add driver" subtitle="They sign in to the In Tha Route app with these details.">
      <form onSubmit={save} className="space-y-4" noValidate>
        <Field label="Full name" value={f.fullName} onChange={set("fullName")} placeholder="e.g. Sam Patel" error={errors.fullName} autoFocus />
        <Field label="Email (for login)" type="email" value={f.email} onChange={set("email")} placeholder="sam@example.com" icon={<Mail className="size-4" />} error={errors.email} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" type="password" value={f.password} onChange={set("password")} placeholder="At least 8 characters" icon={<Lock className="size-4" />} error={errors.password} autoComplete="new-password" />
          <Field
            label="Confirm password"
            type="password"
            value={f.confirm}
            onChange={set("confirm")}
            placeholder="Type it again"
            autoComplete="new-password"
            error={f.confirm && f.confirm !== f.password ? "Passwords do not match." : undefined}
            success={f.password && f.confirm === f.password ? "Passwords match" : undefined}
          />
        </div>
        <Field label="Phone" type="tel" value={f.phone} onChange={set("phone")} placeholder="07…" icon={<Phone className="size-4" />} error={errors.phone} />
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold text-ink-2">Vehicle</p>
          <div className="flex flex-wrap gap-2">
            {VEHICLES.map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => setVehicle(v)}
                className={cn("h-10 rounded-full px-4 text-sm font-semibold transition", v === vehicle ? "bg-ink text-white" : "bg-surface-alt text-ink-2 hover:bg-line")}
              >
                {VEHICLE_SHORT[v]}
              </button>
            ))}
          </div>
        </div>
        <Field label="Plate (optional)" value={f.plateNumber} onChange={(e) => setF((p) => ({ ...p, plateNumber: e.target.value.toUpperCase() }))} error={errors.plateNumber} />
        {formError && <p className="rounded-2xl bg-brand-soft p-3 text-sm font-medium text-brand">{formError}</p>}
        <Button type="submit" className="w-full" size="lg" loading={saving} disabled={!canSave}>
          Add driver
        </Button>
      </form>
    </Modal>
  );
}

/* ========================================================================== */
/* Delivery settings                                                           */
/* ========================================================================== */

const POLICIES: { value: DriverPolicy; title: string; subtitle: string; icon: React.ReactNode }[] = [
  { value: "open_platform", title: "Platform drivers", subtitle: "Any verified driver nearby", icon: <Globe className="size-6" /> },
  { value: "hybrid", title: "Hybrid", subtitle: "Your drivers and platform drivers, first to accept", icon: <GitMerge className="size-6" /> },
  { value: "own_drivers", title: "My drivers only", subtitle: "Only your in-house team", icon: <Users className="size-6" /> },
];

export function DeliverySettingsScreen() {
  const { restaurant, credits, updatePolicy } = useMerchant();
  if (!restaurant) return <Skeleton className="h-80" />;
  const fee = credits?.feePerDeliveryGbp ?? 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="p-6">
        <p className="text-[12px] font-bold tracking-[0.14em] text-ink-3 uppercase">Who delivers your orders</p>
        <div className="mt-4 space-y-3">
          {POLICIES.map((p) => {
            const selected = restaurant.driverPolicy === p.value;
            return (
              <button
                key={p.value}
                onClick={() => !selected && updatePolicy(p.value)}
                className={cn(
                  "flex w-full items-center gap-4 rounded-3xl border-2 p-5 text-left transition",
                  selected ? "border-brand bg-brand-soft" : "border-line hover:border-ink-3"
                )}
              >
                <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", selected ? "bg-brand text-white" : "bg-surface-alt text-ink-2")}>
                  {p.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-ink">{p.title}</span>
                  <span className="block text-sm text-ink-3">{p.subtitle}</span>
                </span>
                <span className={cn("size-6 shrink-0 rounded-full border-2", selected ? "border-brand bg-brand shadow-[inset_0_0_0_4px_white]" : "border-line-strong")} />
              </button>
            );
          })}
        </div>
      </Card>

      <div className="space-y-6">
        <Card className="p-6">
          <p className="text-[12px] font-bold tracking-[0.14em] text-ink-3 uppercase">Billing</p>
          <div className="mt-4 divide-y divide-line">
            <div className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="block font-semibold text-ink">Platform delivery</span>
                <span className="block text-sm text-ink-3">Per order, paid with credits</span>
              </span>
              <span className="text-lg font-extrabold text-ink tabular">{formatGbp(fee)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="block font-semibold text-ink">Your own drivers</span>
                <span className="block text-sm text-ink-3">No platform fee</span>
              </span>
              <span className="text-lg font-extrabold text-ink tabular">{formatGbp(0)}</span>
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <p className="flex items-center gap-2 font-bold text-ink">
            <MapPinned className="size-4 text-brand" /> Pickup
          </p>
          <p className="mt-2 text-sm text-ink-2">{restaurant.name}</p>
          <p className="text-sm text-ink-3">
            {restaurant.address}, {restaurant.postcode}
          </p>
          {restaurant.pickupSafetyNote && <p className="mt-3 rounded-2xl bg-surface-alt/70 p-3 text-sm text-ink-2">“{restaurant.pickupSafetyNote}”</p>}
        </Card>
      </div>
    </div>
  );
}
