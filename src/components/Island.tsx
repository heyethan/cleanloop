"use client";

/**
 * The CleanLoop island — a Dynamic Island-style floating header.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports Island (default) and IslandCollapse.
 * Data schemas: none — presentational, takes already-formatted strings.
 * User instruction, verbatim: "make the cleanloop bubble widget to be like floating
 * island, because right now it interferes with the the map in mobile, make it like a
 * floating island with smooth call and close transitions"
 *
 * WHY: the old header was a ~250px fixed glass slab covering a third of the map on a
 * 6.1" phone. The map is the product; chrome should get out of its way and return on
 * demand.
 *
 * MOTION (Apple's "Designing Fluid Interfaces" applied):
 *  - Springs, not CSS transitions. A spring animates from the CURRENT on-screen value,
 *    so tapping mid-flight reverses smoothly instead of jumping — a keyframed accordion
 *    cannot do that.
 *  - Critically damped (bounce 0) because this is a TAP, not a flick. Overshoot is only
 *    honest when the user's own gesture carried momentum.
 *  - Layout animation drives width/height/radius together, so the pill genuinely morphs
 *    into the card rather than cross-fading between two boxes.
 *  - Symmetric path: it expands from, and collapses back to, the same top-centre origin.
 *  - Materialises rather than fades — blur and scale move together so it reads as glass
 *    arriving, not opacity ramping.
 *  - prefers-reduced-motion collapses all of it to a short cross-fade.
 */

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";

/**
 * Apple ships damping 1.0 / response 0.3-0.4 for non-momentum UI moves. Motion's
 * (bounce, duration) maps onto that: bounce 0 == critically damped.
 */
const SPRING = { type: "spring" as const, bounce: 0, duration: 0.42 };
/** Content is a touch quicker than the container so it settles inside a stable frame. */
const CONTENT_SPRING = { type: "spring" as const, bounce: 0, duration: 0.32 };

export default function Island({
  open,
  onToggle,
  collapsedMetric,
  collapsedLabel,
  expanded,
}: {
  open: boolean;
  onToggle: () => void;
  collapsedMetric: string;
  collapsedLabel: string;
  expanded: React.ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        layout
        transition={reduced ? { duration: 0.12 } : SPRING}
        // Anchored to the top centre: it grows down from where it lives, and shrinks
        // back to the same point. Enter and exit share one path.
        style={{ transformOrigin: "top center", willChange: "transform" }}
        className={`pointer-events-auto mx-auto overflow-hidden border border-white/12 bg-white/[0.07] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.95)] backdrop-blur-2xl ${
          // w-fit, not w-auto: a block-level div resolves w-auto to 100%, which left the
          // collapsed pill's glass stretched across the whole screen.
          open ? "w-full max-w-md rounded-[1.75rem] p-1.5" : "w-fit rounded-full p-1"
        }`}
      >
        <motion.div
          layout
          transition={reduced ? { duration: 0.12 } : SPRING}
          className={`bg-black/45 shadow-[inset_0_1px_1px_rgba(255,255,255,0.09)] ${
            open ? "rounded-[calc(1.75rem-0.375rem)] p-4" : "rounded-full"
          }`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {open ? (
              <motion.div
                key="expanded"
                layout
                initial={{ opacity: 0, filter: "blur(8px)", scale: 0.97 }}
                animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
                exit={{ opacity: 0, filter: "blur(8px)", scale: 0.97 }}
                transition={reduced ? { duration: 0.12 } : CONTENT_SPRING}
              >
                {expanded}
              </motion.div>
            ) : (
              <motion.button
                key="collapsed"
                layout
                onClick={onToggle}
                initial={{ opacity: 0, filter: "blur(8px)", scale: 0.97 }}
                animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
                exit={{ opacity: 0, filter: "blur(8px)", scale: 0.97 }}
                transition={reduced ? { duration: 0.12 } : CONTENT_SPRING}
                // Feedback on press, not on release.
                whileTap={{ scale: 0.97 }}
                aria-expanded={false}
                aria-label={`${collapsedMetric} ${collapsedLabel}. Expand CleanLoop panel`}
                className="flex h-12 items-center gap-2.5 whitespace-nowrap rounded-full pl-4 pr-3.5"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-[#22c98a]"
                  style={{ boxShadow: "0 0 10px #22c98a" }}
                />
                <span className="text-[15px] font-semibold tabular-nums text-white">
                  {collapsedMetric}
                </span>
                <span className="text-[12px] text-white/65">{collapsedLabel}</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className="ml-0.5 shrink-0 text-white/60"
                  aria-hidden
                >
                  <path
                    d="M2.5 4.5L6 8l3.5-3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </MotionConfig>
  );
}

/** Collapse affordance for the expanded state — mirrors the chevron on the pill. */
export function IslandCollapse({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      aria-label={label}
      aria-expanded
      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d="M2.5 7.5L6 4l3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.button>
  );
}
