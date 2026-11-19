import type { Metadata } from "next";

import { DeliverySettingsScreen } from "@/components/merchant/TeamScreens";

// Rendered in the browser once the merchant session is read (see the layout).
export const instant = false;

export const metadata: Metadata = { title: "Delivery settings" };

export default function Page() {
  return <DeliverySettingsScreen />;
}
