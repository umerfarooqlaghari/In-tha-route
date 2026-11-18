"use client";

import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { LogoMark, Wordmark } from "./Logo";
import { RouteBackdrop } from "./RouteBackdrop";

const ease = [0.22, 1, 0.36, 1] as const;

/**
 * Split sign-in layout: the brand panel (animated route map) on the left,
 * the form on the right. On phones the brand panel becomes a short header.
 */
export function AuthShell({
  eyebrow,
  headline,
  blurb,
  points,
  children,
}: {
  eyebrow: string;
  headline: React.ReactNode;
  blurb: string;
  points: { icon: React.ReactNode; title: string; body: string }[];
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh bg-surface lg:grid-cols-[1.05fr_1fr]">
      <aside className="brand-gradient grain relative isolate overflow-hidden px-5 py-6 text-white sm:px-10 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:py-10">
        <RouteBackdrop />
        <div className="pointer-events-none absolute -top-40 -right-32 size-[30rem] rounded-full bg-crimson-700/40 blur-[110px]" />

        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark className="size-9" />
            <Wordmark light />
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 backdrop-blur transition hover:bg-white/15 lg:hidden"
          >
            <ArrowLeft className="size-3.5" /> Back
          </Link>
        </div>

        <div className="relative z-10 mt-8 hidden flex-1 flex-col justify-center lg:flex">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease, delay: 0.2 }}
            className="text-xs font-bold tracking-[0.28em] text-road uppercase"
          >
            {eyebrow}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease, delay: 0.3 }}
            className="mt-4 max-w-md text-5xl leading-[1.05] font-extrabold tracking-[-0.03em]"
          >
            {headline}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="mt-5 max-w-md text-base leading-relaxed text-white/65"
          >
            {blurb}
          </motion.p>

          <div className="mt-10 grid max-w-md gap-3">
            {points.map((p, i) => (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, ease, delay: 0.7 + i * 0.12 }}
                className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-md"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 text-road">{p.icon}</span>
                <div>
                  <p className="text-sm font-bold">{p.title}</p>
                  <p className="mt-0.5 text-[13px] text-white/60">{p.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <p className="relative z-10 mt-6 hidden text-xs text-white/40 lg:block">© In tha Kitchen Ltd</p>
      </aside>

      <section className="relative flex flex-col px-5 py-8 sm:px-10 lg:py-10">
        <Link
          href="/"
          className="group hidden w-fit items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-ink-2 transition hover:bg-surface-alt hover:text-ink lg:flex"
        >
          <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" /> Back to start
        </Link>
        <div className="flex flex-1 items-center justify-center py-6">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.15 }}
            className="w-full max-w-[440px]"
          >
            {children}
          </motion.div>
        </div>
      </section>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="rounded-2xl border border-brand-line bg-brand-soft px-4 py-3 text-sm font-medium text-brand"
      role="alert"
    >
      {message}
    </motion.div>
  );
}
