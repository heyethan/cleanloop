"use client";

/**
 * Full-bleed loader held over the map until MapLibre has actually painted.
 *
 * Importers/callers: src/app/page.tsx (its only caller).
 * Affected API: exports MapLoader (default), taking { ready, lang }. Adds nothing else.
 * Data schemas: none. Renders no data; takes one boolean and a language code.
 * User instruction, verbatim: "when loading website it loads slowly which is a problem, so
 *   implement a loader animation using animation.js three.js or wtv so that map loads by the
 *   time it's done."
 *
 * WHY THIS EXISTS
 *
 * next/dynamic's `loading:` fallback only covers fetching the Map3D chunk. Once that
 * resolves the component mounts and MapLibre still has to fetch a style and a first set of
 * tiles, which on a phone over conference wifi is the longer half of the wait. That second
 * stretch was unguarded, so the first thing a visitor saw was an empty dark rectangle.
 *
 * No new dependency: `motion` and `thinking-orbs` are both already in the bundle, and the
 * orb is the same indicator the app uses for every AI wait, so a first-time visitor meets
 * the product's visual language before they meet the map.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ThinkingOrb } from "thinking-orbs";
import { translate, type Lang } from "@/lib/i18n";

/*
 * Map3D degrades to a list when WebGL2 is missing (locked-down browsers, remote desktop,
 * headless Chromium). On that path MapLibre's `load` event never fires, so a loader waiting
 * only on `ready` would cover the working fallback forever. Always let go by this deadline.
 */
const MAX_WAIT_MS = 8000;

export default function MapLoader({ ready, lang }: { ready: boolean; lang: Lang }) {
  const [expired, setExpired] = useState(false);
  const reduce = useReducedMotion();
  const t = (k: string) => translate(lang, k);

  useEffect(() => {
    const id = setTimeout(() => setExpired(true), MAX_WAIT_MS);
    return () => clearTimeout(id);
  }, []);

  const done = ready || expired;

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#070a0f]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.55, ease: [0.32, 0.72, 0, 1] }}
          aria-live="polite"
          aria-busy="true"
        >
          <ThinkingOrb state="working" size={64} theme="dark" aria-label={t("loading")} />

          <div className="mt-6 text-[13px] font-medium tracking-tight text-white/80">
            {t("app_name")}
          </div>
          <div className="mt-1.5 text-[11px] uppercase tracking-[0.25em] text-white/45">
            {t("loading_city")}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
