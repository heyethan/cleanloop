"use client";

/**
 * List view — browse and triage cases without the map.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports ListView (default) and the SortMode type.
 * Data schemas: consumes Report[] from src/lib/types.ts; created_at is ISO-8601 and is
 * used to compute days-open.
 * User instruction, verbatim: "5. The list view should be presented differently, there's
 * a lot of whitespace which isn't good and when we extend the floating island, it just
 * overlaps the list view."
 *
 * Two audiences, one list: a civic worker wants the worst case first, a citizen wants to
 * see recent activity. The sort toggle covers both rather than guessing.
 *
 * LAYOUT NOTES (measured on a 393x852 iPhone 14 Pro, not eyeballed):
 *  - Top padding was a hardcoded `pt-[248px]` tuned to the expanded island's height. The
 *    island actually measured 249px tall with its top at y=12, so its bottom edge sat at
 *    y=261 and covered the first 13px of this list. A constant coupled to another
 *    component's rendered height is a bug waiting for that component to change — and it
 *    already had. It now reads a live `--island-h` custom property that page.tsx keeps
 *    updated with a ResizeObserver, so the two can never drift again.
 *  - That also removes the dead band: collapsed, the island is ~72px, so the list starts
 *    right under it instead of 248px down.
 *  - Rows were three stacked lines with a wide dead gap between the status text and the
 *    age. Now two lines, with the age moved onto the metadata line.
 */

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Report, ReportStatus } from "@/lib/types";
import { wardName } from "@/lib/wards";
import { translate, type Lang } from "@/lib/i18n";

export type SortMode = "severity" | "recent";

/** Position never overshoots — see the Segmented note in src/app/page.tsx. */
const SORT_SPRING = { type: "spring" as const, bounce: 0, duration: 0.32 };
const SORT_STRETCH_MS = 170;

const STATUS_COLOUR: Record<ReportStatus, string> = {
  open: "#ff3b30",
  claimed: "#ffb020",
  verified_resolved: "#22c98a",
};

