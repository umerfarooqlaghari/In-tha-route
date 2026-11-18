"use client";

import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { ArrowRight, Clock3, Layers, MapPinned, ScanLine, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";

import { LogoMark, Wordmark } from "./Logo";
import { RouteBackdrop } from "./RouteBackdrop";

const ease = [0.22, 1, 0.36, 1] as const;

const FEATURES = [
  { icon: ScanLine, label: "Scan a receipt, order goes live" },
  { icon: Layers, label: "Up to 5 orders in one run" },
  { icon: Clock3, label: "Prep timers synced to couriers" },
  { icon: MapPinned, label: "Live fleet on the map" },
];

export function Welcome() {
  return (
    <main className="brand-gradient grain relative isolate flex min-h-dvh flex-col overflow-hidden text-white">
      <RouteBackdrop />
      <div className="pointer-events-none absolute -top-40 -right-40 size-[38rem] rounded-full bg-crimson-700/40 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 -left-40 size-[34rem] rounded-full bg-crimson-800/50 blur-[120px]" />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 pt-6 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
          className="flex items-center gap-3"
        >
          <LogoMark className="size-10 drop-shadow-[0_6px_20px_rgb(0_0_0/0.5)]" />
          <Wordmark light className="text-lg" />
        </motion.div>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80 backdrop-blur sm:flex"
        >
          <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400" />
          South-West London · live
        </motion.span>
      </header>

      <section className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          <motion.div
            initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.9, ease, delay: 0.1 }}
            className="mb-8 inline-block animate-float"
          >
            <LogoMark className="size-24 drop-shadow-[0_20px_40px_rgb(0_0_0/0.55)] sm:size-28" />
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.25 }}
            className="mb-4 text-xs font-bold tracking-[0.28em] text-road uppercase"
          >
            In tha Kitchen · Delivery platform
          </motion.p>

          <h1 className="text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.035em] sm:text-6xl lg:text-7xl">
            {["Every order,", "on the right"].map((line, i) => (
              <span key={line} className="block overflow-hidden pb-1">
                <motion.span
                  className="block"
                  initial={{ y: "110%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, ease, delay: 0.35 + i * 0.12 }}
                >
                  {line}
                </motion.span>
              </span>
            ))}
            <span className="block overflow-hidden pb-2">
              <motion.span
                className="block bg-gradient-to-r from-road via-amber-200 to-white bg-clip-text text-transparent"
                initial={{ y: "110%" }}
                animate={{ y: 0 }}
                transition={{ duration: 0.9, ease, delay: 0.59 }}
              >
                route.
              </motion.span>
            </span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.8 }}
            className="mt-6 max-w-lg text-base leading-relaxed text-white/70 sm:text-lg"
          >
            Dispatch, batch and track every delivery from kitchen to doorstep. Live prep timers, smart multi-drop runs and
            clear pricing, synced with the In Tha Route app.
          </motion.p>

          <motion.ul
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 1 } } }}
            className="mt-8 grid max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-2"
          >
            {FEATURES.map(({ icon: Icon, label }) => (
              <motion.li
                key={label}
                variants={{ hidden: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0 } }}
                className="flex items-center gap-2.5 text-sm text-white/80"
              >
                <span className="grid size-7 place-items-center rounded-lg bg-white/10 ring-1 ring-white/10">
                  <Icon className="size-3.5 text-road" />
                </span>
                {label}
              </motion.li>
            ))}
          </motion.ul>
        </div>

        <div className="relative">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="mb-4 text-sm font-semibold text-white/60"
          >
            How would you like to sign in?
          </motion.p>
          <div className="grid gap-5">
            <RoleCard
              href="/admin/login"
              index={0}
              icon={<ShieldCheck className="size-7" />}
              eyebrow="Platform team"
              title="Administrator"
              body="Live map & revenue, pricing and batch payouts, driver approvals and merchant policies."
              accent="from-white to-white/80"
              dark
            />
            <RoleCard
              href="/merchant/login"
              index={1}
              icon={<Store className="size-7" />}
              eyebrow="Restaurants & shops"
              title="Merchant"
              body="Sign in to your merchant account, or create one in a minute to start sending orders."
              accent="from-brand to-crimson-600"
            />
          </div>
        </div>
      </section>

      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        className="relative z-10 mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-5 pb-6 text-xs text-white/45 sm:px-8"
      >
        <span>© In tha Kitchen Ltd</span>
        <span>Richmond · Twickenham · Isleworth · Teddington · Hounslow</span>
      </motion.footer>
    </main>
  );
}

function RoleCard({
  href,
  index,
  icon,
  eyebrow,
  title,
  body,
  accent,
  dark,
}: {
  href: string;
  index: number;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
  dark?: boolean;
}) {
  // A gentle 3D tilt that follows the pointer.
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [7, -7]), { stiffness: 200, damping: 20 });
  const ry = useSpring(useTransform(mx, [0, 1], [-9, 9]), { stiffness: 200, damping: 20 });
  const glowX = useTransform(mx, (v) => `${v * 100}%`);
  const glowY = useTransform(my, (v) => `${v * 100}%`);
  const glow = useTransform(
    [glowX, glowY] as never,
    ([x, y]: string[]) => `radial-gradient(360px circle at ${x} ${y}, rgb(255 255 255 / 0.14), transparent 60%)`
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotateX: 12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.9, ease, delay: 0.7 + index * 0.15 }}
      style={{ perspective: 1000 }}
    >
      <Link href={href} className="group block focus-visible:outline-none">
        <motion.div
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            mx.set((e.clientX - r.left) / r.width);
            my.set((e.clientY - r.top) / r.height);
          }}
          onPointerLeave={() => {
            mx.set(0.5);
            my.set(0.5);
          }}
          whileTap={{ scale: 0.98 }}
          style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
          className={
            "relative overflow-hidden rounded-[28px] border p-6 backdrop-blur-xl transition-shadow duration-300 group-focus-visible:ring-2 group-focus-visible:ring-road sm:p-7 " +
            (dark
              ? "border-white/15 bg-white/[0.07] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] hover:shadow-[0_40px_90px_-30px_rgb(0_0_0/0.95)]"
              : "border-white/10 bg-black/35 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] hover:shadow-[0_40px_90px_-24px_rgb(229_72_77/0.6)]")
          }
        >
          <motion.div
            className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{ background: glow }}
          />
          <div className="relative flex items-start gap-5" style={{ transform: "translateZ(30px)" }}>
            <div
              className={`grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${accent} ${
                dark ? "text-crimson-800" : "text-white"
              } shadow-lg transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110`}
            >
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold tracking-[0.2em] text-white/50 uppercase">{eyebrow}</p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{body}</p>
            </div>
            <div className="mt-1 grid size-10 shrink-0 place-items-center rounded-full bg-white/10 ring-1 ring-white/15 transition-all duration-300 group-hover:bg-white group-hover:text-crimson-800">
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </div>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}
