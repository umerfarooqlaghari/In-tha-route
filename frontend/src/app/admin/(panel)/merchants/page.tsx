import type { Metadata } from "next";

import { MerchantsScreen } from "@/components/admin/MerchantsScreen";

// Rendered in the browser once the admin session is read (see the panel layout).
export const instant = false;

export const metadata: Metadata = { title: "Merchants" };

export default function Page() {
  return <MerchantsScreen />;
}
