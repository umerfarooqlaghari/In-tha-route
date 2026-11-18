import type { Metadata } from "next";

import { OrdersScreen } from "@/components/admin/OrdersScreen";

// Rendered in the browser once the admin session is read (see the panel layout).
export const instant = false;

export const metadata: Metadata = { title: "Live orders" };

export default function Page() {
  return <OrdersScreen />;
}
