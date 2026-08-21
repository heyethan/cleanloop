"use client";

/**
 * Ward leaderboard — spec §3 Flow C / §12.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports Leaderboard (default); calls GET /api/leaderboard.
 * Data schemas: consumes LeaderboardRow {ward_id, ward_name, total_reports,
 * total_verified_resolutions, verified_resolution_rate, avg_days_to_verified_resolution}.
 * User instruction, verbatim: "also improve the ui/ux of the website"
 *
 * UX applied:
 *  - GOAL GRADIENT: each ward shows a closure bar, so progress toward "all clear"
 *    is visible rather than implied by a number.
 *  - ANCHORING: sorted and visually led by days-to-VERIFIED, never complaint count.
 */

import { useEffect, useState } from "react";
import Sheet from "@/components/Sheet";
import { translate, type Lang } from "@/lib/i18n";
import { ThinkingOrb } from "thinking-orbs";

interface Row {
  ward_id: string;
  ward_name: string;
  total_reports: number;
  total_verified_resolutions: number;
  verified_resolution_rate: number | null;
  avg_days_to_verified_resolution: number | null;
}

export default function Leaderboard({
  lang,
  onClose,
}: {
  lang: Lang;
  onClose: () => void;
}) {
  const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/leaderboard");
        const json = await res.json();
        if (json.error) setError(json.error);
        else setRows(json.leaderboard);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ranked = rows.filter((r) => r.avg_days_to_verified_resolution != null);
  const best = ranked[0];
  /*
   * Accountability has to cut both ways. Badging only the fastest ward makes this a
   * congratulations board; naming the slowest is what gives a citizen something to
   * point at. Only marked when there are enough ranked wards for "slowest" to mean
   * anything — with two wards it is just "the other one".
   */
  const worst = ranked.length >= 4 ? ranked[ranked.length - 1] : undefined;

  return (
    <Sheet eyebrow={t("accountability")} title={t("ward_performance")} onClose={onClose}>
      <p className="-mt-2 mb-4 text-[11px] leading-relaxed text-white/60">
        Ranked by average days to <span className="text-white/75">verified</span>{" "}
        resolution. Complaint volume is shown but never ranked on — counting
        complaints rewards noise, not outcomes.
      </p>

      {loading && (
        <div className="flex items-center justify-center gap-2.5 py-10 text-xs text-white/55">
          <ThinkingOrb state="working" size={20} theme="dark" aria-label={t("loading")} />
          {t("loading")}
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-400/25 bg-red-400/10 p-3 text-[11px] text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="py-10 text-center text-xs text-white/55">No reports yet.</div>
      )}

      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r, i) => {
            /*
             * Bar length as a share of the SLOWEST ward's time, inverted so faster is
             * longer. Scaling against the slowest keeps the whole bar range in use
             * instead of everything hugging one end.
             */
            const days = r.avg_days_to_verified_resolution;
            const slowestDays = worst?.avg_days_to_verified_resolution ?? days ?? 1;
            const speedShare =
              days == null || !slowestDays ? 0 : Math.max(0.08, 1 - days / (slowestDays * 1.15));
            const isBest = best?.ward_id === r.ward_id;
            const isWorst = worst?.ward_id === r.ward_id;
            return (
              <div
                key={r.ward_id}
                className={`rounded-2xl border p-3.5 ${
                  isBest
                    ? "border-[#22c98a]/30 bg-[#22c98a]/[0.07]"
                    : isWorst
                      ? "border-[#ff9d8a]/25 bg-[#ff6b5e]/[0.06]"
                      : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex min-w-0 items-baseline gap-2.5">
                    <span className="w-4 shrink-0 text-[11px] tabular-nums text-white/60">
                      {i + 1}
                    </span>
                    <span className="truncate text-sm font-medium text-white/90">
                      {r.ward_name}
                    </span>
                    {isBest && (
                      <span className="shrink-0 rounded-full bg-[#22c98a]/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-[#7df0c0]">
                        {t("fastest")}
                      </span>
                    )}
                    {isWorst && (
                      <span className="shrink-0 rounded-full bg-[#ff6b5e]/20 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-[#ffb0a5]">
                        {t("slowest")}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-white/90">
                    {r.avg_days_to_verified_resolution == null
                      ? "—"
                      : `${r.avg_days_to_verified_resolution.toFixed(1)}d`}
                  </span>
                </div>

                {/*
                  The bar now encodes SPEED — the metric this list is ranked by.
                  It used to encode percent-verified while the ranking was days-to-
                  verified, so Koramangala at 42% sat above Yelahanka at 83% with a
                  shorter bar: the ranking and the only graphic on the row disagreed.
                  Longer bar = faster, so the bars descend in step with the ranking.
                */}
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                      isWorst ? "bg-[#ff6b5e]" : "bg-[#22c98a]"
                    }`}
                    style={{ width: `${Math.round(speedShare * 100)}%` }}
                  />
                </div>

                {/*
                  The trailing "42%" was the same fact as "5 of 12 verified", stated
                  twice on one line. The fraction survives because it is the more
                  concrete of the two — a citizen can hold "5 of 12" in their head.
                */}
                <div className="mt-1.5 text-[10px] text-white/60">
                  {t("verified_of", { a: r.total_verified_resolutions, b: r.total_reports })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/*
        Was: "Wards are nearest-locality approximations from OpenStreetMap, not official
        BBMP ward boundaries." Three pieces of sourcing jargon to make one point. The
        point is worth keeping — these are not official ward lines and we should not
        imply they are — so it survives in six words instead of twenty.
      */}
      <p className="mt-4 text-[10px] leading-relaxed text-white/60">
        Locality areas are approximate.
      </p>
    </Sheet>
  );
}
