import type { Metadata } from "next";

import { DriversScreen } from "@/components/admin/DriversScreen";

// Rendered in the browser once the admin session is read (see the panel layout).
export const instant = false;

export const metadata: Metadata = { title: "Drivers" };

export default function Page() {
  return <DriversScreen />;
}
