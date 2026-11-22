"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  BarChart3,
  ChevronDown,
  Coins,
  History,
  LogOut,
  MapPinned,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  RefreshCw,
  ScanLine,
  Settings2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { LogoMark, Wordmark } from "@/components/brand/Logo";
import { LiveDot } from "@/components/ui";
import { ToastProvider } from "@/components/ui/toast";
import { ChatProvider, useChat } from "@/lib/merchant-chat";
import { MerchantProvider, isWaiting, useMerchant, useMerchantSession } from "@/lib/merchant-store";
import { logoSrc } from "@/lib/api";
import { cn, initials, isLive, shortName } from "@/lib/format";
import { NoDriversPrompt } from "./NoDrivers";

export const MERCHANT_NAV = [
  { group: "Orders", href: "/merchant", label: "New order", sub: "Scan a receipt and post it", icon: ScanLine },
  { group: "Orders", href: "/merchant/orders", label: "Live orders", sub: "Prep timers and couriers", icon: ReceiptText },
  { group: "Orders", href: "/merchant/history", label: "Past orders", sub: "Delivered and cancelled", icon: History },
  { group: "Orders", href: "/merchant/analytics", label: "Analytics", sub: "Sales, speed and busy hours", icon: BarChart3 },
  { group: "Team", href: "/merchant/riders", label: "Live riders", sub: "Your riders on the map", icon: MapPinned },
  { group: "Team", href: "/merchant/drivers", label: "My drivers", sub: "Your in-house team", icon: Users },
  { group: "Team", href: "/merchant/messages", label: "Messages", sub: "Chat with your drivers", icon: MessagesSquare },
  { group: "Account", href: "/merchant/credits", label: "Credits", sub: "Balance and top-ups", icon: Coins },
  { group: "Account", href: "/merchant/settings", label: "Delivery settings", sub: "Who delivers your orders", icon: Settings2 },
  { group: "Account", href: "/merchant/account", label: "Account", sub: "Profile, password and delete", icon: UserRound },
] as const;

const isActive = (href: string, pathname: string) =>
  href === "/merchant" ? pathname === "/merchant" : pathname.startsWith(href);

export function MerchantShell({ children }: { children: React.ReactNode }) {
  const user = useMerchantSession();
  const router = useRouter();

  useEffect(() => {
    if (user === null) router.replace("/merchant/login");
  }, [user, router]);

  if (!user) return <BootScreen />;

  return (
    <ToastProvider>
      <MerchantProvider user={user}>
        <ChatProvider>
          <Frame>{children}</Frame>
          <NoDriversPrompt />
        </ChatProvider>
      </MerchantProvider>
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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("itr.sidebar.merchant") === "collapsed";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMobileOpen(false);
  }
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("itr.sidebar.merchant", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });

  const current = MERCHANT_NAV.find((n) => isActive(n.href, pathname)) ?? MERCHANT_NAV[0];

  return (
    <div className="min-h-dvh bg-bg">
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 88 : 272 }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="fixed inset-y-0 left-0 z-40 hidden border-r border-line bg-surface lg:block"
      >
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </motion.aside>

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
                className="absolute top-5 right-4 z-10 rounded-xl p-2 text-ink-3 hover:bg-surface-alt"
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
        <main className="relative z-10 mx-auto -mt-16 max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-8">{children}</main>
      </motion.div>
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const pathname = usePathname();
  const { orders, drivers, restaurant, credits } = useMerchant();
  const { unreadTotal } = useChat();
  const live = orders.filter(isLive);
  const lowCredits =
    !!credits && credits.available < credits.feePerDeliveryGbp;
  const counts: Record<string, { n: number | string; alert?: boolean } | undefined> = {
    "/merchant/orders": { n: live.length, alert: live.some((o) => o.attention || isWaiting(o)) },
    "/merchant/riders": { n: drivers.filter((d) => d.isOnline).length },
    "/merchant/messages": { n: unreadTotal, alert: true },
    "/merchant/credits": lowCredits ? { n: "!", alert: true } : undefined,
  };
  const groups = [...new Set(MERCHANT_NAV.map((n) => n.group))];

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-20 items-center gap-3 px-6", collapsed && "justify-center px-0")}>
        <Link href="/merchant" className="flex min-w-0 items-center gap-3">
          <LogoMark className="size-10 shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                className="min-w-0"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
              >
                <Wordmark className="block text-[17px] leading-tight" />
                <span className="block truncate text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">
                  {restaurant ? shortName(restaurant.name) : "Merchant"}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>
      </div>

      <nav className="scroll-thin flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {groups.map((g) => (
          <div key={g} className="space-y-1">
            {!collapsed && (
              <p className="px-3 pb-1 text-[11px] font-bold tracking-[0.16em] text-ink-3 uppercase">{g}</p>
            )}
            {MERCHANT_NAV.filter((n) => n.group === g).map((item) => {
              const active = isActive(item.href, pathname);
              const Icon = item.icon;
              const c = counts[item.href];
              const show = c && (typeof c.n === "string" || c.n > 0);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors",
                    collapsed && "justify-center py-3",
                    active ? "text-white" : "text-ink-2 hover:bg-surface-alt hover:text-ink"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="merchant-nav-active"
                      className="brand-gradient absolute inset-0 rounded-2xl shadow-[0_12px_30px_-12px_rgb(207_60_66/0.6)]"
                      transition={{ type: "spring", stiffness: 420, damping: 36 }}
                    />
                  )}
                  <Icon className="relative size-5 shrink-0 transition-transform duration-300 group-hover:scale-110" />
                  {!collapsed && <span className="relative flex-1">{item.label}</span>}
                  {show && (
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
          </div>
        ))}
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
      <div className="relative mx-auto flex max-w-[1400px] items-center gap-3 px-4 pt-6 sm:gap-4 sm:px-6 lg:px-8">
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
        <CreditsPill />
        <SyncIndicator />
        <ProfileMenu />
      </div>
    </header>
  );
}

