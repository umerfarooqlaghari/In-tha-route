"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/format";

/** Text input with a label, inline error / success line and an optional show-password toggle. */
export function Field({
  label,
  error,
  success,
  hint,
  icon,
  type = "text",
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  error?: string;
  success?: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <div
        className={cn(
          "group relative flex items-center rounded-2xl border bg-surface transition-all duration-200",
          "focus-within:border-ink focus-within:shadow-[0_0_0_4px_rgb(20_21_26/0.06)]",
          error ? "border-brand bg-brand-soft/40" : "border-line-strong hover:border-ink-3"
        )}
      >
        {icon && <span className="pl-4 text-ink-3 transition-colors group-focus-within:text-ink">{icon}</span>}
        <input
          id={id}
          type={isPassword && reveal ? "text" : type}
          aria-invalid={!!error}
          className="h-12 w-full min-w-0 bg-transparent px-4 text-[15px] text-ink outline-none placeholder:text-ink-3/70"
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="mr-2 rounded-xl p-2 text-ink-3 transition hover:bg-surface-alt hover:text-ink"
            aria-label={reveal ? "Hide password" : "Show password"}
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p
            key="e"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[13px] font-medium text-brand"
          >
            {error}
          </motion.p>
        ) : success ? (
          <motion.p
            key="s"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-1 text-[13px] font-medium text-success"
          >
            <Check className="size-3.5" /> {success}
          </motion.p>
        ) : hint ? (
          <motion.p key="h" className="text-[12px] text-ink-3">
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
