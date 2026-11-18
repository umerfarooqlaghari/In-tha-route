"use client";

import { motion } from "motion/react";
import { useState } from "react";

import { cn } from "@/lib/format";

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Animated donut with a hoverable legend; the centre shows the total or the hovered slice. */
export function Donut({ slices, centerLabel }: { slices: Slice[]; centerLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const active = slices.find((s) => s.key === hover);

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative size-44 shrink-0">
        <svg viewBox="0 0 180 180" className="size-full -rotate-90">
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--color-surface-alt)" strokeWidth="22" />
          {total > 0 &&
            slices.map((s, i) => {
              const len = (s.value / total) * C;
              const gap = slices.filter((x) => x.value > 0).length > 1 ? 3 : 0;
              const el = (
                <motion.circle
                  key={s.key}
                  cx="90"
                  cy="90"
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={hover === s.key ? 28 : 22}
                  strokeLinecap="butt"
                  initial={{ strokeDasharray: `0 ${C}` }}
                  animate={{ strokeDasharray: `${Math.max(0, len - gap)} ${C}`, strokeDashoffset: -offset }}
                  transition={{ duration: 1, delay: 0.15 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  onMouseEnter={() => setHover(s.key)}
                  onMouseLeave={() => setHover(null)}
                  className="cursor-pointer transition-[stroke-width] duration-200"
                  opacity={hover && hover !== s.key ? 0.35 : 1}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-3xl font-extrabold tracking-tight text-ink tabular">{active ? active.value : total}</p>
            <p className="text-[11px] font-bold tracking-[0.14em] text-ink-3 uppercase">{active ? active.label : centerLabel}</p>
          </div>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {slices.map((s) => (
          <li
            key={s.key}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
              hover === s.key ? "bg-surface-alt" : ""
            )}
          >
            <span className="size-2.5 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 font-medium text-ink-2">{s.label}</span>
            <span className="font-bold text-ink tabular">{s.value}</span>
            <span className="w-10 text-right text-xs text-ink-3 tabular">
              {total ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, each growing in after the previous one. */
export function BarList({
  rows,
  format = (n) => String(n),
}: {
  rows: { key: string; label: React.ReactNode; value: number; color?: string; sub?: React.ReactNode }[];
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3.5">
      {rows.map((r, i) => (
        <li key={r.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold text-ink">{r.label}</span>
            <span className="shrink-0 font-bold text-ink tabular">
              {format(r.value)}
              {r.sub && <span className="ml-1.5 text-xs font-medium text-ink-3">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-alt">
            <motion.div
              className="h-full rounded-full"
              style={{ background: r.color ?? "var(--color-brand)" }}
              initial={{ width: 0 }}
              animate={{ width: `${(r.value / max) * 100}%` }}
              transition={{ duration: 0.9, delay: 0.1 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns for the delivery pipeline. */
export function Columns({ cols }: { cols: { key: string; label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...cols.map((c) => c.value));
  return (
    <div className="flex h-48 items-end gap-3">
      {cols.map((c, i) => (
        <div key={c.key} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
          <span className="text-sm font-extrabold text-ink tabular">{c.value}</span>
          <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-xl bg-surface-alt">
            <motion.div
              className="w-full rounded-xl transition-[filter] group-hover:brightness-110"
              style={{ background: `linear-gradient(180deg, ${c.color}, ${c.color}cc)` }}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(c.value ? 8 : 0, (c.value / max) * 100)}%` }}
              transition={{ duration: 0.9, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <span className="text-center text-[11px] leading-tight font-semibold text-ink-3">{c.label}</span>
        </div>
      ))}
    </div>
  );
}
