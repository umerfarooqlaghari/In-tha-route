"use client";

import { motion } from "motion/react";

/**
 * A night-time road map behind the brand screens: winding roads draw
 * themselves in, couriers travel along them and stops pulse.
 */
const ROADS = [
  "M-50 620 C 180 560, 260 380, 470 400 S 760 600, 980 470 S 1260 180, 1500 240",
  "M-50 200 C 140 260, 300 150, 520 210 S 860 90, 1060 180 S 1340 380, 1500 330",
  "M200 950 C 260 760, 420 700, 600 720 S 900 860, 1100 760 S 1320 560, 1500 600",
];

const STOPS = [
  { x: 470, y: 400 },
  { x: 980, y: 470 },
  { x: 520, y: 210 },
  { x: 1060, y: 180 },
  { x: 600, y: 720 },
  { x: 1100, y: 760 },
];

export function RouteBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="rgb(255 255 255 / 0.045)" strokeWidth="1" />
        </pattern>
        <radialGradient id="fade" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="vignette">
          <rect width="1440" height="900" fill="url(#fade)" />
        </mask>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="1440" height="900" fill="url(#grid)" />

      <g mask="url(#vignette)">
        {ROADS.map((d, i) => (
          <g key={i}>
            <motion.path
              d={d}
              fill="none"
              stroke="rgb(0 0 0 / 0.35)"
              strokeWidth="30"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2.2, delay: 0.2 + i * 0.25, ease: [0.65, 0, 0.35, 1] }}
            />
            <motion.path
              d={d}
              fill="none"
              stroke="rgb(255 255 255 / 0.08)"
              strokeWidth="22"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2.2, delay: 0.2 + i * 0.25, ease: [0.65, 0, 0.35, 1] }}
            />
            <motion.path
              d={d}
              fill="none"
              stroke="#F5B014"
              strokeOpacity="0.55"
              strokeWidth="2"
              strokeDasharray="10 14"
              strokeLinecap="round"
              className="animate-dash"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2 + i * 0.25, duration: 1 }}
            />
            {/* courier travelling the road */}
            <circle r="7" fill="#fff" filter="url(#glow)">
              <animateMotion dur={`${14 + i * 4}s`} repeatCount="indefinite" path={d} begin={`${2 + i}s`} />
            </circle>
            <circle r="16" fill="#E5484D" opacity="0.25">
              <animateMotion dur={`${14 + i * 4}s`} repeatCount="indefinite" path={d} begin={`${2 + i}s`} />
            </circle>
          </g>
        ))}

        {STOPS.map((s, i) => (
          <motion.g
            key={i}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 2.3 + i * 0.12, type: "spring", stiffness: 260, damping: 14 }}
            style={{ transformOrigin: `${s.x}px ${s.y}px` }}
          >
            <circle cx={s.x} cy={s.y} r="18" fill="#E5484D" opacity="0.18">
              <animate attributeName="r" values="10;26;10" dur="3s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
              <animate
                attributeName="opacity"
                values="0.35;0;0.35"
                dur="3s"
                begin={`${i * 0.4}s`}
                repeatCount="indefinite"
              />
            </circle>
            <circle cx={s.x} cy={s.y} r="6" fill={i % 2 ? "#F5B014" : "#fff"} stroke="#140000" strokeWidth="3" />
          </motion.g>
        ))}
      </g>
    </svg>
  );
}
