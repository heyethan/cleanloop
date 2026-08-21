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

import { useMemo } from "react";
import type { Report, ReportStatus } from "@/lib/types";
import { wardName } from "@/lib/wards";
import { translate, type Lang } from "@/lib/i18n";

export type SortMode = "severity" | "recent";

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
          <div className="flex flex-1 gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
            {(["severity", "recent"] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onSort(mode)}
                className={`h-9 flex-1 rounded-full text-xs font-medium transition-colors duration-300 ${
                  sort === mode
                    ? "bg-white text-black"
                    : "text-white/60 hover:text-white/85"
                }`}
              >
                {t(mode === "severity" ? "sort_by_severity" : "sort_by_recent")}
              </button>
            ))}
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
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-white/45">
                      {t("days_open", { n: daysSince(r.created_at) })}
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
          style={{
            backgroundColor:
              i <= n
                ? n >= 4
                  ? "#ff6b5e"
                  : n === 3
                    ? "#ffb020"
                    : "#8aa0b8"
                : "#ffffff1f",
          }}
        />
      ))}
    </span>
  );
}