/** Credits left, always in view; red when there aren't enough for a platform delivery. */
function CreditsPill() {
  const { credits } = useMerchant();
  if (!credits) return null;
  const low = credits.available < credits.feePerDeliveryGbp;
  return (
    <Link
      href="/merchant/credits"
      title="Credits available"
      className={cn(
        "flex items-center gap-2 rounded-full py-2 pr-3.5 pl-2.5 text-xs font-bold ring-1 backdrop-blur transition",
        low ? "bg-white text-brand ring-white hover:bg-white/90" : "bg-black/20 text-white ring-white/15 hover:bg-black/30"
      )}
    >
      <Coins className={cn("size-4", low ? "text-brand" : "text-road")} />
      <span className="tabular">{Math.floor(credits.available)}</span>
      <span className="hidden font-semibold opacity-75 sm:inline">{low ? "· top up" : "credits"}</span>
    </Link>
  );
}

function SyncIndicator() {
  const { syncedAt, syncing, error, refresh, connected } = useMerchant();
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
      title={connected ? "Live connection open. Click to refresh now" : "Refresh now"}
      className="group hidden items-center gap-2.5 rounded-full bg-black/20 py-2 pr-3 pl-3.5 text-xs font-semibold ring-1 ring-white/15 backdrop-blur transition hover:bg-black/30 md:flex"
    >
      {error ? <span className="size-2.5 rounded-full bg-amber-400" /> : <LiveDot className="text-emerald-400" />}
      <span className="text-white/85 tabular">
        {error ? "Reconnecting…" : ago === null ? "Connecting…" : ago < 3 ? "Live · just now" : `Live · ${ago}s ago`}
      </span>
      <RefreshCw className={cn("size-3.5 text-white/60 transition group-hover:text-white", syncing && "animate-spin")} />
    </button>
  );
}

function ProfileMenu() {
  const { user, logout, restaurant } = useMerchant();
  const logo = logoSrc(user.restaurant?.logoUrl);
  const router = useRouter();
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="flex items-center gap-2.5 rounded-full bg-white/10 p-1 pr-3 ring-1 ring-white/15 transition hover:bg-white/20"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API
          <img src={logo} alt="" className="size-9 rounded-full bg-white object-cover" />
        ) : (
          <span className="grid size-9 place-items-center rounded-full bg-white text-sm font-extrabold text-crimson-800">
            {initials(user.fullName) || "M"}
          </span>
        )}
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
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- served by the API
                  <img src={logo} alt="" className="size-11 shrink-0 rounded-2xl bg-surface-alt object-cover" />
                ) : (
                  <span className="brand-gradient grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-extrabold text-white">
                    {initials(user.fullName) || "M"}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{user.fullName}</p>
                  <p className="truncate text-xs text-ink-3">{user.email}</p>
                  {restaurant && <p className="truncate text-xs text-ink-3">{restaurant.name}</p>}
                </div>
              </div>
              <Link
                href="/merchant/account"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-sm font-semibold text-ink transition hover:bg-surface-alt"
              >
                <UserRound className="size-4" /> Account
              </Link>
              <button
                onClick={() => {
                  logout();
                  router.replace("/merchant/login");
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
