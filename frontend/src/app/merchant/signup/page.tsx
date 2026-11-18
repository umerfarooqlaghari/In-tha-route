import type { Metadata } from "next";

import { AuthShell } from "@/components/brand/AuthShell";
import { MerchantSignupForm } from "@/components/brand/MerchantSignupForm";
import { MERCHANT_POINTS } from "@/components/brand/merchant-points";

export const metadata: Metadata = { title: "Create a merchant account" };

export default function MerchantSignupPage() {
  return (
    <AuthShell
      eyebrow="Merchant"
      headline={
        <>
          Join the <span className="text-road">route</span>.
        </>
      }
      blurb="Create your merchant account once and use it here and in the In Tha Route app."
      points={MERCHANT_POINTS}
    >
      <MerchantSignupForm />
    </AuthShell>
  );
}
