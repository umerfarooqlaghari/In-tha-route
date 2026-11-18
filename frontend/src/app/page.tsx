import type { Metadata } from "next";

import { Welcome } from "@/components/brand/Welcome";

export const metadata: Metadata = {
  title: { absolute: "In Tha Route — Delivery dispatch" },
};

export default function Home() {
  return <Welcome />;
}
