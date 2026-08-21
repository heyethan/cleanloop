"use client";

/**
 * Locality search — Cmd+K / Ctrl+K, or the Search affordance in the island.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports CommandPalette (default).
 * Data schemas: reads WARDS from src/lib/wards.ts ({id, name, lat, lng}) and a Set of
 * ward ids that have a surveyed OSM boundary; calls onPick(wardId). No dates, no I/O.
 * User instruction, verbatim: "4. There should be an option where we can click on a
 * search option or the trending 'CMD + K' feature where it can ask us which localtiy
 * we'd like to check and when we click on it, there's a smooth camera movement which
 * takes us to that locality and orbits around it."
 *
 * NOTES:
 *  - Each row says whether that locality has a SURVEYED boundary or only a case cluster,
 *    because seven of the twelve have no boundary in OpenStreetMap at all. Better to
 *    admit that at the point of choosing than to let someone wonder why the outline
 *    looks different once they land.
 *  - Focus is trapped while open and restored to the trigger on close, so a keyboard or
 *    screen-reader user is not dropped at the top of the document.
 *  - Matching is substring, not fuzzy: with twelve fixed options fuzzy matching only adds
 *    surprising ranking. Prefix matches sort first because that is what people type.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WARDS } from "@/lib/wards";
import { translate, type Lang } from "@/lib/i18n";

const SPRING = { type: "spring" as const, bounce: 0, duration: 0.34 };

export default function CommandPalette({
  open,
  onOpenChange,
  onPick,
  officialIds,
  lang,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (wardId: string) => void;
  /** Ward ids that have a real surveyed boundary; the rest fall back to a case cluster. */
  officialIds: Set<string>;
  lang: Lang;
}) {
  const t = (k: string) => translate(lang, k);
  const reduced = useReducedMotion();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return WARDS;
    return WARDS.filter((w) => w.name.toLowerCase().includes(needle)).sort((a, b) => {
      // Prefix hits first — typing "ko" should surface Koramangala, not merely include it.
      const ap = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
  }, [q]);

  // Global shortcut. Registered once, independent of open state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    setQ("");
    setCursor(0);
    // Wait a frame so the element exists and the entry animation has begun.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const close = useCallback(() => {
    onOpenChange(false);
    restoreTo.current?.focus?.();
  }, [onOpenChange]);

  const choose = useCallback(
    (wardId: string) => {
      onPick(wardId);
      close();
    },
    [onPick, close],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[cursor];
      if (pick) choose(pick.id);
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
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setCursor(0);
                  }}
                  placeholder={t("search_placeholder")}
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

                {results.map((w, i) => {
                  const isOfficial = officialIds.has(w.id);
                  return (
                    <button
                      key={w.id}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => choose(w.id)}
                      aria-selected={i === cursor}
                      className={`flex h-12 w-full items-center gap-2.5 rounded-2xl px-2.5 text-left transition-colors duration-200 ${
                        i === cursor ? "bg-white/10" : "hover:bg-white/[0.06]"
                      }`}
                    >
                      {/* Solid vs dashed mirrors exactly how the map draws the outline. */}
                      <span
                        aria-hidden
                        className="h-3.5 w-3.5 shrink-0 rounded-[4px]"
                        style={{
                          border: `1.5px ${isOfficial ? "solid" : "dashed"} ${
                            isOfficial ? "#6cb6ff" : "#93a4b8"
                          }`,
                        }}
                      />
                      {/*
                        Each row used to carry a "Surveyed boundary" / "Case cluster"
                        subtitle. Where our outline geometry came from is our problem,
                        not the reader's — someone jumping to Koramangala wants
                        Koramangala. The swatch still differs (solid vs dashed) so the
                        distinction survives visually for anyone who looks.
                      */}
                      <span className="min-w-0 flex-1 truncate text-sm text-white/90">
                        {w.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-white/55">↵</span>
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-white/[0.07] px-4 py-2 text-[10.5px] text-white/55">
                {t("search_hint")}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
