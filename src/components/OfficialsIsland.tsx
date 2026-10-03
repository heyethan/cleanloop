"use client";

/**
 * The officials island — the faces of the people responsible, floating over the map.
 *
 * Importers/callers: src/app/page.tsx (lazy, via next/dynamic).
 * Affected API: exports OfficialsIsland (default).
 * Data schemas: IslandOfficial[] from GET /api/officials-summary (src/lib/areas.ts), already
 * sorted by overdue count. Calls onShow(official) to frame their area on the map.
 *
 * Desktop: a vertical glass stack on the map's right edge; hover tells you who they are and how
 * many cases are overdue on their watch, click frames their area and drops their pin.
 * Phone: a horizontal strip of faces in the thumb zone; tap opens the same words in a popover
 * with a "Show their area" button (there is no hover on touch).
 *
 * Same glass shell and spring as the CleanLoop island (src/components/Island.tsx). Only the
 * heads (city + corporation commissioners) show at first; the chevron expands to the zone heads.
 */
const SPRING = { type: "spring" as const, bounce: 0, duration: 0.42 };
const isHead = (o: IslandOfficial) => o.level !== "zone";

function Chevron({ open, horizontal }: { open: boolean; horizontal?: boolean }) {
  const d = horizontal ? (open ? "M7.5 2.5L4 6l3.5 3.5" : "M4.5 2.5L8 6l-3.5 3.5") : open ? "M2.5 7.5L6 4l3.5 3.5" : "M2.5 4.5L6 8l3.5-3.5";
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Outer glass + inner tint — the two layers the CleanLoop island is built from. */
function Shell({ children, radius }: { children: React.ReactNode; radius: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      layout
      transition={reduced ? { duration: 0.12 } : SPRING}
      className={`overflow-hidden border border-white/12 bg-white/[0.07] p-1 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.95)] backdrop-blur-2xl ${radius}`}
    >
      <motion.div
        layout
        transition={reduced ? { duration: 0.12 } : SPRING}
        className={`bg-black/45 shadow-[inset_0_1px_1px_rgba(255,255,255,0.09)] ${radius}`}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
import { useEffect, useState } from "react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import Face from "@/components/Face";
import { translate, type Lang } from "@/lib/i18n";
import type { IslandOfficial } from "@/lib/areas";

export default function OfficialsIsland({
  officials,
  wide,
  lang,
  onShow,
}: {
  officials: IslandOfficial[];
  wide: boolean;
  lang: Lang;
  onShow: (o: IslandOfficial) => void;
}) {
  const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);
  const [hover, setHover] = useState<IslandOfficial | null>(null);
  // Tooltip follows the hovered face: its centre, relative to the aside.
  const [hoverY, setHoverY] = useState(0);
  const point = (o: IslandOfficial, el: HTMLElement) => {
    const aside = el.closest("aside");
    if (aside) {
      const r = el.getBoundingClientRect();
      setHoverY(r.top + r.height / 2 - aside.getBoundingClientRect().top);
    }
    setHover(o);
  };
  const [tapped, setTapped] = useState<IslandOfficial | null>(null);
  const [all, setAll] = useState(false);
  const says = (o: IslandOfficial) =>
    t("official_says", { name: o.name, role: o.role, area: o.area, n: o.overdue });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTapped(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (officials.length === 0) return null;
  const heads = officials.filter(isHead);
  const shown = all || heads.length === 0 ? officials : heads;
  const more = officials.length - heads.length;
  const toggleLabel = all ? t("officials_fewer") : t("officials_more", { n: more });

  const badge = (o: IslandOfficial) =>
    o.overdue > 0 && (
      <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[#ff3b30] px-1 text-center text-[10px] font-semibold leading-[18px] text-white tabular-nums shadow-[0_0_0_2px_#0b0f15]">
        {o.overdue}
      </span>
    );

  if (wide) {
    return (
      <aside
        aria-label={t("officials")}
        className="pointer-events-auto absolute right-3 top-3 z-20"
      >
        {/* Top-right, height-capped: the map's zoom/compass buttons own the bottom-right. */}
        <MotionConfig reducedMotion="user">
          <Shell radius="rounded-[1.6rem]">
            <ul className="flex max-h-[calc(100dvh-400px)] flex-col items-center gap-2 overflow-y-auto p-2">
              {shown.map((o) => (
                <motion.li layout="position" key={`${o.level}:${o.area}`} className="relative">
                  <button
                    onClick={() => onShow(o)}
                    onMouseEnter={(e) => point(o, e.currentTarget)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={(e) => point(o, e.currentTarget)}
                    onBlur={() => setHover(null)}
                    aria-label={says(o)}
                    className="relative block rounded-full transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-105 focus-visible:scale-105"
                  >
                    <Face name={o.name} photo={o.photo_url} size={44} />
                    {badge(o)}
                  </button>
                </motion.li>
              ))}
            </ul>
            {more > 0 && heads.length > 0 && (
              <motion.button
                layout="position"
                whileTap={{ scale: 0.94 }}
                onClick={() => setAll((v) => !v)}
                aria-expanded={all}
                aria-label={toggleLabel}
                title={toggleLabel}
                className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60"
              >
                <Chevron open={all} />
              </motion.button>
            )}
          </Shell>
        </MotionConfig>
        {hover && (
          <div
            role="tooltip"
            style={{ top: hoverY }}
            className="pointer-events-none absolute right-[calc(100%+10px)] w-72 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0b0f15]/95 p-3.5 text-[12.5px] leading-relaxed text-white/85 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
          >
            {says(hover)}
            <div className="mt-1.5 text-[11px] text-white/45">{hover.open} {t("open_label")}</div>
          </div>
        )}
      </aside>
    );
  }

  return (
    <div className="pointer-events-auto relative">
      {tapped && (
        <div
          role="dialog"
          aria-label={tapped.name}
          className="absolute bottom-[calc(100%+8px)] left-0 right-0 rounded-2xl border border-white/10 bg-[#0b0f15]/95 p-3.5 text-[13px] leading-relaxed text-white/85 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
        >
          <div className="flex items-start gap-3">
            <Face name={tapped.name} photo={tapped.photo_url} size={40} />
            <p className="min-w-0 flex-1">{says(tapped)}</p>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                onShow(tapped);
                setTapped(null);
              }}
              className="h-11 flex-1 rounded-full bg-white text-[13px] font-semibold text-black"
            >
              {t("show_area")}
            </button>
            <button
              onClick={() => setTapped(null)}
              aria-label="Close"
              className="h-11 w-11 shrink-0 rounded-full border border-white/10 bg-white/5 text-white/60"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <MotionConfig reducedMotion="user">
        <Shell radius="rounded-full">
          <div className="flex items-center">
            <ul
              aria-label={t("officials")}
              className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1 pl-1.5 pr-3 [mask-image:linear-gradient(to_right,#000_85%,transparent)]"
            >
              {shown.map((o) => (
                <motion.li layout="position" key={`${o.level}:${o.area}`} className="shrink-0">
                  <button
                    onClick={() => setTapped((cur) => (cur === o ? null : o))}
                    aria-label={says(o)}
                    aria-expanded={tapped === o}
                    className={`relative block rounded-full p-0.5 ${tapped === o ? "ring-2 ring-white/70" : ""}`}
                  >
                    <Face name={o.name} photo={o.photo_url} size={40} />
                    {badge(o)}
                  </button>
                </motion.li>
              ))}
            </ul>
            {more > 0 && heads.length > 0 && (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => setAll((v) => !v)}
                aria-expanded={all}
                aria-label={toggleLabel}
                className="mr-1.5 flex h-11 shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 text-[12px] text-white/70"
              >
                {all ? null : `+${more}`}
                <Chevron open={all} horizontal />
              </motion.button>
            )}
          </div>
        </Shell>
      </MotionConfig>
    </div>
  );
}
