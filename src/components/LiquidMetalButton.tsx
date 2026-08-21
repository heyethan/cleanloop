"use client";

/**
 * The primary CTA, wrapped in an animated liquid-metal ring.
 *
 * Importers/callers: src/app/page.tsx (replaces the inline CTA markup).
 * Affected API: exports LiquidMetalButton (default).
 * Data schemas: none — presentational. No dates, no I/O.
 * User instruction, verbatim: "1. can we implement [LiquidMetal shader component] for
 * the 'report a dump spot' button? use /redesign-existing-projects skill for this. I'd
 * like only the liquid metal effect, not the entire button changing, so keep the brand
 * theme same."
 *
 * WHAT CHANGED AND WHAT DID NOT:
 *   The inner body is the CTA that was already here — white pill, black semibold label,
 *   the nested circular arrow, the same press-scale easing. Only the BORDER is new. The
 *   reference snippet restyled the whole control (neutral chrome, dark-mode body, size
 *   variants); that was deliberately not carried over.
 *
 *   The snippet's `cn()` helper was also dropped: this repo has no @/lib/utils and every
 *   other component composes className with template literals. Adding a utility for one
 *   file would be the odd one out.
 *
 * COST, STATED PLAINLY: this mounts a SECOND WebGL context on top of MapLibre's, running
 * a fragment shader continuously, on a phone. So it is gated:
 *   - `paused` stops it whenever a sheet is open or the camera is flying.
 *   - It stops when the tab is hidden.
 *   - prefers-reduced-motion drops the canvas entirely for a static ring.
 * A shader that animates behind a modal is pure battery cost with nobody looking at it.
 */

import { useEffect, useState } from "react";
import { LiquidMetal } from "@paper-design/shaders-react";

/** Ring thickness in px. Thin enough to read as a rim, not a frame. */
const BORDER = 3;

export default function LiquidMetalButton({
  onClick,
  children,
  paused = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  /** True while a sheet is open or the camera is animating — see the note above. */
  paused?: boolean;
}) {
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);

    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mq.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const shaderOn = !reduced && !paused && !hidden;

  return (
    <button
      onClick={onClick}
      className="group mx-auto block w-full max-w-md transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.975]"
    >
      <div
        className="relative overflow-hidden rounded-full shadow-[0_20px_50px_-12px_rgba(255,255,255,0.35)]"
        style={{ padding: BORDER }}
      >
        {shaderOn ? (
          <div className="absolute inset-0 z-0 overflow-hidden rounded-full">
            <LiquidMetal
              colorBack="#0b0f15"
              colorTint="#ffffff"
              speed={0.35}
              repetition={4}
              distortion={0.12}
              softness={0}
              shiftRed={0.3}
              shiftBlue={-0.3}
              angle={45}
              shape="none"
              scale={1}
              fit="cover"
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        ) : (
          // Static stand-in with the same footprint, so nothing shifts when it pauses.
          <div
            aria-hidden
            className="absolute inset-0 z-0 rounded-full"
            style={{
              background:
                "linear-gradient(135deg,#ffffff 0%,#8e98a6 38%,#ffffff 55%,#5d6774 78%,#e8edf3 100%)",
            }}
          />
        )}

        {/* Unchanged brand body. */}
        <div className="relative z-10 flex items-center justify-center gap-3 rounded-full bg-white py-4 text-[15px] font-semibold text-black">
          {children}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-xs transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-[1px] group-hover:translate-x-0.5">
            ↗
          </span>
        </div>
      </div>
    </button>
  );
}
