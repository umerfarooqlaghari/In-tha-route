import type { Metadata } from "next";

import { PastOrdersScreen } from "@/components/merchant/InsightsScreens";

// Rendered in the browser once the merchant session is read (see the layout).
export const instant = false;

export const metadata: Metadata = { title: "Past orders" };

export default function Page() {
  return <PastOrdersScreen />;
}
