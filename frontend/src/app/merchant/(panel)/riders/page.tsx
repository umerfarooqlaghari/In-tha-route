import type { Metadata } from "next";

import { LiveRidersScreen } from "@/components/merchant/TeamScreens";

// Rendered in the browser once the merchant session is read (see the layout).
export const instant = false;

export const metadata: Metadata = { title: "Live riders" };

export default function Page() {
  return <LiveRidersScreen />;
}
