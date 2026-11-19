import { MerchantShell } from "@/components/merchant/MerchantShell";

// The dashboard waits for the merchant session, which lives in the browser, so the server
// can't pre-render the pages inside it. Navigations between these pages are client-side.
export const instant = false;

export default function MerchantPanelLayout({ children }: { children: React.ReactNode }) {
  return <MerchantShell>{children}</MerchantShell>;
}
