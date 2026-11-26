"use client";

import { motion } from "motion/react";
import { Bike, Layers, Route } from "lucide-react";
import { useState } from "react";

import { AnimatedNumber, Card, CardHeader, Segmented, Skeleton, Stepper } from "@/components/ui";
import { useAdmin } from "@/lib/admin-store";
import { formatGbp, formatPoolTime, ORDINALS } from "@/lib/format";
import type { AlgorithmConfig } from "@/lib/types";

type NudgeKey =
  | "baseDistanceMiles" | "extraMileRestaurantChargeGbp" | "extraMileDriverPayoutGbp" | "offerRadiusMiles"
  | "maxPrepTimeWindowMinutes" | "maxPickupRadiusMiles" | "maxDropoffRadiusMiles";

/** Same settings, steps and limits as the app's Pricing screen. */
export function PricingScreen() {
  const { data, updateAlgorithm, updateSteppedPayoutAt } = useAdmin();
  const [picked, setSize] = useState("2");
  const algorithm = data?.algorithm;
  // Never simulate more orders than a driver may hold.
  const n = Math.min(Number(picked), algorithm?.maxBatchSize ?? 5);
  const size = String(n);

  if (!data || !algorithm) {
    return (
      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Skeleton className="h-[520px] rounded-3xl" />
        <Skeleton className="h-[520px] rounded-3xl" />
      </div>
    );
  }

  const summary = data.pricingSummary;
  // Simulator and "you keep" figures are calculated on the server.
  const sim = summary?.simulations.find((s) => s.orders === n);
  const restaurantsPay = sim?.restaurantsPayGbp ?? 0;
  const driverEarns = sim?.driverEarnsGbp ?? 0;
  const profit = sim?.profitGbp ?? 0;
  const driverShare = sim?.driverShare ?? 0;

  const setFee = (delta: number) =>
    updateAlgorithm({
      baseRestaurantChargeGbp: Math.max(2.5, Math.min(12, +(algorithm.baseRestaurantChargeGbp + delta).toFixed(2))),
    });
  const nudge = (key: NudgeKey, delta: number, min: number, max: number) =>
    updateAlgorithm({ [key]: Math.max(min, Math.min(max, +(algorithm[key] + delta).toFixed(2))) } as Partial<AlgorithmConfig>);
  const setMax = (delta: number) => {
    const next = Math.max(1, Math.min(8, algorithm.maxBatchSize + delta));
    updateAlgorithm({ maxBatchSize: next });
    if (n > next) setSize(String(next));
  };
  const setTier = (i: number, delta: number) =>
    updateSteppedPayoutAt(i, Math.max(1, Math.min(8, +(algorithm.steppedDriverPayoutsGbp[i] + delta).toFixed(2))));

  const tiers = algorithm.steppedDriverPayoutsGbp.slice(0, algorithm.maxBatchSize);
  const tierMax = Math.max(algorithm.baseRestaurantChargeGbp, ...tiers);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1.1fr_1fr]">
      <div className="space-y-6 xl:sticky xl:top-6">
        {/* Simulator */}
        <Card className="overflow-hidden">
          <div className="brand-gradient grain relative isolate p-6 text-white sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.2em] text-road uppercase">Batch simulator</p>
                <h3 className="mt-1 text-xl font-extrabold tracking-tight">What one run earns</h3>
              </div>
              <span className="text-sm text-white/60">Orders per run</span>
            </div>
            <div className="mt-5 rounded-2xl bg-black/25 p-1 backdrop-blur">
              <Segmented
                value={size}
                onChange={setSize}
                options={Array.from({ length: algorithm.maxBatchSize }, (_, i) => ({ value: String(i + 1), label: `${i + 1}` }))}
                className="bg-transparent [&_button]:text-white/60 [&_button[aria-checked=true]]:text-ink"
              />
            </div>
            <div className="mt-7 grid grid-cols-3 gap-4">
              <SimFigure label="Merchants pay" value={restaurantsPay} />
              <SimFigure label="Driver earns" value={driverEarns} />
              <SimFigure label="Your profit" value={profit} highlight />
            </div>
          </div>
          <div className="p-6 sm:p-7">
            <div className="flex h-4 overflow-hidden rounded-full bg-surface-alt">
              <motion.div
                className="h-full bg-ink"
                animate={{ width: `${driverShare * 100}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
              <motion.div
                className="h-full bg-gradient-to-r from-success to-emerald-400"
                animate={{ width: `${(1 - driverShare) * 100}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>
            <div className="mt-3 flex justify-between text-[13px] font-semibold">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="size-2.5 rounded-full bg-ink" /> Driver {Math.round(driverShare * 100)}%
              </span>
              <span className="flex items-center gap-1.5 text-success">
                Platform {Math.round((1 - driverShare) * 100)}% <span className="size-2.5 rounded-full bg-success" />
              </span>
            </div>
          </div>
        </Card>

        {/* Tier chart */}
        <Card delay={0.08}>
          <CardHeader title="Pay per order in a run" subtitle="What the driver gets vs what you keep, per order position" />
          <div className="flex h-56 items-end gap-3 p-6">
            {tiers.map((pay, i) => {
              const keep = summary?.tiers[i]?.platformKeepsGbp ?? algorithm.baseRestaurantChargeGbp - pay;
              return (
                <div key={i} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[11px] font-bold text-success tabular opacity-0 transition group-hover:opacity-100">
                    +{formatGbp(keep)}
                  </span>
                  <div className="flex w-full flex-1 flex-col justify-end overflow-hidden rounded-xl bg-surface-alt">
                    <motion.div
                      className="w-full bg-gradient-to-b from-emerald-300 to-success"
                      animate={{ height: `${(Math.max(0, keep) / tierMax) * 100}%` }}
                      transition={{ type: "spring", stiffness: 140, damping: 20 }}
                    />
                    <motion.div
                      className="w-full bg-ink"
                      animate={{ height: `${(pay / tierMax) * 100}%` }}
                      transition={{ type: "spring", stiffness: 140, damping: 20 }}
                    />
                  </div>
                  <span className="text-xs font-bold text-ink tabular">{formatGbp(pay)}</span>
                  <span className="text-[11px] font-semibold text-ink-3">{ORDINALS[i]}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Section icon={<Route className="size-4" />} title="Rates" delay={0.05}>
          <SettingRow title="Merchant fee" sub="Per order">
            <Stepper name="Merchant fee" value={formatGbp(algorithm.baseRestaurantChargeGbp)} onDecrement={() => setFee(-0.25)} onIncrement={() => setFee(0.25)} />
          </SettingRow>
          <SettingRow title="Included distance" sub="Covered by the fee">
            <Stepper
              name="Included distance"
              value={`${algorithm.baseDistanceMiles} mi`}
              onDecrement={() => nudge("baseDistanceMiles", -0.5, 0.5, 20)}
              onIncrement={() => nudge("baseDistanceMiles", 0.5, 0.5, 20)}
            />
          </SettingRow>
          <SettingRow title="Extra mile · merchant" sub="Charged per mile beyond">
            <Stepper
              name="Extra mile merchant"
              value={formatGbp(algorithm.extraMileRestaurantChargeGbp)}
              onDecrement={() => nudge("extraMileRestaurantChargeGbp", -0.05, 0, 10)}
              onIncrement={() => nudge("extraMileRestaurantChargeGbp", 0.05, 0, 10)}
            />
          </SettingRow>
          <SettingRow title="Extra mile · driver" sub="Paid per mile beyond">
            <Stepper
              name="Extra mile driver"
              value={formatGbp(algorithm.extraMileDriverPayoutGbp)}
              onDecrement={() => nudge("extraMileDriverPayoutGbp", -0.05, 0, 10)}
              onIncrement={() => nudge("extraMileDriverPayoutGbp", 0.05, 0, 10)}
            />
          </SettingRow>
        </Section>

        <Section icon={<Bike className="size-4" />} title="Drivers" delay={0.1}>
          <SettingRow title="Max batch" sub="Orders a driver holds at once">
            <Stepper name="Max batch" value={`${algorithm.maxBatchSize}`} onDecrement={() => setMax(-1)} onIncrement={() => setMax(1)} />
          </SettingRow>
          <SettingRow
            title="Distance limit"
            sub={algorithm.noDistanceLimit ? "Every driver sees every order" : "Drivers see orders within the radius"}
          >
            <Segmented
              size="sm"
              value={algorithm.noDistanceLimit ? "none" : "miles"}
              onChange={(v) => updateAlgorithm({ noDistanceLimit: v === "none" })}
              options={[
                { value: "miles", label: "Miles" },
                { value: "none", label: "No limit" },
              ]}
            />
          </SettingRow>
          <SettingRow title="Time in pool" sub="Then the order leaves the pool · merchants can set their own">
            <Stepper
              name="Time in pool"
              value={formatPoolTime(algorithm.poolWindowSeconds)}
              onDecrement={() => updateAlgorithm({ poolWindowSeconds: Math.max(30, algorithm.poolWindowSeconds - 30) })}
              onIncrement={() => updateAlgorithm({ poolWindowSeconds: Math.min(1800, algorithm.poolWindowSeconds + 30) })}
            />
          </SettingRow>
          {!algorithm.noDistanceLimit && (
            <SettingRow title="Driver radius" sub="Who sees a new order">
              <Stepper
                name="Driver radius"
                value={`${algorithm.offerRadiusMiles} mi`}
                onDecrement={() => nudge("offerRadiusMiles", -0.5, 0.5, 20)}
                onIncrement={() => nudge("offerRadiusMiles", 0.5, 0.5, 20)}
              />
            </SettingRow>
          )}
        </Section>

        <Section icon={<Layers className="size-4" />} title="Double & triple deliveries" delay={0.12}>
          <SettingRow title="Ready within" sub="Pool orders ready this close together can be grouped">
            <Stepper
              name="Ready within"
              value={`${algorithm.maxPrepTimeWindowMinutes} min`}
              onDecrement={() => nudge("maxPrepTimeWindowMinutes", -1, 1, 120)}
              onIncrement={() => nudge("maxPrepTimeWindowMinutes", 1, 1, 120)}
            />
          </SettingRow>
          <SettingRow title="Pickups within" sub="Same or nearby merchants">
            <Stepper
              name="Pickups within"
              value={`${algorithm.maxPickupRadiusMiles} mi`}
              onDecrement={() => nudge("maxPickupRadiusMiles", -0.1, 0, 20)}
              onIncrement={() => nudge("maxPickupRadiusMiles", 0.1, 0, 20)}
            />
          </SettingRow>
          <SettingRow title="Drop-offs within" sub="Customers near each other">
            <Stepper
              name="Drop-offs within"
              value={`${algorithm.maxDropoffRadiusMiles} mi`}
              onDecrement={() => nudge("maxDropoffRadiusMiles", -0.5, 0, 20)}
              onIncrement={() => nudge("maxDropoffRadiusMiles", 0.5, 0, 20)}
            />
          </SettingRow>
        </Section>

        <Section icon={<Layers className="size-4" />} title="Driver pay per order" delay={0.15}>
          {tiers.map((pay, i) => (
            <SettingRow
              key={i}
              title={`${ORDINALS[i]} order`}
              sub={
                <>
                  You keep{" "}
                  <span className="font-semibold text-success">
                    {formatGbp(summary?.tiers[i]?.platformKeepsGbp ?? algorithm.baseRestaurantChargeGbp - pay)}
                  </span>
                </>
              }
            >
              <Stepper name={`${ORDINALS[i]} order pay`} value={formatGbp(pay)} onDecrement={() => setTier(i, -0.1)} onIncrement={() => setTier(i, 0.1)} />
            </SettingRow>
          ))}
        </Section>
      </div>
    </div>
  );
}

function SimFigure({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-white/55">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tracking-tight sm:text-3xl ${highlight ? "text-emerald-300" : "text-white"}`}>
        <AnimatedNumber value={value} format={formatGbp} />
      </p>
    </div>
  );
}

function Section({
  icon,
  title,
  delay,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <Card delay={delay}>
      <div className="flex items-center gap-2.5 px-6 pt-5 pb-2">
        <span className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</span>
        <h3 className="text-[15px] font-bold text-ink">{title}</h3>
      </div>
      <div className="divide-y divide-line px-6 pb-2">{children}</div>
    </Card>
  );
}

function SettingRow({ title, sub, children }: { title: string; sub: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        <p className="text-[13px] text-ink-3">{sub}</p>
      </div>
      {children}
    </div>
  );
}
