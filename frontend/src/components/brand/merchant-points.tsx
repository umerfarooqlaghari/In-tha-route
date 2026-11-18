import { Clock3, ScanLine, Users } from "lucide-react";

export const MERCHANT_POINTS = [
  { icon: <ScanLine className="size-4" />, title: "Scan, don’t type", body: "Snap the receipt and the order goes live." },
  { icon: <Clock3 className="size-4" />, title: "Prep timers", body: "Couriers arrive when the food is ready." },
  { icon: <Users className="size-4" />, title: "Your drivers or ours", body: "In-house, platform or both." },
];
