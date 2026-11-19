import type { Metadata } from "next";

import { AnalyticsScreen } from "@/components/merchant/InsightsScreens";

// Rendered in the browser once the merchant session is read (see the layout).
export const instant = false;

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return <AnalyticsScreen />;
}
