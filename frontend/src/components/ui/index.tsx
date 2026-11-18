"use client";

import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { Loader2, Minus, Plus, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn, initials } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "dark" | "secondary" | "ghost" | "success" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand text-white shadow-[0_10px_30px_-12px_rgb(229_72_77/0.8)] hover:bg-brand-pressed hover:shadow-[var(--shadow-glow)]",
  dark: "bg-ink text-white hover:bg-black shadow-[0_10px_30px_-14px_rgb(0_0_0/0.7)]",
  secondary: "bg-surface text-ink ring-1 ring-line-strong hover:ring-ink-3 hover:bg-surface-alt",
  ghost: "text-ink-2 hover:bg-surface-alt hover:text-ink",
  success: "bg-success text-white hover:brightness-110 shadow-[0_10px_30px_-14px_rgb(20_163_90/0.8)]",
  danger: "bg-brand-soft text-brand ring-1 ring-brand-line hover:bg-brand hover:text-white",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  const sizes = {
    sm: "h-9 px-3.5 text-[13px] gap-1.5 rounded-xl",
    md: "h-11 px-5 text-sm gap-2 rounded-xl",
    lg: "h-13 px-7 text-[15px] gap-2.5 rounded-2xl",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden font-semibold whitespace-nowrap transition-all duration-200 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        sizes[size],
        VARIANTS[variant],
        className
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  delay = 0,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn("rounded-3xl border border-line bg-surface shadow-[var(--shadow-card)]", className)}
      {...(rest as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-6 pt-5", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-bold tracking-tight text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                       */
/* -------------------------------------------------------------------------- */

type Tone = "neutral" | "success" | "warning" | "info" | "brand";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-alt text-ink-2",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
};

export function Badge({
  tone = "neutral",
  dot,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide whitespace-nowrap uppercase",
        TONES[tone],
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                      */
/* -------------------------------------------------------------------------- */

const AVATAR_TONES: Record<Tone, string> = {
  neutral: "from-ink-3 to-ink-2",
  success: "from-emerald-400 to-emerald-600",
  warning: "from-amber-400 to-orange-500",
  info: "from-sky-400 to-blue-600",
  brand: "from-rose-400 to-red-600",
};

export function Avatar({ name, tone = "neutral", online }: { name: string; tone?: Tone; online?: boolean }) {
  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          "grid size-11 place-items-center rounded-2xl bg-gradient-to-br text-sm font-bold text-white shadow-sm",
          AVATAR_TONES[tone]
        )}
      >
        {initials(name) || "?"}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-surface",
            online ? "bg-success" : "bg-line-strong"
          )}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                           */
/* -------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div className={cn("flex rounded-2xl bg-surface-alt p-1", className)} role="radiogroup">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(o.value)}
            className={cn(
              "relative flex-1 rounded-xl font-semibold transition-colors",
              size === "sm" ? "h-8 px-3 text-[12px]" : "h-10 px-4 text-[13px]",
              active ? "text-ink" : "text-ink-3 hover:text-ink-2"
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-xl bg-surface shadow-[0_2px_10px_-2px_rgb(0_0_0/0.12)]"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stepper                                                                     */
/* -------------------------------------------------------------------------- */

export function Stepper({
  name,
  value,
  onDecrement,
  onIncrement,
}: {
  name: string;
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  const btn =
    "grid size-9 place-items-center rounded-xl bg-surface text-ink ring-1 ring-line-strong transition hover:bg-ink hover:text-white hover:ring-ink active:scale-90";
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-surface-alt p-1">
      <button className={btn} onClick={onDecrement} aria-label={`Decrease ${name}`}>
        <Minus className="size-4" />
      </button>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="tabular min-w-16 text-center text-sm font-bold text-ink"
        >
          {value}
        </motion.span>
      </AnimatePresence>
      <button className={btn} onClick={onIncrement} aria-label={`Increase ${name}`}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Animated number                                                             */
/* -------------------------------------------------------------------------- */

export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toString(),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value]);
  return <motion.span className={cn("tabular", className)}>{text}</motion.span>;
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Pages are kept alive (hidden) after navigating away; close the dialog when that happens.
  useLayoutEffect(() => () => closeRef.current(), []);

  // Rendered at the end of <body> so animated (transformed) parents can't clip it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-crimson-950/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn(
              "relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-[var(--shadow-float)] sm:rounded-3xl",
              width
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
                {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                className="rounded-xl p-2 text-ink-3 transition hover:rotate-90 hover:bg-surface-alt hover:text-ink"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="scroll-thin overflow-y-auto p-6">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** A yes/no question before an action that can't be undone. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep",
  tone = "danger",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "dark";
  onConfirm: () => Promise<unknown> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} width="max-w-md">
      <p className="text-[15px] leading-relaxed text-ink-2">{body}</p>
      <div className="mt-6 flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === "danger" ? "primary" : "dark"}
          className="flex-1"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
              onClose();
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-surface-alt", className)}>
      <div className="absolute inset-y-0 w-1/2 animate-shine bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="grid size-14 place-items-center rounded-2xl bg-surface-alt text-ink-3"
      >
        {icon}
      </motion.div>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="max-w-xs text-sm text-ink-3">{body}</p>}
    </div>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2.5", className)}>
      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-current" />
      <span className="relative inline-flex size-2.5 rounded-full bg-current" />
    </span>
  );
}
