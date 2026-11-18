import { cn } from "@/lib/format";

/**
 * The In Tha Route mark (same as the app icon): a road curving through a
 * red-ringed disc. `animated` runs the centre-line dashes along the road.
 */
export function LogoMark({ className, animated = true }: { className?: string; animated?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("size-10", className)} aria-hidden>
      <circle cx="50" cy="50" r="48" fill="#fff" />
      <circle cx="50" cy="50" r="42" fill="#0F1218" />
      <circle cx="50" cy="50" r="38" fill="none" stroke="#E33535" strokeWidth="2.6" />
      <path
        d="M63 25 C 46 33, 47 43, 48.5 52 C 50 62, 46 69, 35.5 75"
        fill="none"
        stroke="#fff"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <path
        d="M63 25 C 46 33, 47 43, 48.5 52 C 50 62, 46 69, 35.5 75"
        fill="none"
        stroke="#232A37"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M63 25 C 46 33, 47 43, 48.5 52 C 50 62, 46 69, 35.5 75"
        fill="none"
        stroke="#F5B014"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="3.2 4.8"
        className={animated ? "animate-dash" : undefined}
      />
    </svg>
  );
}

export function Wordmark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("font-extrabold tracking-tight", light ? "text-white" : "text-ink", className)}>
      In Tha <span className={light ? "text-road" : "text-brand"}>Route</span>
    </span>
  );
}