const STATUS_KEY: Record<ReportStatus, string> = {
  open: "status_open",
  claimed: "status_claimed",
  verified_resolved: "status_verified",
};

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default function ListView({
  reports,
  sort,
  onSort,
  onSelect,
  onBackToMap,
  lang,
}: {
  reports: Report[];
  sort: SortMode;
  onSort: (s: SortMode) => void;
  onSelect: (r: Report) => void;
  /**
   * The view switch lives in the island, which is collapsed over this surface. Rather
   * than making "go back to the map" a two-tap trip through a HUD, the list carries its
   * own escape hatch.
   */
  onBackToMap: () => void;
  lang: Lang;
}) {
  const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);

  const uid = useId();
  const reduce = useReducedMotion();
  const [stretching, setStretching] = useState(false);
  const prevSort = useRef(sort);
  useEffect(() => {
    if (prevSort.current === sort) return;
    prevSort.current = sort;
    if (reduce) return;
    setStretching(true);
    const timer = window.setTimeout(() => setStretching(false), SORT_STRETCH_MS);
    return () => window.clearTimeout(timer);
  }, [sort, reduce]);

  const sorted = useMemo(() => {
    const rows = [...reports];
    if (sort === "severity") {
      // Worst first: severity desc, then oldest first — a severe spot ignored for
      // three weeks outranks a severe spot reported this morning.
      rows.sort(
        (a, b) =>
          b.severity - a.severity ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    } else {
      rows.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return rows;
  }, [reports, sort]);

  return (
    <div
      className="h-full w-full overflow-y-auto bg-[#070a0f] px-3 pb-40"
      style={{
        // Live island height + a 12px breathing gap. Fallback covers the first paint
        // before the ResizeObserver has reported.
        paddingTop: "calc(var(--island-h, 72px) + 0.75rem)",
      }}
    >
      <div className="mx-auto max-w-md">
        {/* controls: sort on the left, escape back to the map on the right */}
        <div className="mb-2.5 flex items-center gap-2">
          {/* Same travelling thumb as the island's segmented controls — see Segmented
              in src/app/page.tsx for why position carries no bounce. */}
          <div className="flex flex-1 gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
            {(["severity", "recent"] as SortMode[]).map((mode) => {
              const active = sort === mode;
              return (
                <button
                  key={mode}
                  onClick={() => onSort(mode)}
                  aria-pressed={active}
                  // h-9 measured 36px — 8px under the 44px touch floor.
                  className="group relative h-11 flex-1 rounded-full text-xs font-medium"
                >
                  {active && (
                    <motion.span
                      aria-hidden
                      layoutId={`sort-thumb-${uid}`}
                      transition={reduce ? { duration: 0 } : SORT_SPRING}
                      className="absolute inset-0 rounded-full"
                    >
                      <span
                        className="block h-full w-full rounded-full bg-white"
                        style={{
                          transform: stretching ? "scaleX(1.07)" : "scaleX(1)",
                          transition: `transform ${SORT_STRETCH_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`,
                        }}
                      />
                    </motion.span>
                  )}
                  <span
                    className={`relative z-10 transition-colors duration-200 ${
                      active ? "text-black" : "text-white/60 group-hover:text-white/85"
                    }`}
                  >
                    {t(mode === "severity" ? "sort_by_severity" : "sort_by_recent")}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={onBackToMap}
            aria-label={t("map_view")}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-xs font-medium text-white/70 transition-colors duration-300 active:bg-white/10"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M1 3.5L5 1.5v9L1 12.5v-9zM5 1.5l4 2v9l-4-2v-9zM9 3.5l4-2v9l-4 2v-9z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            {t("map_view")}
          </button>
        </div>

        {/*
          The list never said how big it was, so "worst first" had no denominator —
          you could not tell whether you were looking at 8 cases or 800, or whether a
          filter had actually taken effect.
        */}
        {sorted.length > 0 && (
          <p className="mb-2 px-1 text-[11px] text-white/60">
            {t("showing_n", { n: sorted.length })}
          </p>
        )}

        {sorted.length === 0 && (
          <p className="py-12 text-center text-sm text-white/55">{t("no_reports")}</p>
        )}

        <ul className="space-y-1.5">
          {sorted.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onSelect(r)}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2 text-left transition-colors duration-300 active:bg-white/[0.08]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.photo_before_url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: STATUS_COLOUR[r.status],
                        boxShadow: `0 0 8px ${STATUS_COLOUR[r.status]}`,
                      }}
                    />
                    <span className="truncate text-sm font-medium text-white/90">
                      {t(`waste_${r.waste_type}`)}
                    </span>
                    {r.is_recurring && (
                      <span className="shrink-0 rounded-full bg-[#ffb020]/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[#ffd591]">
                        {t("recurring")}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-white/60">
                      {/*
                        Rows marked "Verified clean" were also reading "45d open" —
                        flatly contradictory. daysSince(created_at) measures the age of
                        the REPORT, which is "days open" only while the case is still
                        open. The close date lives on Resolution.verified_at, which this
                        list's payload does not carry, so rather than invent one the
                        label now says what the number actually measures.
                      */}
                      {r.status === "verified_resolved"
                        ? t("days_ago", { n: daysSince(r.created_at) })
                        : t("days_open", { n: daysSince(r.created_at) })}
                    </span>
                  </span>

                  {/* Everything else on one metadata line — three lines of it was air. */}
                  <span className="mt-1 flex items-center gap-1.5 text-[11px] text-white/55">
                    <SeverityBar n={r.severity} />
                    <span className="truncate">
                      {r.ward_id ? `${wardName(r.ward_id)} · ` : ""}
                      {t(STATUS_KEY[r.status])}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Severity as five pips rather than "Severity 4/5". Scanning a long list for the bad ones
 * is a shape-matching task, and shapes beat re-reading the same six characters per row.
 *
 * DELIBERATELY MONOCHROME. The pips used to be red/amber/grey by severity, which put two
 * different colour systems in one row: a row could show five RED severity pips beside a
 * GREEN "verified clean" status dot, and the eye reads the larger red mass first and
 * concludes the case is bad. In this product colour means STATUS and nothing else —
 * severity is encoded by how many pips are lit, which is a length judgement and does not
 * compete with the status dot.
 */
function SeverityBar({ n }: { n: number }) {
  return (
    <span
      className="flex shrink-0 items-center gap-[2px]"
      aria-label={`Severity ${n} of 5`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="h-[3px] w-[7px] rounded-full"
          style={{ backgroundColor: i <= n ? "#ffffffb8" : "#ffffff24" }}
        />
      ))}
    </span>
  );
}
