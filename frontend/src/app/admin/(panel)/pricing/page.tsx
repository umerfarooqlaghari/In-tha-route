import type { Metadata } from "next";

import { PricingScreen } from "@/components/admin/PricingScreen";

// Rendered in the browser once the admin session is read (see the panel layout).
export const instant = false;

export const metadata: Metadata = { title: "Pricing" };

export default function Page() {
  return <PricingScreen />;
}
