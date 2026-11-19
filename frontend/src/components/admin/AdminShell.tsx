"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  BadgePoundSterling,
  ChevronDown,
  Coins,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Store,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { LogoMark, Wordmark } from "@/components/brand/Logo";
import { LiveDot } from "@/components/ui";
import { ToastProvider } from "@/components/ui/toast";
import { AdminProvider, useAdmin, useAdminSession } from "@/lib/admin-store";
import { cn, initials, isLive } from "@/lib/format";

export const NAV = [
  { href: "/admin", label: "Overview", sub: "Live map & revenue", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Live orders", sub: "Dispatch & controls", icon: ReceiptText },
  { href: "/admin/pricing", label: "Pricing", sub: "Fees & batch payouts", icon: BadgePoundSterling },
  { href: "/admin/drivers", label: "Drivers", sub: "Approve & contract", icon: ShieldCheck },
  { href: "/admin/merchants", label: "Merchants", sub: "Partners, fees & access", icon: Store },
  { href: "/admin/credits", label: "Credits", sub: "Payments & usage", icon: Coins },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const user = useAdminSession();
  const router = useRouter();

  useEffect(() => {
    if (user === null) router.replace("/admin/login");
  }, [user, router]);

  if (!user) return <BootScreen />;

  return (
    <ToastProvider>
      <AdminProvider user={user}>
        <Frame>{children}</Frame>
      </AdminProvider>
    </ToastProvider>
  );
}

function BootScreen() {
  return (
    <div className="brand-gradient grid min-h-dvh place-items-center">
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
        <LogoMark className="size-16 animate-float" />
      </motion.div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Only rendered in the browser (after the session is read), so storage is available here.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("itr.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  // Close the phone menu after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMobileOpen(false);
  }
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("itr.sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });

  const current = NAV.find((n) => (n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href))) ?? NAV[0];

  return (
    <div className="min-h-dvh bg-bg">
      {/* Desktop sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 88 : 272 }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="fixed inset-y-0 left-0 z-40 hidden border-r border-line bg-surface lg:block"
      >
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-crimson-950/50 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[280px] bg-surface shadow-[var(--shadow-float)] lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-5 right-4 rounded-xl p-2 text-ink-3 hover:bg-surface-alt"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
              <Sidebar collapsed={false} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <motion.div
        initial={false}
        animate={{ paddingLeft: collapsed ? 88 : 272 }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="max-lg:!pl-0"
      >
        <TopBar title={current.label} subtitle={current.sub} onMenu={() => setMobileOpen(true)} />
        <main className="relative z-10 mx-auto -mt-16 max-w-[1500px] px-4 pb-16 sm:px-6 lg:px-8">{children}</main>
      </motion.div>
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const pathname = usePathname();
  const { data, orders } = useAdmin();
  const live = orders.filter(isLive);
  const lowCredits =
    data?.restaurants.filter(
      (r) => r.isActive !== false && (r.credits?.available ?? 0) < (r.feePerDeliveryGbp ?? 0)
    ).length ?? 0;
  const counts: Record<string, { n: number; alert?: boolean } | undefined> = {
    "/admin/credits": { n: lowCredits, alert: true },
    "/admin/orders": { n: live.length, alert: live.some((o) => o.attention) },
    "/admin/drivers": {
      n:
        data?.drivers.filter(
          (d) =>
            d.driverType === "platform_contracted" &&
            (d.approval === "pending" ||
              (d.approval === "approved" && d.kycDocuments.some((k) => k.status === "pending")))
        ).length ?? 0,
      alert: true,
    },
  };

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-20 items-center gap-3 px-6", collapsed && "justify-center px-0")}>
        <Link href="/admin" className="flex items-center gap-3">
          <LogoMark className="size-10 shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
                <Wordmark className="block text-[17px] leading-tight" />
                <span className="text-[11px] font-semibold tracking-[0.16em] text-ink-3 uppercase">Admin panel</span>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>
      </div>

      <nav className="scroll-thin flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {!collapsed && (
          <p className="px-3 pb-2 text-[11px] font-bold tracking-[0.16em] text-ink-3 uppercase">Manage</p>
        )}
        {NAV.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          const Icon = item.icon;
          const c = counts[item.href];
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition-colors",
                collapsed && "justify-center",
                active ? "text-white" : "text-ink-2 hover:bg-surface-alt hover:text-ink"
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="brand-gradient absolute inset-0 rounded-2xl shadow-[0_12px_30px_-12px_rgb(207_60_66/0.6)]"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <Icon className="relative size-5 shrink-0 transition-transform duration-300 group-hover:scale-110" />
              {!collapsed && <span className="relative flex-1">{item.label}</span>}
              {c && c.n > 0 && (
                <span
                  className={cn(
                    "relative grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular",
                    collapsed ? "absolute top-1.5 right-1.5 h-4 min-w-4 text-[10px]" : "h-5",
                    active ? "bg-white text-crimson-700" : c.alert ? "bg-brand text-white" : "bg-surface-alt text-ink-2"
                  )}
                >
                  {c.n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {onToggle && (
        <div className="border-t border-line p-3">
          <button
            onClick={onToggle}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-ink-3 transition hover:bg-surface-alt hover:text-ink",
              collapsed && "justify-center"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar({ title, subtitle, onMenu }: { title: string; subtitle: string; onMenu: () => void }) {
  return (
    <header className="brand-gradient grain relative isolate overflow-hidden pb-24 text-white">
      <div className="pointer-events-none absolute -top-24 right-10 size-80 rounded-full bg-crimson-700/30 blur-[90px]" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-30" preserveAspectRatio="none" viewBox="0 0 1200 200" aria-hidden>
        <path d="M-20 160 C 200 120, 380 40, 620 90 S 980 170, 1220 60" fill="none" stroke="#F5B014" strokeWidth="1.5" strokeDasharray="8 12" className="animate-dash" />
      </svg>
      <div className="relative mx-auto flex max-w-[1500px] items-center gap-4 px-4 pt-6 sm:px-6 lg:px-8">
        <button
          onClick={onMenu}
          className="rounded-xl bg-white/10 p-2.5 ring-1 ring-white/15 transition hover:bg-white/20 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
              <p className="mt-0.5 truncate text-sm text-white/60">{subtitle}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <SyncIndicator />
        <ProfileMenu />
      </div>
    </header>
  );
}

function SyncIndicator() {
  const { syncedAt, syncing, error, refresh } = useAdmin();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/purity -- relative time label, re-rendered every second
  const ago = syncedAt ? Math.max(0, Math.round((Date.now() - syncedAt) / 1000)) : null;

  return (
    <button
      onClick={() => refresh()}
      title="Refresh now"
      className="group hidden items-center gap-2.5 rounded-full bg-black/20 py-2 pr-3 pl-3.5 text-xs font-semibold ring-1 ring-white/15 backdrop-blur transition hover:bg-black/30 sm:flex"
    >
      {error ? (
        <span className="size-2.5 rounded-full bg-amber-400" />
      ) : (
        <LiveDot className="text-emerald-400" />
      )}
      <span className="text-white/85 tabular">
        {error ? "Reconnecting…" : ago === null ? "Connecting…" : ago < 3 ? "Live · just now" : `Live · ${ago}s ago`}
      </span>
      <RefreshCw className={cn("size-3.5 text-white/60 transition group-hover:text-white", syncing && "animate-spin")} />
    </button>
  );
}

function ProfileMenu() {
  const { user, logout } = useAdmin();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Where the menu opens, under the button. The menu is drawn at the end of <body> so
  // the header (which clips its glow) and the page cards can't cover it.
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 12, right: Math.max(16, window.innerWidth - r.right) });
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useLayoutEffect(() => () => setOpen(false), []);

  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="flex items-center gap-2.5 rounded-full bg-white/10 p-1 pr-3 ring-1 ring-white/15 transition hover:bg-white/20"
        aria-expanded={open}
      >
        <span className="grid size-9 place-items-center rounded-full bg-white text-sm font-extrabold text-crimson-800">
          {initials(user.fullName) || "A"}
        </span>
        <span className="hidden text-sm font-semibold md:block">{user.fullName.split(" ")[0]}</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.16 }}
            style={{ transformOrigin: "top right", top: pos.top, right: pos.right }}
            className="fixed z-[80] w-72 max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-[var(--shadow-float)]"
          >
            <div className="flex items-center gap-3 border-b border-line p-4">
              <span className="brand-gradient grid size-11 place-items-center rounded-2xl text-sm font-extrabold text-white">
                {initials(user.fullName) || "A"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{user.fullName}</p>
                <p className="truncate text-xs text-ink-3">{user.email}</p>
              </div>
            </div>
            <button
              onClick={() => {
                logout();
                router.replace("/admin/login");
              }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
            >
              <LogOut className="size-4" /> Log out
            </button>
          </motion.div>
        )}
      </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
