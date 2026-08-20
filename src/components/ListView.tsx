"use client";

/**
 * List view — browse and triage cases without the map.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports ListView (default) and the SortMode type.
 * Data schemas: consumes Report[] from src/lib/types.ts; created_at is ISO-8601 and is
 * used to compute days-open.
 * User instruction, verbatim: "We already have a map view, which is good, give an option
 * for list view as well so we can explore cases by list" + "Both, with a sort toggle"
 *
 * Two audiences, one list: a civic worker wants the worst case first, a citizen wants to
 * see recent activity. The sort toggle covers both rather than guessing.
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
  lang,
}: {
  reports: Report[];
  sort: SortMode;
  onSort: (s: SortMode) => void;
  onSelect: (r: Report) => void;
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
    <div className="h-full w-full overflow-y-auto bg-[#070a0f] px-3 pb-40 pt-[248px] sm:pt-[232px]">
      <div className="mx-auto max-w-md">
        {/* sort toggle */}
        <div className="mb-3 flex gap-1.5 rounded-full border border-white/10 bg-white/[0.04] p-1">
          {(["severity", "recent"] as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onSort(mode)}
              className={`h-9 flex-1 rounded-full text-xs font-medium transition-colors duration-300 ${
                sort === mode ? "bg-white text-black" : "text-white/60 hover:text-white/85"
              }`}
            >
              {t(mode === "severity" ? "sort_by_severity" : "sort_by_recent")}
            </button>
          ))}
        </div>

        {sorted.length === 0 && (
          <p className="py-12 text-center text-sm text-white/55">{t("no_reports")}</p>
        )}

        <ul className="space-y-2">
          {sorted.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onSelect(r)}
                className="flex w-full gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5 text-left transition-colors duration-300 active:bg-white/[0.08]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.photo_before_url}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-xl object-cover"
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
                  </span>

                  <span className="mt-1 block truncate text-[11px] text-white/60">
                    {t("severity_of", { n: r.severity })}
                    {r.ward_id ? ` · ${wardName(r.ward_id)}` : ""}
                  </span>

                  <span className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="text-white/55">{t(STATUS_KEY[r.status])}</span>
                    <span className="text-white/45">
                      {t("days_open", { n: daysSince(r.created_at) })}
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
