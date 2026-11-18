import type { Metadata } from "next";

import { MerchantHome } from "@/components/brand/MerchantHome";

export const metadata: Metadata = { title: "Merchant" };

export default function MerchantPage() {
  return <MerchantHome />;
}
