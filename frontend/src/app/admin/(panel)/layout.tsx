import { AdminShell } from "@/components/admin/AdminShell";

// The panel waits for the admin session, which lives in the browser, so the server
// can't pre-render the pages inside it. Navigations between panel pages are client-side.
export const instant = false;

export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
