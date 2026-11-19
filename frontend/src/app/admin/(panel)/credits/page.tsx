import type { Metadata } from "next";

import { CreditsAdminScreen } from "@/components/admin/CreditsAdminScreen";

// Rendered in the browser once the admin session is read (see the panel layout).
export const instant = false;

export const metadata: Metadata = { title: "Credits" };

export default function Page() {
  return <CreditsAdminScreen />;
}
