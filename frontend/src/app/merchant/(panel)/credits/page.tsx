import type { Metadata } from "next";

import { CreditsScreen } from "@/components/merchant/CreditsScreen";

// Rendered in the browser once the merchant session is read (see the layout).
export const instant = false;

export const metadata: Metadata = { title: "Credits" };

export default function Page() {
  return <CreditsScreen />;
}
