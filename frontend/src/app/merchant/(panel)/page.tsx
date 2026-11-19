import type { Metadata } from "next";

import { NewOrderScreen } from "@/components/merchant/NewOrderScreen";

// Rendered in the browser once the merchant session is read (see the layout).
export const instant = false;

export const metadata: Metadata = { title: "New order" };

export default function Page() {
  return <NewOrderScreen />;
}
