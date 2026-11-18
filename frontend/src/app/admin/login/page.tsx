import { BadgePoundSterling, Map, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { AuthShell } from "@/components/brand/AuthShell";
import { SignInForm } from "@/components/brand/SignInForm";

export const metadata: Metadata = { title: "Administrator sign in" };

export default function AdminLoginPage() {
  return (
    <AuthShell
      eyebrow="Administrator"
      headline={
        <>
          Run the whole <span className="text-road">route</span> from one screen.
        </>
      }
      blurb="The same live data as the In Tha Route app. Whatever you change here shows on your phone, and the other way round."
      points={[
        { icon: <Map className="size-4" />, title: "Live overview", body: "Fleet, merchants and drop-offs on one map." },
        {
          icon: <BadgePoundSterling className="size-4" />,
          title: "Pricing & payouts",
          body: "Fees, extra miles and stepped batch pay.",
        },
        { icon: <ShieldCheck className="size-4" />, title: "Driver approvals", body: "Check documents and approve drivers." },
      ]}
    >
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1 text-[11px] font-bold tracking-[0.18em] text-white uppercase">
          <ShieldCheck className="size-3.5" /> Admin
        </span>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-ink">Welcome back</h2>
        <p className="mt-2 text-[15px] text-ink-3">Sign in with your administrator account.</p>
      </div>
      <SignInForm portal="admin" role="admin" redirectTo="/admin" />
    </AuthShell>
  );
}
