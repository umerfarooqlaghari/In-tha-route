import type { Metadata } from "next";

import { OverviewScreen } from "@/components/admin/OverviewScreen";

// Rendered in the browser once the admin session is read (see the panel layout).
export const instant = false;

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return <OverviewScreen />;
}
