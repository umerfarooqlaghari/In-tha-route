import type { Metadata } from "next";

import { LiveOrdersScreen } from "@/components/merchant/LiveOrdersScreen";

// Rendered in the browser once the merchant session is read (see the layout).
export const instant = false;

export const metadata: Metadata = { title: "Live orders" };

export default function Page() {
  return <LiveOrdersScreen />;
}
