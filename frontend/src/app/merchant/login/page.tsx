import { Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/brand/AuthShell";
import { SignInForm } from "@/components/brand/SignInForm";
import { MERCHANT_POINTS } from "@/components/brand/merchant-points";

export const metadata: Metadata = { title: "Merchant sign in" };

export default function MerchantLoginPage() {
  return (
    <AuthShell
      eyebrow="Merchant"
      headline={
        <>
          Your kitchen, <span className="text-road">delivered</span> on time.
        </>
      }
      blurb="Scan a receipt, set the prep time, and a courier arrives as the food is ready."
      points={MERCHANT_POINTS}
    >
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1 text-[11px] font-bold tracking-[0.18em] text-white uppercase">
          <Store className="size-3.5" /> Merchant
        </span>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-ink">Sign in</h2>
        <p className="mt-2 text-[15px] text-ink-3">Use the account you created for your restaurant or shop.</p>
      </div>
      <SignInForm
        portal="merchant"
        role="restaurant"
        redirectTo="/merchant"
        footer={
          <div className="rounded-2xl border border-line bg-surface-alt/60 p-4 text-center text-sm text-ink-2">
            New to In Tha Route?{" "}
            <Link href="/merchant/signup" className="font-bold text-brand underline-offset-4 hover:underline">
              Create a merchant account
            </Link>
          </div>
        }
      />
    </AuthShell>
  );
}
