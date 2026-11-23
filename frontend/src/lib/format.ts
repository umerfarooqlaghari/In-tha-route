import type { DriverProfile, LiveOrder, OrderSource } from "./types";

export const formatGbp = (value: number) => `£${(value ?? 0).toFixed(2)}`;

export const formatCountdown = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/** "Saffron - Richmond" → "Saffron" */
export const shortName = (n: string) => (n ?? "").split(" - ")[0];

/** Document titles carry hints in brackets that the admin list doesn't need. */
export const cleanTitle = (t: string) => t.replace(/\s*\(.*?\)/g, "");

export const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

export const VEHICLE_SHORT: Record<DriverProfile["vehicle"], string> = {
  "Motorcycle / Scooter": "Scooter",
  Car: "Car",
  "E-Bike": "E-Bike",
};

export const SOURCE_COLORS: Record<string, string> = {
  Deliveroo: "#16A34A",
  "Uber Eats": "#14151A",
  "Eat Presto POS": "#7A5AF8",
  "Just Eat": "#FF8000",
};

/** Colour for an order's source; anything not from a delivery app counts as a direct order. */
export const sourceColor = (source: OrderSource | string) => SOURCE_COLORS[source] ?? SOURCE_COLORS["Eat Presto POS"];

export const sourceLabel = (source: string) => (source === "Eat Presto POS" || source === "Other" ? "Direct" : source);

/** Same wording the admin sees in the mobile app. */
export const ADMIN_STATUS: Record<LiveOrder["status"], string> = {
  preparing: "Waiting for a driver",
  ready_for_pickup: "Ready · waiting for a driver",
  batched_offered: "Offered",
  driver_assigned: "Driver on the way",
  picked_up: "Collected",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const isLive = (o: LiveOrder) => o.status !== "delivered" && o.status !== "cancelled";

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Pool time: "45 s", "2 min", "2 min 30 s". */
export function formatPoolTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (!m) return `${s} s`;
  return s ? `${m} min ${s} s` : `${m} min`;
}
