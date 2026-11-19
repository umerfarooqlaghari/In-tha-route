import type { Metadata } from "next";

import { MessagesScreen } from "@/components/merchant/MessagesScreen";

// Rendered in the browser once the merchant session is read (see the layout).
export const instant = false;

export const metadata: Metadata = { title: "Messages" };

export default function Page() {
  return <MessagesScreen />;
}
