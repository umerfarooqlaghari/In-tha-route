"use client";

import { motion } from "motion/react";
import { LogOut, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { clearSession, getSession, onSessionChange } from "@/lib/api";
import type { AuthUser } from "@/lib/types";
import { LogoMark, Wordmark } from "./Logo";
import { RouteBackdrop } from "./RouteBackdrop";

/**
 * Where a merchant lands after signing in on the web. The merchant web portal
 * is the next phase; until then this confirms the account and points to the app.
 */
export function MerchantHome() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    const read = () => {
      const s = getSession("merchant");
      const u = s?.user.role === "restaurant" ? s.user : null;
      setUser(u);
      if (!u) router.replace("/merchant/login");
    };
    read();
    return onSessionChange((p) => p === "merchant" && read());
  }, [router]);

  if (!user) return <main className="brand-gradient min-h-dvh" />;

  return (
    <main className="brand-gradient grain relative isolate grid min-h-dvh place-items-center overflow-hidden px-5 text-white">
      <RouteBackdrop />
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-lg rounded-[32px] border border-white/15 bg-black/30 p-8 text-center shadow-[0_40px_100px_-30px_rgb(0_0_0/0.9)] backdrop-blur-xl sm:p-10"
      >
        <LogoMark className="mx-auto size-20 animate-float" />
        <p className="mt-6 text-xs font-bold tracking-[0.28em] text-road uppercase">Merchant</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          Hi {user.fullName.split(" ")[0]}, you’re signed in
        </h1>
        <p className="mt-2 text-white/70">{user.restaurant?.name}</p>
        <div className="mt-6 flex items-start gap-3 rounded-2xl bg-white/10 p-4 text-left text-sm text-white/80">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-road" />
          <p>
            The merchant web portal is on its way. Meanwhile, scan receipts and follow your orders in the{" "}
            <Wordmark light className="text-sm" /> app with this same account.
          </p>
        </div>
        <Button
          variant="secondary"
          className="mt-8"
          icon={<LogOut className="size-4" />}
          onClick={() => {
            clearSession("merchant");
            router.replace("/");
          }}
        >
          Sign out
        </Button>
      </motion.div>
    </main>
  );
}
