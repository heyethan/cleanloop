"use client";

/**
 * Zone / ward search — Cmd+K / Ctrl+K, or the Search affordance in the island.
 *
 * Importers/callers: src/app/page.tsx (lazy, via next/dynamic; page.tsx owns the ⌘K listener
 * so the shortcut works before this chunk has loaded).
 * Affected API: exports CommandPalette (default).
 * Data schemas: reads AreaPick[] (10 GBA zones + 369 wards, from GET /api/areas via
 * src/lib/areaPicks.ts); calls onPick(area). Matches English and Kannada names.
 * User instruction, verbatim: "4. There should be an option where we can click on a
 * search option or the trending 'CMD + K' feature where it can ask us which localtiy
 * we'd like to check and when we click on it, there's a smooth camera movement which
 * takes us to that locality and orbits around it."
 *
 * NOTES:
 *  - Rows show the zone a ward belongs to, and open/overdue counts, so the choice is informed.
 *  - Focus is trapped while open and restored to the trigger on close, so a keyboard or
 *    screen-reader user is not dropped at the top of the document.
 *  - Two levels: Enter on a zone opens its wards (first row is the zone itself, so Enter
 *    again frames the whole zone); Backspace on an empty query steps back out. ⌘/Ctrl+Enter
 *    on a zone flies straight to it.
 *  - Matching is substring, not fuzzy: fuzzy matching over ward names only adds surprising
 *    ranking. Prefix matches sort first because that is what people type. At most 60 rows
 *    render; typing narrows the rest.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translate, type Lang } from "@/lib/i18n";
import type { AreaPick } from "@/lib/types";

const MAX_ROWS = 60;

const SPRING = { type: "spring" as const, bounce: 0, duration: 0.34 };

export default function CommandPalette({
  open,
  onOpenChange,
  onPick,
  areas,
  lang,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (area: AreaPick) => void;
  areas: AreaPick[];
  lang: Lang;
}) {
  const t = (k: string) => translate(lang, k);
  const reduced = useReducedMotion();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  // The zone we've drilled into, or null at the top level.
  const [inZone, setInZone] = useState<AreaPick | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (inZone) {
      const wards = areas
        .filter((a) => a.kind === "ward" && a.zone === inZone.zone)
        .filter((a) => !needle || a.name.toLowerCase().includes(needle) || (a.name_kn?.includes(q.trim()) ?? false))
        .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
      return [inZone, ...wards];
    }
    // Empty query: the 10 zones (they come first in `areas`), the natural starting points.
    if (!needle) return areas.filter((a) => a.kind === "zone");
    const hit = (a: AreaPick) => a.name.toLowerCase().includes(needle) || (a.name_kn?.includes(q.trim()) ?? false);
    const prefix = (a: AreaPick) =>
      a.name.toLowerCase().startsWith(needle) || (a.name_kn?.startsWith(q.trim()) ?? false) ? 0 : 1;
    return areas
      .filter(hit)
      // Prefix hits first — typing "ko" should surface Koramangala, not merely include it.
      .sort((a, b) => prefix(a) - prefix(b) || (a.kind === b.kind ? 0 : a.kind === "zone" ? -1 : 1) || a.name.localeCompare(b.name))
      .slice(0, MAX_ROWS);
  }, [q, areas, inZone]);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    // Wait a frame so the element exists and the entry animation has begun.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Reset on close, not on open: the next open always starts fresh at the zone list.
  const close = useCallback(() => {
    setQ("");
    setCursor(0);
    setInZone(null);
    onOpenChange(false);
    restoreTo.current?.focus?.();
  }, [onOpenChange]);

  const choose = useCallback(
    (area: AreaPick, direct = false) => {
      // First pick of a zone drills into its wards; picking it again (row 0) frames it.
      if (area.kind === "zone" && !inZone && !direct) {
        setInZone(area);
        setQ("");
        setCursor(0);
        inputRef.current?.focus();
        return;
      }
      onPick(area);
      close();
    },
    [onPick, close, inZone],
  );

  const back = () => {
    if (!inZone) return;
    const zones = areas.filter((a) => a.kind === "zone");
    setCursor(Math.max(0, zones.findIndex((z) => z.id === inZone.id)));
    setInZone(null);
    setQ("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (inZone) back();
      else close();
    } else if (e.key === "Backspace" && inZone && q === "") {
      e.preventDefault();
      back();
    } else if (e.key === "ArrowLeft" && inZone && q === "") {
      e.preventDefault();
      back();
    } else if (e.key === "ArrowRight" && !inZone && q === "" && results[cursor]?.kind === "zone") {
      e.preventDefault();
      choose(results[cursor]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[cursor];
      if (pick) choose(pick, e.metaKey || e.ctrlKey);
    } else if (e.key === "Tab") {
      // Trap: there is exactly one focusable control, so Tab must not leave the panel.
      e.preventDefault();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[max(4.5rem,env(safe-area-inset-top))]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.1 : 0.18 }}
        >
          {/* Scrim: this is a modal task, so the map is dimmed and pushed back. */}
          <button
            aria-label="Close search"
            onClick={close}
            className="absolute inset-0 h-full w-full cursor-default bg-black/55 backdrop-blur-[2px]"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal
            aria-label={t("search_locality")}
            onKeyDown={onKeyDown}
            initial={
              reduced
                ? { opacity: 0 }
                : { opacity: 0, y: -12, scale: 0.97, filter: "blur(10px)" }
            }
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={
              reduced
                ? { opacity: 0 }
                : { opacity: 0, y: -12, scale: 0.97, filter: "blur(10px)" }
            }
            transition={reduced ? { duration: 0.1 } : SPRING}
            style={{ transformOrigin: "top center" }}
            className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/12 bg-white/[0.07] p-1.5 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.95)] backdrop-blur-2xl"
          >
            <div className="rounded-[calc(1.75rem-0.375rem)] bg-black/55 shadow-[inset_0_1px_1px_rgba(255,255,255,0.09)]">
              <div className="flex items-center gap-2.5 px-4 pt-3.5">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="shrink-0 text-white/60"
                  aria-hidden
                >
                  <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.4" />
                  <path
                    d="M10.5 10.5L14 14"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                {inZone && (
                  <button
                    onClick={back}
                    aria-label={`${t("search_back")}: ${inZone.name}`}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-[#6cb6ff]/40 bg-[#6cb6ff]/10 px-2.5 text-[12px] text-[#bfe0ff]"
                  >
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {inZone.name}
                  </button>
                )}
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setCursor(0);
                  }}
                  placeholder={inZone ? t("search_wards_in") : t("search_placeholder")}
                  aria-label={t("search_locality")}
                  className="h-10 w-full bg-transparent text-[15px] text-white outline-none placeholder:text-white/55"
                />
              </div>

              <div className="mt-1 max-h-[46vh] overflow-y-auto px-1.5 pb-1.5">
                {results.length === 0 && (
                  <p className="px-2.5 py-6 text-center text-[13px] text-white/60">
                    {t("search_empty")}
                  </p>
                )}

                {results.map((w, i) => (
                  <button
                    key={`${w.kind}:${w.id}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(w)}
                    aria-selected={i === cursor}
                    className={`flex min-h-12 w-full items-center gap-2.5 rounded-2xl px-2.5 py-1.5 text-left transition-colors duration-200 ${
                      i === cursor ? "bg-white/10" : "hover:bg-white/[0.06]"
                    }`}
                  >
                    {/* Zones get a solid swatch, wards a lighter one — mirrors the map's two levels. */}
                    <span
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 rounded-[4px]"
                      style={{ border: `1.5px solid ${w.kind === "zone" ? "#6cb6ff" : "#93a4b8"}` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white/90">
                        {inZone && w.kind === "zone"
                          ? t("search_whole_zone").replace("{zone}", w.name)
                          : lang === "kn" && w.name_kn
                            ? w.name_kn
                            : w.name}
                      </span>
                      <span className="block truncate text-[11px] text-white/50">
                        {w.kind === "zone" ? `${w.corporation} · ${t("zone_label")}` : `${w.zone} ${t("zone_label")}`}
                        {` · ${w.open} ${t("open_label")}`}
                        {w.overdue > 0 && <span className="text-[#ff8a80]">{` · ${w.overdue} ${t("overdue_count")}`}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-white/55">
                      {w.kind === "zone" && !inZone ? "→" : "↵"}
                    </span>
                  </button>
                ))}
              </div>

              <div className="border-t border-white/[0.07] px-4 py-2 text-[10.5px] text-white/55">
                {inZone ? t("search_hint_wards") : t("search_hint")}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
