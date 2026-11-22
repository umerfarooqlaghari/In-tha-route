import type { Metadata } from "next";

import { MerchantAccountScreen } from "@/components/account/AccountScreen";

// Rendered in the browser once the merchant session is read (see the panel layout).
export const instant = false;

export const metadata: Metadata = { title: "Account" };

export default function Page() {
  return <MerchantAccountScreen />;
}
